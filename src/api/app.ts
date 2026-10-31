import express, { type Express } from 'express';
import type { Logger } from '../config/logger.js';
import type { EmailService } from '../services/emailService.js';
import type { HealthService } from '../services/healthService.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { emailsRouter } from './routes/emails.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { composePageHtml } from './ui/composePage.js';

export interface AppDependencies {
  emailService: EmailService;
  healthService: HealthService;
  apiKey: string;
  logger: Logger;
}

export function createApp({ emailService, healthService, apiKey, logger }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(requestLogger(logger));
  app.use(express.json({ limit: '256kb' }));

  app.get('/', (_req, res) => {
    res.type('html').send(composePageHtml);
  });
  app.use('/health', healthRouter(healthService));
  app.use('/emails', apiKeyAuth(apiKey), emailsRouter(emailService));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
