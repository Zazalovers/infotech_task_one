import { Resend } from 'resend';
import { EmailSendError, type EmailSender, type OutgoingEmail, type SendOptions } from '../ports/emailSender.js';

const SEND_TIMEOUT_MS = 10_000;

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(email: OutgoingEmail, options: SendOptions): Promise<{ providerMessageId: string }> {
    const payload = email.html
      ? { from: email.from, to: email.to, subject: email.subject, html: email.html, text: email.text }
      : { from: email.from, to: email.to, subject: email.subject, text: email.text ?? '' };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EmailSendError(`Resend did not respond within ${SEND_TIMEOUT_MS} ms`)),
        SEND_TIMEOUT_MS,
      );
    });

    try {
      const { data, error } = await Promise.race([
        this.client.emails.send(payload, { idempotencyKey: options.idempotencyKey }),
        timeout,
      ]);
      if (error) {
        throw new EmailSendError(`Resend ${error.name}: ${error.message}`, error.statusCode);
      }
      return { providerMessageId: data.id };
    } catch (err) {
      if (err instanceof EmailSendError) throw err;
      throw new EmailSendError(`Resend request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
