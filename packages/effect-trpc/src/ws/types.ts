/**
 * @module effect-trpc/ws/types
 *
 * Branded IDs and state types for WebSocket subscriptions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Branded IDs
// ─────────────────────────────────────────────────────────────────────────────

declare const ClientIdBrand: unique symbol
declare const SubscriptionIdBrand: unique symbol

/**
 * Unique identifier for a WebSocket client connection.
 * Branded string identifier for a WebSocket client connection.
 */
export const ClientId = (value: string): ClientId => value as ClientId

/**
 * Type for ClientId branded string.
 */
export type ClientId = string & { readonly [ClientIdBrand]: true }

/**
 * Unique identifier for an active subscription.
 * Branded string identifier for an active subscription.
 */
export const SubscriptionId = (value: string): SubscriptionId => value as SubscriptionId

/**
 * Type for SubscriptionId branded string.
 */
export type SubscriptionId = string & { readonly [SubscriptionIdBrand]: true }

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
