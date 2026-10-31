# Backlog

Ordered build plan. Each task is roughly one commit; the suggested commit message is shown in `code`. Feature ids refer to [FEATURES.md](FEATURES.md).

Legend: **S** ≈ < 1 h, **M** ≈ 1–3 h, **L** ≈ 3+ h.

---

## Milestone 0 — Project skeleton

- [ ] **T0.1** (S) `git init`, Node 22 + TypeScript strict, `tsx` for dev, `.gitignore` (`node_modules`, `dist`, `.env`), `.editorconfig`, Prettier, ESLint. — `chore: initialize TypeScript project`
- [ ] **T0.2** (S) Create empty layer folders `src/{api,services,data,models,worker,config}` and `.dependency-cruiser.cjs` with the layer rules from SPEC §2.2; `npm run lint:arch`. — `chore: add layer structure and dependency rules` (F1)
- [ ] **T0.3** (S) `docker-compose.yml` with Postgres 16 (+ a separate test database). — `chore: add docker compose for postgres`
- [ ] **T0.4** (S) `src/config/env.ts` with zod validation; `.env.example` with placeholders. — `feat: add validated environment config` (F3)

## Milestone 1 — Database

- [ ] **T1.1** (S) `src/data/db.ts` — pg `Pool` from `DATABASE_URL` or `PG*`, SSL flag, pool size. — `feat(data): add postgres connection pool` (F3)
- [ ] **T1.2** (M) node-pg-migrate setup + `001_create_email_jobs.sql` (enum, table, CHECK, indexes). — `feat(db): add email_jobs migration` (F2)
- [ ] **T1.3** (S) `src/models/emailJob.ts` entity + status enum; DTOs in `src/models/dto/`. — `feat(models): add email job entity and DTOs`
- [ ] **T1.4** (M) `emailJobRepository`: `insert`, `findById`, `findByIdempotencyKey`, `list`, `claimDue`, `markSent`, `scheduleRetry`, `markFailed`. Row ↔ entity mapping (snake_case → camelCase). — `feat(data): add email job repository` (F2)
- [ ] **T1.5** (M) Repository integration tests incl. concurrent `claimDue` (two connections, no overlap) and expired-lease reclaim. — `test(data): cover repository and claim query` (F13)
- [ ] **T1.6** (S) `scripts/seed.ts` via the repository, idempotent. — `feat: add seed script` (F2)

## Milestone 2 — API: enqueue & query

- [ ] **T2.1** (S) `services/errors.ts` domain errors; `api/middleware/errorHandler.ts` maps them to HTTP. — `feat(api): add error handling`
- [ ] **T2.2** (S) `api/app.ts`, `server.ts`, pino request logger with request id. — `feat(api): bootstrap express app` (F12)
- [ ] **T2.3** (M) `emailService.enqueue/getById/list` + unit tests with fake repo. — `feat(services): add email service` (F4, F7)
- [ ] **T2.4** (M) zod validators, `emails.controller.ts`, `emails.routes.ts` for `POST /emails`, `GET /emails/:id`, `GET /emails`. — `feat(api): add email endpoints` (F4, F7)
- [ ] **T2.5** (S) `apiKeyAuth` middleware (constant-time compare) on `/emails*`. — `feat(api): protect email endpoints with api key` (F11)
- [ ] **T2.6** (M) supertest API tests: 202, 400 details, 401, 404, idempotency, sender never called. — `test(api): cover email endpoints` (F13)

## Milestone 3 — Worker & Resend

- [ ] **T3.1** (S) `services/ports/emailSender.ts` interface + `providers/resendEmailSender.ts` (timeout, idempotency key, error normalization). — `feat(services): add resend email sender` (F5)
- [ ] **T3.2** (S) `services/retryPolicy.ts` (exponential backoff + jitter) + unit tests. — `feat(services): add retry backoff policy` (F6)
- [ ] **T3.3** (M) `emailJobProcessor.processBatch()` — claim → send → `markSent` / `scheduleRetry` / `markFailed`. Unit tests: success, 3 failures then success, always fails → `failed` after exactly 4 attempts. — `feat(services): add email job processor` (F5, F6)
- [ ] **T3.4** (M) `worker/worker.ts` poll loop (drain-then-sleep), `worker-main.ts`, in-process start behind `WORKER_ENABLED`, graceful shutdown. — `feat(worker): add background email worker` (F5, F12)
- [ ] **T3.5** (S) Manual check with a real Resend key: send to `delivered@resend.dev`, check Resend dashboard; send with an invalid key to watch retries → `failed`. — no commit (note results in README)

## Milestone 4 — Health check

- [ ] **T4.1** (S) `healthRepository.ping()` (`SELECT 1`, 2 s timeout). — `feat(data): add database ping`
- [ ] **T4.2** (S) `healthService.check()` returns app + db status (no HTTP codes). — `feat(services): add health service` (F8)
- [ ] **T4.3** (S) `GET /health` controller: 200 / 503, `Cache-Control: no-store`. — `feat(api): add health endpoint` (F8)
- [ ] **T4.4** (S) Tests: DB up → 200; DB stubbed down → 503. — `test(api): cover health endpoint` (F13)

## Milestone 5 — CI

- [ ] **T5.1** (M) GitHub Actions: `npm ci` → lint → `lint:arch` → SQL-outside-data grep → typecheck → tests with Postgres service container. — `ci: add github actions workflow` (F1, F13)

## Milestone 6 — Deploy & monitor

- [ ] **T6.1** (S) Production scripts: `build`, `start`, `start:worker`, `migrate:up`; `engines.node`. — `chore: add production scripts`
- [ ] **T6.2** (M) Render: Postgres + Web Service, env vars, health check path, auto-migrate. Smoke test live URL (`/health`, `POST /emails`). (F9)
- [ ] **T6.3** (S) Worker heartbeat: `HeartbeatPinger` port + `asniherHeartbeat` provider + `monitoringService.reportWorkerAlive()` (throttled, errors swallowed and logged) + unit test; env vars in config, `.env.example` and README. — `feat(worker): ping asniher heartbeat after each poll cycle` (F10)
- [ ] **T6.4** (S) At app.asniher.com: create M1 (HTTP `/health`, 2xx, 1–5 min), M2 (keyword), M3 (SSL), and M4 (heartbeat, 2 min period + 2 min grace). Copy M4's ping URL into `ASNIHER_HEARTBEAT_URL` on Render. Set up the alert email. (F10)
- [ ] **T6.5** (S) Optional: Asniher status page with M1 and M4. (F10)
- [ ] **T6.6** (S) Make the DB unreachable → confirm the monitor goes down and an alert arrives → restore. (F10)
- [ ] **T6.7** (S) Screenshots → `docs/monitoring/asniher-monitor.png` (+ dashboard and incident). — `docs: add monitoring screenshots` (F10)

## Milestone 6b — Cloudflare Workers (alternative to Render)

- [x] **T6b.1** Cloudflare entrypoint (`src/cloudflare/index.ts`): Express via `httpServerHandler`, cron → `drainQueue()`, lazy init. — `feat(cloudflare): add Workers entrypoint with cron-driven email worker`
- [x] **T6b.2** `wrangler.jsonc` (Hyperdrive, cron, vars), `.dev.vars.example`, `cf:*` scripts, CI bundle check.
- [x] **T6b.3** Verified locally with `wrangler dev`: `/health` 200/503, enqueue 202/401, cron run → retries → `failed`.
- [ ] **T6b.4** Create Neon DB, run migrations, `wrangler hyperdrive create`, put the id in `wrangler.jsonc`, set secrets, `npm run cf:deploy`. See [DEPLOY_CLOUDFLARE.md](DEPLOY_CLOUDFLARE.md).
- [ ] **T6b.5** Point the Asniher monitors at the `workers.dev` URL; set `ASNIHER_HEARTBEAT_URL` secret.

## Milestone 7 — Delivery

- [ ] **T7.1** (M) README: overview, Mermaid diagram, setup, env table, migrations/seed, `curl` examples, deploy, live URL, monitor screenshot. — `docs: write README` (F14)
- [ ] **T7.2** (S) Secret audit: `git log -p | grep -iE "re_[a-z0-9]|password="`; confirm `.env` never committed. (F14)
- [ ] **T7.3** (S) Review history (`git log --oneline`), tidy unpushed commits if needed, push to public GitHub repo, submit link. (F14)

---

## Stretch (only if time allows)

- [ ] Classify permanent Resend errors (400/422) → fail immediately; retry only network/429/5xx.
- [ ] `POST /emails/:id/retry` to requeue a `failed` job.
- [ ] Resend webhook endpoint to record delivered/bounced events.
- [ ] Worker stats in `/health` (pending count, oldest pending age) — informational only, must not affect the 200/503 rule.
- [ ] Rate limiting on `POST /emails`.
- [ ] OpenAPI spec generated from zod schemas.

## Definition of done (every task)

- Layer rules pass (`npm run lint:arch`), typecheck passes, tests pass.
- No secrets, no SQL outside `src/data/`, no HTTP types outside `src/api/`.
- One focused commit with a conventional message.
