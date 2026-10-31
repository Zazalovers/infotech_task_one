import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ErrorResponse } from '../../models/dto/emailDtos.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Requires `x-api-key` to match the configured key (constant-time comparison). */
export function apiKeyAuth(apiKey: string) {
  const expected = digest(apiKey);
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header('x-api-key');
    if (provided && timingSafeEqual(digest(provided), expected)) {
      next();
      return;
    }
    const body: ErrorResponse = { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' } };
    res.status(401).json(body);
  };
}
