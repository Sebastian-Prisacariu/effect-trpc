/**
 * @module effect-trpc/errors
 *
 * Rich domain errors for effect-trpc, following the Schema.TaggedError pattern.
 * All errors include:
 * - TypeId for type identification
 * - isRetryable flag for client retry logic
 * - httpStatus for server response codes
 * - Contextual message getters
 */

import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

// ─────────────────────────────────────────────────────────────────────────────
// Type Identification
// ─────────────────────────────────────────────────────────────────────────────

export const TypeId: unique symbol = Symbol.for("@effect-trpc/TRPCError")
export type TypeId = typeof TypeId

export const isTRPCError = (u: unknown): u is TRPCError =>
  Predicate.hasProperty(u, TypeId)

// ─────────────────────────────────────────────────────────────────────────────
// Base Fields (all errors have these)
// ─────────────────────────────────────────────────────────────────────────────

const BaseFields = {
  procedure: Schema.String,
  description: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error for invalid procedure input.
 *
 * @remarks
 * **Security Note:** The `received` field contains the raw invalid value.
 * This may include sensitive user data. Be careful when:
 * - Logging this error (consider sanitizing or omitting `received`)
 * - Returning this error to clients (the client already has the data)
 * - Storing error logs (may violate data retention policies)
 *
 * @since 0.1.0
 * @category errors
 */
export class InputValidationError extends Schema.TaggedError<InputValidationError>()(
  "InputValidationError",
  {
    ...BaseFields,
    field: Schema.optional(Schema.String),
    expected: Schema.optional(Schema.String),
    /** Raw invalid value - may contain sensitive data, handle with care */
    received: Schema.optional(Schema.Unknown),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 400

  override get message(): string {
    const field = this.field ? ` at "${this.field}"` : ""
    return `[${this.procedure}] Input validation failed${field}: ${this.description ?? "Invalid input"}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Validation Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when procedure output doesn't match the expected schema.
 *
 * @since 0.1.0
 * @category errors
 */
export class OutputValidationError extends Schema.TaggedError<OutputValidationError>()(
  "OutputValidationError",
  {
    ...BaseFields,
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 500

  override get message(): string {
    return `[${this.procedure}] Output validation failed: ${this.description ?? "Server returned invalid data"}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Not Found Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when a requested resource cannot be found.
 *
 * @since 0.1.0
 * @category errors
 */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  {
    ...BaseFields,
    resource: Schema.optional(Schema.String),
    resourceId: Schema.optional(Schema.String),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 404

  override get message(): string {
    const resource = this.resource ?? "Resource"
    const id = this.resourceId ? ` (${this.resourceId})` : ""
    return `[${this.procedure}] ${resource}${id} not found`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unauthorized Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when authentication is required but not provided.
 *
 * @since 0.1.0
 * @category errors
 */
export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  {
    ...BaseFields,
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 401

  override get message(): string {
    return `[${this.procedure}] Authentication required`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when access to a resource is denied due to insufficient permissions.
 *
 * @since 0.1.0
 * @category errors
 */
export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  {
    ...BaseFields,
    requiredPermission: Schema.optional(Schema.String),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 403

  override get message(): string {
    const perm = this.requiredPermission
      ? ` (requires: ${this.requiredPermission})`
      : ""
    return `[${this.procedure}] Access denied${perm}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limit Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when a rate limit has been exceeded.
 *
 * @since 0.1.0
 * @category errors
 */
export class RateLimitError extends Schema.TaggedError<RateLimitError>()(
  "RateLimitError",
  {
    ...BaseFields,
    retryAfterMs: Schema.optional(Schema.Number),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = true
  readonly httpStatus = 429

  override get message(): string {
    const retry = this.retryAfterMs
      ? `. Retry after ${Math.ceil(this.retryAfterMs / 1000)}s`
      : ""
    return `[${this.procedure}] Rate limit exceeded${retry}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeout Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when a request times out.
 *
 * @since 0.1.0
 * @category errors
 */
export class TimeoutError extends Schema.TaggedError<TimeoutError>()(
  "TimeoutError",
  {
    ...BaseFields,
    timeoutMs: Schema.Number,
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = true
  readonly httpStatus = 504

  override get message(): string {
    return `[${this.procedure}] Request timed out after ${this.timeoutMs}ms`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error for unexpected internal server errors.
 *
 * @since 0.1.0
 * @category errors
 */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "InternalError",
  {
    ...BaseFields,
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 500

  override get message(): string {
    return `[${this.procedure}] Internal server error: ${this.description ?? "An unexpected error occurred"}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Error (Client-side only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error for network-related failures (client-side only).
 *
 * @since 0.1.0
 * @category errors
 */
export class NetworkError extends Schema.TaggedError<NetworkError>()(
  "NetworkError",
  {
    ...BaseFields,
    reason: Schema.Literal("Offline", "ConnectionFailed", "ConnectionReset"),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = true
  readonly httpStatus = 0 // No HTTP response

  override get message(): string {
    return `[${this.procedure}] Network error: ${this.reason}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Union Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of all tRPC error types.
 *
 * @since 0.1.0
 * @category errors
 */
export type TRPCError =
  | InputValidationError
  | OutputValidationError
  | NotFoundError
  | UnauthorizedError
  | ForbiddenError
  | RateLimitError
  | TimeoutError
  | InternalError
  | NetworkError

/**
 * Schema for all tRPC error types.
 *
 * @since 0.1.0
 * @category errors
 */
export const TRPCErrorSchema = Schema.Union(
  InputValidationError,
  OutputValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  TimeoutError,
  InternalError,
  NetworkError,
)
