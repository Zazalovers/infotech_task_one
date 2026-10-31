export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SendOptions {
  /** Provider-side de-duplication key; the job id is used so retries never double-send. */
  idempotencyKey: string;
}

export interface EmailSender {
  send(email: OutgoingEmail, options: SendOptions): Promise<{ providerMessageId: string }>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}
