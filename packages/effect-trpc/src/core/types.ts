/**
 * @module effect-trpc/core/types
 *
 * Core branded types used throughout effect-trpc.
 *
 * @since 0.1.0
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Branded IDs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unique identifier for a WebSocket client connection.
 *
 * @since 0.1.0
 * @category models
 */
export const ClientId = Schema.String.pipe(Schema.brand("ClientId"))

/**
 * Type for ClientId branded string.
 *
 * @since 0.1.0
 * @category models
 */
export type ClientId = typeof ClientId.Type

/**
 * Unique identifier for an active subscription.
 *
 * @since 0.1.0
 * @category models
 */
export const SubscriptionId = Schema.String.pipe(Schema.brand("SubscriptionId"))

/**
 * Type for SubscriptionId branded string.
 *
 * @since 0.1.0
 * @category models
 */
export type SubscriptionId = typeof SubscriptionId.Type
