/**
 * AppError — canonical error hierarchy for the shared architecture.
 *
 * This is the single source of truth for typed HTTP errors. The legacy
 * `server/core/errors/AppError.ts` remains untouched for backward compat with
 * modules that haven't migrated yet. New and refactored modules import from
 * here.
 *
 * Every subclass maps 1-to-1 with an HTTP status so the central errorHandler
 * in `server/core/errors/errorHandler.ts` can produce a clean `{ success:
 * false, error }` envelope without any instanceof branching.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    status = 500,
    code = "INTERNAL_ERROR",
    details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — malformed or semantically invalid request body / params. */
export class BadRequestError extends AppError {
  constructor(message = "Requisição inválida", details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

/** 401 — missing or expired authentication. */
export class UnauthorizedError extends AppError {
  constructor(message = "Não autenticado") {
    super(message, 401, "UNAUTHORIZED");
  }
}

/** 403 — authenticated but not allowed. */
export class ForbiddenError extends AppError {
  constructor(message = "Acesso negado") {
    super(message, 403, "FORBIDDEN");
  }
}

/** 404 — resource not found (also used to hide cross-tenant existence). */
export class NotFoundError extends AppError {
  constructor(message = "Recurso não encontrado") {
    super(message, 404, "NOT_FOUND");
  }
}

/** 409 — state conflict (duplicate submission, locked record, etc.). */
export class ConflictError extends AppError {
  constructor(message = "Conflito de estado", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

/** 422 — structurally valid but semantically unprocessable input. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

/** 503 — service temporarily unavailable (maintenance mode, etc.). */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Serviço temporariamente indisponível") {
    super(message, 503, "SERVICE_UNAVAILABLE");
  }
}
