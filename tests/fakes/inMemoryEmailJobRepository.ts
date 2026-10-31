import { randomUUID } from 'node:crypto';
import type { EmailJobRepository } from '../../src/data/repositories/emailJobRepository.js';
import type { EmailJob, EmailJobListQuery, EmailJobSeed, NewEmailJob } from '../../src/models/emailJob.js';

/** In-memory stand-in for PgEmailJobRepository. Ignores time: every pending, unlocked job is due. */
export class InMemoryEmailJobRepository implements EmailJobRepository {
  readonly jobs = new Map<string, EmailJob>();

  async insert(input: NewEmailJob): Promise<{ job: EmailJob; created: boolean }> {
    const existing = [...this.jobs.values()].find(
      (j) => input.idempotencyKey !== null && j.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { job: existing, created: false };

    const now = new Date();
    const job: EmailJob = {
      id: randomUUID(),
      ...input,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      lockedUntil: null,
      lastError: null,
      providerMessageId: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return { job, created: true };
  }

  async insertSeed(seed: EmailJobSeed): Promise<boolean> {
    const { created, job } = await this.insert(seed);
    Object.assign(job, seed);
    return created;
  }

  async findById(id: string): Promise<EmailJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async list(query: EmailJobListQuery): Promise<EmailJob[]> {
    return [...this.jobs.values()]
      .filter((j) => !query.status || j.status === query.status)
      .slice(query.offset, query.offset + query.limit);
  }

  async claimDue(limit: number): Promise<EmailJob[]> {
    const due = [...this.jobs.values()].filter((j) => j.status === 'pending' && j.lockedUntil === null).slice(0, limit);
    for (const job of due) {
      job.attempts += 1;
      job.lockedUntil = new Date(Date.now() + 60_000);
    }
    return due.map((j) => ({ ...j }));
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    this.update(id, { status: 'sent', providerMessageId, sentAt: new Date(), lockedUntil: null, lastError: null });
  }

  async scheduleRetry(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    this.update(id, { lastError: error, nextAttemptAt, lockedUntil: null });
  }

  async markFailed(id: string, error: string): Promise<void> {
    this.update(id, { status: 'failed', lastError: error, lockedUntil: null });
  }

  private update(id: string, patch: Partial<EmailJob>): void {
    const job = this.jobs.get(id);
    if (job) Object.assign(job, patch, { updatedAt: new Date() });
  }
}
