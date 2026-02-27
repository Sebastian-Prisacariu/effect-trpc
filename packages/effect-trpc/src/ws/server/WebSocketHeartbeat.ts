/**
 * @module effect-trpc/ws/server/WebSocketHeartbeat
 *
 * Service for WebSocket ping/pong keepalive management.
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as HashMap from "effect/HashMap"
import * as Fiber from "effect/Fiber"
import * as Schedule from "effect/Schedule"
import * as Duration from "effect/Duration"
import * as Option from "effect/Option"
import * as DateTime from "effect/DateTime"

import type { ClientId } from "../types.js"
import { HeartbeatTimeoutError } from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heartbeat configuration.
 */
export interface HeartbeatConfig {
  /** Interval between ping messages. Default: 30 seconds */
  readonly pingInterval: Duration.Duration
  /** Timeout waiting for pong response. Default: 10 seconds */
  readonly pongTimeout: Duration.Duration
}

/**
 * Default heartbeat configuration.
 */
export const defaultHeartbeatConfig: HeartbeatConfig = {
  pingInterval: Duration.seconds(30),
  pongTimeout: Duration.seconds(10),
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for WebSocket heartbeat management.
 */
export interface WebSocketHeartbeatShape {
  /**
   * Start heartbeat monitoring for a client.
   * Returns an effect that completes when:
   * - Client times out (fails with HeartbeatTimeoutError)
   * - Monitoring is stopped via stop()
   *
   * @param clientId - The client to monitor
   * @param sendPing - Effect to send a ping message to the client
   */
  readonly start: (
    clientId: ClientId,
    sendPing: Effect.Effect<void>,
  ) => Effect.Effect<void, HeartbeatTimeoutError>

  /**
   * Record that a pong was received from a client.
   * Resets the timeout timer.
   */
  readonly receivedPong: (clientId: ClientId) => Effect.Effect<void>

  /**
   * Stop heartbeat monitoring for a client.
   * Call this when the client disconnects.
   */
  readonly stop: (clientId: ClientId) => Effect.Effect<void>

  /**
   * Get the heartbeat configuration.
   */
  readonly config: HeartbeatConfig

  /**
   * Clean up all heartbeat monitoring.
   * Called when shutting down the server.
   */
  readonly cleanupAll: Effect.Effect<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context tag for WebSocketHeartbeat service.
 */
export class WebSocketHeartbeat extends Context.Tag(
  "@effect-trpc/WebSocketHeartbeat",
)<WebSocketHeartbeat, WebSocketHeartbeatShape>() {}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface ClientHeartbeatState {
  readonly lastPongAt: Ref.Ref<DateTime.Utc>
  readonly fiber: Fiber.RuntimeFiber<void, HeartbeatTimeoutError>
}

/**
 * Create the heartbeat service implementation.
 */
const makeWebSocketHeartbeat = (config: HeartbeatConfig) =>
  Effect.gen(function* () {
    // Track state per client
    const clients = yield* Ref.make(
      HashMap.empty<ClientId, ClientHeartbeatState>(),
    )

    const service: WebSocketHeartbeatShape = {
      start: (clientId, sendPing) =>
        Effect.gen(function* () {
          // Create a ref to track last pong time for this client
          const now = yield* DateTime.now
          const lastPongRef = yield* Ref.make(now)

          // Single heartbeat iteration
          const heartbeatIteration: Effect.Effect<void, HeartbeatTimeoutError> =
            Effect.gen(function* () {
              // Send ping
              yield* sendPing

              // Record time we sent ping
              const startTime = yield* Ref.get(lastPongRef)

              // Wait for pong timeout
              yield* Effect.sleep(config.pongTimeout)

              // Check if we received a pong since we sent the ping
              const currentPongTime = yield* Ref.get(lastPongRef)

              if (DateTime.lessThanOrEqualTo(currentPongTime, startTime)) {
                // No pong received - timeout
                return yield* new HeartbeatTimeoutError({
                  clientId,
                  lastPongAt: DateTime.toDate(currentPongTime),
                })
              }

              // Pong received, wait for remaining interval
              const remainingInterval = Duration.subtract(
                config.pingInterval,
                config.pongTimeout,
              )
              if (Duration.toMillis(remainingInterval) > 0) {
                yield* Effect.sleep(remainingInterval)
              }
            })

          // The heartbeat loop - repeat forever, discarding the count
          const heartbeatLoop: Effect.Effect<void, HeartbeatTimeoutError> =
            Effect.repeat(heartbeatIteration, Schedule.forever).pipe(
              Effect.asVoid,
            )

          // Fork the heartbeat loop
          const fiber = yield* Effect.fork(heartbeatLoop)

          // Store state
          yield* Ref.update(clients, HashMap.set(clientId, {
            lastPongAt: lastPongRef,
            fiber,
          }))

          // Wait for the fiber (will fail on timeout or be interrupted)
          yield* Fiber.join(fiber)
        }),

      receivedPong: (clientId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(clients)
          const state = HashMap.get(map, clientId)

          if (Option.isSome(state)) {
            const now = yield* DateTime.now
            yield* Ref.set(state.value.lastPongAt, now)
          }
        }),

      stop: (clientId) =>
        Effect.gen(function* () {
          const map = yield* Ref.get(clients)
          const state = HashMap.get(map, clientId)

          if (Option.isSome(state)) {
            yield* Fiber.interrupt(state.value.fiber)
            yield* Ref.update(clients, HashMap.remove(clientId))
          }
        }),

      cleanupAll: Effect.gen(function* () {
        const map = yield* Ref.get(clients)
        const allClients = Array.from(HashMap.values(map))

        // Interrupt all fibers
        yield* Effect.forEach(
          allClients,
          (state) => Fiber.interrupt(state.fiber),
          { concurrency: "unbounded", discard: true },
        )

        // Clear the map
        yield* Ref.set(clients, HashMap.empty())
      }),

      config,
    }

    return service
  })

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default Layer with standard heartbeat intervals.
 * Ping every 30s, timeout after 10s.
 */
export const WebSocketHeartbeatLive: Layer.Layer<WebSocketHeartbeat> =
  Layer.effect(WebSocketHeartbeat, makeWebSocketHeartbeat(defaultHeartbeatConfig))

/**
 * Create a Layer with custom heartbeat configuration.
 *
 * @example
 * ```ts
 * // Faster heartbeat for low-latency connections
 * const FastHeartbeat = makeWebSocketHeartbeatLayer({
 *   pingInterval: Duration.seconds(10),
 *   pongTimeout: Duration.seconds(3),
 * })
 * ```
 */
export const makeWebSocketHeartbeatLayer = (
  config: HeartbeatConfig,
): Layer.Layer<WebSocketHeartbeat> =>
  Layer.effect(WebSocketHeartbeat, makeWebSocketHeartbeat(config))

/**
 * Layer that disables heartbeat (for testing).
 *
 * @warning DO NOT use in production - connections may become stale!
 */
export const WebSocketHeartbeatDisabled: Layer.Layer<WebSocketHeartbeat> =
  Layer.succeed(WebSocketHeartbeat, {
    start: () => Effect.never,
    receivedPong: () => Effect.void,
    stop: () => Effect.void,
    cleanupAll: Effect.void,
    config: {
      pingInterval: Duration.infinity,
      pongTimeout: Duration.infinity,
    },
  })
