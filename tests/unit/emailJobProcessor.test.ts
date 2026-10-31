import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailJobProcessor } from '../../src/services/emailJobProcessor.js';
import { EmailSendError, type EmailSender } from '../../src/services/ports/emailSender.js';
import { InMemoryEmailJobRepository } from '../fakes/inMemoryEmailJobRepository.js';

const options = { from: 'onboarding@resend.dev', batchSize: 10, lockSeconds: 60, retryBaseMs: 1000 };
const silent = pino({ level: 'silent' });

describe('EmailJobProcessor', () => {
  let repo: InMemoryEmailJobRepository;

  beforeEach(() => {
    repo = new InMemoryEmailJobRepository();
  });

  async function enqueue() {
    const { job } = await repo.insert({
      toAddress: 'delivered@resend.dev',
      subject: 'Hi',
      htmlBody: '<p>Hi</p>',
      textBody: null,
      idempotencyKey: null,
      maxAttempts: 4,
    });
    return job;
  }

  it('marks a job sent and passes the job id as idempotency key', async () => {
    const job = await enqueue();
    const send = vi.fn<EmailSender['send']>().mockResolvedValue({ providerMessageId: 'msg_1' });
    const processor = new EmailJobProcessor(repo, { send }, options, silent);

    expect(await processor.processBatch()).toBe(1);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: options.from, to: 'delivered@resend.dev', html: '<p>Hi</p>' }),
      { idempotencyKey: job.id },
    );
    const stored = await repo.findById(job.id);
    expect(stored).toMatchObject({ status: 'sent', providerMessageId: 'msg_1', attempts: 1, lockedUntil: null });
  });

  it('keeps a failed job pending with backoff while attempts remain', async () => {
    const job = await enqueue();
    const now = new Date('2026-01-01T00:00:00Z');
    const send = vi.fn<EmailSender['send']>().mockRejectedValue(new EmailSendError('Resend 500', 500));
    const processor = new EmailJobProcessor(repo, { send }, options, silent, () => now, () => 0.5);

    await processor.processBatch();

    const stored = await repo.findById(job.id);
    expect(stored).toMatchObject({ status: 'pending', attempts: 1, lastError: 'Resend 500', lockedUntil: null });
    expect(stored?.nextAttemptAt.toISOString()).toBe('2026-01-01T00:00:01.000Z');
  });

  it('succeeds after 3 failed attempts (retries)', async () => {
    const job = await enqueue();
    const send = vi
      .fn<EmailSender['send']>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ providerMessageId: 'msg_4' });
    const processor = new EmailJobProcessor(repo, { send }, options, silent);

    for (let i = 0; i < 4; i++) await processor.processBatch();

    expect(send).toHaveBeenCalledTimes(4);
    expect(await repo.findById(job.id)).toMatchObject({ status: 'sent', attempts: 4 });
  });

  it('marks the job failed after exactly maxAttempts (1 try + 3 retries)', async () => {
    const job = await enqueue();
    const send = vi.fn<EmailSender['send']>().mockRejectedValue(new Error('boom'));
    const processor = new EmailJobProcessor(repo, { send }, options, silent);

    for (let i = 0; i < 6; i++) await processor.processBatch();

    expect(send).toHaveBeenCalledTimes(4);
    expect(await repo.findById(job.id)).toMatchObject({ status: 'failed', attempts: 4, lastError: 'boom' });
  });
});
