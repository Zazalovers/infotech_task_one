import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from '../config/logger.js';
import type { EmailService } from '../services/emailService.js';
import type { HealthService } from '../services/healthService.js';
import { apiKeyAuth } from './middleware/apiKeyAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { emailsRouter } from './routes/emails.routes.js';
import { healthRouter } from './routes/health.routes.js';

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

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id']?.toString() ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      // Monitors hit /health every minute; keep those out of the info logs.
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (req.url === '/health' && res.statusCode < 400) return 'debug';
        return 'info';
      },
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  app.use('/health', healthRouter(healthService));
  app.use('/emails', apiKeyAuth(apiKey), emailsRouter(emailService));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
