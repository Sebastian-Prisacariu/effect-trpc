/**
 * @module effect-trpc/ws/protocol
 *
 * WebSocket message schemas for client-server communication.
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Client → Server Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authentication message sent immediately after connection.
 */
export class AuthMessage extends Schema.TaggedClass<AuthMessage>()("Auth", {
  token: Schema.String,
}) {}

/**
 * Subscribe to a procedure.
 *
 * @remarks
 * The `id` field is a client-provided correlation ID for the subscription request.
 * The server generates a unique subscription ID and returns it in `SubscribedMessage.subscriptionId`.
 * Subsequent messages (Data, Complete, Error) use the server-generated `subscriptionId`.
 */
export class SubscribeMessage extends Schema.TaggedClass<SubscribeMessage>()(
  "Subscribe",
  {
    /** Client-provided correlation ID for this subscription request */
    id: Schema.String,
    /** Procedure path (e.g., "notifications.watch") */
    path: Schema.String,
    /** Procedure input, validated server-side */
    input: Schema.Unknown,
  },
) {}

/**
 * Unsubscribe from an active subscription.
 */
export class UnsubscribeMessage extends Schema.TaggedClass<UnsubscribeMessage>()(
  "Unsubscribe",
  {
    id: Schema.String,
  },
) {}

/**
 * Client sending data to an active subscription (bidirectional).
 */
export class ClientDataMessage extends Schema.TaggedClass<ClientDataMessage>()(
  "ClientData",
  {
    id: Schema.String,
    data: Schema.Unknown,
  },
) {}

/**
 * Ping message for keepalive.
 */
export class PingMessage extends Schema.TaggedClass<PingMessage>()("Ping", {}) {}

/**
 * Client acknowledges backpressure state change.
 * Sent in response to Pause/Resume messages.
 *
 * @since 0.1.0
 * @category Backpressure
 */
export class BackpressureAckMessage extends Schema.TaggedClass<BackpressureAckMessage>()(
  "BackpressureAck",
  {
    /** Subscription ID this ack is for */
    id: Schema.String,
    /** Whether client is now paused */
    paused: Schema.Boolean,
  },
) {}

/**
 * Union of all client → server messages.
 */
export const FromClientMessage = Schema.Union(
  AuthMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientDataMessage,
  PingMessage,
  BackpressureAckMessage,
)
export type FromClientMessage = typeof FromClientMessage.Type

// ─────────────────────────────────────────────────────────────────────────────
// Server → Client Messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authentication result.
 */
export class AuthResultMessage extends Schema.TaggedClass<AuthResultMessage>()(
  "AuthResult",
  {
    success: Schema.Boolean,
    clientId: Schema.optional(Schema.String),
    error: Schema.optional(Schema.String),
  },
) {}

/**
 * Subscription confirmed.
 *
 * @remarks
 * `id` is the client's correlation ID from the SubscribeMessage.
 * `subscriptionId` is the server-generated unique ID for the subscription.
 * All subsequent messages (Data, Complete, Error, Unsubscribe) use `subscriptionId`.
 */
export class SubscribedMessage extends Schema.TaggedClass<SubscribedMessage>()(
  "Subscribed",
  {
    /** Client's correlation ID from SubscribeMessage */
    id: Schema.String,
    /** Server-generated unique subscription ID */
    subscriptionId: Schema.String,
  },
) {}

/**
 * Data from a subscription.
 */
export class DataMessage extends Schema.TaggedClass<DataMessage>()("Data", {
  id: Schema.String,
  data: Schema.Unknown,
}) {}

/**
 * Error from a subscription.
 */
export class ErrorMessage extends Schema.TaggedClass<ErrorMessage>()("Error", {
  id: Schema.String,
  error: Schema.Struct({
    _tag: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }),
}) {}

/**
 * Subscription completed normally.
 */
export class CompleteMessage extends Schema.TaggedClass<CompleteMessage>()(
  "Complete",
  {
    id: Schema.String,
  },
) {}

/**
 * Server sending data back to client for a subscription (bidirectional response).
 */
export class ServerDataMessage extends Schema.TaggedClass<ServerDataMessage>()(
  "ServerData",
  {
    id: Schema.String,
    data: Schema.Unknown,
  },
) {}

/**
 * Pong response to ping.
 */
export class PongMessage extends Schema.TaggedClass<PongMessage>()("Pong", {}) {}

/**
 * Server signals client to pause sending data.
 * Sent when server-side queue is filling up.
 *
 * @since 0.1.0
 * @category Backpressure
 */
export class PauseMessage extends Schema.TaggedClass<PauseMessage>()(
  "Pause",
  {
    /** Subscription ID to pause */
    id: Schema.String,
    /** Current queue fill percentage (0-100) */
    queueFillPercent: Schema.Number,
  },
) {}

/**
 * Server signals client to resume sending data.
 * Sent when server-side queue has drained sufficiently.
 *
 * @since 0.1.0
 * @category Backpressure
 */
export class ResumeMessage extends Schema.TaggedClass<ResumeMessage>()(
  "Resume",
  {
    /** Subscription ID to resume */
    id: Schema.String,
  },
) {}

/**
 * Union of all server → client messages.
 */
export const FromServerMessage = Schema.Union(
  AuthResultMessage,
  SubscribedMessage,
  DataMessage,
  ErrorMessage,
  CompleteMessage,
  ServerDataMessage,
  PongMessage,
  PauseMessage,
  ResumeMessage,
)
export type FromServerMessage = typeof FromServerMessage.Type

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards (re-exported from internal)
// ─────────────────────────────────────────────────────────────────────────────

import * as internal from "./internal/protocol.js"

/**
 * Check if a client message is an AuthMessage.
 * @since 0.1.0
 * @category guards
 */
export const isAuthMessage = internal.isAuthMessage

/**
 * Check if a client message is a SubscribeMessage.
 * @since 0.1.0
 * @category guards
 */
export const isSubscribeMessage = internal.isSubscribeMessage

/**
 * Check if a client message is an UnsubscribeMessage.
 * @since 0.1.0
 * @category guards
 */
export const isUnsubscribeMessage = internal.isUnsubscribeMessage

/**
 * Check if a client message is a ClientDataMessage.
 * @since 0.1.0
 * @category guards
 */
export const isClientDataMessage = internal.isClientDataMessage

/**
 * Check if a client message is a PingMessage.
 * @since 0.1.0
 * @category guards
 */
export const isPingMessage = internal.isPingMessage

/**
 * Check if a server message is a DataMessage.
 * @since 0.1.0
 * @category guards
 */
export const isDataMessage = internal.isDataMessage

/**
 * Check if a server message is an ErrorMessage.
 * @since 0.1.0
 * @category guards
 */
export const isErrorMessage = internal.isErrorMessage

/**
 * Check if a server message is a CompleteMessage.
 * @since 0.1.0
 * @category guards
 */
export const isCompleteMessage = internal.isCompleteMessage

/**
 * Check if a client message is a BackpressureAckMessage.
 * @since 0.1.0
 * @category guards
 */
export const isBackpressureAckMessage = internal.isBackpressureAckMessage

/**
 * Check if a server message is a PauseMessage.
 * @since 0.1.0
 * @category guards
 */
export const isPauseMessage = internal.isPauseMessage

/**
 * Check if a server message is a ResumeMessage.
 * @since 0.1.0
 * @category guards
 */
export const isResumeMessage = internal.isResumeMessage
