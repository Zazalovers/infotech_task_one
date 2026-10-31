import type { DbPool } from '../db.js';
import type {
  EmailJob,
  EmailJobListQuery,
  EmailJobSeed,
  EmailJobStatus,
  NewEmailJob,
} from '../../models/emailJob.js';

export interface EmailJobRepository {
  /** Inserts a job; if the idempotency key already exists, returns the existing job with created=false. */
  insert(job: NewEmailJob): Promise<{ job: EmailJob; created: boolean }>;
  insertSeed(job: EmailJobSeed): Promise<boolean>;
  findById(id: string): Promise<EmailJob | null>;
  list(query: EmailJobListQuery): Promise<EmailJob[]>;
  /** Atomically leases up to `limit` due pending jobs and increments their attempt counter. */
  claimDue(limit: number, lockSeconds: number): Promise<EmailJob[]>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  scheduleRetry(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

interface EmailJobRow {
  id: string;
  to_address: string;
  subject: string;
  html_body: string | null;
  text_body: string | null;
  status: EmailJobStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  locked_until: Date | null;
  last_error: string | null;
  provider_message_id: string | null;
  idempotency_key: string | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toEntity(row: EmailJobRow): EmailJob {
  return {
    id: row.id,
    toAddress: row.to_address,
    subject: row.subject,
    htmlBody: row.html_body,
    textBody: row.text_body,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
    providerMessageId: row.provider_message_id,
    idempotencyKey: row.idempotency_key,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MAX_ERROR_LENGTH = 2000;

export class PgEmailJobRepository implements EmailJobRepository {
  constructor(private readonly pool: DbPool) {}

  async insert(job: NewEmailJob): Promise<{ job: EmailJob; created: boolean }> {
    const { rows } = await this.pool.query<EmailJobRow>(
      `INSERT INTO email_jobs (to_address, subject, html_body, text_body, idempotency_key, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [job.toAddress, job.subject, job.htmlBody, job.textBody, job.idempotencyKey, job.maxAttempts],
    );
    if (rows[0]) return { job: toEntity(rows[0]), created: true };

    // Conflict: a job with this idempotency key already exists.
    const existing = await this.pool.query<EmailJobRow>(
      'SELECT * FROM email_jobs WHERE idempotency_key = $1',
      [job.idempotencyKey],
    );
    if (!existing.rows[0]) throw new Error('Insert conflicted but no existing job was found');
    return { job: toEntity(existing.rows[0]), created: false };
  }

  async insertSeed(job: EmailJobSeed): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO email_jobs
         (to_address, subject, html_body, text_body, idempotency_key, max_attempts,
          status, attempts, last_error, provider_message_id, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        job.toAddress,
        job.subject,
        job.htmlBody,
        job.textBody,
        job.idempotencyKey,
        job.maxAttempts,
        job.status,
        job.attempts,
        job.lastError,
        job.providerMessageId,
        job.sentAt,
      ],
    );
    return rowCount === 1;
  }

  async findById(id: string): Promise<EmailJob | null> {
    const { rows } = await this.pool.query<EmailJobRow>('SELECT * FROM email_jobs WHERE id = $1', [id]);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list(query: EmailJobListQuery): Promise<EmailJob[]> {
    const { rows } = await this.pool.query<EmailJobRow>(
      `SELECT * FROM email_jobs
       WHERE ($1::email_job_status IS NULL OR status = $1::email_job_status)
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [query.status ?? null, query.limit, query.offset],
    );
    return rows.map(toEntity);
  }

  async claimDue(limit: number, lockSeconds: number): Promise<EmailJob[]> {
    const { rows } = await this.pool.query<EmailJobRow>(
      `UPDATE email_jobs
          SET locked_until = now() + make_interval(secs => $2),
              attempts = attempts + 1,
              updated_at = now()
        WHERE id IN (
          SELECT id FROM email_jobs
           WHERE status = 'pending'
             AND next_attempt_at <= now()
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING *`,
      [limit, lockSeconds],
    );
    return rows.map(toEntity).sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime());
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    await this.pool.query(
      `UPDATE email_jobs
          SET status = 'sent', provider_message_id = $2, sent_at = now(),
              locked_until = NULL, last_error = NULL, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, providerMessageId],
    );
  }

  async scheduleRetry(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE email_jobs
          SET last_error = $2, next_attempt_at = $3, locked_until = NULL, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, error.slice(0, MAX_ERROR_LENGTH), nextAttemptAt],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE email_jobs
          SET status = 'failed', last_error = $2, locked_until = NULL, updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [id, error.slice(0, MAX_ERROR_LENGTH)],
    );
  }
}
