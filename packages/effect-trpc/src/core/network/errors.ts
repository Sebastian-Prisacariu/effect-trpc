/**
 * @module effect-trpc/core/network/errors
 *
 * Errors for the Network service.
 *
 * @since 0.2.0
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Type Identification
// ─────────────────────────────────────────────────────────────────────────────

export const NetworkErrorTypeId: unique symbol = Symbol.for("@effect-trpc/NetworkError")
export type NetworkErrorTypeId = typeof NetworkErrorTypeId

// ─────────────────────────────────────────────────────────────────────────────
// Network Offline Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when attempting to execute an effect while offline
 * and the network gate is configured to fail.
 *
 * @since 0.2.0
 * @category errors
 */
export class NetworkOfflineError extends Schema.TaggedError<NetworkOfflineError>()(
  "NetworkOfflineError",
  {
    lastOnlineAt: Schema.optional(Schema.Number),
  },
) {
  readonly [NetworkErrorTypeId]: NetworkErrorTypeId = NetworkErrorTypeId
  readonly isRetryable = true

  override get message(): string {
    if (this.lastOnlineAt) {
      const ago = Math.round((Date.now() - this.lastOnlineAt) / 1000)
      return `Network is offline (last online ${ago}s ago)`
    }
    return "Network is offline"
  }
}
