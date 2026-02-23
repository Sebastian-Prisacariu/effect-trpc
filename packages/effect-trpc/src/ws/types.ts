/**
 * @module effect-trpc/ws/types
 *
 * Branded IDs and state types for WebSocket subscriptions.
 */

import * as CoreTypes from "../core/types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Branded IDs (re-exported from core)
// ─────────────────────────────────────────────────────────────────────────────

// Re-export branded IDs from core to maintain backward compatibility
// while keeping the dependency direction clean (ws depends on core, not vice versa)

/**
 * Unique identifier for a WebSocket client connection.
 * Re-exported from core/types.
 */
export const ClientId = CoreTypes.ClientId

/**
 * Type for ClientId branded string.
 */
export type ClientId = CoreTypes.ClientId

/**
 * Unique identifier for an active subscription.
 * Re-exported from core/types.
 */
export const SubscriptionId = CoreTypes.SubscriptionId

/**
 * Type for SubscriptionId branded string.
 */
export type SubscriptionId = CoreTypes.SubscriptionId

// ─────────────────────────────────────────────────────────────────────────────
// Connection State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket connection state.
 */
export type ConnectionState =
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Authenticating" }
  | { readonly _tag: "Connected"; readonly clientId: ClientId }
  | { readonly _tag: "Reconnecting"; readonly attempt: number }
  | { readonly _tag: "Disconnected"; readonly reason?: string }

/**
 * Connection state constructors.
 */
export const ConnectionStateCtor = {
  Connecting: { _tag: "Connecting" } as const,
  Authenticating: { _tag: "Authenticating" } as const,
  Connected: (clientId: ClientId): ConnectionState => ({
    _tag: "Connected",
    clientId,
  }),
  Reconnecting: (attempt: number): ConnectionState => ({
    _tag: "Reconnecting",
    attempt,
  }),
  Disconnected: (reason?: string): ConnectionState =>
    reason !== undefined
      ? { _tag: "Disconnected", reason }
      : { _tag: "Disconnected" },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Subscription State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State of an individual subscription.
 */
export type SubscriptionState<A = unknown> =
  | { readonly _tag: "Subscribing" }
  | { readonly _tag: "Active"; readonly lastData?: A }
  | { readonly _tag: "Error"; readonly error: unknown }
  | { readonly _tag: "Completed" }
  | { readonly _tag: "Unsubscribed" }

/**
 * Subscription state constructors.
 */
export const SubscriptionStateCtor = {
  Subscribing: { _tag: "Subscribing" } as const,
  Active: <A>(lastData?: A): SubscriptionState<A> =>
    lastData !== undefined
      ? { _tag: "Active", lastData }
      : { _tag: "Active" },
  Error: (error: unknown): SubscriptionState => ({
    _tag: "Error",
    error,
  }),
  Completed: { _tag: "Completed" } as const,
  Unsubscribed: { _tag: "Unsubscribed" } as const,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// ID Generators (re-exported from internal)
// ─────────────────────────────────────────────────────────────────────────────

import * as internal from "./internal/types.js"

/**
 * Generate a unique client ID.
 * Uses Clock and Random services for referential transparency.
 *
 * @since 0.1.0
 * @category generators
 */
export const generateClientId = internal.generateClientId

/**
 * Generate a unique subscription ID.
 * Uses Clock and Random services for referential transparency.
 *
 * @since 0.1.0
 * @category generators
 */
export const generateSubscriptionId = internal.generateSubscriptionId
