import { join } from 'node:path';
import { createPool } from '../src/data/db.js';
import { Migrator } from '../src/data/migrator.js';

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  console.error('Usage: tsx scripts/migrate.ts <up|down>');
  process.exit(1);
}

const pool = createPool();
// npm scripts run from the project root, both for tsx (dev) and compiled (dist) runs.
const migrator = new Migrator(pool, join(process.cwd(), 'migrations'));

try {
  if (direction === 'up') {
    const applied = await migrator.up();
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
  } else {
    const reverted = await migrator.down();
    console.log(reverted ? `Reverted: ${reverted}` : 'Nothing to revert');
  }
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
