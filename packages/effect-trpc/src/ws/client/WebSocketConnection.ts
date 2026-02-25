/**
 * @module effect-trpc/ws/client/WebSocketConnection
 *
 * Service for managing the raw WebSocket connection.
 * Handles connecting, sending, receiving, and closing.
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Queue from "effect/Queue"
import * as Deferred from "effect/Deferred"
import * as Stream from "effect/Stream"
import type * as Scope from "effect/Scope"
import * as Schema from "effect/Schema"
import * as Runtime from "effect/Runtime"
import type * as DateTimeType from "effect/DateTime"
import * as DateTime from "effect/DateTime"

import { FromClientMessage, FromServerMessage } from "../protocol.js"
import type { FromClientMessage as FromClientMessageType } from "../protocol.js"
import {
  WebSocketConnectionError,
  WebSocketSendError,
} from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Connection State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket connection state.
 * 
 * @since 0.1.0
 * @category models
 */
export type ConnectionState =
  | { readonly _tag: "Disconnected" }
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Connected"; readonly connectedAt: DateTimeType.Utc }
  | { readonly _tag: "Reconnecting"; readonly attempt: number }
  | { readonly _tag: "Error"; readonly error: WebSocketConnectionError }

/**
 * ConnectionState constructors.
 * 
 * @since 0.1.0
 * @category constructors
 */
export const ConnectionState = {
  Disconnected: { _tag: "Disconnected" } as ConnectionState,
  Connecting: { _tag: "Connecting" } as ConnectionState,
  Connected: (connectedAt: DateTimeType.Utc): ConnectionState => ({
    _tag: "Connected",
    connectedAt,
  }),
  Reconnecting: (attempt: number): ConnectionState => ({
    _tag: "Reconnecting",
    attempt,
  }),
  Error: (error: WebSocketConnectionError): ConnectionState => ({
    _tag: "Error",
    error,
  }),
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket connection configuration.
 * 
 * @since 0.1.0
 * @category models
 */
export interface WebSocketConnectionConfig {
  /** WebSocket URL to connect to */
  readonly url: string
  /** Optional protocols */
  readonly protocols?: string | string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for WebSocket connection management.
 * 
 * @since 0.1.0
 * @category services
 */
export interface WebSocketConnectionShape {
  /**
   * Connect to the WebSocket server.
   * Waits for the connection to be established.
   */
  readonly connect: Effect.Effect<void, WebSocketConnectionError>

  /**
   * Disconnect from the WebSocket server.
   */
  readonly disconnect: Effect.Effect<void>

  /**
   * Send a message to the server.
   * Uses Schema encoding for type-safe serialization.
   */
  readonly send: (
    message: FromClientMessageType,
  ) => Effect.Effect<void, WebSocketSendError>

  /**
   * Get the current connection state.
   */
  readonly state: Effect.Effect<ConnectionState>

  /**
   * Stream of incoming messages from the server.
   */
  readonly messages: Stream.Stream<FromServerMessage, WebSocketConnectionError>

  /**
   * Stream of connection state changes.
   */
  readonly stateChanges: Stream.Stream<ConnectionState>

  /**
   * Check if connected.
   */
  readonly isConnected: Effect.Effect<boolean>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context tag for WebSocketConnection service.
 *
 * @example
 * ```ts
 * import { WebSocketConnection } from 'effect-trpc/ws/client'
 *
 * const program = Effect.gen(function* () {
 *   const conn = yield* WebSocketConnection
 *   yield* conn.connect()
 *   // ...
 * }).pipe(Effect.provide(WebSocketConnection.layer({ url: 'ws://localhost:3000' })))
 * ```
 * 
 * @since 0.1.0
 * @category tags
 */
export class WebSocketConnection extends Context.Tag(
  "@effect-trpc/WebSocketConnection",
)<WebSocketConnection, WebSocketConnectionShape>() {
  /**
   * Create a WebSocketConnection layer with the given config.
   *
   * @since 0.1.0
   * @category Layers
   */
  static layer: (config: WebSocketConnectionConfig) => Layer.Layer<WebSocketConnection, never, Scope.Scope>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketConnection implementation.
 * Uses the browser's native WebSocket.
 */
const makeWebSocketConnection = (
  config: WebSocketConnectionConfig,
): Effect.Effect<WebSocketConnectionShape, never, Scope.Scope> =>
  Effect.gen(function* () {
    // State
    const stateRef = yield* Ref.make<ConnectionState>(
      ConnectionState.Disconnected,
    )
    const wsRef = yield* Ref.make<WebSocket | null>(null)

    // Queues for messages and state changes
    // Use sliding bounded queues to prevent memory accumulation on slow consumers
    // Message queue: 1000 messages max, drops oldest when full
    // State queue: 100 states max (state changes are less frequent)
    const messageQueue = yield* Queue.sliding<
      FromServerMessage | WebSocketConnectionError
    >(1000)
    const stateQueue = yield* Queue.sliding<ConnectionState>(100)

    // Get runtime for running effects in callbacks
    const runtime = yield* Effect.runtime<never>()
    const runFork = Runtime.runFork(runtime)

    // Helper to update state
    const updateState = (state: ConnectionState) =>
      Effect.gen(function* () {
        yield* Ref.set(stateRef, state)
        yield* Queue.offer(stateQueue, state)
      })

    // Parse incoming messages using Schema
    const parseMessage = Schema.decodeUnknown(
      Schema.parseJson(FromServerMessage),
    )

    const service: WebSocketConnectionShape = {
      connect: Effect.gen(function* () {
        const currentState = yield* Ref.get(stateRef)

        if (currentState._tag === "Connected") {
          return
        }

        // If already connecting, we need to wait for it to finish
        // but we don't have the deferred.
        // Instead, we can just wait for state to become Connected or Error
        if (currentState._tag === "Connecting") {
          return yield* Stream.fromQueue(stateQueue).pipe(
            Stream.filter((state) => state._tag === "Connected" || state._tag === "Error"),
            Stream.take(1),
            Stream.runLast,
            Effect.flatMap((stateOption) => {
              const state = stateOption._tag === "Some" ? stateOption.value : null
              if (state && state._tag === "Error") {
                return Effect.fail(state.error)
              }
              return Effect.void
            })
          )
        }

        yield* updateState(ConnectionState.Connecting)

        // Create connection deferred
        const connected = yield* Deferred.make<void, WebSocketConnectionError>()

        // Create WebSocket
        const WS = globalThis.WebSocket || WebSocket
        const ws = new WS(config.url, config.protocols)

        ws.onopen = () => {
          runFork(
            Effect.gen(function* () {
              const now = yield* DateTime.now
              yield* updateState(ConnectionState.Connected(now))
              yield* Deferred.succeed(connected, undefined)
            }),
          )
        }

        ws.onerror = (event) => {
          const error = new WebSocketConnectionError({
            url: config.url,
            reason: "ConnectionFailed",
            description: "WebSocket error",
            cause: event,
          })
          runFork(
            Effect.gen(function* () {
              yield* updateState(ConnectionState.Error(error))
              yield* Deferred.fail(connected, error)
            }),
          )
        }

        ws.onclose = (event) => {
          runFork(
            Effect.gen(function* () {
              yield* updateState(ConnectionState.Disconnected)
              yield* Ref.set(wsRef, null)
              // Only shutdown the queue on clean close (intentional disconnect)
              // Unclean closes need to keep the queue alive for reconnection
              if (event.wasClean) {
                yield* Queue.shutdown(messageQueue)
              } else {
                yield* Effect.logWarning("WebSocket closed uncleanly", { code: event.code, reason: event.reason })
              }
            }),
          )
        }

        ws.onmessage = (event) => {
          runFork(
            parseMessage(event.data).pipe(
              Effect.flatMap((message) => Queue.offer(messageQueue, message)),
              Effect.catchAllCause((cause) => {
                // Get data length safely without exposing content
                const dataLength = typeof event.data === "string" 
                  ? event.data.length 
                  : event.data instanceof ArrayBuffer 
                    ? event.data.byteLength 
                    : 0
                return Effect.logError("WebSocket message parse error").pipe(
                  Effect.annotateLogs({ cause, dataLength })
                )
              }),
            ),
          )
        }

        yield* Ref.set(wsRef, ws)

        // Wait for connection with timeout
        yield* Deferred.await(connected).pipe(
          Effect.timeoutFail({
            duration: "10 seconds",
            onTimeout: () =>
              new WebSocketConnectionError({
                url: config.url,
                reason: "Timeout",
                description: "Connection timeout",
              }),
          }),
        )
      }).pipe(Effect.withSpan("WebSocketConnection.connect")),

      disconnect: Effect.gen(function* () {
        const ws = yield* Ref.get(wsRef)
        if (ws) {
          ws.close(1000, "Client disconnect")
          yield* Ref.set(wsRef, null)
          yield* updateState(ConnectionState.Disconnected)
        }
      }).pipe(Effect.withSpan("WebSocketConnection.disconnect")),

      send: (message) =>
        Effect.gen(function* () {
          const ws = yield* Ref.get(wsRef)

          if (!ws || ws.readyState !== WebSocket.OPEN) {
            return yield* Effect.fail(
              new WebSocketSendError({
                reason: "NotConnected",
                description: "WebSocket is not connected",
              }),
            )
          }

          // Use Schema encoding for type-safe serialization (same as server)
          const encoded = yield* Schema.encode(FromClientMessage)(message).pipe(
            Effect.mapError((cause) =>
              new WebSocketSendError({
                reason: "EncodeFailed",
                description: "Failed to encode message",
                cause,
              }),
            ),
          )

          yield* Effect.try({
            try: () => ws.send(JSON.stringify(encoded)),
            catch: (cause) =>
              new WebSocketSendError({
                reason: "SendFailed",
                description: "Failed to send message",
                cause,
              }),
          })
        }).pipe(Effect.withSpan("WebSocketConnection.send", { attributes: { messageTag: message._tag } })),

      state: Ref.get(stateRef),

      messages: Stream.fromQueue(messageQueue).pipe(
        Stream.flatMap((item) => {
          // Check if it's an error by looking at the type
          if ("_tag" in item && item._tag === "WebSocketConnectionError") {
            return Stream.fail(item)
          }
          return Stream.succeed(item)
        }),
      ),

      stateChanges: Stream.fromQueue(stateQueue),

      isConnected: Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)
        return state._tag === "Connected"
      }),
    }

    // Cleanup on scope close
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const ws = yield* Ref.get(wsRef)
        if (ws) {
          ws.close(1000, "Scope closed")
        }
        yield* Queue.shutdown(messageQueue)
        yield* Queue.shutdown(stateQueue)
      }),
    )

    return service
  })

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketConnection layer with the given config.
 * 
 * @since 0.1.0
 * @category layers
 */
export const makeWebSocketConnectionLayer = (
  config: WebSocketConnectionConfig,
): Layer.Layer<WebSocketConnection, never, Scope.Scope> =>
  Layer.scoped(WebSocketConnection, makeWebSocketConnection(config))

// Assign static property after function is defined
WebSocketConnection.layer = makeWebSocketConnectionLayer
