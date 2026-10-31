import type { EmailJob } from '../../models/emailJob.js';
import type { EmailJobResponse } from '../../models/dto/emailDtos.js';

/** Public JSON shape of a job. Email bodies are intentionally not echoed back. */
export function toEmailJobResponse(job: EmailJob): EmailJobResponse {
  return {
    id: job.id,
    to: job.toAddress,
    subject: job.subject,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    providerMessageId: job.providerMessageId,
    nextAttemptAt: job.nextAttemptAt.toISOString(),
    sentAt: job.sentAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
