/**
 * @module effect-trpc/ws/server/ConnectionRegistry
 *
 * Service for tracking active WebSocket connections.
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as HashMap from "effect/HashMap"
import * as PubSub from "effect/PubSub"
import * as Stream from "effect/Stream"
import * as Option from "effect/Option"
import type * as DateTime from "effect/DateTime"

import type { ClientId } from "../types.js"
import type { AuthResult } from "./WebSocketAuth.js"
import type { FromServerMessage as FromServerMessageType } from "../protocol.js"
import { ConnectionNotFoundError, ConnectionLimitExceededError } from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast Result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a broadcast operation.
 * Provides visibility into success/failure counts.
 *
 * @since 0.1.0
 * @category Models
 */
export interface BroadcastResult {
  /** Number of clients that received the message successfully */
  readonly sent: number
  /** Number of clients that failed to receive the message */
  readonly failed: number
  /** Client IDs that failed (for debugging) */
  readonly failedClientIds: ReadonlyArray<ClientId>
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents an active client connection.
 *
 * @since 0.1.0
 * @category Models
 */
export interface Connection {
  /** Unique client identifier */
  readonly clientId: ClientId
  /** Authentication info */
  readonly auth: AuthResult
  /** When the connection was established */
  readonly connectedAt: DateTime.Utc
  /** Send a message to this client */
  readonly send: (message: FromServerMessageType) => Effect.Effect<void>
  /** Close this connection */
  readonly close: (reason?: string) => Effect.Effect<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection lifecycle events.
 *
 * @since 0.1.0
 * @category Models
 */
export type ConnectionEvent =
  | { readonly _tag: "Connected"; readonly connection: Connection }
  | { readonly _tag: "Disconnected"; readonly clientId: ClientId; readonly reason?: string }

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for ConnectionRegistry.
 *
 * @since 0.1.0
 * @category Models
 */
export interface ConnectionRegistryConfig {
  /**
   * Maximum number of concurrent connections allowed.
   * Set to 0 or undefined for unlimited connections.
   * Default: 10000
   *
   * @since 0.1.0
   */
  readonly maxConnections?: number
}

/**
 * Default configuration for ConnectionRegistry.
 *
 * @since 0.1.0
 * @category Config
 */
export const defaultConnectionRegistryConfig: Required<ConnectionRegistryConfig> = {
  maxConnections: 10000,
}

/**
 * Service for tracking active WebSocket connections.
 *
 * @example
 * ```ts
 * import { ConnectionRegistry } from 'effect-trpc/ws/server'
 *
 * // Use the default layer
 * const program = Effect.gen(function* () {
 *   const registry = yield* ConnectionRegistry
 *   // ...
 * }).pipe(Effect.provide(ConnectionRegistry.Live))
 *
 * // Or with custom config
 * const customLayer = ConnectionRegistry.layer({ maxConnections: 5000 })
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class ConnectionRegistry extends Context.Tag("@effect-trpc/ConnectionRegistry")<
  ConnectionRegistry,
  ConnectionRegistry.Service
>() {
  /**
   * Default Layer with in-memory connection storage.
   * Uses default configuration (maxConnections: 10000).
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<ConnectionRegistry>

  /**
   * Create a Layer with custom configuration.
   *
   * @param config - Configuration for connection limits
   * @returns Layer providing ConnectionRegistry
   *
   * @since 0.1.0
   * @category Layers
   */
  static layer: (config?: ConnectionRegistryConfig) => Layer.Layer<ConnectionRegistry>
}

/**
 * @since 0.1.0
 */
export declare namespace ConnectionRegistry {
  /**
   * The service interface for ConnectionRegistry.
   *
   * @since 0.1.0
   * @category Models
   */
  export interface Service {
    /**
     * Register a new connection.
     * Fails with ConnectionLimitExceededError if the limit is reached.
     */
    readonly register: (connection: Connection) => Effect.Effect<void, ConnectionLimitExceededError>

    /**
     * Unregister a connection.
     */
    readonly unregister: (
      clientId: ClientId,
      reason?: string,
    ) => Effect.Effect<void>

    /**
     * Get the maximum number of connections allowed.
     * Returns 0 if unlimited.
     */
    readonly getMaxConnections: Effect.Effect<number>

    /**
     * Check if the registry can accept more connections.
     */
    readonly canAcceptConnection: Effect.Effect<boolean>

    /**
     * Get a connection by client ID.
     */
    readonly get: (
      clientId: ClientId,
    ) => Effect.Effect<Connection, ConnectionNotFoundError>

    /**
     * Get all active connections.
     */
    readonly getAll: Effect.Effect<ReadonlyArray<Connection>>

    /**
     * Get count of active connections.
     */
    readonly count: Effect.Effect<number>

    /**
     * Stream of connection events.
     */
    readonly events: Stream.Stream<ConnectionEvent>

    /**
     * Broadcast a message to all connections.
     * Returns result with success/failure counts.
     */
    readonly broadcast: (
      message: FromServerMessageType,
      filter?: (connection: Connection) => boolean,
    ) => Effect.Effect<BroadcastResult>

    /**
     * Broadcast a message to connections matching a user ID.
     * Returns result with success/failure counts.
     */
    readonly broadcastToUser: (
      userId: string,
      message: FromServerMessageType,
    ) => Effect.Effect<BroadcastResult>

    /**
     * Clean up all connections.
     * Called when shutting down the server.
     */
    readonly cleanupAll: Effect.Effect<void>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum number of connection events to buffer in the PubSub.
 * Using sliding strategy - drops oldest events when full.
 * This prevents memory issues if event consumers are slow.
 */
const MAX_EVENT_QUEUE_SIZE = 1000

/**
 * Create the connection registry implementation.
 *
 * @param config - Optional configuration for connection limits
 */
const makeConnectionRegistry = (config: ConnectionRegistryConfig = {}) =>
  Effect.gen(function* () {
    const { maxConnections } = { ...defaultConnectionRegistryConfig, ...config }

    // In-memory storage of connections
    const connections = yield* Ref.make(HashMap.empty<ClientId, Connection>())

    // PubSub for connection events (bounded with sliding strategy)
    // Sliding drops oldest events when queue is full, ensuring we don't run out of memory
    const eventsPubSub = yield* PubSub.sliding<ConnectionEvent>(MAX_EVENT_QUEUE_SIZE)

    const service: ConnectionRegistry.Service = {
      register: Effect.fn("ConnectionRegistry.register")(
        function* (connection: Connection) {
          yield* Effect.annotateCurrentSpan("clientId", connection.clientId)

          // Check connection limit before registering
          if (maxConnections > 0) {
            const currentMap = yield* Ref.get(connections)
            const currentCount = HashMap.size(currentMap)

            if (currentCount >= maxConnections) {
              return yield* Effect.fail(
                new ConnectionLimitExceededError({
                  currentCount,
                  maxConnections,
                  clientId: connection.clientId,
                }),
              )
            }
          }

          yield* Ref.update(connections, HashMap.set(connection.clientId, connection))
          yield* PubSub.publish(eventsPubSub, {
            _tag: "Connected",
            connection,
          })
        },
      ),

    unregister: Effect.fn("ConnectionRegistry.unregister")(
      function* (clientId: ClientId, reason?: string) {
        yield* Effect.annotateCurrentSpan("clientId", clientId)
        const map = yield* Ref.get(connections)
        const exists = HashMap.has(map, clientId)

        if (exists) {
          yield* Ref.update(connections, HashMap.remove(clientId))
          const event: ConnectionEvent =
            reason !== undefined
              ? { _tag: "Disconnected", clientId, reason }
              : { _tag: "Disconnected", clientId }
          yield* PubSub.publish(eventsPubSub, event)
        }
      },
    ),

    get: (clientId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(connections)
        const conn = HashMap.get(map, clientId)

        if (Option.isNone(conn)) {
          return yield* Effect.fail(new ConnectionNotFoundError({ clientId }))
        }

        return conn.value
      }),

    getAll: Effect.gen(function* () {
      const map = yield* Ref.get(connections)
      return Array.from(HashMap.values(map))
    }),

    count: Effect.gen(function* () {
      const map = yield* Ref.get(connections)
      return HashMap.size(map)
    }),

    events: Stream.fromPubSub(eventsPubSub),

    broadcast: Effect.fn("ConnectionRegistry.broadcast")(
      function* (message: FromServerMessageType, filter?: (connection: Connection) => boolean) {
        yield* Effect.annotateCurrentSpan("messageTag", message._tag)
        const map = yield* Ref.get(connections)
        const conns = Array.from(HashMap.values(map))
        const filtered = filter ? conns.filter(filter) : conns

        // Track results for each send
        const results = yield* Effect.forEach(
          filtered,
          (conn) =>
            conn.send(message).pipe(
              Effect.as({ success: true as const, clientId: conn.clientId }),
              Effect.catchAllCause((cause) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning("Broadcast send failed", {
                    clientId: conn.clientId,
                    cause,
                  })
                  return { success: false as const, clientId: conn.clientId }
                }),
              ),
            ),
          { concurrency: "unbounded" },
        )

        const sent = results.filter((r) => r.success).length
        const failed = results.filter((r) => !r.success).length
        const failedClientIds = results
          .filter((r) => !r.success)
          .map((r) => r.clientId)

        return { sent, failed, failedClientIds } satisfies BroadcastResult
      },
    ),

    broadcastToUser: Effect.fn("ConnectionRegistry.broadcastToUser")(
      function* (userId: string, message: FromServerMessageType) {
        yield* Effect.annotateCurrentSpan("userId", userId)
        yield* Effect.annotateCurrentSpan("messageTag", message._tag)
        const map = yield* Ref.get(connections)
        const conns = Array.from(HashMap.values(map))
        const userConns = conns.filter((c) => c.auth.userId === userId)

        // Track results for each send
        const results = yield* Effect.forEach(
          userConns,
          (conn) =>
            conn.send(message).pipe(
              Effect.as({ success: true as const, clientId: conn.clientId }),
              Effect.catchAllCause((cause) =>
                Effect.gen(function* () {
                  yield* Effect.logWarning("Broadcast to user send failed", {
                    clientId: conn.clientId,
                    userId,
                    cause,
                  })
                  return { success: false as const, clientId: conn.clientId }
                }),
              ),
            ),
          { concurrency: "unbounded" },
        )

        const sent = results.filter((r) => r.success).length
        const failed = results.filter((r) => !r.success).length
        const failedClientIds = results
          .filter((r) => !r.success)
          .map((r) => r.clientId)

        return { sent, failed, failedClientIds } satisfies BroadcastResult
      },
    ),

    cleanupAll: Effect.gen(function* () {
      const map = yield* Ref.get(connections)
      const allConns = Array.from(HashMap.values(map))

      // Close all connections
      yield* Effect.forEach(
        allConns,
        (conn) =>
          conn.close("Server shutdown").pipe(
            Effect.catchAllCause((cause) =>
              Effect.logWarning("Failed to close connection during cleanup", {
                clientId: conn.clientId,
                cause,
              }),
            ),
          ),
        { concurrency: "unbounded", discard: true },
      )

      // Clear the map
      yield* Ref.set(connections, HashMap.empty())
    }),

    getMaxConnections: Effect.succeed(maxConnections),

    canAcceptConnection: Effect.gen(function* () {
      if (maxConnections <= 0) return true
      const map = yield* Ref.get(connections)
      return HashMap.size(map) < maxConnections
    }),
  }

  return service
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Layer with custom configuration.
 *
 * @param config - Configuration for connection limits
 * @returns Layer providing ConnectionRegistry
 *
 * @example
 * ```ts
 * // Limit to 5000 concurrent connections
 * const registry = ConnectionRegistry.layer({ maxConnections: 5000 })
 *
 * // Unlimited connections
 * const unlimited = ConnectionRegistry.layer({ maxConnections: 0 })
 * ```
 *
 * @since 0.1.0
 * @category Layers
 */
export const layer = (config?: ConnectionRegistryConfig): Layer.Layer<ConnectionRegistry> =>
  Layer.effect(ConnectionRegistry, makeConnectionRegistry(config))

/**
 * Default Layer with in-memory connection storage.
 * Uses default configuration (maxConnections: 10000).
 *
 * @since 0.1.0
 * @category Layers
 */
export const ConnectionRegistryLive: Layer.Layer<ConnectionRegistry> = layer()

// Assign static properties after layer is defined
ConnectionRegistry.Live = ConnectionRegistryLive
ConnectionRegistry.layer = layer
