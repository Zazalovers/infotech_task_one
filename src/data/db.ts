import pg from 'pg';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

export type DbPool = pg.Pool;

export function createPool(): DbPool {
  const ssl = config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined;
  const common = {
    ssl,
    max: config.DATABASE_POOL_MAX,
    maxUses: config.DATABASE_POOL_MAX_USES ?? Infinity,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  };

  const pool = config.DATABASE_URL
    ? new pg.Pool({ connectionString: config.DATABASE_URL, ...common })
    : new pg.Pool({
        host: config.PGHOST,
        port: config.PGPORT,
        user: config.PGUSER,
        password: config.PGPASSWORD,
        database: config.PGDATABASE,
        ...common,
      });

  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => {
    // With single-use connections on Cloudflare Workers, pg-cloudflare reports our own close as an error.
    if (config.DATABASE_POOL_MAX_USES === 1 && err.message.includes('socket has been closed')) {
      logger.debug({ err }, 'postgres connection closed');
      return;
    }
    logger.error({ err }, 'postgres pool error');
  });
  return pool;
}
