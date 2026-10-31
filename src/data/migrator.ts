import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbPool } from './db.js';

// Arbitrary constant so concurrent deploys never run migrations at the same time.
const MIGRATION_LOCK_ID = 727274;

/**
 * Minimal SQL migration runner.
 * Files: migrations/NNN_name.up.sql and migrations/NNN_name.down.sql, applied in name order,
 * each in its own transaction, tracked in the schema_migrations table.
 */
export class Migrator {
  constructor(
    private readonly pool: DbPool,
    private readonly dir: string,
  ) {}

  async up(): Promise<string[]> {
    return this.withLock(async () => {
      const applied = new Set(await this.appliedVersions());
      const pending = (await this.versions()).filter((v) => !applied.has(v));
      for (const version of pending) {
        await this.run(version, 'up');
      }
      return pending;
    });
  }

  async down(): Promise<string | null> {
    return this.withLock(async () => {
      const applied = await this.appliedVersions();
      const last = applied.at(-1);
      if (!last) return null;
      await this.run(last, 'down');
      return last;
    });
  }

  private async versions(): Promise<string[]> {
    const files = await readdir(this.dir);
    return files
      .filter((f) => f.endsWith('.up.sql'))
      .map((f) => f.replace(/\.up\.sql$/, ''))
      .sort();
  }

  private async appliedVersions(): Promise<string[]> {
    const { rows } = await this.pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    return rows.map((r) => r.version);
  }

  private async run(version: string, direction: 'up' | 'down'): Promise<void> {
    const sql = await readFile(join(this.dir, `${version}.${direction}.sql`), 'utf8');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      if (direction === 'up') {
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      } else {
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version text PRIMARY KEY,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      client.release();
    }
  }
}
