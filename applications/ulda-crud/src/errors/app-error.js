import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "./error-codes.js";

/**
 * Base application error with HTTP status, machine-readable code, localization key, and unique error id.
 */
class AppError extends Error {
  /**
   * @param {string} message
   * @param {object} [options]
   * @param {number} [options.status]
   * @param {string} [options.code]
   * @param {string} [options.messageKey]
   * @param {string} [options.nextStepKey]
   * @param {object} [options.context]
   * @param {string} [options.errorId]
   * @param {boolean} [options.expose]
   * @param {"critical"|"error"|"warning"|"info"|"debug"} [options.level]
   * @param {Error} [options.cause]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.status = options.status ?? 500;
    this.code = options.code ?? ERROR_CODES.INTERNAL;
    this.messageKey = options.messageKey ?? "errors.internal";
    this.nextStepKey = options.nextStepKey ?? "next.retryLater";
    this.context = options.context ?? {};
    this.errorId = options.errorId ?? randomUUID();
    this.expose = options.expose ?? this.status < 500;
    this.level = options.level ?? (this.status >= 500 ? "error" : "warning");
  }
}

class ValidationError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      status: 400,
      code: ERROR_CODES.VALIDATION,
      messageKey: "errors.validation",
      nextStepKey: "next.reviewInput",
      level: "warning",
      ...options
    });
  }
}

class NotFoundError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      status: 404,
      code: ERROR_CODES.NOT_FOUND,
      messageKey: "errors.notFound",
      nextStepKey: "next.checkAddress",
      level: "warning",
      ...options
    });
  }
}

class DatabaseError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      status: 503,
      code: ERROR_CODES.DATABASE,
      messageKey: "errors.database",
      nextStepKey: "next.retryLater",
      level: "error",
      expose: true,
      ...options
    });
  }
}

class VerificationError extends AppError {
  constructor(message, options = {}) {
    super(message, {
      status: 400,
      code: ERROR_CODES.VERIFICATION,
      messageKey: "errors.verification",
      nextStepKey: "next.useNextState",
      level: "warning",
      ...options
    });
  }
}

/**
 * Converts unknown errors to AppError instances while preserving existing AppError objects.
 *
 * @param {unknown} error
 * @param {object} [options]
 * @param {string} [options.message]
 * @param {object} [options.context]
 * @returns {AppError}
 */
function toAppError(error, options = {}) {
  if (error instanceof AppError) {
    return error;
  }
  const message = options.message ?? (error instanceof Error ? error.message : String(error));
  return new AppError(message, {
    context: options.context,
    cause: error instanceof Error ? error : undefined
  });
}

export {
  AppError,
  DatabaseError,
  NotFoundError,
  ValidationError,
  VerificationError,
  toAppError
};
