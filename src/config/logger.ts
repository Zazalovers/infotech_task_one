import { pino, type Logger } from 'pino';
import { config } from './env.js';

export type { Logger };

export const logger: Logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
  base: { service: 'mail-queue-service', version: config.APP_VERSION },
  // Never log credentials or email contents.
  redact: {
    paths: [
      'req.headers["x-api-key"]',
      'req.headers.authorization',
      'req.headers.cookie',
      '*.html',
      '*.text',
      '*.htmlBody',
      '*.textBody',
    ],
    censor: '[redacted]',
  },
});
