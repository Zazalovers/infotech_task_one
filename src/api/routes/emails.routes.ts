import { Router } from 'express';
import type { EmailService } from '../../services/emailService.js';
import { createEmailsController } from '../controllers/emails.controller.js';

export function emailsRouter(emailService: EmailService): Router {
  const controller = createEmailsController(emailService);
  const router = Router();
  router.post('/', controller.create);
  router.get('/', controller.list);
  router.get('/:id', controller.getById);
  return router;
}
