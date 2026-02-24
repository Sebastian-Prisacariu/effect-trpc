/**
 * @module effect-trpc/core/network
 *
 * Network service for online/offline detection.
 *
 * @example
 * ```ts
 * import { Network, NetworkBrowserLive } from 'effect-trpc'
 *
 * const program = Effect.gen(function* () {
 *   const network = yield* Network
 *
 *   // Check status
 *   const online = yield* network.isOnline
 *
 *   // Wait for online
 *   yield* network.awaitOnline
 *
 *   // Run only when online
 *   yield* network.whenOnline(myEffect)
 * })
 *
 * program.pipe(Effect.provide(NetworkBrowserLive))
 * ```
 *
 * @since 0.3.0
 */

// Types
export type { NetworkState, NetworkDetector, NetworkService } from "./Network.js"

// Service Tag
export { Network } from "./Network.js"

// Layers
export { NetworkBrowserLive, NetworkAlwaysOnline } from "./Network.js"

// Convenience accessors
export {
  isOnline,
  getState,
  awaitOnline,
  awaitOffline,
  whenOnline,
  whenOffline,
} from "./Network.js"

// Errors
export { NetworkOfflineError, NetworkErrorTypeId } from "./errors.js"
