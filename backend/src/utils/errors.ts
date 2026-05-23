export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnauthorizedError    extends AppError { constructor(msg = 'Unauthorized') { super(msg, 401, 'UNAUTHORIZED'); } }
export class ForbiddenError       extends AppError { constructor(msg = 'Forbidden') { super(msg, 403, 'FORBIDDEN'); } }
export class NotFoundError        extends AppError { constructor(resource = 'Resource') { super(`${resource} not found`, 404, 'NOT_FOUND'); } }
export class ValidationError      extends AppError { public details: unknown; constructor(msg: string, details?: unknown) { super(msg, 422, 'VALIDATION_ERROR'); this.details = details; } }
export class ConflictError        extends AppError { constructor(msg: string) { super(msg, 409, 'CONFLICT'); } }
export class TooManyRequestsError extends AppError { constructor(msg = 'Too many requests') { super(msg, 429, 'TOO_MANY_REQUESTS'); } }
export class PaymentError         extends AppError { constructor(msg: string) { super(msg, 402, 'PAYMENT_ERROR'); } }
export class PremiumRequiredError extends AppError { constructor(feat = 'This feature') { super(`${feat} requires a Premium subscription`, 403, 'PREMIUM_REQUIRED'); } }
export class StreamError          extends AppError { constructor(msg: string, code = 'STREAM_ERROR') { super(msg, 400, code); } }
