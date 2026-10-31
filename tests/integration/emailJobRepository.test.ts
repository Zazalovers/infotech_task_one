import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../../src/data/db.js';
import { Migrator } from '../../src/data/migrator.js';
import { PgEmailJobRepository } from '../../src/data/repositories/emailJobRepository.js';
import { PgHealthRepository } from '../../src/data/repositories/healthRepository.js';
import type { NewEmailJob } from '../../src/models/emailJob.js';

const pool = createPool();
const repo = new PgEmailJobRepository(pool);

const newJob = (overrides: Partial<NewEmailJob> = {}): NewEmailJob => ({
  toAddress: 'delivered@resend.dev',
  subject: 'Hello',
  htmlBody: null,
  textBody: 'Hi',
  idempotencyKey: null,
  maxAttempts: 4,
  ...overrides,
});

beforeAll(async () => {
  await new Migrator(pool, join(process.cwd(), 'migrations')).up();
});

beforeEach(async () => {
  await pool.query('TRUNCATE email_jobs');
});

afterAll(async () => {
  await pool.end();
});

describe('PgEmailJobRepository', () => {
  it('inserts a pending job with defaults', async () => {
    const { job, created } = await repo.insert(newJob());
    expect(created).toBe(true);
    expect(job).toMatchObject({ status: 'pending', attempts: 0, maxAttempts: 4, lockedUntil: null });
    expect(await repo.findById(job.id)).toEqual(job);
  });

  it('returns the existing job for a duplicate idempotency key', async () => {
    const first = await repo.insert(newJob({ idempotencyKey: 'k1' }));
    const second = await repo.insert(newJob({ idempotencyKey: 'k1', subject: 'Other' }));
    expect(second).toEqual({ job: first.job, created: false });
  });

  it('rejects a job without any body (CHECK constraint)', async () => {
    await expect(repo.insert(newJob({ textBody: null }))).rejects.toThrow(/email_jobs_body_present/);
  });

  it('claims due jobs, increments attempts and leases them', async () => {
    const { job } = await repo.insert(newJob());
    const claimed = await repo.claimDue(10, 60);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: job.id, attempts: 1 });
    expect(claimed[0]?.lockedUntil).not.toBeNull();
    // Leased jobs are not claimable again.
    expect(await repo.claimDue(10, 60)).toHaveLength(0);
  });

  it('never hands the same job to concurrent claimers', async () => {
    for (let i = 0; i < 20; i++) await repo.insert(newJob());

    const results = await Promise.all([repo.claimDue(10, 60), repo.claimDue(10, 60), repo.claimDue(10, 60)]);
    const ids = results.flat().map((j) => j.id);

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('re-claims a job whose lease expired', async () => {
    const { job } = await repo.insert(newJob());
    await repo.claimDue(10, 60);
    await pool.query("UPDATE email_jobs SET locked_until = now() - interval '1 second' WHERE id = $1", [job.id]);

    const reclaimed = await repo.claimDue(10, 60);
    expect(reclaimed[0]).toMatchObject({ id: job.id, attempts: 2 });
  });

  it('does not claim jobs scheduled in the future', async () => {
    const { job } = await repo.insert(newJob());
    await repo.claimDue(10, 60);
    await repo.scheduleRetry(job.id, 'boom', new Date(Date.now() + 60_000));

    expect(await repo.claimDue(10, 60)).toHaveLength(0);
    expect(await repo.findById(job.id)).toMatchObject({ status: 'pending', lastError: 'boom', lockedUntil: null });
  });

  it('marks jobs sent and failed', async () => {
    const a = (await repo.insert(newJob())).job;
    const b = (await repo.insert(newJob())).job;
    await repo.claimDue(10, 60);

    await repo.markSent(a.id, 'msg_123');
    await repo.markFailed(b.id, 'gave up');

    expect(await repo.findById(a.id)).toMatchObject({ status: 'sent', providerMessageId: 'msg_123', lockedUntil: null });
    expect((await repo.findById(a.id))?.sentAt).toBeInstanceOf(Date);
    expect(await repo.findById(b.id)).toMatchObject({ status: 'failed', lastError: 'gave up' });
  });

  it('lists newest first with status filter and pagination', async () => {
    const a = (await repo.insert(newJob({ subject: 'a' }))).job;
    const b = (await repo.insert(newJob({ subject: 'b' }))).job;
    await repo.claimDue(1, 60);
    await repo.markFailed(a.id, 'x');

    expect((await repo.list({ limit: 10, offset: 0 })).map((j) => j.id)).toEqual([b.id, a.id]);
    expect((await repo.list({ status: 'failed', limit: 10, offset: 0 })).map((j) => j.id)).toEqual([a.id]);
    expect(await repo.list({ limit: 1, offset: 1 })).toHaveLength(1);
  });
});

describe('PgHealthRepository', () => {
  it('pings the database', async () => {
    const latency = await new PgHealthRepository(pool).ping(2000);
    expect(latency).toBeGreaterThanOrEqual(0);
  });
});
