export const EMAIL_JOB_STATUSES = ['pending', 'sent', 'failed'] as const;
export type EmailJobStatus = (typeof EMAIL_JOB_STATUSES)[number];

/** A row of the email_jobs table, as used inside the application. */
export interface EmailJob {
  id: string;
  toAddress: string;
  subject: string;
  htmlBody: string | null;
  textBody: string | null;
  status: EmailJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lockedUntil: Date | null;
  lastError: string | null;
  providerMessageId: string | null;
  idempotencyKey: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields needed to create a new pending job. */
export interface NewEmailJob {
  toAddress: string;
  subject: string;
  htmlBody: string | null;
  textBody: string | null;
  idempotencyKey: string | null;
  maxAttempts: number;
}

/** A job inserted with an explicit state (seed data / fixtures). */
export interface EmailJobSeed extends NewEmailJob {
  status: EmailJobStatus;
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
}

export interface EmailJobListQuery {
  status?: EmailJobStatus;
  limit: number;
  offset: number;
}
