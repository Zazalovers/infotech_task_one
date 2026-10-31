# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

A small monolithic Node.js + TypeScript backend. HTTP endpoints enqueue email jobs in PostgreSQL; a background worker sends them through Resend with retries. `GET /health` is monitored in production on Asniher.com.

- Full spec: [docs/SPEC.md](docs/SPEC.md)
- Features & acceptance criteria: [docs/FEATURES.md](docs/FEATURES.md)
- Build order / task list: [docs/BACKLOG.md](docs/BACKLOG.md) — work the next unchecked task and tick it when done.

## Commands

```bash
docker compose up -d          # local Postgres
cp .env.example .env          # then fill in values
npm install
npm run migrate:up            # apply migrations (migrate:down to roll back)
npm run seed                  # sample data (idempotent)
npm run dev                   # API + in-process worker with reload
npm run start:worker          # worker only
npm test                      # unit + integration (needs Postgres)
npm run lint && npm run lint:arch && npm run typecheck
npm run build && npm start    # production
```

## Architecture rules — non-negotiable

Layers, top to bottom: `api` / `worker` → `services` → `data` → `models`.

- **Calls only go downward.** `api` and `worker` call `services`; `services` call `data`; `data` uses `models`. Never skip a layer (`api` must not import `data`) and never import upward.
- **`models`**: types, enums, DTOs only. No I/O, no logic.
- **`data`**: the only place with SQL and the `pg` import. Always parameterized queries (`$1`), never string-concatenated SQL. Repositories return entities from `models`, not raw rows.
- **`services`**: business logic, retry policy, orchestration. No `express`, no `req`/`res`, no status codes, no SQL. Throw domain errors from `services/errors.ts`.
- **`api`**: routes, controllers, zod validation, mapping domain errors → HTTP status in `middleware/errorHandler.ts`. Controllers stay thin: validate → one service call → respond.
- **`worker`**: entrypoint like `api`; calls services only, no HTTP.
- **Resend** is accessed only through the `EmailSender` interface (`services/ports/`), implemented in `services/providers/resendEmailSender.ts`.
- **`config/env.ts`** is the only reader of `process.env`.

`npm run lint:arch` (dependency-cruiser) and the CI SQL grep enforce this. If a change seems to need a rule exception, change the design instead.

## Email queue rules

- Endpoints **never** send email. `POST /emails` inserts a `pending` job and returns `202`.
- Stored statuses are exactly `pending`, `sent`, `failed`. "In progress" = unexpired `locked_until`, not a new status.
- Claim jobs with `FOR UPDATE SKIP LOCKED`; increment `attempts` on claim.
- Failure with attempts left → stay `pending`, set `last_error`, push `next_attempt_at` (backoff). Final failure → `failed`.
- `max_attempts` ≥ 4 (1 try + at least 3 retries). Do not lower it.
- Pass the job id as Resend's idempotency key.

## Health check rules

- `GET /health`: `200` when DB `SELECT 1` succeeds within 2 s, else `503`. Public, `Cache-Control: no-store`.
- Never put connection strings, hostnames or stack traces in the response.
- Don't let optional checks (Resend, queue depth) turn the response into a 503 — only the database decides.
- Monitoring is on Asniher (SPEC §7.2): an HTTP/keyword monitor on `/health` plus a worker heartbeat. The heartbeat goes through the `HeartbeatPinger` port, is throttled, and a failed ping must never break job processing.

## Conventions

- TypeScript strict; no `any` in new code. camelCase in TS, snake_case in SQL; map in repositories.
- File names: `thing.role.ts` in `api` (`emails.controller.ts`), camelCase elsewhere (`emailJobRepository.ts`).
- Errors returned to clients: `{ "error": { "code", "message", "details"? } }`.
- Logging via pino only (no `console.log`). Never log secrets or email bodies.
- New schema changes = new migration file; never edit an applied migration.
- Tests: unit tests use fake repository/sender; repository tests hit the real test DB.

## Secrets & git

- Never commit `.env` or real keys. Only `.env.example` with placeholders (`re_xxxxxxxx`).
- New env var → add it to `config/env.ts`, `.env.example`, and the README table in the same commit.
- Commits: small, conventional (`feat(services): …`, `fix(api): …`, `test: …`, `docs: …`). One backlog task ≈ one commit. Don't commit unless asked.
