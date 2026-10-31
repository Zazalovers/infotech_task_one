import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../../config/logger.js';
import type { ErrorResponse } from '../../models/dto/emailDtos.js';
import { DomainError } from '../../services/errors.js';
import { RequestValidationError } from '../validators/validate.js';

const DOMAIN_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
};

function send(res: Response, status: number, error: ErrorResponse['error']): void {
  res.status(status).json({ error } satisfies ErrorResponse);
}

export function notFoundHandler(req: Request, res: Response): void {
  send(res, 404, { code: 'ROUTE_NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
}

/** Maps errors to HTTP responses. The only place that turns domain errors into status codes. */
export function errorHandler(logger: Logger) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof RequestValidationError) {
      send(res, 400, { code: 'VALIDATION_ERROR', message: err.message, details: err.details });
      return;
    }
    if (err instanceof DomainError) {
      send(res, DOMAIN_STATUS[err.code] ?? 400, { code: err.code, message: err.message, details: err.details });
      return;
    }
    // body-parser errors carry a `type` and an HTTP status.
    const bodyError = err as { type?: string; status?: number };
    if (bodyError.type === 'entity.parse.failed') {
      send(res, 400, { code: 'INVALID_JSON', message: 'Request body is not valid JSON' });
      return;
    }
    if (bodyError.type === 'entity.too.large') {
      send(res, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
      return;
    }

    logger.error({ err }, 'unhandled error');
    send(res, 500, { code: 'INTERNAL_ERROR', message: 'Internal server error' });
  };
}
