/**
 * @module effect-trpc/ws/shared
 *
 * Shared WebSocket handler logic for Node.js and Bun adapters.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Context from "effect/Context"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as HashMap from "effect/HashMap"
import type * as DateTimeType from "effect/DateTime"
import * as DateTime from "effect/DateTime"

import type { Router } from "../../core/router.js"
import type {
  ProceduresGroup,
  ProcedureRecord,
  ProceduresService,
  SubscriptionHandler,
} from "../../core/procedures.js"
import type { ClientId, SubscriptionId } from "../types.js"
import {
  WebSocketCodec,
  WebSocketCodecLive,
  WebSocketAuth,
  WebSocketAuthTest,
  ConnectionRegistry,
  ConnectionRegistryLive,
  SubscriptionManager,
  SubscriptionManagerLive,
  type WebSocketAuthHandler,
  type AuthResult,
  type Connection,
  type RegisteredHandler,
  makeWebSocketAuth,
} from "../server/index.js"
import {
  AuthResultMessage,
  SubscribedMessage,
  PongMessage,
  ErrorMessage,
  type FromServerMessage,
} from "../protocol.js"
export { makeAdapterRuntimeState } from "./adapter-runtime-state.js"
export type { AdapterLifecycle, ConnectionAdmission, AdapterRuntimeState } from "./adapter-runtime-state.js"

// ─────────────────────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connection state data tracked per WebSocket connection.
 */
export interface ConnectionStateData {
  readonly authenticated: boolean
  readonly authResult: AuthResult | undefined
  readonly clientId: ClientId | undefined
}

/**
 * Initial connection state.
 */
export const initialConnectionState: ConnectionStateData = {
  authenticated: false,
  authResult: undefined,
  clientId: undefined,
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the full WebSocket service layer.
 */
export const createWebSocketLayer = (auth?: WebSocketAuthHandler) => {
  const authLayer = auth ? makeWebSocketAuth(auth) : WebSocketAuthTest

  const baseLayer = Layer.mergeAll(
    WebSocketCodecLive,
    authLayer,
    ConnectionRegistryLive,
  )

  return Layer.mergeAll(
    baseLayer,
    SubscriptionManagerLive.pipe(Layer.provide(ConnectionRegistryLive)),
  )
}

/**
 * Create the full WebSocket service layer with handlers layer merged.
 *
 * @remarks
 * The handlers layer must be fully satisfied (no requirements) to work with ManagedRuntime.
 * Use `Layer.provide` to satisfy any dependencies before passing to this function.
 */
export const createWebSocketLayerWithHandlers = (
  auth: WebSocketAuthHandler | undefined,
  handlers: Layer.Layer<any, never, never> | undefined,
): Layer.Layer<any, never, never> => {
  const wsLayer = createWebSocketLayer(auth)

  if (handlers) {
    // Merge the handlers layer so ProceduresService tags are available
    return Layer.mergeAll(wsLayer, handlers)
  }

  return wsLayer
}

/**
 * Create a ManagedRuntime with the WebSocket layer.
 */
export const createWebSocketRuntime = (auth?: WebSocketAuthHandler) =>
  ManagedRuntime.make(createWebSocketLayer(auth))

/**
 * Create a ManagedRuntime with the WebSocket layer and handlers.
 *
 * @remarks
 * The handlers layer must be fully satisfied (no requirements) to work with ManagedRuntime.
 * Use `Layer.provide` to satisfy any dependencies before passing to this function.
 */
export const createWebSocketRuntimeWithHandlers = (
  auth: WebSocketAuthHandler | undefined,
  handlers: Layer.Layer<any, never, never> | undefined,
) => ManagedRuntime.make(createWebSocketLayerWithHandlers(auth, handlers))

// ─────────────────────────────────────────────────────────────────────────────
// Handler Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract subscription handlers from a router using the handlers layer.
 * This retrieves actual handler implementations from the ProceduresService if available,
 * or falls back to stub handlers if no handlers layer is provided.
 *
 * @param router - The router containing subscription procedures
 * @returns Effect that produces a Map of path to RegisteredHandler
 */
export const extractSubscriptionHandlersFromLayer = <TRouter extends Router>(
  router: TRouter,
): Effect.Effect<HashMap.HashMap<string, RegisteredHandler>, never, any> =>
  Effect.gen(function* () {
    let handlers = HashMap.empty<string, RegisteredHandler>()

    for (const [groupKey, group] of Object.entries(router.routes)) {
      const proceduresGroup = group as ProceduresGroup<string, ProcedureRecord>

      // Get the ProceduresService for this group
      const serviceTag = Context.GenericTag<ProceduresService<string, ProcedureRecord>>(
        `@effect-trpc/${proceduresGroup.name}`,
      )

      // Try to get the service - use serviceOption to handle missing service
      const maybeService = yield* Effect.serviceOption(serviceTag)

      for (const [procKey, proc] of Object.entries(proceduresGroup.procedures)) {
         
        if (proc.type === "subscription") {
          const path = `${groupKey}.${procKey}`

          // Try to get real handler from service if available
          let handlerImpl: SubscriptionHandler<unknown, unknown, unknown, never> | undefined

          if (maybeService._tag === "Some") {
             
            handlerImpl = maybeService.value.handlers[procKey] as SubscriptionHandler<unknown, unknown, unknown, never> | undefined
          }

          if (handlerImpl) {
            // Use real handler implementation
            handlers = HashMap.set(handlers, path, {
              path,
              inputSchema: proc.inputSchema,
              outputSchema: proc.outputSchema,
              handler: handlerImpl,
            })
          } else {
            // Fallback to stub handler - used when no handlers layer provided
            // or when specific handler is not implemented
            handlers = HashMap.set(handlers, path, {
              path,
              inputSchema: proc.inputSchema,
              outputSchema: proc.outputSchema,
              handler: {
                onSubscribe: () => Effect.succeed(Stream.empty),
              },
            })
          }
        }
      }
    }

    return handlers
  })

/**
 * Register all subscription handlers with the SubscriptionManager.
 */
export const registerHandlers = (handlers: HashMap.HashMap<string, RegisteredHandler>) =>
  Effect.gen(function* () {
    const subscriptions = yield* SubscriptionManager
    for (const handler of HashMap.values(handlers)) {
      yield* subscriptions.registerHandler(handler)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// Message Handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for handling a WebSocket message.
 */
export interface HandleMessageOptions {
  /** The raw message data */
  readonly data: string
  /** Current connection state */
  readonly state: ConnectionStateData
  /** Function to update connection state */
  readonly updateState: (state: ConnectionStateData) => Effect.Effect<void>
  /** Function to send a message to the client */
  readonly send: (message: FromServerMessage) => Effect.Effect<void>
  /** Function to create a Connection object for registry */
  readonly createConnection: (auth: AuthResult, connectedAt: DateTimeType.Utc) => Connection
}

/**
 * Handle an incoming WebSocket message.
 * Returns the updated connection state if auth succeeded.
 */
export const handleMessage = (options: HandleMessageOptions) =>
  Effect.gen(function* () {
    const { data, state, updateState, send, createConnection } = options

    const codec = yield* WebSocketCodec
    const authService = yield* WebSocketAuth
    const registry = yield* ConnectionRegistry
    const subscriptions = yield* SubscriptionManager

    const message = yield* codec.decode(data).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // Log at warning level - parsing failures should be visible
          yield* Effect.logWarning("Failed to decode WebSocket message", { 
            error: error.message,
            data: data.slice(0, 200), // Truncate for logging
          })
          
          // Send error back to client so they know the message wasn't understood
          yield* send(
            new ErrorMessage({
              id: "parse-error",
              error: {
                _tag: "ParseError",
                message: `Failed to parse message: ${error.message}`,
                cause: undefined,
              },
            }),
          )
          
          return null
        }),
      ),
    )

    if (!message) return

    // Handle auth message
    if (message._tag === "Auth") {
      const result = yield* authService.authenticate(message.token).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(null as AuthResult | null).pipe(
            Effect.tap(() =>
              send(
                new AuthResultMessage({
                  success: false,
                  error: error.message,
                }),
              ),
            ),
          ),
        ),
      )

      if (result) {
        // Register in ConnectionRegistry FIRST (source of truth)
        // Then update local state to prevent race condition where messages
        // see authenticated=true but connection isn't registered yet
        const connectedAt = yield* DateTime.now
        const connection = createConnection(result, connectedAt)
        yield* registry.register(connection)

        yield* updateState({
          authenticated: true,
          authResult: result,
          clientId: result.clientId,
        })

        yield* send(
          new AuthResultMessage({
            success: true,
            clientId: result.clientId,
          }),
        )
      }
      return
    }

    // All other messages require authentication
    if (!state.authenticated || !state.clientId) {
      yield* send(
        new AuthResultMessage({
          success: false,
          error: "Not authenticated",
        }),
      )
      return
    }

    // Handle subscribe
    if (message._tag === "Subscribe") {
      const canSubscribe = yield* authService
        .canSubscribe(state.authResult!, message.path, message.input)
        .pipe(Effect.catchAll(() => Effect.succeed(false)))

      if (!canSubscribe) {
        // Send authorization error to client
        yield* send(new ErrorMessage({
          id: message.id,
          error: {
            _tag: "ForbiddenError",
            message: "Not authorized to subscribe to this path",
            cause: undefined,
          },
        }))
        return
      }

      const subscriptionId = yield* subscriptions.subscribe(
        state.clientId,
        message.id, // Client's correlation ID
        message.path,
        message.input,
      ).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("Subscription failed", { 
              path: message.path, 
              error: error._tag,
              message: error.message,
            })
            yield* send(new ErrorMessage({
              id: message.id,
              error: {
                _tag: error._tag,
                message: error.message,
                cause: undefined,
              },
            }))
            return null as SubscriptionId | null
          }),
        ),
      )

      if (subscriptionId) {
        // Return both the client's correlation ID and server-generated subscription ID
        yield* send(new SubscribedMessage({ 
          id: message.id,
          subscriptionId,
        }))
      }
      return
    }

    // Handle unsubscribe
    if (message._tag === "Unsubscribe") {
      yield* subscriptions.unsubscribe(
        state.clientId,
        message.id as SubscriptionId,
      )
      return
    }

    // Handle client data (bidirectional)
    if (message._tag === "ClientData") {
      yield* subscriptions
        .sendToSubscription(
          state.clientId,
          message.id as SubscriptionId,
          message.data,
        )
        .pipe(
          Effect.catchAll((error) =>
            Effect.logWarning("Failed to send data to subscription", {
              subscriptionId: message.id,
              error: error._tag,
              message: error.message,
            }),
          ),
        )
      return
    }

    // Handle ping
    if (message._tag === "Ping") {
      yield* send(new PongMessage({}))
      return
    }
  })

/**
 * Clean up a client connection.
 */
export const cleanupConnection = (clientId: ClientId, reason: string) =>
  Effect.gen(function* () {
    const registry = yield* ConnectionRegistry
    const subscriptions = yield* SubscriptionManager
    yield* subscriptions.cleanupClient(clientId)
    yield* registry.unregister(clientId, reason)
  })

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

export {
  WebSocketCodec,
  WebSocketAuth,
  ConnectionRegistry,
  SubscriptionManager,
  makeWebSocketAuth,
  type AuthResult,
  type Connection,
  type RegisteredHandler,
  type WebSocketAuthHandler,
}
