/**
 * @module effect-trpc/ws/client/WebSocketReconnect
 *
 * Service for handling WebSocket reconnection with exponential backoff.
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Duration from "effect/Duration"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Fiber from "effect/Fiber"
import * as Random from "effect/Random"

import { WebSocketConnection } from "./WebSocketConnection.js"
import { WebSocketConnectionError } from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconnection configuration.
 */
export interface WebSocketReconnectConfig {
  /** Initial delay before first reconnection attempt (default: 500ms) */
  readonly initialDelayMs?: number
  /** Maximum delay between reconnection attempts (default: 30000ms) */
  readonly maxDelayMs?: number
  /** Backoff factor (default: 2) */
  readonly factor?: number
  /** Maximum number of reconnection attempts (undefined = infinite) */
  readonly maxAttempts?: number
  /** Jitter factor to randomize delays (0-1, default: 0.1) */
  readonly jitter?: number
}

const defaultConfig = {
  initialDelayMs: 500,
  maxDelayMs: 30000,
  factor: 2,
  maxAttempts: undefined as number | undefined,
  jitter: 0.1,
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for reconnection management.
 */
export interface WebSocketReconnectShape {
  /**
   * Start the reconnection loop.
   * Will attempt to reconnect whenever the connection is lost.
   */
  readonly start: Effect.Effect<void, WebSocketConnectionError>

  /**
   * Stop the reconnection loop.
   */
  readonly stop: Effect.Effect<void>

  /**
   * Get the current reconnection attempt number.
   * Returns 0 if not reconnecting.
   */
  readonly attempt: Effect.Effect<number>

  /**
   * Whether reconnection is currently enabled.
   */
  readonly isEnabled: Effect.Effect<boolean>

  /**
   * Enable or disable automatic reconnection.
   */
  readonly setEnabled: (enabled: boolean) => Effect.Effect<void>

  /**
   * Reset the reconnection state (attempt counter, delays).
   * Call this after a successful connection.
   */
  readonly reset: Effect.Effect<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context tag for WebSocketReconnect service.
 */
export class WebSocketReconnect extends Context.Tag(
  "@effect-trpc/WebSocketReconnect",
)<WebSocketReconnect, WebSocketReconnectShape>() {}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketReconnect implementation.
 */
const makeWebSocketReconnect = (
  config: WebSocketReconnectConfig = {},
): Effect.Effect<WebSocketReconnectShape, never, WebSocketConnection | Scope.Scope> =>
  Effect.gen(function* () {
    const connection = yield* WebSocketConnection

    const mergedConfig = { ...defaultConfig, ...config }

    // State
    const attemptRef = yield* Ref.make(0)
    const enabledRef = yield* Ref.make(true)
    const runningRef = yield* Ref.make(false)
    const watcherFiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, WebSocketConnectionError> | null>(null)

    // Calculate delay with jitter using Effect's Random for testability
    const calculateDelayMs = (attempt: number): Effect.Effect<number> =>
      Effect.gen(function* () {
        const baseDelay = mergedConfig.initialDelayMs
        const maxDelayMs = mergedConfig.maxDelayMs

        // Exponential backoff
        let delay = baseDelay * Math.pow(mergedConfig.factor, attempt - 1)
        delay = Math.min(delay, maxDelayMs)

        // Add jitter using Effect's Random
        const jitterRange = delay * mergedConfig.jitter
        const randomValue = yield* Random.next // Returns number between 0 and 1
        const jitter = (randomValue - 0.5) * 2 * jitterRange
        delay = Math.max(0, delay + jitter)

        return delay
      })

    // Watch state changes and reconnect
    const watchAndReconnect: Effect.Effect<void, WebSocketConnectionError> =
      Stream.runForEach(connection.stateChanges, (state) =>
        Effect.gen(function* () {
          const enabled = yield* Ref.get(enabledRef)

          if (
            enabled &&
            (state._tag === "Disconnected" || state._tag === "Error")
          ) {
            // Increment attempt counter
            yield* Ref.update(attemptRef, (n) => n + 1)
            const attempt = yield* Ref.get(attemptRef)

            // Check max attempts
            if (
              mergedConfig.maxAttempts !== undefined &&
              attempt > mergedConfig.maxAttempts
            ) {
              return yield* Effect.fail(
                new WebSocketConnectionError({
                  url: "unknown",
                  reason: "MaxAttemptsReached",
                  description: `Max reconnection attempts (${mergedConfig.maxAttempts}) reached`,
                }),
              )
            }

            // Wait and reconnect
            const delayMs = yield* calculateDelayMs(attempt)
            yield* Effect.sleep(Duration.millis(delayMs))
            yield* connection.connect.pipe(Effect.ignore)
          } else if (state._tag === "Connected") {
            // Reset attempt counter on successful connection
            yield* Ref.set(attemptRef, 0)
          }
        }),
      )

    const service: WebSocketReconnectShape = {
      start: Effect.gen(function* () {
        const isRunning = yield* Ref.get(runningRef)
        if (isRunning) return

        yield* Ref.set(runningRef, true)

        // Connect initially
        yield* connection.connect

        // Start watcher fiber
        const fiber = yield* Effect.fork(watchAndReconnect)
        yield* Ref.set(watcherFiberRef, fiber)
      }),

      stop: Effect.gen(function* () {
        yield* Ref.set(runningRef, false)
        
        // Stop watcher fiber
        const fiber = yield* Ref.get(watcherFiberRef)
        if (fiber) {
          yield* Fiber.interrupt(fiber)
          yield* Ref.set(watcherFiberRef, null)
        }
        
        yield* connection.disconnect
      }),

      attempt: Ref.get(attemptRef),

      isEnabled: Ref.get(enabledRef),

      setEnabled: (enabled) => Ref.set(enabledRef, enabled),

      reset: Ref.set(attemptRef, 0),
    }

    // Cleanup on scope close
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const fiber = yield* Ref.get(watcherFiberRef)
        if (fiber) {
          yield* Fiber.interrupt(fiber)
        }
      }),
    )

    return service
  })

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketReconnect layer with the given config.
 */
export const makeWebSocketReconnectLayer = (
  config: WebSocketReconnectConfig = {},
): Layer.Layer<WebSocketReconnect, never, WebSocketConnection | Scope.Scope> =>
  Layer.scoped(WebSocketReconnect, makeWebSocketReconnect(config))

/**
 * Default layer with standard reconnection settings.
 */
export const WebSocketReconnectLive: Layer.Layer<
  WebSocketReconnect,
  never,
  WebSocketConnection | Scope.Scope
> = makeWebSocketReconnectLayer({})
