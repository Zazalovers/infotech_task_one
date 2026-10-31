# Technical Specification — Mail Queue Service

A small monolithic backend that accepts email requests over HTTP, stores them as jobs in PostgreSQL, and delivers them through Resend from a background worker. A `/health` endpoint is monitored in production on Asniher.com.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS + TypeScript (strict) | Typed DTOs/entities, one language for API and worker |
| HTTP framework | Express 5 | Small, async error handling built in |
| Validation | zod | Schemas double as TypeScript types for DTOs |
| Database | PostgreSQL 16 | Required; also serves as the queue (no Redis needed) |
| DB driver | `pg` (node-postgres), raw parameterized SQL | Keeps every query visible inside `src/data/` |
| Migrations | Small built-in runner (`src/data/migrator.ts`) over plain SQL files | Up/down migrations, tracked in `schema_migrations`, advisory-locked; works with `DATABASE_URL` or `PG*` |
| Email provider | `resend` Node SDK | Required |
| Logging | `pino` (JSON logs) | Structured logs readable in the host's log viewer |
| Tests | `vitest` + `supertest`, Postgres via docker compose | Real DB for repository/integration tests |
| Layer enforcement | `dependency-cruiser` in CI | Fails the build if a layer imports the wrong layer |
| Local infra | Docker Compose (Postgres) | One command to get a DB |
| Hosting | Render (Web Service + Render Postgres) — alt: Railway | Free tier, HTTPS URL for monitoring |

---

## 2. Architecture

### 2.1 Layers

```
            ┌──────────────────────────────┐   ┌───────────────────────┐
 HTTP ───▶  │ api                          │   │ worker (entrypoint)   │
            │ routes, controllers,         │   │ poll loop, no HTTP    │
            │ zod validation, HTTP errors  │   │                       │
            └──────────────┬───────────────┘   └───────────┬───────────┘
                           ▼                               ▼
            ┌──────────────────────────────────────────────────────────┐
            │ services — business logic, retry policy, EmailSender port│──▶ Resend API
            └──────────────────────────┬───────────────────────────────┘
                                       ▼
            ┌──────────────────────────────────────────────────────────┐
            │ data — pg pool, repositories (ALL SQL lives here)         │──▶ PostgreSQL
            └──────────────────────────┬───────────────────────────────┘
                                       ▼
            ┌──────────────────────────────────────────────────────────┐
            │ models — entities, DTOs, enums (types only, no logic/IO)  │
            └──────────────────────────────────────────────────────────┘
```

### 2.2 Layer rules (enforced)

| Layer | May import | Must NOT contain |
|---|---|---|
| `api` | `services`, `models`, `config` | SQL, `pg`, `resend`, business rules |
| `worker` | `services`, `models`, `config` | SQL, `pg`, `express`, HTTP status codes |
| `services` | `data`, `models`, `config` | `express`, `req`/`res`, status codes, SQL |
| `data` | `models`, `config` | `express`, business rules, `resend` |
| `models` | nothing (other models only) | I/O of any kind |

- `models` are plain types/DTOs; every layer may *reference* them, but "calls" only go downward: api → services → data.
- `config` (env parsing) is cross-cutting and has no dependencies on other layers.
- The worker is a second entrypoint at the same level as `api`; it only calls services.
- The Resend client lives in `services/providers/` behind an `EmailSender` interface (`services/ports/`), so services can be unit-tested with a fake sender. It is not DB access, so it does not belong in `data`.
- Services throw domain errors (`NotFoundError`, `DomainValidationError`) with no HTTP knowledge; `api/middleware/errorHandler.ts` maps them to status codes.
- Enforced by `.dependency-cruiser.cjs` (run in `npm run lint` and CI) and a CI grep that fails if `SELECT|INSERT|UPDATE|DELETE` appears outside `src/data/` and `migrations/`.

### 2.3 Folder layout

```
src/
  api/
    app.ts                     # builds the Express app (no listen)
    routes/                    # emails.routes.ts, health.routes.ts
    controllers/               # emails.controller.ts, health.controller.ts
    validators/                # zod schemas for body/params/query
    middleware/                # apiKeyAuth.ts, errorHandler.ts, requestLogger.ts
  services/
    emailService.ts            # enqueue, getById, list
    emailJobProcessor.ts       # claim → send → mark sent / schedule retry / fail
    healthService.ts
    monitoringService.ts       # reportWorkerAlive() → heartbeat (throttled)
    retryPolicy.ts             # backoff calculation (pure)
    errors.ts                  # domain errors
    ports/emailSender.ts       # interface EmailSender
    ports/heartbeatPinger.ts   # interface HeartbeatPinger
    providers/resendEmailSender.ts
    providers/asniherHeartbeat.ts
  data/
    db.ts                      # pg Pool from env config
    repositories/
      emailJobRepository.ts
      healthRepository.ts      # SELECT 1 with timeout
  models/
    emailJob.ts                # EmailJob entity, EmailJobStatus enum
    dto/                       # CreateEmailRequest, EmailJobResponse, HealthResponse
  worker/
    worker.ts                  # poll loop, graceful stop
  config/
    env.ts                     # zod-validated process.env
    logger.ts                  # pino logger with redaction
  container.ts                 # composition root: wires repos → services → api/worker
  server.ts                    # entrypoint: API (+ worker if WORKER_ENABLED)
  worker-main.ts               # entrypoint: worker only
migrations/                    # NNN_name.up.sql / NNN_name.down.sql
scripts/seed.ts
tests/{unit,integration}/
docs/                          # SPEC, FEATURES, BACKLOG, monitoring screenshot
```

### 2.4 Process model

One codebase, one deployable. Two start modes:

- `npm start` → API; also starts the worker loop in-process when `WORKER_ENABLED=true` (default in production so a single free-tier service is enough).
- `npm run start:worker` → worker only (for running it as a separate process later).

Because jobs are claimed with `FOR UPDATE SKIP LOCKED`, running several worker instances is safe.

---

## 3. Data model

### 3.1 Table `email_jobs`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `to_address` | `text` NOT NULL | Single recipient (keeps scope small) |
| `subject` | `text` NOT NULL | |
| `html_body` | `text` NULL | At least one of html/text required (CHECK) |
| `text_body` | `text` NULL | |
| `status` | `email_job_status` enum NOT NULL default `'pending'` | `pending`, `sent`, `failed` |
| `attempts` | `int` NOT NULL default 0 | Incremented when a worker claims the job |
| `max_attempts` | `int` NOT NULL default 4 | 1 initial try + 3 retries |
| `next_attempt_at` | `timestamptz` NOT NULL default `now()` | Backoff scheduling |
| `locked_until` | `timestamptz` NULL | Lease; expired lease = job is claimable again |
| `last_error` | `text` NULL | Last provider/network error message |
| `provider_message_id` | `text` NULL | Resend email id |
| `idempotency_key` | `text` NULL UNIQUE | Optional client-supplied key |
| `sent_at` | `timestamptz` NULL | |
| `created_at` / `updated_at` | `timestamptz` NOT NULL default `now()` | `updated_at` set by repository on every update |

Indexes:
- `idx_email_jobs_claimable` on `(next_attempt_at)` `WHERE status = 'pending'` — the worker's hot query.
- `idx_email_jobs_status_created` on `(status, created_at DESC)` — list endpoint.

### 3.2 Status semantics

```
            enqueue
               │
               ▼
          ┌─────────┐  send ok            ┌──────┐
          │ pending │ ──────────────────▶ │ sent │
          └─────────┘                     └──────┘
            ▲     │ send error
            │     │ attempts < max_attempts
            └─────┘ (next_attempt_at = now + backoff)
                  │ send error AND attempts >= max_attempts
                  ▼
              ┌────────┐
              │ failed │
              └────────┘
```

- A transient failure keeps the job `pending` with `attempts` incremented, `last_error` set and `next_attempt_at` pushed out. Only after the final attempt does it become `failed`.
- "Processing" is represented by an unexpired `locked_until`, not a separate status, so the stored statuses are exactly the three required.

### 3.3 Migrations

- `001_create_email_jobs.up.sql` / `.down.sql`: enum, table, CHECK constraints, indexes (`gen_random_uuid()` is built into PG 13+).
- Run with `npm run migrate:up` / `migrate:down`. In production, `npm start` runs the compiled migrator before starting the server.

### 3.4 Seed script

`npm run seed` (`scripts/seed.ts`) is idempotent (fixed `idempotency_key`s, `ON CONFLICT DO NOTHING`) and inserts:
- 2 `pending` jobs to `delivered@resend.dev` (Resend test address — succeeds without a verified domain),
- 1 `pending` job to `bounced@resend.dev`,
- 1 `sent` and 1 `failed` historical job so `GET /emails` shows every status.

The seed goes through the data layer's repository, not inline SQL.

---

## 4. Email queue & worker

### 4.1 Enqueue (API path)

`POST /emails` → controller validates with zod → `emailService.enqueue(dto)` → `emailJobRepository.insert()` → `202 Accepted` with the job. **No call to Resend in the request path.** If `idempotency_key` already exists, return the existing job with `200`.

### 4.2 Worker loop

Every `WORKER_POLL_INTERVAL_MS` (default 2000 ms):

1. **Claim** up to `WORKER_BATCH_SIZE` (default 10) jobs atomically:
   ```sql
   UPDATE email_jobs
      SET locked_until = now() + make_interval(secs => $2),
          attempts = attempts + 1,
          updated_at = now()
    WHERE id IN (
      SELECT id FROM email_jobs
       WHERE status = 'pending'
         AND next_attempt_at <= now()
         AND (locked_until IS NULL OR locked_until < now())
       ORDER BY next_attempt_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED)
   RETURNING *;
   ```
2. For each job, `emailSender.send({ from: EMAIL_FROM, to, subject, html, text }, { idempotencyKey: job.id })`.
3. **Success** → `markSent(id, providerMessageId)`: `status='sent'`, `sent_at=now()`, `locked_until=NULL`.
4. **Failure** →
   - `attempts < max_attempts` → `scheduleRetry(id, error, nextAttemptAt)`: stays `pending`, `locked_until=NULL`.
   - otherwise → `markFailed(id, error)`: `status='failed'`.
5. If the loop drained a full batch, poll again immediately; otherwise wait for the interval.

### 4.3 Retry policy

Exponential backoff with jitter, computed in `services/retryPolicy.ts` (pure function, unit tested):

`delay = EMAIL_RETRY_BASE_MS * 2^(attempts-1)` ± 20 % jitter. With the default base of 10 s: ~10 s, ~20 s, ~40 s → 4 attempts total, then `failed`.

All provider errors (network, 429, 5xx, and 4xx) are retried so the "at least 3 retries" rule always holds. Classifying permanent errors is a backlog stretch item.

### 4.4 Reliability details

- **Crash safety:** if the process dies mid-send, the lease expires (`WORKER_LOCK_SECONDS`, default 60) and another poll picks the job up.
- **Duplicate protection:** the job id is sent as Resend's idempotency key, so a retry after a crash between "Resend accepted" and "DB updated" is de-duplicated by Resend.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the worker stops claiming, waits for in-flight sends (max 10 s), then the pg pool is closed.
- **Send timeout:** each Resend call is wrapped in a 10 s timeout; a timeout counts as a failure.

### 4.5 Resend setup notes

- Without a verified domain, Resend only allows `from: onboarding@resend.dev` and delivery to your own account email or the `@resend.dev` test addresses. That is enough for the assignment; a verified domain is optional.
- The API key is read only from `RESEND_API_KEY`; it is never logged.

---

## 5. HTTP API

Base URL: `https://<service>.onrender.com`. JSON in/out. `/emails*` requires `x-api-key: <API_KEY>` (prevents strangers from sending mail through the public deployment). `/health` is public.

### 5.1 `POST /emails`

```json
{
  "to": "delivered@resend.dev",
  "subject": "Welcome",
  "html": "<p>Hello!</p>",
  "text": "Hello!",
  "idempotencyKey": "signup-42"
}
```
Validation: `to` valid email; `subject` 1–200 chars; `html` or `text` required, each ≤ 100 KB; `idempotencyKey` optional, ≤ 100 chars.

- `202` → `{ "id": "…", "status": "pending", "attempts": 0, "createdAt": "…" }`
- `200` → existing job for a repeated `idempotencyKey`
- `400` → `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [...] } }`
- `401` → missing/wrong API key

### 5.2 `GET /emails/:id`

`200` → full job view (`id, to, subject, status, attempts, maxAttempts, lastError, providerMessageId, nextAttemptAt, sentAt, createdAt, updatedAt`); `400` invalid uuid; `404` not found.

### 5.3 `GET /emails?status=pending&limit=20&offset=0`

`200` → `{ "items": [...], "limit": 20, "offset": 0 }`. `status` optional, one of the three values; `limit` 1–100, default 20.

### 5.4 `GET /health`

Runs `SELECT 1` with a 2 s timeout via `healthRepository`.

`200`
```json
{
  "status": "ok",
  "timestamp": "2026-10-31T12:00:00.000Z",
  "app": { "status": "up", "version": "1.0.0", "uptimeSeconds": 1234 },
  "database": { "status": "up", "latencyMs": 3 }
}
```
`503`
```json
{
  "status": "error",
  "timestamp": "…",
  "app": { "status": "up", "version": "1.0.0", "uptimeSeconds": 1234 },
  "database": { "status": "down", "error": "connection timeout" }
}
```
`Cache-Control: no-store`. The error string is generic (no hostnames/credentials).

### 5.5 Error format

All errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Unknown errors → `500` `INTERNAL_ERROR`, stack logged but never returned.

---

## 6. Configuration (environment variables)

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` / `test` / `production` |
| `PORT` | no | `3000` | HTTP port (Render injects it) |
| `LOG_LEVEL` | no | `info` | pino level |
| `DATABASE_URL` | one of | — | Full connection string; takes precedence |
| `PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE` | one of | — | Used when `DATABASE_URL` is absent |
| `DATABASE_SSL` | no | `false` | `true` on managed Postgres |
| `DATABASE_POOL_MAX` | no | `10` | pg pool size |
| `RESEND_API_KEY` | yes (worker) | — | Resend secret key |
| `EMAIL_FROM` | yes | `onboarding@resend.dev` | Sender address |
| `API_KEY` | yes | — | Shared secret for `/emails*` |
| `WORKER_ENABLED` | no | `true` | Run worker inside the API process |
| `WORKER_POLL_INTERVAL_MS` | no | `2000` | Poll interval |
| `WORKER_BATCH_SIZE` | no | `10` | Jobs claimed per poll |
| `WORKER_LOCK_SECONDS` | no | `60` | Lease duration |
| `EMAIL_MAX_ATTEMPTS` | no | `4` | Total attempts (must be ≥ 4 → ≥ 3 retries) |
| `EMAIL_RETRY_BASE_MS` | no | `10000` | Backoff base |
| `ASNIHER_HEARTBEAT_URL` | no | — | Asniher heartbeat ping URL; heartbeat disabled when empty |
| `HEARTBEAT_INTERVAL_MS` | no | `60000` | Minimum time between heartbeat pings |

`src/config/env.ts` validates these with zod at startup and exits with a clear message if something required is missing. `.env.example` lists every variable with placeholder values only.

---

## 7. Deployment & monitoring

### 7.1 Render

1. Create **Render Postgres** (free) → copy the *Internal Database URL*.
2. Create **Web Service** from the GitHub repo (or use `render.yaml` as a Blueprint):
   - Build: `npm ci --include=dev && npm run build`
   - Start: `npm start` (runs migrations, then the server)
   - Health check path: `/health`
   - Env vars from §6 (`DATABASE_SSL=true`, `WORKER_ENABLED=true`).
3. Optional: run `npm run seed` once from the Render shell.

Free-tier caveat: free web services sleep after inactivity; the Asniher monitor's periodic requests also keep it awake. Note Render's free Postgres expiry window in the README.

### 7.2 Asniher.com monitoring

Asniher (app.asniher.com) is a hosted uptime monitoring service. It offers HTTP(S)/keyword monitors, SSL monitors, heartbeat monitors and status pages, with alerts by email, Slack, Discord, Telegram or webhook. Monitors are created in the dashboard; the plan does not rely on an Asniher API.

| # | Monitor | Type | Target | Settings | Required? |
|---|---|---|---|---|---|
| M1 | API health | HTTP(S) | `GET https://<service>.onrender.com/health` | Expected status `200–299`; interval 1 min (5 min is fine on the free tier); timeout 10 s | **Yes**, the graded one |
| M2 | Health payload | Keyword | same URL | Keyword `"database":{"status":"up"` must be **present** | Recommended |
| M3 | TLS certificate | SSL | `<service>.onrender.com` | Alert 14 days before expiry | Optional |
| M4 | Email worker alive | Heartbeat | Asniher's unique ping URL | Period = 2 min, grace 2 min; the worker pings it after each poll cycle | Optional, recommended |
| — | Status page | Status page | M1 + M4 | Public page linked from the README | Optional |

Alerts: the account email (the default), plus optionally a Discord/Slack channel.

**Heartbeat (M4):** `/health` only proves the API and database are up; it says nothing about the worker. When `ASNIHER_HEARTBEAT_URL` is set, the worker sends a fire-and-forget `GET` to it at most once per `HEARTBEAT_INTERVAL_MS` (default 60 s) after a successful poll cycle. A cycle counts as successful even if some emails failed; it fails only when the database or loop errors. The call goes through a `HeartbeatPinger` port (`services/ports/heartbeatPinger.ts`, implemented in `services/providers/asniherHeartbeat.ts`). The worker calls `monitoringService.reportWorkerAlive()`; it never makes the HTTP call itself. A failed ping is logged at `warn` and never affects job processing.

**Verify alerting** (do this once, before taking the screenshot):
1. Point `DATABASE_URL` to a bad host (or suspend the Render DB) → `/health` returns `503` → M1 and M2 go **down** and an alert email arrives.
2. Restore it → the monitors go back **up**.
3. Optional: set `WORKER_ENABLED=false` → M4 goes **down** after the grace period → set it back.

**Screenshots** (`docs/monitoring/`):
- `asniher-monitor.png`: the M1 detail view with the URL, status and response-time chart. **Required.**
- `asniher-dashboard.png`: all monitors in the list.
- `asniher-incident.png`: the down/up incident from the verification step.

Embed them in the README under "Monitoring", together with the status page link.

### 7.3 Observability

- pino JSON logs with request id, method, path, status, duration; worker logs `job.claimed`, `job.sent`, `job.retry_scheduled`, `job.failed` with `jobId` and `attempt`.
- Never log the API key, Resend key, or email bodies.

---

## 8. Testing strategy

| Level | Scope | Tooling |
|---|---|---|
| Unit | `retryPolicy`, `emailService`, `emailJobProcessor` with fake repository + fake `EmailSender` | vitest |
| Integration | repositories against real Postgres (claim query, SKIP LOCKED, status transitions) | vitest + docker compose DB |
| API | routes end-to-end with supertest: validation, 202/404/401, `/health` 200 and 503 (stubbed health service) | supertest |
| Architecture | dependency-cruiser rules + SQL grep | CI |

Key scenarios: enqueue never calls the sender; success → `sent`; sender fails 3× then succeeds → `sent` with `attempts=4`; sender always fails → `failed` after exactly `max_attempts`; expired lease is re-claimed; two concurrent claimers never get the same job.

---

## 9. Delivery checklist

- Public GitHub repo, `main` branch, clean conventional-commit history (no "wip"/"fix typo" noise — squash locally before pushing).
- `README.md`: overview, Mermaid architecture diagram, local setup, env var table, migrations/seed, example `curl` requests, deployment, monitoring screenshot.
- `.env.example` committed; `.env` in `.gitignore`; no real keys anywhere in history (run `git log -p | grep -i re_` before pushing).
- GitHub Actions CI: install → lint (incl. layer rules) → typecheck → tests with Postgres service container.
