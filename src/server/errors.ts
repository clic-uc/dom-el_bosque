import type { ZodError } from 'zod';

export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; details?: unknown } };

/** Errores de dominio tipados (§3.2 punto 13). Los mensajes están pensados para mostrarse al usuario. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'No encontramos lo que buscabas', details?: unknown) {
    super('NOT_FOUND', 404, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', 409, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Revisa los datos ingresados', details?: unknown) {
    super('VALIDATION', 400, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permiso para hacer esto', details?: unknown) {
    super('FORBIDDEN', 403, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Debes iniciar sesión') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class PasswordChangeRequiredError extends AppError {
  constructor() {
    super('PASSWORD_CHANGE_REQUIRED', 403, 'Debes cambiar tu contraseña temporal antes de continuar');
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Demasiadas solicitudes. Espera un momento e intenta de nuevo') {
    super('RATE_LIMITED', 429, message);
  }
}

/** Convierte un ZodError en un mensaje legible: "N° Permiso: es obligatorio". */
export function zodToValidationError(err: ZodError, prefix = 'Revisa los datos'): ValidationError {
  const issues = err.issues.map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));
  const first = issues[0];
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : prefix;
  return new ValidationError(message, { issues });
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function statusFromText(s: string): number {
  const map: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
  };
  return map[s] ?? 500;
}
