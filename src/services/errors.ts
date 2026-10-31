/** Base class for business errors. Carries no HTTP knowledge; the api layer maps codes to status codes. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super('NOT_FOUND', message);
  }
}

export class DomainValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details);
  }
}
