/**
 * @module effect-trpc/ws/errors
 *
 * WebSocket-specific error types.
 */

import * as Schema from "effect/Schema"
import * as Predicate from "effect/Predicate"

// ─────────────────────────────────────────────────────────────────────────────
// Type Identification
// ─────────────────────────────────────────────────────────────────────────────

export const WebSocketErrorTypeId: unique symbol = Symbol.for("@effect-trpc/WebSocketError")
export type WebSocketErrorTypeId = typeof WebSocketErrorTypeId

export const isWebSocketError = (u: unknown): u is WebSocketError =>
  Predicate.hasProperty(u, WebSocketErrorTypeId)

// ─────────────────────────────────────────────────────────────────────────────
// Connection Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error establishing or maintaining WebSocket connection.
 *
 * @since 0.1.0
 * @category errors
 */
export class WebSocketConnectionError extends Schema.TaggedError<WebSocketConnectionError>()(
  "WebSocketConnectionError",
  {
    url: Schema.String,
    reason: Schema.Literal(
      "ConnectionFailed",
      "ConnectionLost",
      "Timeout",
      "Closed",
      "MaxAttemptsReached",
    ),
    description: Schema.optional(Schema.String),
    code: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const codeStr = this.code !== undefined ? ` (code: ${this.code})` : ""
    const desc = this.description ? `: ${this.description}` : ""
    return `WebSocket connection error: ${this.reason}${codeStr}${desc}`
  }
}

/**
 * Error sending a message over WebSocket.
 *
 * @since 0.1.0
 * @category errors
 */
export class WebSocketSendError extends Schema.TaggedError<WebSocketSendError>()(
  "WebSocketSendError",
  {
    reason: Schema.Literal("NotConnected", "SendFailed", "EncodeFailed"),
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const desc = this.description ? `: ${this.description}` : ""
    return `WebSocket send error: ${this.reason}${desc}`
  }
}

/**
 * Error closing WebSocket connection.
 *
 * @since 0.1.0
 * @category errors
 */
export class WebSocketCloseError extends Schema.TaggedError<WebSocketCloseError>()(
  "WebSocketCloseError",
  {
    code: Schema.optional(Schema.Number),
    reason: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const codeStr = this.code !== undefined ? ` (code: ${this.code})` : ""
    const reasonStr = this.reason ? `: ${this.reason}` : ""
    return `WebSocket close error${codeStr}${reasonStr}`
  }
}

/**
 * WebSocket authentication error.
 *
 * @since 0.1.0
 * @category errors
 */
export class WebSocketAuthError extends Schema.TaggedError<WebSocketAuthError>()(
  "WebSocketAuthError",
  {
    reason: Schema.Literal(
      "InvalidToken",
      "Expired",
      "Missing",
      "Rejected",
      "Timeout",
      "TokenError",
      "SendFailed",
    ),
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const desc = this.description ? `: ${this.description}` : ""
    return `WebSocket authentication failed: ${this.reason}${desc}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error related to a specific WebSocket subscription.
 *
 * @since 0.1.0
 * @category errors
 */
export class WebSocketSubscriptionError extends Schema.TaggedError<WebSocketSubscriptionError>()(
  "WebSocketSubscriptionError",
  {
    subscriptionId: Schema.String,
    path: Schema.String,
    reason: Schema.Literal(
      "NotFound",
      "InputValidation",
      "OutputValidation",
      "HandlerError",
      "Interrupted",
      "Unauthorized",
      "SetupTimeout",
    ),
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const desc = this.description ? `: ${this.description}` : ""
    return `WebSocket subscription error [${this.path}] (${this.subscriptionId}): ${this.reason}${desc}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error in WebSocket message protocol.
 *
 * @since 0.1.0
 * @category errors
 */
export class WebSocketProtocolError extends Schema.TaggedError<WebSocketProtocolError>()(
  "WebSocketProtocolError",
  {
    reason: Schema.Literal("InvalidMessage", "UnexpectedMessage", "ParseError", "EncodeError"),
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const desc = this.description ? `: ${this.description}` : ""
    return `WebSocket protocol error: ${this.reason}${desc}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection not found in registry.
 *
 * @since 0.1.0
 * @category errors
 */
export class ConnectionNotFoundError extends Schema.TaggedError<ConnectionNotFoundError>()(
  "ConnectionNotFoundError",
  {
    clientId: Schema.String,
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    return `Connection not found: ${this.clientId}`
  }
}

/**
 * Connection limit exceeded - server has reached maximum connections.
 * Used for DoS protection.
 *
 * @since 0.1.0
 * @category errors
 */
export class ConnectionLimitExceededError extends Schema.TaggedError<ConnectionLimitExceededError>()(
  "ConnectionLimitExceededError",
  {
    currentCount: Schema.Number,
    maxConnections: Schema.Number,
    clientId: Schema.optional(Schema.String),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const client = this.clientId ? ` (client: ${this.clientId})` : ""
    return `Connection limit exceeded: ${this.currentCount}/${this.maxConnections}${client}`
  }
}

/**
 * Subscription not found.
 *
 * @since 0.1.0
 * @category errors
 */
export class SubscriptionNotFoundError extends Schema.TaggedError<SubscriptionNotFoundError>()(
  "SubscriptionNotFoundError",
  {
    subscriptionId: Schema.String,
    clientId: Schema.optional(Schema.String),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const client = this.clientId ? ` (client: ${this.clientId})` : ""
    return `Subscription not found: ${this.subscriptionId}${client}`
  }
}

/**
 * Handler not found for procedure path.
 *
 * @since 0.1.0
 * @category errors
 */
export class HandlerNotFoundError extends Schema.TaggedError<HandlerNotFoundError>()(
  "HandlerNotFoundError",
  {
    path: Schema.String,
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    return `No subscription handler found for: ${this.path}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconnection Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconnection attempts exhausted.
 *
 * @since 0.1.0
 * @category errors
 */
export class ReconnectGaveUpError extends Schema.TaggedError<ReconnectGaveUpError>()(
  "ReconnectGaveUpError",
  {
    attempts: Schema.Number,
    lastError: Schema.optional(Schema.Unknown),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    return `WebSocket reconnection failed after ${this.attempts} attempts`
  }
}

/**
 * Heartbeat timeout - no pong received.
 *
 * @since 0.1.0
 * @category errors
 */
export class HeartbeatTimeoutError extends Schema.TaggedError<HeartbeatTimeoutError>()(
  "HeartbeatTimeoutError",
  {
    clientId: Schema.String,
    lastPongAt: Schema.optional(Schema.DateFromSelf),
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    return `Heartbeat timeout for client: ${this.clientId}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Message rate limit exceeded - client is sending messages too quickly.
 * Used for DoS protection.
 *
 * @since 0.1.0
 * @category errors
 */
export class MessageRateLimitExceededError extends Schema.TaggedError<MessageRateLimitExceededError>()(
  "MessageRateLimitExceededError",
  {
    clientId: Schema.String,
    currentCount: Schema.Number,
    maxMessages: Schema.Number,
    retryAfterMs: Schema.Number,
  },
) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    const retrySeconds = Math.ceil(this.retryAfterMs / 1000)
    return `Rate limit exceeded for client ${this.clientId}: ${this.currentCount}/${this.maxMessages} messages. Retry after ${retrySeconds}s`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path Validation Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invalid subscription path.
 * Used for security validation of procedure paths.
 *
 * @since 0.1.0
 * @category errors
 */
export class InvalidPathError extends Schema.TaggedError<InvalidPathError>()("InvalidPathError", {
  path: Schema.String,
  reason: Schema.String,
}) {
  readonly [WebSocketErrorTypeId]: WebSocketErrorTypeId = WebSocketErrorTypeId

  override get message(): string {
    return `Invalid subscription path "${this.path}": ${this.reason}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Union Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of all WebSocket error types.
 *
 * @since 0.1.0
 * @category errors
 */
export type WebSocketError =
  | WebSocketConnectionError
  | WebSocketSendError
  | WebSocketCloseError
  | WebSocketAuthError
  | WebSocketSubscriptionError
  | WebSocketProtocolError
  | ConnectionNotFoundError
  | ConnectionLimitExceededError
  | SubscriptionNotFoundError
  | HandlerNotFoundError
  | ReconnectGaveUpError
  | HeartbeatTimeoutError
  | MessageRateLimitExceededError
  | InvalidPathError
