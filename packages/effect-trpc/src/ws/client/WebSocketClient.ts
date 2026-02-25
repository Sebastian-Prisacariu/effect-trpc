/**
 * @module effect-trpc/ws/client/WebSocketClient
 *
 * High-level WebSocket client service.
 * Composes connection, reconnection, and subscription management.
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Scope from "effect/Scope"
import * as Schedule from "effect/Schedule"
import * as Deferred from "effect/Deferred"
import * as Option from "effect/Option"
import * as Random from "effect/Random"

import type { SubscriptionId, ClientId } from "../types.js"
import {
  AuthMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientDataMessage,
  PingMessage,
  BackpressureAckMessage,
} from "../protocol.js"
import type {
  WebSocketSendError,
  SubscriptionNotFoundError} from "../errors.js";
import {
  WebSocketConnectionError,
  WebSocketAuthError
} from "../errors.js"
import {
  WebSocketConnection,
  type ConnectionState,
} from "./WebSocketConnection.js"
import type { WebSocketReconnectConfig } from "./WebSocketReconnect.js"
import { SubscriptionRegistry } from "./SubscriptionRegistry.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket client state.
 * 
 * @since 0.1.0
 * @category models
 */
export type ClientState =
  | { readonly _tag: "Disconnected" }
  | { readonly _tag: "Connecting" }
  | { readonly _tag: "Authenticating" }
  | { readonly _tag: "Ready"; readonly clientId: ClientId }
  | { readonly _tag: "Reconnecting"; readonly attempt: number }
  | { readonly _tag: "Error"; readonly error: unknown }

/**
 * ClientState constructors.
 * 
 * @since 0.1.0
 * @category constructors
 */
export const ClientState = {
  Disconnected: { _tag: "Disconnected" } as ClientState,
  Connecting: { _tag: "Connecting" } as ClientState,
  Authenticating: { _tag: "Authenticating" } as ClientState,
  Ready: (clientId: ClientId): ClientState => ({
    _tag: "Ready",
    clientId,
  }),
  Reconnecting: (attempt: number): ClientState => ({
    _tag: "Reconnecting",
    attempt,
  }),
  Error: (error: unknown): ClientState => ({
    _tag: "Error",
    error,
  }),
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebSocket client configuration.
 * 
 * @since 0.1.0
 * @category models
 */
export interface WebSocketClientConfig {
  /** WebSocket URL */
  readonly url: string
  /** Authentication token getter */
  readonly getToken: Effect.Effect<string, unknown>
  /** Reconnection config */
  readonly reconnect?: WebSocketReconnectConfig
  /** Heartbeat interval in ms (default: 30000) */
  readonly heartbeatIntervalMs?: number
  /** Whether to auto-connect (default: true) */
  readonly autoConnect?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for WebSocket client.
 * 
 * @since 0.1.0
 * @category services
 */
export interface WebSocketClientShape {
  /**
   * Connect and authenticate.
   */
  readonly connect: Effect.Effect<void, WebSocketConnectionError | WebSocketAuthError>

  /**
   * Disconnect.
   */
  readonly disconnect: Effect.Effect<void>

  /**
   * Subscribe to a procedure.
   * Returns the subscription ID and a stream of data.
   */
  readonly subscribe: <A>(
    path: string,
    input: unknown,
  ) => Effect.Effect<
    { readonly id: SubscriptionId; readonly stream: Stream.Stream<A, unknown> },
    WebSocketSendError | WebSocketConnectionError
  >

  /**
   * Unsubscribe from a procedure.
   */
  readonly unsubscribe: (id: SubscriptionId) => Effect.Effect<void, WebSocketSendError>

  /**
   * Send data to a subscription (bidirectional).
   */
  readonly send: (
    id: SubscriptionId,
    data: unknown,
  ) => Effect.Effect<void, WebSocketSendError | SubscriptionNotFoundError>

  /**
   * Update the input for a subscription.
   * This ensures resubscription after reconnection uses the latest input value.
   * Call this whenever the input changes to avoid stale input on reconnection.
   *
   * @since 0.1.0
   */
  readonly updateSubscriptionInput: (
    id: SubscriptionId,
    input: unknown,
  ) => Effect.Effect<void>

  /**
   * Get the current client state.
   */
  readonly state: Effect.Effect<ClientState>

  /**
   * Stream of client state changes.
   */
  readonly stateChanges: Stream.Stream<ClientState>

  /**
   * Get the client ID (available after authentication).
   * Returns Option.none() if not yet authenticated.
   */
  readonly clientId: Effect.Effect<Option.Option<ClientId>>

  /**
   * Check if ready (connected and authenticated).
   */
  readonly isReady: Effect.Effect<boolean>

  /**
   * Check if a subscription is paused due to backpressure.
   * Returns false if subscription doesn't exist.
   *
   * @since 0.1.0
   */
  readonly isPaused: (id: SubscriptionId) => Effect.Effect<boolean>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context tag for WebSocketClient service.
 *
 * @example
 * ```ts
 * import { WebSocketClient, WebSocketConnection, SubscriptionRegistry } from 'effect-trpc/ws/client'
 *
 * const program = Effect.gen(function* () {
 *   const client = yield* WebSocketClient
 *   // ...
 * }).pipe(
 *   Effect.provide(WebSocketClient.layer({ url: 'ws://localhost:3000' })),
 *   Effect.provide(WebSocketConnection.layer({ url: 'ws://localhost:3000' })),
 *   Effect.provide(SubscriptionRegistry.Live)
 * )
 * ```
 * 
 * @since 0.1.0
 * @category tags
 */
export class WebSocketClient extends Context.Tag("@effect-trpc/WebSocketClient")<
  WebSocketClient,
  WebSocketClientShape
>() {
  /**
   * Create a WebSocketClient layer with the given config.
   *
   * @since 0.1.0
   * @category Layers
   */
  static layer: (config: WebSocketClientConfig) => Layer.Layer<
    WebSocketClient,
    never,
    WebSocketConnection | SubscriptionRegistry | Scope.Scope
  >
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketClient implementation.
 */
const makeWebSocketClient = (
  config: WebSocketClientConfig,
): Effect.Effect<
  WebSocketClientShape,
  never,
  WebSocketConnection | SubscriptionRegistry | Scope.Scope
> =>
  Effect.gen(function* () {
    const connection = yield* WebSocketConnection
    const registry = yield* SubscriptionRegistry

    // State - using SubscriptionRef so stateChanges can emit all state updates including Ready
    const stateRef = yield* SubscriptionRef.make<ClientState>(ClientState.Disconnected)
    const clientIdRef = yield* Ref.make<ClientId | undefined>(undefined)
    const messageHandlerFiber = yield* Ref.make<Fiber.RuntimeFiber<void, unknown> | null>(null)
    const heartbeatFiber = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null)

    // Auth deferred - used to wait for auth result
    const authDeferred = yield* Ref.make<Deferred.Deferred<ClientId, WebSocketAuthError> | null>(null)

    // Update state - uses SubscriptionRef.set to notify all subscribers
    const updateState = (state: ClientState) => SubscriptionRef.set(stateRef, state)

    // Set up backpressure callback to send BackpressureAck
    yield* registry.setBackpressureCallback((subscriptionId, paused) =>
      connection.send(new BackpressureAckMessage({ id: subscriptionId, paused })).pipe(Effect.ignore),
    )

    // Handle incoming messages
    const handleMessages: Effect.Effect<void, unknown> = Stream.runForEach(
      connection.messages,
      (message) =>
        Effect.gen(function* () {
          // Handle auth result
          if (message._tag === "AuthResult") {
            const deferred = yield* Ref.get(authDeferred)
            if (deferred) {
              if (message.success && message.clientId) {
                yield* Ref.set(clientIdRef, message.clientId as ClientId)
                yield* updateState(ClientState.Ready(message.clientId as ClientId))
                yield* Deferred.succeed(deferred, message.clientId as ClientId)
              } else {
                const error = new WebSocketAuthError({
                  reason: "Rejected",
                  description: message.error ?? "Authentication failed",
                })
                yield* updateState(ClientState.Error(error))
                yield* Deferred.fail(deferred, error)
              }
            }
            return
          }

          // Route subscription messages
          yield* registry.routeMessage(message)
        }),
    )

    // Start heartbeat
    const startHeartbeat: Effect.Effect<void> = Effect.gen(function* () {
      const interval = config.heartbeatIntervalMs ?? 30000

      const fiber = yield* Effect.fork(
        Effect.repeat(
          Effect.gen(function* () {
            const isReady = yield* service.isReady
            if (isReady) {
              yield* connection.send(new PingMessage({})).pipe(Effect.ignore)
            }
          }),
          Schedule.spaced(interval),
        ).pipe(Effect.asVoid),
      )
      yield* Ref.set(heartbeatFiber, fiber)
    })

    // Resubscribe after reconnection - resends subscribe messages for all active subscriptions
    const resubscribe: Effect.Effect<void, WebSocketSendError> = Effect.gen(function* () {
      const subs = yield* registry.getAll

      yield* Effect.forEach(
        subs,
        (sub) =>
          connection.send(
            new SubscribeMessage({
              id: sub.id,
              path: sub.path,
              input: sub.input,
            }),
          ),
        { concurrency: "unbounded", discard: true },
      )
    })

    // Reauthenticate after reconnection
    const reauthenticate: Effect.Effect<void, WebSocketAuthError> = Effect.gen(function* () {
      yield* updateState(ClientState.Authenticating)

      // Create new auth deferred
      const deferred = yield* Deferred.make<ClientId, WebSocketAuthError>()
      yield* Ref.set(authDeferred, deferred)

      // Get fresh token and authenticate
      const token = yield* config.getToken.pipe(
        Effect.mapError(
          (cause) =>
            new WebSocketAuthError({
              reason: "TokenError",
              description: "Failed to get auth token",
              cause,
            }),
        ),
      )

      yield* connection.send(new AuthMessage({ token })).pipe(
        Effect.mapError(
          (cause) =>
            new WebSocketAuthError({
              reason: "SendFailed",
              description: "Failed to send auth message",
              cause,
            }),
        ),
      )

      // Wait for auth result with timeout
      yield* Deferred.await(deferred).pipe(
        Effect.timeoutFail({
          duration: "10 seconds",
          onTimeout: () =>
            new WebSocketAuthError({
              reason: "Timeout",
              description: "Authentication timeout",
            }),
        }),
      )
    })

    // ─────────────────────────────────────────────────────────────────────────
    // Connection State Machine
    // ─────────────────────────────────────────────────────────────────────────
    //
    // State transitions we care about:
    //
    //   * -> Disconnected (unexpected)  → Start reconnection attempts
    //   * -> Connected (after disconnect) → Reauthenticate + resubscribe
    //
    // Manual disconnect bypasses reconnection logic entirely.
    // ─────────────────────────────────────────────────────────────────────────

    const prevConnStateRef = yield* Ref.make<ConnectionState | null>(null)
    const reconnectionFiber = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null)
    const manualDisconnectRef = yield* Ref.make(false)

    /**
     * Represents a connection state transition for the state machine.
     */
    type StateTransition = {
      readonly from: ConnectionState["_tag"] | null
      readonly to: ConnectionState["_tag"]
    }

    /**
     * Determines if a transition represents an unexpected disconnect.
     * This occurs when we transition TO Disconnected from any connected state.
     */
    const isUnexpectedDisconnect = (transition: StateTransition): boolean =>
      transition.to === "Disconnected" && 
      transition.from !== null && 
      transition.from !== "Disconnected"

    /**
     * Determines if a transition represents a successful reconnection.
     * This occurs when we transition TO Connected from a non-connected state.
     */
    const isReconnection = (transition: StateTransition): boolean =>
      transition.to === "Connected" && 
      transition.from !== null && 
      transition.from !== "Connected"

    // Calculate delay with jitter using Effect.random for referential transparency
    const calculateDelayMs = (attempt: number): Effect.Effect<number> =>
      Effect.gen(function* () {
        const baseDelay = config.reconnect?.initialDelayMs ?? 500
        const maxDelayMs = config.reconnect?.maxDelayMs ?? 30000
        const factor = config.reconnect?.factor ?? 2
        const jitterConfig = 0.1

        let delay = baseDelay * Math.pow(factor, attempt - 1)
        delay = Math.min(delay, maxDelayMs)

        const jitterRange = delay * jitterConfig
        const randomValue = yield* Random.next // Use Effect.random for referential transparency
        const jitter = (randomValue - 0.5) * 2 * jitterRange
        delay = Math.max(0, delay + jitter)

        return delay
      })

    /**
     * Handles state transitions using a state machine pattern.
     * Each transition type has a dedicated handler for clarity.
     */
    const handleStateTransition = (
      transition: StateTransition,
      reconnectAttemptRef: { current: number },
    ): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const isManuallyDisconnected = yield* Ref.get(manualDisconnectRef)

        // ─────────────────────────────────────────────────────────────────────
        // Transition: * -> Disconnected (unexpected disconnect)
        // Action: Start reconnection with exponential backoff
        // ─────────────────────────────────────────────────────────────────────
        if (isUnexpectedDisconnect(transition) && !isManuallyDisconnected) {
          yield* updateState(ClientState.Disconnected)

          reconnectAttemptRef.current++
          const maxAttempts = config.reconnect?.maxAttempts

          // Check if we've exceeded max attempts
          if (maxAttempts !== undefined && reconnectAttemptRef.current > maxAttempts) {
            yield* updateState(
              ClientState.Error(
                new WebSocketConnectionError({
                  url: config.url,
                  reason: "MaxAttemptsReached",
                  description: `Max reconnection attempts (${maxAttempts}) reached`,
                }),
              ),
            )
            return
          }

          // Calculate delay and attempt reconnection
          const delayMs = yield* calculateDelayMs(reconnectAttemptRef.current)
          yield* updateState(ClientState.Reconnecting(reconnectAttemptRef.current))
          yield* Effect.sleep(delayMs)
          yield* connection.connect.pipe(Effect.ignore)
          return
        }

        // ─────────────────────────────────────────────────────────────────────
        // Transition: * -> Connected (successful reconnection)
        // Action: Reauthenticate and restore subscriptions
        // ─────────────────────────────────────────────────────────────────────
        if (isReconnection(transition)) {
          reconnectAttemptRef.current = 0 // Reset attempts on successful connection
          yield* Effect.logDebug("WebSocket reconnected, reauthenticating...")
          yield* reauthenticate.pipe(
            Effect.tap(() => Effect.logDebug("Reauthenticated, resubscribing...")),
            Effect.tap(() => resubscribe),
            Effect.tap(() => Effect.logDebug("Resubscribed to all subscriptions")),
            Effect.catchAll((error) =>
              Effect.logWarning("Failed to reauthenticate after reconnection", {
                error: error._tag,
                message: error.message,
              }),
            ),
          )
          return
        }

        // Other transitions (Connecting, Error, etc.) are logged but don't require action
      })

    const startReconnectionHandler: Effect.Effect<void> = Effect.gen(function* () {
      // Use an object ref so the mutable counter survives across stream iterations
      const reconnectAttemptRef = { current: 0 }

      const fiber = yield* Effect.fork(
        Stream.runForEach(connection.stateChanges, (connState) =>
          Effect.gen(function* () {
            const prevState = yield* Ref.get(prevConnStateRef)
            yield* Ref.set(prevConnStateRef, connState)

            const transition: StateTransition = {
              from: prevState?._tag ?? null,
              to: connState._tag,
            }

            yield* handleStateTransition(transition, reconnectAttemptRef)
          }),
        ).pipe(Effect.asVoid),
      )
      yield* Ref.set(reconnectionFiber, fiber)
    })

    const service: WebSocketClientShape = {
      connect: Effect.gen(function* () {
        yield* Ref.set(manualDisconnectRef, false)
        yield* updateState(ClientState.Connecting)

        // Connect to WebSocket
        yield* connection.connect

        // Start message handler
        const fiber = yield* Effect.fork(handleMessages)
        yield* Ref.set(messageHandlerFiber, fiber)

        yield* updateState(ClientState.Authenticating)

        // Create auth deferred
        const deferred = yield* Deferred.make<ClientId, WebSocketAuthError>()
        yield* Ref.set(authDeferred, deferred)

        // Get token and authenticate
        const token = yield* config.getToken.pipe(
          Effect.mapError(
            (cause) =>
              new WebSocketAuthError({
                reason: "TokenError",
                description: "Failed to get auth token",
                cause,
              }),
          ),
        )

        yield* connection.send(new AuthMessage({ token })).pipe(
          Effect.mapError(
            (cause) =>
              new WebSocketAuthError({
                reason: "SendFailed",
                description: "Failed to send auth message",
                cause,
              }),
          ),
        )

        // Wait for auth result with timeout
        yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: "10 seconds",
            onTimeout: () =>
              new WebSocketAuthError({
                reason: "Timeout",
                description: "Authentication timeout",
              }),
          }),
        )

        // Start heartbeat
        yield* startHeartbeat

        // Start reconnection handler to detect and handle reconnections
        yield* startReconnectionHandler
      }).pipe(Effect.withSpan("WebSocketClient.connect")),

      disconnect: Effect.gen(function* () {
        yield* Ref.set(manualDisconnectRef, true)
        // Stop heartbeat
        const hbFiber = yield* Ref.get(heartbeatFiber)
        if (hbFiber) {
          yield* Fiber.interrupt(hbFiber)
          yield* Ref.set(heartbeatFiber, null)
        }

        // Stop message handler
        const msgFiber = yield* Ref.get(messageHandlerFiber)
        if (msgFiber) {
          yield* Fiber.interrupt(msgFiber)
          yield* Ref.set(messageHandlerFiber, null)
        }

        // Stop reconnection handler
        const reconFiber = yield* Ref.get(reconnectionFiber)
        if (reconFiber) {
          yield* Fiber.interrupt(reconFiber)
          yield* Ref.set(reconnectionFiber, null)
        }

        // Clear subscriptions
        yield* registry.clear

        // Disconnect
        yield* connection.disconnect
        yield* updateState(ClientState.Disconnected)
      }).pipe(Effect.withSpan("WebSocketClient.disconnect")),

      subscribe: <A>(path: string, input: unknown) =>
        Effect.gen(function* () {
          // Create subscription
          const { id, stream } = yield* registry.create<A>(path, input)

          // Send subscribe message
          yield* connection.send(
            new SubscribeMessage({ id, path, input }),
          )

          return { id, stream }
        }).pipe(Effect.withSpan("WebSocketClient.subscribe", { attributes: { path } })),

      unsubscribe: (id) =>
        Effect.gen(function* () {
          const sub = yield* registry.get(id).pipe(Effect.catchAll(() => Effect.succeed(null)))
          const serverId = sub?.serverId ?? id
          yield* connection.send(new UnsubscribeMessage({ id: serverId }))
          yield* registry.remove(id)
        }).pipe(Effect.withSpan("WebSocketClient.unsubscribe", { attributes: { subscriptionId: id } })),

      send: (id, data) =>
        Effect.gen(function* () {
          // Verify subscription exists
          const sub = yield* registry.get(id)
          const serverId = sub.serverId ?? id
          yield* connection.send(new ClientDataMessage({ id: serverId, data }))
        }).pipe(Effect.withSpan("WebSocketClient.send", { attributes: { subscriptionId: id } })),

      updateSubscriptionInput: (id, input) =>
        registry.updateInput(id, input).pipe(
          Effect.withSpan("WebSocketClient.updateSubscriptionInput", { attributes: { subscriptionId: id } }),
        ),

      state: SubscriptionRef.get(stateRef),

      // Use SubscriptionRef.changes to get all state updates including Ready
      // This properly emits Ready state set via updateState in the message handler
      stateChanges: stateRef.changes,

      clientId: Ref.get(clientIdRef).pipe(Effect.map(Option.fromNullable)),

      isReady: Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(stateRef)
        return state._tag === "Ready"
      }),

      isPaused: (id) => registry.isPaused(id),
    }

    // Auto-connect if configured
    if (config.autoConnect !== false) {
      yield* Effect.gen(function* () {
        yield* Effect.logDebug("Auto-connect starting")
        yield* service.connect.pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Effect.logError("Auto-connect failed").pipe(
                Effect.annotateLogs({
                  error: error._tag,
                  message: error.message,
                  url: config.url,
                })
              )
              // Update state to reflect the failure
              yield* updateState(ClientState.Error(error))
            })
          )
        )
      }).pipe(Effect.fork)
    }

    // Cleanup on scope close
    yield* Effect.addFinalizer(() => service.disconnect)

    return service
  })

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketClient layer with the given config.
 * 
 * @since 0.1.0
 * @category layers
 */
export const makeWebSocketClientLayer = (
  config: WebSocketClientConfig,
): Layer.Layer<
  WebSocketClient,
  never,
  WebSocketConnection | SubscriptionRegistry | Scope.Scope
> => Layer.scoped(WebSocketClient, makeWebSocketClient(config))

// Assign static property after function is defined
WebSocketClient.layer = makeWebSocketClientLayer
