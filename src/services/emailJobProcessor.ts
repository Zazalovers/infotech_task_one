import type { Logger } from '../config/logger.js';
import type { EmailJobRepository } from '../data/repositories/emailJobRepository.js';
import type { EmailJob } from '../models/emailJob.js';
import type { EmailSender } from './ports/emailSender.js';
import { computeBackoffMs } from './retryPolicy.js';

export interface EmailJobProcessorOptions {
  from: string;
  batchSize: number;
  lockSeconds: number;
  retryBaseMs: number;
}

export class EmailJobProcessor {
  constructor(
    private readonly jobs: EmailJobRepository,
    private readonly sender: EmailSender,
    private readonly options: EmailJobProcessorOptions,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
    private readonly random: () => number = Math.random,
  ) {}

  /** Claims due jobs and sends them one by one. Returns how many jobs were claimed. */
  async processBatch(): Promise<number> {
    const claimed = await this.jobs.claimDue(this.options.batchSize, this.options.lockSeconds);
    // Sequential on purpose: keeps us well inside Resend's per-second rate limit.
    for (const job of claimed) {
      await this.processJob(job);
    }
    return claimed.length;
  }

  private async processJob(job: EmailJob): Promise<void> {
    const log = this.logger.child({ jobId: job.id, attempt: job.attempts, maxAttempts: job.maxAttempts });
    log.info('job.claimed');

    let providerMessageId: string;
    try {
      ({ providerMessageId } = await this.sender.send(
        {
          from: this.options.from,
          to: job.toAddress,
          subject: job.subject,
          html: job.htmlBody ?? undefined,
          text: job.textBody ?? undefined,
        },
        { idempotencyKey: job.id },
      ));
    } catch (err) {
      await this.handleFailure(job, err, log);
      return;
    }

    // Outside the try: if this DB write fails, the lease expires and the retry is de-duplicated
    // by the provider's idempotency key instead of being counted as a send failure.
    await this.jobs.markSent(job.id, providerMessageId);
    log.info({ providerMessageId }, 'job.sent');
  }

  private async handleFailure(job: EmailJob, err: unknown, log: Logger): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);

    if (job.attempts >= job.maxAttempts) {
      await this.jobs.markFailed(job.id, message);
      log.error({ error: message }, 'job.failed');
      return;
    }

    const delayMs = computeBackoffMs(job.attempts, this.options.retryBaseMs, this.random);
    const nextAttemptAt = new Date(this.now().getTime() + delayMs);
    await this.jobs.scheduleRetry(job.id, message, nextAttemptAt);
    log.warn({ error: message, nextAttemptAt }, 'job.retry_scheduled');
  }
}
