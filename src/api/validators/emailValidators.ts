import { z } from 'zod';
import { EMAIL_JOB_STATUSES, type EmailJobListQuery } from '../../models/emailJob.js';
import type { CreateEmailRequest } from '../../models/dto/emailDtos.js';

const MAX_BODY_CHARS = 100_000;

export const createEmailSchema = z
  .strictObject({
    to: z.email().max(320),
    subject: z.string().trim().min(1).max(200),
    html: z.string().min(1).max(MAX_BODY_CHARS).optional(),
    text: z.string().min(1).max(MAX_BODY_CHARS).optional(),
    idempotencyKey: z.string().trim().min(1).max(100).optional(),
  })
  .refine((body) => body.html !== undefined || body.text !== undefined, {
    message: 'Either html or text is required',
    path: ['html'],
  }) satisfies z.ZodType<CreateEmailRequest>;

export const emailIdParamsSchema = z.object({
  id: z.uuid({ message: 'id must be a UUID' }),
});

export const listEmailsQuerySchema = z.object({
  status: z.enum(EMAIL_JOB_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}) satisfies z.ZodType<EmailJobListQuery>;
