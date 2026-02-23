/**
 * @module effect-trpc/ws/server/BackpressureController
 *
 * Flow control and backpressure signaling for WebSocket subscriptions.
 * Monitors queue fill levels and signals clients to pause/resume sending.
 *
 * @example
 * ```ts
 * import { BackpressureController, BackpressureControllerLive } from 'effect-trpc/ws/server'
 *
 * const program = Effect.gen(function* () {
 *   const bp = yield* BackpressureController
 *   
 *   // Check if a subscription should accept more data
 *   const canAccept = yield* bp.canAcceptData(subscriptionId)
 *   
 *   // Record queue state changes
 *   yield* bp.recordQueueState(subscriptionId, currentSize, maxSize)
 * }).pipe(Effect.provide(BackpressureControllerLive))
 * ```
 *
 * @since 0.1.0
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"

import { PauseMessage, ResumeMessage } from "../protocol.js"
import type { ClientId, SubscriptionId } from "../types.js"
import type { Connection } from "./ConnectionRegistry.js"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for backpressure thresholds.
 *
 * @since 0.1.0
 * @category Configuration
 */
export interface BackpressureConfig {
  /**
   * Queue fill percentage at which to send Pause signal.
   * Default: 80 (80%)
   */
  readonly pauseThreshold: number

  /**
   * Queue fill percentage at which to send Resume signal.
   * Default: 50 (50%)
   */
  readonly resumeThreshold: number

  /**
   * Whether backpressure is enabled.
   * When disabled, no Pause/Resume signals are sent.
   * Default: true
   */
  readonly enabled: boolean
}

/**
 * Default backpressure configuration.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const defaultBackpressureConfig: BackpressureConfig = {
  pauseThreshold: 80,
  resumeThreshold: 50,
  enabled: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Backpressure State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backpressure state for a single subscription.
 *
 * @since 0.1.0
 * @category Models
 */
export interface BackpressureState {
  /** Subscription ID */
  readonly subscriptionId: SubscriptionId

  /** Client ID for sending signals */
  readonly clientId: ClientId

  /** Whether client is currently paused */
  readonly isPaused: boolean

  /** Whether client has acknowledged the pause state */
  readonly isAcknowledged: boolean

  /** Last recorded queue fill percentage */
  readonly lastFillPercent: number

  /** Connection for sending signals */
  readonly connection: Connection
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for backpressure control.
 *
 * @since 0.1.0
 * @category Models
 */
export interface BackpressureControllerService {
  /**
   * Register a subscription for backpressure monitoring.
   */
  readonly register: (
    subscriptionId: SubscriptionId,
    clientId: ClientId,
    connection: Connection,
  ) => Effect.Effect<void>

  /**
   * Unregister a subscription from backpressure monitoring.
   */
  readonly unregister: (subscriptionId: SubscriptionId) => Effect.Effect<void>

  /**
   * Record the current queue state for a subscription.
   * May trigger Pause/Resume signals based on thresholds.
   *
   * @param subscriptionId - The subscription to update
   * @param currentSize - Current queue size
   * @param maxSize - Maximum queue capacity
   * @returns Whether data can be accepted (not paused or client acknowledged pause)
   */
  readonly recordQueueState: (
    subscriptionId: SubscriptionId,
    currentSize: number,
    maxSize: number,
  ) => Effect.Effect<boolean>

  /**
   * Handle a BackpressureAck message from a client.
   */
  readonly handleAck: (
    subscriptionId: SubscriptionId,
    paused: boolean,
  ) => Effect.Effect<void>

  /**
   * Check if a subscription can accept more data.
   * Returns false if paused and client hasn't acknowledged.
   */
  readonly canAcceptData: (subscriptionId: SubscriptionId) => Effect.Effect<boolean>

  /**
   * Get the current backpressure state for a subscription.
   */
  readonly getState: (
    subscriptionId: SubscriptionId,
  ) => Effect.Effect<Option.Option<BackpressureState>>

  /**
   * Get all subscriptions currently in paused state.
   */
  readonly getPausedSubscriptions: Effect.Effect<ReadonlyArray<BackpressureState>>

  /**
   * Force resume a subscription (e.g., on client reconnect).
   */
  readonly forceResume: (subscriptionId: SubscriptionId) => Effect.Effect<void>

  /**
   * Clean up all backpressure state for a client.
   */
  readonly cleanupClient: (clientId: ClientId) => Effect.Effect<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service for managing backpressure signaling.
 *
 * @example
 * ```ts
 * import { BackpressureController } from 'effect-trpc/ws/server'
 *
 * const program = Effect.gen(function* () {
 *   const bp = yield* BackpressureController
 *   
 *   // Register subscription for monitoring
 *   yield* bp.register(subscriptionId, clientId, connection)
 *   
 *   // On each message, check queue state
 *   const canAccept = yield* bp.recordQueueState(subscriptionId, queueSize, maxSize)
 *   if (!canAccept) {
 *     // Client is paused, wait for ack or drop message
 *   }
 * }).pipe(Effect.provide(BackpressureController.Live))
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class BackpressureController extends Context.Tag("@effect-trpc/BackpressureController")<
  BackpressureController,
  BackpressureControllerService
>() {
  /**
   * Live layer with default configuration.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<BackpressureController>

  /**
   * Create a layer with custom configuration.
   *
   * @since 0.1.0
   * @category Layers
   */
  static withConfig: (config: Partial<BackpressureConfig>) => Layer.Layer<BackpressureController>

  /**
   * Disabled layer (no-op) for testing or when backpressure is not needed.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Disabled: Layer.Layer<BackpressureController>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const makeBackpressureController = (config: BackpressureConfig) =>
  Effect.gen(function* () {
    // State: subscriptionId -> BackpressureState
    const states = yield* Ref.make(HashMap.empty<SubscriptionId, BackpressureState>())

    const service: BackpressureControllerService = {
      register: (subscriptionId, clientId, connection) =>
        Effect.gen(function* () {
          const state: BackpressureState = {
            subscriptionId,
            clientId,
            isPaused: false,
            isAcknowledged: true, // Not paused = acknowledged
            lastFillPercent: 0,
            connection,
          }
          yield* Ref.update(states, HashMap.set(subscriptionId, state))
        }),

      unregister: (subscriptionId) =>
        Ref.update(states, HashMap.remove(subscriptionId)),

      recordQueueState: (subscriptionId, currentSize, maxSize) =>
        Effect.gen(function* () {
          if (!config.enabled) {
            return true // Always accept when disabled
          }

          const fillPercent = maxSize > 0 ? (currentSize / maxSize) * 100 : 0
          const stateMap = yield* Ref.get(states)
          const maybeState = HashMap.get(stateMap, subscriptionId)

          if (Option.isNone(maybeState)) {
            return true // No state = accept
          }

          const state = maybeState.value
          let newState = { ...state, lastFillPercent: fillPercent }
          let shouldSendSignal = false
          let signalType: "pause" | "resume" | null = null

          // Check if we need to pause
          if (!state.isPaused && fillPercent >= config.pauseThreshold) {
            newState = { ...newState, isPaused: true, isAcknowledged: false }
            shouldSendSignal = true
            signalType = "pause"
          }
          // Check if we can resume
          else if (state.isPaused && fillPercent <= config.resumeThreshold) {
            newState = { ...newState, isPaused: false, isAcknowledged: true }
            shouldSendSignal = true
            signalType = "resume"
          }

          // Update state
          yield* Ref.update(states, HashMap.set(subscriptionId, newState))

          // Send signal if needed
          if (shouldSendSignal && signalType) {
            if (signalType === "pause") {
              yield* state.connection
                .send(new PauseMessage({ id: subscriptionId, queueFillPercent: fillPercent }))
                .pipe(Effect.ignore)
            } else {
              yield* state.connection
                .send(new ResumeMessage({ id: subscriptionId }))
                .pipe(Effect.ignore)
            }
          }

          // Return whether we can accept data
          // Accept if not paused, or if paused but client acknowledged
          return !newState.isPaused || newState.isAcknowledged
        }),

      handleAck: (subscriptionId, paused) =>
        Effect.gen(function* () {
          yield* Ref.update(states, (map) => {
            const maybeState = HashMap.get(map, subscriptionId)
            if (Option.isNone(maybeState)) {
              return map
            }
            const state = maybeState.value
            // Only acknowledge if the ack matches current pause state
            if (state.isPaused === paused) {
              return HashMap.set(map, subscriptionId, {
                ...state,
                isAcknowledged: true,
              })
            }
            return map
          })
        }),

      canAcceptData: (subscriptionId) =>
        Effect.gen(function* () {
          if (!config.enabled) {
            return true
          }

          const stateMap = yield* Ref.get(states)
          const maybeState = HashMap.get(stateMap, subscriptionId)

          if (Option.isNone(maybeState)) {
            return true
          }

          const state = maybeState.value
          // Accept if not paused, or if paused but client acknowledged
          return !state.isPaused || state.isAcknowledged
        }),

      getState: (subscriptionId) =>
        Effect.gen(function* () {
          const stateMap = yield* Ref.get(states)
          return HashMap.get(stateMap, subscriptionId)
        }),

      getPausedSubscriptions: Effect.gen(function* () {
        const stateMap = yield* Ref.get(states)
        return Array.from(HashMap.values(stateMap)).filter((s) => s.isPaused)
      }),

      forceResume: (subscriptionId) =>
        Effect.gen(function* () {
          const stateMap = yield* Ref.get(states)
          const maybeState = HashMap.get(stateMap, subscriptionId)

          if (Option.isSome(maybeState) && maybeState.value.isPaused) {
            const state = maybeState.value
            const newState: BackpressureState = {
              ...state,
              isPaused: false,
              isAcknowledged: true,
            }
            yield* Ref.update(states, HashMap.set(subscriptionId, newState))
            // Send resume signal
            yield* state.connection
              .send(new ResumeMessage({ id: subscriptionId }))
              .pipe(Effect.ignore)
          }
        }),

      cleanupClient: (clientId) =>
        Ref.update(states, (map) => {
          const toRemove = Array.from(HashMap.entries(map))
            .filter(([_, state]) => state.clientId === clientId)
            .map(([id]) => id)
          return toRemove.reduce((acc, id) => HashMap.remove(acc, id), map)
        }),
    }

    return service
  })

// No-op implementation for when backpressure is disabled
const makeNoOpBackpressureController = Effect.succeed<BackpressureControllerService>({
  register: () => Effect.void,
  unregister: () => Effect.void,
  recordQueueState: () => Effect.succeed(true),
  handleAck: () => Effect.void,
  canAcceptData: () => Effect.succeed(true),
  getState: () => Effect.succeed(Option.none()),
  getPausedSubscriptions: Effect.succeed([]),
  forceResume: () => Effect.void,
  cleanupClient: () => Effect.void,
})

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live layer with default configuration.
 *
 * @since 0.1.0
 * @category Layers
 */
export const BackpressureControllerLive: Layer.Layer<BackpressureController> = Layer.effect(
  BackpressureController,
  makeBackpressureController(defaultBackpressureConfig),
)

/**
 * Create a layer with custom configuration.
 *
 * @since 0.1.0
 * @category Layers
 */
export const makeBackpressureControllerLayer = (
  config: Partial<BackpressureConfig>,
): Layer.Layer<BackpressureController> =>
  Layer.effect(
    BackpressureController,
    makeBackpressureController({ ...defaultBackpressureConfig, ...config }),
  )

/**
 * Disabled layer (no-op) for testing or when backpressure is not needed.
 *
 * @since 0.1.0
 * @category Layers
 */
export const BackpressureControllerDisabled: Layer.Layer<BackpressureController> = Layer.effect(
  BackpressureController,
  makeNoOpBackpressureController,
)

// Assign static properties
BackpressureController.Live = BackpressureControllerLive
BackpressureController.withConfig = makeBackpressureControllerLayer
BackpressureController.Disabled = BackpressureControllerDisabled
