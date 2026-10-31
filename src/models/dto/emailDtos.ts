import type { EmailJobStatus } from '../emailJob.js';

export interface CreateEmailRequest {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey?: string;
}

export interface EmailJobResponse {
  id: string;
  to: string;
  subject: string;
  status: EmailJobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailJobListResponse {
  items: EmailJobResponse[];
  limit: number;
  offset: number;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
