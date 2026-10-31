# Deploying to Cloudflare Workers

The same codebase runs on Cloudflare Workers through a separate entrypoint, [src/cloudflare/index.ts](../src/cloudflare/index.ts). The api, services, data and models layers are shared with the Node.js build unchanged.

| Concern | Node.js (Render / local) | Cloudflare Workers |
|---|---|---|
| HTTP | Express on `app.listen()` | The same Express app, served by `httpServerHandler` from `cloudflare:node` |
| Email worker | In-process poll loop (`src/worker/worker.ts`) | **Cron Trigger** every minute → `drainQueue()` (`src/worker/drain.ts`) |
| Database | Direct `pg` pool | `pg` through **Hyperdrive** to an external Postgres (Neon, Supabase, …) |
| Connections | Pooled and reused | Single-use (`DATABASE_POOL_MAX_USES=1`); Hyperdrive does the pooling |
| Config | `.env` / host env vars | `vars` in [wrangler.jsonc](../wrangler.jsonc) + `wrangler secret put` |
| Logs | pino JSON on stdout | pino → console → Workers Logs (`observability` enabled) |
| Migrations | `npm start` runs them | Run once from your machine against the database (step 2) |

```mermaid
flowchart LR
    client([Client]) -->|HTTPS| w
    asniher([Asniher]) -->|GET /health| w
    cron([Cron Trigger<br/>every minute]) --> w
    subgraph cf [Cloudflare]
        w["Worker: mail-queue-service<br/>fetch → Express app<br/>scheduled → drainQueue()"]
        hd[(Hyperdrive)]
        w --> hd
    end
    hd --> pg[(Postgres<br/>Neon / Supabase)]
    w --> resend([Resend API])
    w -.->|heartbeat| asniher
```

Because Cloudflare doesn't host Postgres itself, you still need a Postgres database somewhere. Hyperdrive gives the Worker fast, pooled connections to it.

---

## Prerequisites

- A Cloudflare account. The free plan is enough to start. The free plan has a small per-invocation CPU budget; if Workers Logs show `Exceeded CPU Limit`, switch to Workers Paid.
- A hosted Postgres database reachable from the internet. [Neon](https://neon.tech) and [Supabase](https://supabase.com) both have free tiers.
- A Resend API key.

Wrangler is already a dev dependency, so run it with `npx wrangler`.

---

## 1. Create the database

Create a Neon (or Supabase) project and copy its connection string, for example:

```
postgres://USER:PASSWORD@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

## 2. Run migrations (and optional seed) against it

From your machine (PowerShell):

```powershell
$env:DATABASE_URL = "postgres://USER:PASSWORD@HOST/DB?sslmode=require"
$env:DATABASE_SSL = "true"
npm run migrate:up
npm run seed          # optional
Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL
```

(bash: `DATABASE_URL="…" DATABASE_SSL=true npm run migrate:up`)

## 3. Log in to Cloudflare

```bash
npx wrangler login
```

## 4. Create the Hyperdrive config

```bash
npx wrangler hyperdrive create mailqueue-db --connection-string="postgres://USER:PASSWORD@HOST/DB?sslmode=require"
```

Uncomment the `hyperdrive` block in [wrangler.jsonc](../wrangler.jsonc) and put the `id` it prints there. (Without Hyperdrive you can instead set the connection string directly with `npx wrangler secret put DATABASE_URL`; until either exists, every request fails with error 1101.)

## 5. Set secrets

```bash
npx wrangler secret put API_KEY                 # long random string; clients send it as x-api-key
npx wrangler secret put RESEND_API_KEY          # re_...
npx wrangler secret put ASNIHER_HEARTBEAT_URL   # optional, from the Asniher heartbeat monitor
```

Non-secret settings (`EMAIL_FROM`, retry settings, …) are the `vars` in `wrangler.jsonc`.

## 6. Deploy

Pushes to `main` deploy automatically (see below). To deploy by hand:

```bash
npm run cf:deploy
```

Wrangler prints the URL, for example `https://mail-queue-service.<your-subdomain>.workers.dev`. The cron trigger (`* * * * *`) is registered by the same deploy.

## 7. Smoke test

```bash
BASE=https://mail-queue-service.<your-subdomain>.workers.dev
KEY=<the API_KEY you set>

curl -i $BASE/health
curl -i -X POST $BASE/emails -H "x-api-key: $KEY" -H "content-type: application/json" \
  -d '{"to":"delivered@resend.dev","subject":"Hello from Workers","text":"It works"}'
# within ~1 minute the cron run sends it:
curl -s $BASE/emails/<id> -H "x-api-key: $KEY"
```

Follow live logs with `npm run cf:tail`.

## 8. Monitoring on Asniher

- **HTTP monitor:** `GET $BASE/health`, expect `2xx`, every 1–5 minutes; optionally a keyword check for `"database":{"status":"up"`.
- **Heartbeat monitor:** period 2 minutes, grace 2 minutes. Every cron run pings `ASNIHER_HEARTBEAT_URL` after draining the queue, so a stuck or failing cron shows up as a missed heartbeat.
- Take the screenshot for `docs/monitoring/asniher-monitor.png`.

---

## Automatic deploys from GitHub

The Worker `mail-queue-service` is connected to this repository with **Workers Builds** (Cloudflare dashboard → Workers & Pages → mail-queue-service → Settings → Build). Every push to `main` runs `npm ci` and `npx wrangler deploy` on Cloudflare. Build logs are on the Worker's **Deployments** tab.

- Secrets set with `wrangler secret put` are kept across deploys; `vars` come from `wrangler.jsonc` in the commit being built.
- Builds don't wait for GitHub Actions CI, so a commit that fails CI still deploys. Keep `main` green.

## Running the Worker locally

`wrangler dev` runs the real Workers runtime (workerd) on your machine. The database comes from `DATABASE_URL` in `.dev.vars` (the Docker Postgres), or from Hyperdrive's `localConnectionString` once that block is enabled.

```bash
docker compose up -d
npm run migrate:up
cp .dev.vars.example .dev.vars        # set API_KEY and RESEND_API_KEY
npm run cf:dev                        # http://localhost:8787

# trigger the cron handler by hand:
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

## Behaviour differences to know

- **Retry timing:** the cron runs once a minute, so backoff delays shorter than a minute (10 s, 20 s, 40 s by default) effectively become "next minute". The retry count is unchanged: 1 attempt + 3 retries, then `failed`.
- **Run length:** one cron run drains batches for at most 45 s, so runs never overlap. `FOR UPDATE SKIP LOCKED` keeps overlapping runs safe anyway.
- **Global scope:** Workers forbid timers, random values and I/O at module load, so the entrypoint loads the app lazily on the first request or cron run and reuses it afterwards.
