import type { Request, Response } from 'express';
import type { EmailService } from '../../services/emailService.js';
import type { EmailJobListResponse } from '../../models/dto/emailDtos.js';
import { toEmailJobResponse } from '../presenters/emailJobPresenter.js';
import { parseOrThrow } from '../validators/validate.js';
import { createEmailSchema, emailIdParamsSchema, listEmailsQuerySchema } from '../validators/emailValidators.js';

export function createEmailsController(emailService: EmailService) {
  return {
    async create(req: Request, res: Response): Promise<void> {
      const body = parseOrThrow(createEmailSchema, req.body);
      const { job, created } = await emailService.enqueue(body);
      // 202: accepted for asynchronous delivery. 200: idempotent replay of an existing job.
      res.status(created ? 202 : 200).json(toEmailJobResponse(job));
    },

    async getById(req: Request, res: Response): Promise<void> {
      const { id } = parseOrThrow(emailIdParamsSchema, req.params);
      const job = await emailService.getById(id);
      res.json(toEmailJobResponse(job));
    },

    async list(req: Request, res: Response): Promise<void> {
      const query = parseOrThrow(listEmailsQuerySchema, req.query);
      const jobs = await emailService.list(query);
      const body: EmailJobListResponse = {
        items: jobs.map(toEmailJobResponse),
        limit: query.limit,
        offset: query.offset,
      };
      res.json(body);
    },
  };
}
