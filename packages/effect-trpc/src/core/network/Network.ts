/**
 * @module effect-trpc/core/network/Network
 *
 * Network service for online/offline detection and flow control.
 *
 * Built on the Gate primitive, provides:
 * - Online/offline status detection
 * - Reactive state changes
 * - Request gating when offline
 * - SSR-safe implementation
 *
 * @example
 * ```ts
 * import { Network } from 'effect-trpc'
 * import { Effect } from 'effect'
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
 *   // Run effect only when online
 *   yield* network.whenOnline(myEffect)
 * })
 *
 * // Run with the browser-based layer
 * program.pipe(Effect.provide(Network.BrowserLive))
 * ```
 *
 * @since 0.3.0
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Scope from "effect/Scope"

import { Gate, type GateInstance } from "../gate/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current state of network connectivity.
 *
 * @since 0.3.0
 * @category types
 */
export interface NetworkState {
  readonly isOnline: boolean
  readonly lastOnlineAt: number | null
  readonly lastOfflineAt: number | null
}

/**
 * Network detection strategy.
 *
 * - `'browser'`: Use navigator.onLine + events (default, works everywhere)
 * - `'none'`: Always online (disable detection)
 *
 * @since 0.3.0
 * @category types
 */
export type NetworkDetector = "browser" | "none"

// ─────────────────────────────────────────────────────────────────────────────
// Service Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Network service interface.
 *
 * @since 0.3.0
 * @category service
 */
export interface NetworkService {
  // ─────────────────────────────────────────────────────────────────────────
  // State (Effect-based)
  // ─────────────────────────────────────────────────────────────────────────

  /** Current online status */
  readonly isOnline: Effect.Effect<boolean>

  /** Full state including timestamps */
  readonly state: Effect.Effect<NetworkState>

  /** Wait until online */
  readonly awaitOnline: Effect.Effect<void>

  /** Wait until offline */
  readonly awaitOffline: Effect.Effect<void>

  // ─────────────────────────────────────────────────────────────────────────
  // Reactive (Stream-based)
  // ─────────────────────────────────────────────────────────────────────────

  /** Stream of online/offline changes */
  readonly changes: Stream.Stream<boolean>

  // ─────────────────────────────────────────────────────────────────────────
  // Gating
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Run effect when online (waits if offline).
   * The effect will block until the network is online, then execute.
   * This never fails with a network error - it waits instead.
   */
  readonly whenOnline: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>

  /**
   * Run effect when offline (waits if online).
   * The effect will block until the network goes offline, then execute.
   */
  readonly whenOffline: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>

  // ─────────────────────────────────────────────────────────────────────────
  // Gate Access (for composition)
  // ─────────────────────────────────────────────────────────────────────────

  /** The underlying gate */
  readonly gate: GateInstance

  // ─────────────────────────────────────────────────────────────────────────
  // Callback-based (for React hooks)
  // ─────────────────────────────────────────────────────────────────────────

  /** Subscribe to online status changes */
  readonly subscribe: (callback: (isOnline: boolean) => void) => () => void

  /** Subscribe specifically to reconnect events */
  readonly subscribeToReconnect: (callback: () => void) => () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Network service Context.Tag.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const network = yield* Network
 *   const online = yield* network.isOnline
 * })
 * ```
 *
 * @since 0.3.0
 * @category service
 */
export class Network extends Context.Tag("@effect-trpc/Network")<Network, NetworkService>() {}

// ─────────────────────────────────────────────────────────────────────────────
// Browser Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Debounce delay in milliseconds.
 * Prevents rapid network state transitions (flapping) from causing
 * excessive reconnect attempts.
 */
const NETWORK_DEBOUNCE_MS = 500

const makeBrowserNetwork: Effect.Effect<NetworkService, never, Scope.Scope> = Effect.gen(
  function* () {
    const scope = yield* Effect.scope

    // Determine initial state (SSR-safe: default to online)
    // Note: In Node.js, navigator exists but navigator.onLine is undefined
    const initialOnline =
      typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
        ? navigator.onLine
        : true

    // Create underlying gate
    const gate = yield* Gate.make("network", {
      initiallyOpen: initialOnline,
      closedBehavior: "wait",
    })

    // State with timestamps
    const stateRef = yield* SubscriptionRef.make<NetworkState>({
      isOnline: initialOnline,
      lastOnlineAt: initialOnline ? Date.now() : null,
      lastOfflineAt: initialOnline ? null : Date.now(),
    })

    // Track reconnect subscribers separately
    const reconnectCallbacks = new Set<() => void>()

    // Set up browser event listeners (client-side only)
    if (typeof window !== "undefined") {
      // Debounce state for network flapping protection
      let debounceTimeout: ReturnType<typeof setTimeout> | null = null
      let lastKnownState: boolean = initialOnline

      /**
       * Apply a network state change after debouncing.
       * This is called after the debounce delay to actually update state.
       */
      const applyStateChange = (online: boolean) => {
        lastKnownState = online
        if (online) {
          Effect.runSync(
            Effect.gen(function* () {
              yield* Gate.open(gate)
              yield* SubscriptionRef.update(stateRef, (s) => ({
                ...s,
                isOnline: true,
                lastOnlineAt: Date.now(),
              }))
            }),
          )
          // Notify reconnect subscribers
          reconnectCallbacks.forEach((cb) => cb())
        } else {
          Effect.runSync(
            Effect.gen(function* () {
              yield* Gate.close(gate)
              yield* SubscriptionRef.update(stateRef, (s) => ({
                ...s,
                isOnline: false,
                lastOfflineAt: Date.now(),
              }))
            }),
          )
        }
      }

      /**
       * Handle network state change with debouncing.
       * Prevents rapid online/offline transitions (flapping) from causing
       * excessive reconnect attempts.
       */
      const handleNetworkChange = (online: boolean) => {
        // Skip if state hasn't actually changed
        if (online === lastKnownState) return

        // Clear any pending debounced state change
        if (debounceTimeout !== null) {
          clearTimeout(debounceTimeout)
        }

        // Debounce the state change
        debounceTimeout = setTimeout(() => {
          debounceTimeout = null
          applyStateChange(online)
        }, NETWORK_DEBOUNCE_MS)
      }

      const handleOnline = () => handleNetworkChange(true)
      const handleOffline = () => handleNetworkChange(false)

      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)

      yield* Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          // Clear any pending debounce on cleanup
          if (debounceTimeout !== null) {
            clearTimeout(debounceTimeout)
          }
          window.removeEventListener("online", handleOnline)
          window.removeEventListener("offline", handleOffline)
          reconnectCallbacks.clear()
        }),
      )
    }

    // Build service
    const service: NetworkService = {
      isOnline: SubscriptionRef.get(stateRef).pipe(Effect.map((s) => s.isOnline)),

      state: SubscriptionRef.get(stateRef),

      awaitOnline: Gate.awaitOpen(gate),

      awaitOffline: Gate.awaitClose(gate),

      changes: stateRef.changes.pipe(
        Stream.map((s) => s.isOnline),
        Stream.changes,
      ),

      // Type assertion: Gate.whenOpen returns E | GateClosedError, but since
      // we use closedBehavior: "wait", GateClosedError is never thrown.
      // The gate waits until open, never fails.
      whenOnline: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Gate.whenOpen(gate, effect) as Effect.Effect<A, E, R>,

      whenOffline: (effect) =>
        Effect.gen(function* () {
          yield* Gate.awaitClose(gate)
          return yield* effect
        }),

      gate,

      subscribe: (callback) => Gate.subscribe(gate, callback),

      subscribeToReconnect: (callback) => {
        reconnectCallbacks.add(callback)
        return () => {
          reconnectCallbacks.delete(callback)
        }
      },
    }

    return service
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Always Online Implementation
// ─────────────────────────────────────────────────────────────────────────────

const makeAlwaysOnline: Effect.Effect<NetworkService, never, Scope.Scope> = Effect.gen(
  function* () {
    // Create a gate that's always open
    const gate = yield* Gate.make("network", {
      initiallyOpen: true,
      closedBehavior: "wait",
    })

    const stateRef = yield* SubscriptionRef.make<NetworkState>({
      isOnline: true,
      lastOnlineAt: Date.now(),
      lastOfflineAt: null,
    })

    const service: NetworkService = {
      isOnline: Effect.succeed(true),

      state: SubscriptionRef.get(stateRef),

      awaitOnline: Effect.void,

      awaitOffline: Effect.never,

      changes: Stream.empty,

      // AlwaysOnline: effect runs immediately since we're always "online"
      whenOnline: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,

      // AlwaysOnline: never goes offline, so this effect never runs
      whenOffline: <A, E, R>(_effect: Effect.Effect<A, E, R>) =>
        Effect.never as Effect.Effect<A, E, R>,

      gate,

      subscribe: () => () => {},

      subscribeToReconnect: () => () => {},
    }

    return service
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if currently online.
 * Requires Network service in context.
 *
 * @since 0.3.0
 * @category accessors
 */
export const isOnline: Effect.Effect<boolean, never, Network> = Effect.flatMap(
  Network,
  (n) => n.isOnline,
)

/**
 * Get full network state.
 * Requires Network service in context.
 *
 * @since 0.3.0
 * @category accessors
 */
export const getState: Effect.Effect<NetworkState, never, Network> = Effect.flatMap(
  Network,
  (n) => n.state,
)

/**
 * Wait until online.
 * Requires Network service in context.
 *
 * @since 0.3.0
 * @category accessors
 */
export const awaitOnline: Effect.Effect<void, never, Network> = Effect.flatMap(
  Network,
  (n) => n.awaitOnline,
)

/**
 * Wait until offline.
 * Requires Network service in context.
 *
 * @since 0.3.0
 * @category accessors
 */
export const awaitOffline: Effect.Effect<void, never, Network> = Effect.flatMap(
  Network,
  (n) => n.awaitOffline,
)

/**
 * Run effect when online (waits if offline).
 * Requires Network service in context.
 *
 * @since 0.3.0
 * @category accessors
 */
export const whenOnline = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Network> =>
  Effect.flatMap(Network, (n) => n.whenOnline(effect))

/**
 * Run effect when offline (waits if online).
 * Requires Network service in context.
 *
 * @since 0.3.0
 * @category accessors
 */
export const whenOffline = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | Network> => Effect.flatMap(Network, (n) => n.whenOffline(effect))

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Layer that uses browser APIs for network detection.
 * Always reports online on server (SSR-safe).
 *
 * @since 0.3.0
 * @category layers
 */
export const NetworkBrowserLive: Layer.Layer<Network> = Layer.scoped(Network, makeBrowserNetwork)

/**
 * Layer that always reports online (no detection).
 * Useful for testing or server-only code.
 *
 * @since 0.3.0
 * @category layers
 */
export const NetworkAlwaysOnline: Layer.Layer<Network> = Layer.scoped(Network, makeAlwaysOnline)
