// Cloudflare Workers entrypoint.
//   fetch     → the same Express app as src/server.ts (via Workers' Node.js HTTP compatibility)
//   scheduled → Cron Trigger that drains the email queue (replaces the in-process poll loop)
//
// Workers forbid timers, random values and I/O at global scope (reading the Hyperdrive binding
// counts), so the app (config, logger, pg pool, Express) is loaded lazily inside the first handler
// call and then reused for the lifetime of the isolate.
import { httpServerHandler } from 'cloudflare:node';

const PORT = 8080;
// Cron runs every minute; leave headroom so runs never overlap.
const CRON_TIME_BUDGET_MS = 45_000;

interface Env {
  // Optional until a hosted Postgres exists; without it, a DATABASE_URL secret is used instead.
  HYPERDRIVE?: { connectionString: string };
  [name: string]: unknown;
}

interface ScheduledController {
  readonly cron: string;
}

async function loadApp(env: Env) {
  // Config reads process.env when first imported, so copy the Worker's vars and secrets
  // (string bindings) there first, and point DATABASE_URL at Hyperdrive when it is configured.
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') process.env[name] = value;
  }
  if (env.HYPERDRIVE) process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;

  const [{ createApp }, { config }, { logger }, { buildContainer }, { drainQueue }] = await Promise.all([
    import('../api/app.js'),
    import('../config/env.js'),
    import('../config/logger.js'),
    import('../container.js'),
    import('../worker/drain.js'),
  ]);

  const container = buildContainer();
  createApp({
    emailService: container.emailService,
    healthService: container.healthService,
    apiKey: config.API_KEY,
    logger,
  }).listen(PORT);

  return {
    async drain(cron: string): Promise<void> {
      const { processor, monitoring } = container.buildEmailProcessing();
      await drainQueue(
        processor,
        monitoring,
        { batchSize: config.WORKER_BATCH_SIZE, maxDurationMs: CRON_TIME_BUDGET_MS },
        logger.child({ component: 'worker', cron }),
      );
    },
  };
}

let app: ReturnType<typeof loadApp> | undefined;
// A failed start (e.g. bad config) is not cached, so the next request retries instead of failing forever.
const getApp = (env: Env) =>
  (app ??= loadApp(env).catch((err: unknown) => {
    app = undefined;
    throw err;
  }));

const http = httpServerHandler({ port: PORT });

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    await getApp(env);
    return http.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await (await getApp(env)).drain(controller.cron);
  },
};
