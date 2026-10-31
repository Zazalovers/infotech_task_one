import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../config/logger.js';

/**
 * One structured log line per request, plus an x-request-id header.
 * Headers and bodies are never logged (they can contain the API key or email contents).
 */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const reqId = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', reqId);
    const started = performance.now();

    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
      const entry = {
        reqId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      };
      if (res.statusCode >= 500) logger.error(entry, 'request.completed');
      // Monitors hit /health every minute; keep those out of the info logs.
      else if (path === '/health') logger.debug(entry, 'request.completed');
      else logger.info(entry, 'request.completed');
    });

    next();
  };
}
