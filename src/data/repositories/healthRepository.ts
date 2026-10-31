import type { DbPool } from '../db.js';

export interface HealthRepository {
  /** Runs a trivial query; resolves with the round-trip latency in ms or rejects on failure/timeout. */
  ping(timeoutMs: number): Promise<number>;
}

export class DatabaseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`database did not respond within ${timeoutMs} ms`);
    this.name = 'DatabaseTimeoutError';
  }
}

export class PgHealthRepository implements HealthRepository {
  constructor(private readonly pool: DbPool) {}

  async ping(timeoutMs: number): Promise<number> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DatabaseTimeoutError(timeoutMs)), timeoutMs);
    });
    try {
      await Promise.race([this.pool.query('SELECT 1'), timeout]);
      return Math.round(performance.now() - started);
    } finally {
      clearTimeout(timer);
    }
  }
}
