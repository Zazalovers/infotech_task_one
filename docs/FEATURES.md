# Features

Each feature lists the assignment requirement it covers and testable acceptance criteria. Details live in [SPEC.md](SPEC.md); the build order is in [BACKLOG.md](BACKLOG.md).

| # | Feature | Requirement | Priority |
|---|---|---|---|
| F1 | Layered architecture with enforced boundaries | 1. Architecture | Must |
| F2 | PostgreSQL schema, migrations, seed | 2. Database | Must |
| F3 | Env-based configuration | 2. Database | Must |
| F4 | Enqueue email endpoint | 3. Email queue | Must |
| F5 | Background worker sending via Resend | 3. Email queue | Must |
| F6 | Job status tracking + retries | 3. Email queue | Must |
| F7 | Email job query endpoints | 3. Email queue (visibility) | Should |
| F8 | Health check endpoint | 4. Healthcheck | Must |
| F9 | Production deployment | 4. Healthcheck | Must |
| F10 | Asniher.com uptime monitor | 4. Healthcheck | Must |
| F11 | API key protection | Safety of public deploy | Should |
| F12 | Structured logging & graceful shutdown | Production readiness | Should |
| F13 | Automated tests & CI | Quality | Should |
| F14 | README, `.env.example`, clean history | 5. Delivery | Must |

---

## F1 — Layered architecture

Code is split into `api`, `services`, `data`, `models` (plus `worker` and `config` entrypoint/cross-cutting folders).

- [ ] Controllers only parse/validate input, call one service method, and shape the HTTP response.
- [ ] Services contain no `express` imports, no status codes, no SQL.
- [ ] All SQL is in `src/data/repositories/*`.
- [ ] `models` contains only types/enums/DTOs.
- [ ] `npm run lint:arch` (dependency-cruiser) fails if `api` imports `data`, `services` imports `api`, etc.
- [ ] CI grep finds no SQL keywords outside `src/data/` and `migrations/`.

## F2 — Database schema, migrations, seed

- [ ] `npm run migrate:up` creates `email_jobs`, the `email_job_status` enum (`pending`, `sent`, `failed`) and indexes on an empty DB.
- [ ] `npm run migrate:down` rolls it back cleanly.
- [ ] `npm run seed` inserts sample jobs covering all three statuses; running it twice creates no duplicates.

## F3 — Environment configuration

- [ ] DB connection comes from `DATABASE_URL` or `PG*` variables only — nothing hard-coded.
- [ ] Missing required vars stop startup with a readable error listing them.
- [ ] `.env.example` documents every variable with placeholders.

## F4 — Enqueue email (`POST /emails`)

- [ ] Valid request → `202` with a job `id` and `status: "pending"`; a row exists in `email_jobs`.
- [ ] The request handler never calls Resend (verified by a test with a spy sender).
- [ ] Invalid email/subject/body → `400` with field-level `details`.
- [ ] Same `idempotencyKey` twice → second call returns the original job (`200`), no new row.

## F5 — Background worker

- [ ] Worker polls the DB and claims due `pending` jobs using `FOR UPDATE SKIP LOCKED`.
- [ ] Each claimed job is sent through Resend with `from = EMAIL_FROM`.
- [ ] Runs in-process with the API when `WORKER_ENABLED=true`, or standalone via `npm run start:worker`.
- [ ] Two worker instances never send the same job.
- [ ] A job whose worker crashed is picked up again after its lease expires.

## F6 — Status tracking & retries

- [ ] Successful send → `status = sent`, `sent_at` and `provider_message_id` stored.
- [ ] Failed send with attempts left → stays `pending`, `attempts` +1, `last_error` stored, `next_attempt_at` delayed with exponential backoff.
- [ ] After `max_attempts` (default 4 = 1 try + **3 retries**) → `status = failed`.
- [ ] `EMAIL_MAX_ATTEMPTS` below 4 is rejected at startup.
- [ ] Job id is passed to Resend as the idempotency key.

## F7 — Query email jobs

- [ ] `GET /emails/:id` → `200` with status, attempts, last error; `404` if unknown; `400` if not a uuid.
- [ ] `GET /emails?status=&limit=&offset=` → paginated list, newest first, filterable by status.

## F8 — Health check (`GET /health`)

- [ ] DB reachable → `200` with `app.status = "up"` and `database.status = "up"` + `latencyMs`.
- [ ] DB unreachable or check exceeds 2 s → `503` with `database.status = "down"`.
- [ ] Response is `Cache-Control: no-store`, needs no auth, and leaks no connection details.
- [ ] Health check SQL lives in `healthRepository` (layer rules still apply).

## F9 — Deployment

- [ ] App deployed on Render (or Railway) with managed Postgres and a public HTTPS URL.
- [ ] Migrations run automatically on deploy.
- [ ] Secrets are set in the host's env settings, not in the repo.
- [ ] `POST /emails` on the live URL results in a real delivered email (visible in the Resend dashboard).

## F10 — Asniher.com monitor

Monitors M1–M4 and the status page are described in SPEC §7.2.

- [ ] **M1** HTTP(S) monitor on `https://<app>/health` expecting `2xx`, interval ≤ 5 min.
- [ ] **M2** keyword monitor: `"database":{"status":"up"` must be present.
- [ ] **M3** SSL certificate monitor (optional).
- [ ] **M4** heartbeat monitor: the worker pings `ASNIHER_HEARTBEAT_URL` at most once a minute; a failed ping never breaks job processing.
- [ ] Alert contact configured (account email, optionally Discord or Slack).
- [ ] Public status page showing M1 and M4, linked in the README (optional).
- [ ] Down detection shown once: DB made unreachable → M1 goes down and an alert arrives → restored.
- [ ] Screenshots in `docs/monitoring/` (`asniher-monitor.png` required; dashboard and incident shots optional), embedded in the README.

## F11 — API key protection

- [ ] `/emails*` requires `x-api-key` matching `API_KEY`; otherwise `401`.
- [ ] Comparison is constant-time.
- [ ] `/health` stays public.

## F12 — Logging & graceful shutdown

- [ ] JSON request logs with request id and duration.
- [ ] Worker logs every state transition with `jobId` and `attempt`.
- [ ] Secrets and email bodies are never logged.
- [ ] `SIGTERM` stops claiming, finishes in-flight sends, closes the HTTP server and DB pool.

## F13 — Tests & CI

- [ ] Unit tests: retry policy, email service, job processor (fake sender/repo).
- [ ] Integration tests: repositories and claim query against real Postgres.
- [ ] API tests: validation, auth, 202/404, health 200/503.
- [ ] GitHub Actions runs lint, arch rules, typecheck, tests on every push.

## F14 — Delivery

- [ ] README: overview, Mermaid architecture diagram, setup, env vars, migrations/seed, example `curl` requests, deploy steps, live URL, monitor screenshot.
- [ ] `.env.example` committed; `.env` git-ignored; no real keys in any commit.
- [ ] Linear history of small conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

---

## Out of scope

- Multiple recipients, CC/BCC, attachments, templates.
- User accounts / OAuth.
- Resend webhooks (delivered/bounced/opened events).
- A separate message broker (Redis, RabbitMQ, SQS) — Postgres is the queue.
