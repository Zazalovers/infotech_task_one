import type { z } from 'zod';

/** Thrown when a request fails schema validation; mapped to 400 by the error handler. */
export class RequestValidationError extends Error {
  constructor(readonly details: { path: string; message: string }[]) {
    super('Request validation failed');
    this.name = 'RequestValidationError';
  }
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new RequestValidationError(
      result.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    );
  }
  return result.data;
}
