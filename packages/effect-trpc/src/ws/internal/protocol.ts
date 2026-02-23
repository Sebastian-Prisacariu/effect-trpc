/**
 * @module effect-trpc/ws/internal/protocol
 * @internal
 *
 * Internal protocol utilities for WebSocket communication.
 * Contains type guards and helpers that are implementation details.
 */

import type {
    AuthMessage,
    BackpressureAckMessage,
    ClientDataMessage,
    CompleteMessage,
    DataMessage,
    ErrorMessage,
    FromClientMessage,
    FromServerMessage,
    PauseMessage,
    PingMessage,
    ResumeMessage,
    SubscribeMessage,
    UnsubscribeMessage,
} from "../protocol.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client Message Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a client message is an AuthMessage.
 * @internal
 */
export const isAuthMessage = (msg: FromClientMessage): msg is AuthMessage =>
  msg._tag === "Auth"

/**
 * Check if a client message is a SubscribeMessage.
 * @internal
 */
export const isSubscribeMessage = (msg: FromClientMessage): msg is SubscribeMessage =>
  msg._tag === "Subscribe"

/**
 * Check if a client message is an UnsubscribeMessage.
 * @internal
 */
export const isUnsubscribeMessage = (msg: FromClientMessage): msg is UnsubscribeMessage =>
  msg._tag === "Unsubscribe"

/**
 * Check if a client message is a ClientDataMessage.
 * @internal
 */
export const isClientDataMessage = (msg: FromClientMessage): msg is ClientDataMessage =>
  msg._tag === "ClientData"

/**
 * Check if a client message is a PingMessage.
 * @internal
 */
export const isPingMessage = (msg: FromClientMessage): msg is PingMessage =>
  msg._tag === "Ping"

/**
 * Check if a client message is a BackpressureAckMessage.
 * @internal
 * @since 0.1.0
 */
export const isBackpressureAckMessage = (msg: FromClientMessage): msg is BackpressureAckMessage =>
  msg._tag === "BackpressureAck"

// ─────────────────────────────────────────────────────────────────────────────
// Server Message Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a server message is a DataMessage.
 * @internal
 */
export const isDataMessage = (msg: FromServerMessage): msg is DataMessage =>
  msg._tag === "Data"

/**
 * Check if a server message is an ErrorMessage.
 * @internal
 */
export const isErrorMessage = (msg: FromServerMessage): msg is ErrorMessage =>
  msg._tag === "Error"

/**
 * Check if a server message is a CompleteMessage.
 * @internal
 */
export const isCompleteMessage = (msg: FromServerMessage): msg is CompleteMessage =>
  msg._tag === "Complete"

/**
 * Check if a server message is a PauseMessage.
 * @internal
 * @since 0.1.0
 */
export const isPauseMessage = (msg: FromServerMessage): msg is PauseMessage =>
  msg._tag === "Pause"

/**
 * Check if a server message is a ResumeMessage.
 * @internal
 * @since 0.1.0
 */
export const isResumeMessage = (msg: FromServerMessage): msg is ResumeMessage =>
  msg._tag === "Resume"
