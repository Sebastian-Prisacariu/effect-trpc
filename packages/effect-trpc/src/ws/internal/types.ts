/**
 * @module effect-trpc/ws/internal/types
 * @internal
 *
 * Internal type utilities for WebSocket subscriptions.
 * Contains ID generators and state management helpers.
 */

import * as Effect from "effect/Effect"
import * as Random from "effect/Random"
import * as Clock from "effect/Clock"
import type { ClientId, SubscriptionId } from "../types.js"

// ─────────────────────────────────────────────────────────────────────────────
// ID Generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a unique client ID.
 * Uses Clock and Random services for referential transparency.
 * @internal
 */
export const generateClientId: Effect.Effect<ClientId> = Effect.gen(function* () {
  const timestamp = yield* Clock.currentTimeMillis
  const random = yield* Random.nextInt
  return `client_${timestamp}_${Math.abs(random).toString(36).slice(0, 9)}` as ClientId
})

/**
 * Generate a unique subscription ID.
 * Uses Clock and Random services for referential transparency.
 * @internal
 */
export const generateSubscriptionId: Effect.Effect<SubscriptionId> = Effect.gen(function* () {
  const timestamp = yield* Clock.currentTimeMillis
  const random = yield* Random.nextInt
  return `sub_${timestamp}_${Math.abs(random).toString(36).slice(0, 9)}` as SubscriptionId
})
