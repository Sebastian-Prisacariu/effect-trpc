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

// Sensitive field patterns for redaction
const SENSITIVE_PATTERNS = /"(password|token|secret|key|apikey|api_key|authorization|auth|credential|private)":\s*"[^"]*"/gi

/**
 * Redact sensitive values from a JSON string.
 * @internal
 */
const redactSensitive = (str: string): string =>
  str.replace(SENSITIVE_PATTERNS, '"$1":"[REDACTED]"')

/**
 * Error for invalid procedure input.
 *
 * @remarks
 * **Security Note:** Raw input is NOT included in serialization to prevent
 * sensitive data (passwords, tokens, etc.) from leaking into logs or error
 * responses. Use `getDebugInfo()` for development debugging only.
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
    // Note: received field removed from schema to prevent serialization
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly isRetryable = false
  readonly httpStatus = 400

  /**
   * Private storage for raw input - NOT serialized.
   * Only accessible via getDebugInfo() which redacts sensitive data.
   * @internal
   */
  private readonly _rawInput?: unknown

  /**
   * Create an InputValidationError with optional raw input capture.
   *
   * @param props - Error properties (procedure, field, expected, description)
   * @param rawInput - Optional raw input for debugging (NOT serialized)
   */
  static withInput(
    props: {
      readonly procedure: string
      readonly field?: string
      readonly expected?: string
      readonly description?: string
      readonly cause?: unknown
    },
    rawInput?: unknown,
  ): InputValidationError {
    const error = new InputValidationError(props)
    // Use Object.defineProperty to set private field after construction
    Object.defineProperty(error, "_rawInput", {
      value: rawInput,
      writable: false,
      enumerable: false, // Won't show in JSON.stringify
      configurable: false,
    })
    return error
  }

  override get message(): string {
    const field = this.field ? ` at "${this.field}"` : ""
    return `[${this.procedure}] Input validation failed${field}: ${this.description ?? "Invalid input"}`
  }

  /**
   * Get debug information about the invalid input.
   *
   * **WARNING:** Only use this for development debugging. The output is
   * truncated and has common sensitive fields redacted, but may still
   * contain sensitive data. Never log this in production.
   *
   * @param maxLength - Maximum length of the output (default: 200)
   * @returns Truncated and redacted string representation of the input
   */
  getDebugInfo(maxLength = 200): string {
    if (this._rawInput === undefined) {
      return "[input not captured]"
    }

    try {
      const str = JSON.stringify(this._rawInput)
      const redacted = redactSensitive(str)
      if (redacted.length <= maxLength) {
        return redacted
      }
      return redacted.slice(0, maxLength) + "...[truncated]"
    } catch {
      return "[input not serializable]"
    }
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
