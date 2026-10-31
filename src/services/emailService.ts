import type { EmailJobRepository } from '../data/repositories/emailJobRepository.js';
import type { EmailJob, EmailJobListQuery } from '../models/emailJob.js';
import type { CreateEmailRequest } from '../models/dto/emailDtos.js';
import { DomainValidationError, NotFoundError } from './errors.js';

export interface EmailServiceOptions {
  maxAttempts: number;
}

export class EmailService {
  constructor(
    private readonly jobs: EmailJobRepository,
    private readonly options: EmailServiceOptions,
  ) {}

  /** Stores the email as a pending job. Sending happens later in the worker — never here. */
  async enqueue(request: CreateEmailRequest): Promise<{ job: EmailJob; created: boolean }> {
    if (!request.html && !request.text) {
      throw new DomainValidationError('Either html or text body is required');
    }
    return this.jobs.insert({
      toAddress: request.to,
      subject: request.subject,
      htmlBody: request.html ?? null,
      textBody: request.text ?? null,
      idempotencyKey: request.idempotencyKey ?? null,
      maxAttempts: this.options.maxAttempts,
    });
  }

  async getById(id: string): Promise<EmailJob> {
    const job = await this.jobs.findById(id);
    if (!job) throw new NotFoundError(`Email job ${id} not found`);
    return job;
  }

  list(query: EmailJobListQuery): Promise<EmailJob[]> {
    return this.jobs.list(query);
  }
}
