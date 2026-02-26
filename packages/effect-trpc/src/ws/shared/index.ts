/**
 * @module effect-trpc/ws/shared
 *
 * Shared WebSocket handler logic for Node.js and Bun adapters.
 */

import * as Context from "effect/Context"
import type * as DateTimeType from "effect/DateTime"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Predicate from "effect/Predicate"
import * as Ref from "effect/Ref"
import type * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

import type {
  ProcedureRecord,
  ProceduresGroup,
  ProceduresService,
  SubscriptionHandler,
} from "../../core/server/procedures.js"
import type { RouterRecord, RouterShape } from "../../core/server/router.js"
import {
    AuthResultMessage,
    ErrorMessage,
    type FromServerMessage,
    PongMessage,
    SubscribedMessage,
} from "../protocol.js"
import {
    type AuthResult,
    type Connection,
    ConnectionRegistry,
    ConnectionRegistryLive,
    MessageRateLimiter,
    MessageRateLimiterDisabled,
    MessageRateLimiterLive,
    type RateLimitConfig,
    type RegisteredHandler,
    SubscriptionManager,
    SubscriptionManagerLive,
    WebSocketAuth,
    type WebSocketAuthHandler,
    WebSocketAuthTest,
    WebSocketCodec,
    WebSocketCodecLive,
    makeMessageRateLimiterLayer,
    makeWebSocketAuth,
} from "../server/index.js"
import type { ClientId, SubscriptionId } from "../types.js"
export { makeAdapterRuntimeState } from "./adapter-runtime-state.js"
export type { AdapterLifecycle, AdapterRuntimeState, ConnectionAdmission } from "./adapter-runtime-state.js"

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

/**
 * Cleanup guard state to prevent race conditions during connection cleanup.
 * Uses atomic state to ensure message handlers don't access resources after cleanup starts.
 */
export interface CleanupGuard {
  /** Ref tracking whether cleanup has started */
  readonly isCleaningUp: Ref.Ref<boolean>
}

/**
 * Create a cleanup guard for a connection.
 */
export const makeCleanupGuard: Effect.Effect<CleanupGuard> = Effect.gen(function* () {
  const isCleaningUp = yield* Ref.make(false)
  return { isCleaningUp }
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating the WebSocket layer.
 */
export interface WebSocketLayerOptions {
  /** Authentication handler */
  readonly auth?: WebSocketAuthHandler | undefined
  /** Rate limit configuration. Set to false to disable rate limiting. */
  readonly rateLimit?: RateLimitConfig | false | undefined
}

/**
 * Create the full WebSocket service layer.
 * 
 * @param options - Configuration options or just an auth handler for backward compatibility
 */
export const createWebSocketLayer = (options?: WebSocketAuthHandler | WebSocketLayerOptions) => {
  // Handle backward compatibility: if options is a function, treat it as auth handler
  const opts: WebSocketLayerOptions = typeof options === "function"
    ? { auth: options as WebSocketAuthHandler }
    : (options as WebSocketLayerOptions | undefined) ?? {}

  const authLayer = opts.auth !== undefined ? makeWebSocketAuth(opts.auth) : WebSocketAuthTest
  
  // Rate limiter layer: use custom config, default, or disabled
  const rateLimiterLayer = opts.rateLimit === false
    ? MessageRateLimiterDisabled
    : opts.rateLimit !== undefined
      ? makeMessageRateLimiterLayer(opts.rateLimit)
      : MessageRateLimiterLive

  const baseLayer = Layer.mergeAll(
    WebSocketCodecLive,
    authLayer,
    ConnectionRegistryLive,
    rateLimiterLayer,
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
  rateLimit?: RateLimitConfig | false,
): Layer.Layer<any, never, never> => {
  const wsLayer = createWebSocketLayer({ auth, rateLimit })

  if (handlers) {
    // Merge the handlers layer so ProceduresService tags are available
    return Layer.mergeAll(wsLayer, handlers)
  }

  return wsLayer
}

/**
 * Create a ManagedRuntime with the WebSocket layer.
 */
export const createWebSocketRuntime = (options?: WebSocketAuthHandler | WebSocketLayerOptions) =>
  ManagedRuntime.make(createWebSocketLayer(options))

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
  rateLimit?: RateLimitConfig | false,
) => ManagedRuntime.make(createWebSocketLayerWithHandlers(auth, handlers, rateLimit))

type ProcedureDefinitionRuntime = {
  readonly _tag: "ProcedureDefinition"
  readonly type: string
  readonly inputSchema: Schema.Schema<unknown, unknown, never> | undefined
  readonly outputSchema: Schema.Schema<unknown, unknown, never> | undefined
}

const isProcedureDefinitionRuntime = (value: unknown): value is ProcedureDefinitionRuntime =>
  Predicate.isTagged(value, "ProcedureDefinition")

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
export const extractSubscriptionHandlersFromLayer = <TRouter extends RouterShape<RouterRecord>>(
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
        if (isProcedureDefinitionRuntime(proc) && proc.type === "subscription") {
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
  /** Optional cleanup guard to prevent processing during cleanup */
  readonly cleanupGuard?: CleanupGuard
}

/**
 * Handle an incoming WebSocket message.
 * Returns the updated connection state if auth succeeded.
 * 
 * If a cleanup guard is provided, this will skip processing if cleanup
 * has already started, preventing race conditions where messages are
 * processed after connection resources have been cleaned up.
 */
export const handleMessage = (options: HandleMessageOptions) =>
  Effect.gen(function* () {
    const { data, state, updateState, send, createConnection, cleanupGuard } = options

    // Check cleanup guard before processing - skip if cleanup has started
    if (cleanupGuard) {
      const isCleaningUp = yield* Ref.get(cleanupGuard.isCleaningUp)
      if (isCleaningUp) {
        yield* Effect.logDebug("Skipping message processing: connection cleanup in progress")
        return
      }
    }

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

    // Check rate limit for authenticated messages
    const rateLimiter = yield* MessageRateLimiter
    const rateLimitResult = yield* rateLimiter.checkLimit(state.clientId).pipe(
      Effect.catchTag("MessageRateLimitExceededError", (error) =>
        Effect.gen(function* () {
          yield* Effect.logWarning("Rate limit exceeded", {
            clientId: state.clientId,
            count: error.currentCount,
            max: error.maxMessages,
            retryAfterMs: error.retryAfterMs,
          })
          yield* send(
            new ErrorMessage({
              id: "rate-limit",
              error: {
                _tag: "RateLimitExceeded",
                message: error.message,
                cause: undefined,
              },
            }),
          )
          return "rate_limited" as const
        }),
      ),
    )

    if (rateLimitResult === "rate_limited") {
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
 * Options for cleaning up a connection.
 */
export interface CleanupConnectionOptions {
  /** The client ID to clean up */
  readonly clientId: ClientId
  /** Reason for the cleanup */
  readonly reason: string
  /** Optional cleanup guard - if provided, will be set atomically to prevent race conditions */
  readonly cleanupGuard?: CleanupGuard
}

/**
 * Clean up a client connection.
 * 
 * If a cleanup guard is provided, this will atomically mark cleanup as started
 * before proceeding. If cleanup was already started, this is a no-op to prevent
 * double cleanup.
 */
export const cleanupConnection = (options: CleanupConnectionOptions) =>
  Effect.gen(function* () {
    const { clientId, reason, cleanupGuard } = options

    // Atomically check and set cleanup state if guard is provided
    if (cleanupGuard) {
      const wasCleaningUp = yield* Ref.getAndSet(cleanupGuard.isCleaningUp, true)
      if (wasCleaningUp) {
        // Already cleaning up - skip to prevent double cleanup
        yield* Effect.logDebug("Skipping cleanup: already in progress", { clientId })
        return
      }
    }

    const registry = yield* ConnectionRegistry
    const subscriptions = yield* SubscriptionManager
    const rateLimiter = yield* MessageRateLimiter
    
    yield* subscriptions.cleanupClient(clientId)
    yield* rateLimiter.clearClient(clientId)
    yield* registry.unregister(clientId, reason)
  })

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

export {
    ConnectionRegistry, MessageRateLimiter, MessageRateLimiterDisabled, MessageRateLimiterLive, SubscriptionManager, WebSocketAuth, WebSocketCodec, makeMessageRateLimiterLayer, makeWebSocketAuth, type AuthResult,
    type Connection, type RateLimitConfig, type RegisteredHandler,
    type WebSocketAuthHandler
}

