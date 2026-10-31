import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: optionalString,
    PGHOST: optionalString,
    PGPORT: z.coerce.number().int().positive().default(5432),
    PGUSER: optionalString,
    PGPASSWORD: optionalString,
    PGDATABASE: optionalString,
    DATABASE_SSL: bool.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    RESEND_API_KEY: optionalString,
    EMAIL_FROM: z.string().min(3).default('onboarding@resend.dev'),

    API_KEY: z.string().min(8, 'API_KEY must be at least 8 characters'),

    WORKER_ENABLED: bool.default(true),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    WORKER_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(10),
    WORKER_LOCK_SECONDS: z.coerce.number().int().positive().default(60),
    EMAIL_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(4, 'EMAIL_MAX_ATTEMPTS must be >= 4 (1 attempt + at least 3 retries)')
      .default(4),
    EMAIL_RETRY_BASE_MS: z.coerce.number().int().positive().default(10000),

    ASNIHER_HEARTBEAT_URL: optionalString.pipe(z.url().optional()),
    HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  })
  .refine((env) => env.DATABASE_URL || env.PGHOST, {
    message: 'Set DATABASE_URL, or PGHOST/PGUSER/PGPASSWORD/PGDATABASE',
    path: ['DATABASE_URL'],
  });

export type Config = z.infer<typeof envSchema> & { APP_VERSION: string };

function readVersion(): string {
  const pkgUrl = new URL('../../package.json', import.meta.url);
  try {
    return (JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string }).version;
  } catch {
    // Compiled output lives one level deeper (dist/src/config).
    const distPkgUrl = new URL('../../../package.json', import.meta.url);
    return (JSON.parse(readFileSync(distPkgUrl, 'utf8')) as { version: string }).version;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return { ...parsed.data, APP_VERSION: readVersion() };
}

export const config = loadConfig();
