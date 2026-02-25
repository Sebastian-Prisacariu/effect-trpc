/**
 * @module effect-trpc/bun/ws
 *
 * WebSocket-only Bun adapter for effect-trpc.
 * Use this alongside the HTTP adapter for subscription support.
 *
 * @example
 * ```ts
 * import { createWebSocketHandler } from "effect-trpc/bun/ws"
 * import { createFetchHandler } from "effect-trpc/bun/http"
 *
 * const wsHandler = createWebSocketHandler({
 *   router: appRouter,
 *   auth: {
 *     authenticate: (token) =>
 *       Effect.gen(function* () {
 *         const user = yield* verifyJwt(token)
 *         return { userId: user.id, clientId: generateClientId() }
 *       }),
 *   },
 * })
 *
 * const httpHandler = createFetchHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * Bun.serve({
 *   port: 3000,
 *   fetch(req, server) {
 *     const url = new URL(req.url)
 *     if (url.pathname === "/ws") {
 *       if (server.upgrade(req, { data: { authenticated: false } })) {
 *         return // WebSocket upgrade successful
 *       }
 *       return new Response("Upgrade failed", { status: 500 })
 *     }
 *     return httpHandler.fetch(req)
 *   },
 *   websocket: wsHandler.websocket,
 * })
 * ```
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as BunContext from "@effect/platform-bun/BunContext"
import * as BunHttpPlatform from "@effect/platform-bun/BunHttpPlatform"
import type { Router } from "../core/router.js"
import type { ClientId, SubscriptionId } from "../ws/types.js"
import {
  WebSocketCodec,
  WebSocketAuth,
  ConnectionRegistry,
  SubscriptionManager,
  type WebSocketAuthHandler,
  type AuthResult,
  type Connection,
  createWebSocketLayerWithHandlers,
  extractSubscriptionHandlersFromLayer,
  registerHandlers,
} from "../ws/shared/index.js"
import { makeAdapterRuntimeState, type ConnectionAdmission } from "../ws/shared/adapter-runtime-state.js"
import {
  AuthResultMessage,
  SubscribedMessage,
  PongMessage,
  ErrorMessage,
  type FromServerMessage,
} from "../ws/protocol.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Data attached to each WebSocket connection.
 */
interface WebSocketData {
  clientId?: ClientId
  authenticated: boolean
  authResult?: AuthResult
  /** Fiber for auth timeout - interrupted when authenticated or closed */
  authTimeoutFiber?: Fiber.RuntimeFiber<void, never>
  /** Cleanup guard to prevent race conditions during connection cleanup */
  cleanupGuard?: Ref.Ref<boolean>
}

/**
 * Bun's WebSocket interface.
 */
export interface BunWebSocket<T = unknown> {
  data: T
  readonly readyState: number
  send(data: string | ArrayBuffer | Uint8Array, compress?: boolean): number
  sendText(data: string, compress?: boolean): number
  sendBinary(data: ArrayBuffer | Uint8Array, compress?: boolean): number
  close(code?: number, reason?: string): void
  ping(data?: string | ArrayBuffer | Uint8Array): void
  pong(data?: string | ArrayBuffer | Uint8Array): void
}

/**
 * Bun's WebSocket handler configuration.
 */
export interface BunWebSocketHandler<T = unknown> {
  message(ws: BunWebSocket<T>, message: string | ArrayBuffer): void
  open?(ws: BunWebSocket<T>): void
  close?(ws: BunWebSocket<T>, code: number, reason: string): void
  drain?(ws: BunWebSocket<T>): void
  ping?(ws: BunWebSocket<T>, data: ArrayBuffer): void
  pong?(ws: BunWebSocket<T>, data: ArrayBuffer): void
  perMessageDeflate?: boolean
  maxPayloadLength?: number
  idleTimeout?: number
  backpressureLimit?: number
  closeOnBackpressureLimit?: boolean
}

/**
 * Options for creating a WebSocket handler.
 */
export interface CreateWebSocketHandlerOptions<TRouter extends Router> {
  /**
   * The router instance (used to extract subscription procedures).
   */
  readonly router: TRouter

  /**
   * Authentication handler.
   * If not provided, uses test auth (accepts any token).
   */
  readonly auth?: WebSocketAuthHandler

  /**
   * The layer providing subscription handler implementations.
   * This should be a fully composed layer with no requirements.
   * Use `Layer.provide` to satisfy any dependencies before passing.
   *
   * @example
   * ```ts
   * const wsHandler = createWebSocketHandler({
   *   router: appRouter,
   *   handlers: AppHandlersLive.pipe(Layer.provide(DbLive)),
   * })
   * ```
   */
  readonly handlers?: Layer.Layer<any, never, never>

  /**
   * Idle timeout in seconds (Bun closes connection after this many seconds of inactivity).
   * @default 60
   */
  readonly idleTimeout?: number

  /**
   * Maximum WebSocket message payload length in bytes.
   * @default 16 * 1024 * 1024 (16MB)
   */
  readonly maxPayloadLength?: number

  /**
   * Authentication timeout in seconds.
   * Unauthenticated connections are closed after this time.
   * Prevents resource exhaustion from connections that never authenticate.
   * @default 10
   */
  readonly authTimeoutSeconds?: number
}

/**
 * WebSocket handler for Bun.
 */
export interface BunWebSocketHandlerResult {
  /**
   * The websocket handler configuration for Bun.serve().
   */
  readonly websocket: BunWebSocketHandler<WebSocketData>

  /**
   * Broadcast a message to all connected clients.
   */
  readonly broadcast: (message: FromServerMessage) => Effect.Effect<void>

  /**
   * Broadcast a message to a specific user (all their connections).
   */
  readonly broadcastToUser: (userId: string, message: FromServerMessage) => Effect.Effect<void>

  /**
   * Get count of connected clients.
   */
  readonly connectionCount: Effect.Effect<number>

  /**
   * Dispose of handler resources.
   */
  readonly dispose: () => Promise<void>
}

// Re-export types for convenience
export type { WebSocketAuthHandler, FromServerMessage }

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Handler Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocket handler for subscription procedures in Bun.
 *
 * Returns a `websocket` handler that can be passed to `Bun.serve()`.
 *
 * @example
 * ```ts
 * import { createWebSocketHandler } from "effect-trpc/bun/ws"
 * import { createFetchHandler } from "effect-trpc/bun/http"
 *
 * const wsHandler = createWebSocketHandler({
 *   router: appRouter,
 *   auth: {
 *     authenticate: (token) =>
 *       Effect.gen(function* () {
 *         const user = yield* verifyJwt(token)
 *         return { userId: user.id }
 *       }),
 *   },
 * })
 *
 * const httpHandler = createFetchHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * Bun.serve({
 *   port: 3000,
 *   fetch(req, server) {
 *     const url = new URL(req.url)
 *     if (url.pathname === "/ws") {
 *       if (server.upgrade(req, { data: { authenticated: false } })) {
 *         return // WebSocket upgrade successful
 *       }
 *       return new Response("Upgrade failed", { status: 500 })
 *     }
 *     return httpHandler.fetch(req)
 *   },
 *   websocket: wsHandler.websocket,
 * })
 *
 * // Cleanup on shutdown
 * process.on("SIGINT", async () => {
 *   await wsHandler.dispose()
 * })
 * ```
 */
export function createWebSocketHandler<TRouter extends Router>(
  options: CreateWebSocketHandlerOptions<TRouter>,
): BunWebSocketHandlerResult {
  const {
    router,
    auth,
    handlers,
    idleTimeout = 60,
    maxPayloadLength = 16 * 1024 * 1024,
    authTimeoutSeconds = 10,
  } = options

  const handlersWithBunRuntime = handlers?.pipe(
    Layer.provide(BunHttpPlatform.layer),
    Layer.provide(BunContext.layer),
  )

  // Create full layer with WebSocket services and handlers
  const fullLayer = createWebSocketLayerWithHandlers(auth, handlersWithBunRuntime)

  // Create managed runtime
  const managedRuntime = ManagedRuntime.make(fullLayer)

  const runtimeState = Effect.runSync(makeAdapterRuntimeState)

  const attachTrackedFiber = <A, E>(fiber: Fiber.RuntimeFiber<A, E>) => {
    Effect.runSync(runtimeState.trackFiber(fiber))
    fiber.addObserver(() => {
      Effect.runSync(runtimeState.untrackFiber(fiber))
    })
  }

  const forkTracked = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    opts?: { readonly allowDuringDisposing?: boolean },
  ) => {
    const canRun = Effect.runSync(
      opts?.allowDuringDisposing === true
        ? runtimeState.canRunCleanupWork
        : runtimeState.canRunNewWork,
    )
    if (!canRun) return

    const fiber = managedRuntime.runFork(effect)
    attachTrackedFiber(fiber)
  }

  const rejectConnection = (
    ws: BunWebSocket<WebSocketData>,
    admission: ConnectionAdmission,
  ) => {
    switch (admission._tag) {
      case "ShuttingDown":
        ws.close(1001, "Server shutting down")
        return
      case "Failed":
        ws.close(1011, "Server error: handler registration failed")
        return
      case "Starting":
        ws.close(1013, "Server starting up, try again later")
        return
      case "Accept":
        return
    }
  }

  // Extract and register subscription handlers from the handlers layer
  const registerHandlersEffect = Effect.gen(function* () {
    const subscriptionHandlers = yield* extractSubscriptionHandlersFromLayer(router)
    yield* registerHandlers(subscriptionHandlers)
  })

  // Register handlers once at startup and track completion
  managedRuntime.runPromise(registerHandlersEffect).then(
    () => {
      Effect.runSync(runtimeState.markReady)
    },
    (error) => {
      const registrationError = error instanceof Error ? error : new Error(String(error))
      Effect.runSync(runtimeState.markFailed(registrationError))
      console.error("Failed to register WebSocket handlers:", error)
    },
  )

  // Handle incoming message
  const handleMessage = (ws: BunWebSocket<WebSocketData>, data: string) =>
    Effect.gen(function* () {
      // Check cleanup guard before processing - skip if cleanup has started
      if (ws.data.cleanupGuard) {
        const isCleaningUp = yield* Ref.get(ws.data.cleanupGuard)
        if (isCleaningUp) {
          yield* Effect.logDebug("Skipping message processing: connection cleanup in progress")
          return
        }
      }

      const codec = yield* WebSocketCodec
      const authService = yield* WebSocketAuth
      const registry = yield* ConnectionRegistry
      const subscriptions = yield* SubscriptionManager

      // Create send function with codec in scope
      const send = (message: FromServerMessage): Effect.Effect<void> =>
        Effect.gen(function* () {
          const encoded = yield* codec.encode(message).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.logWarning(
                  `WebSocket send encoding failed: ${error instanceof Error ? error.message : String(error)}`,
                )
                return ""
              }),
            ),
          )
          if (!encoded) return

          const json = typeof encoded === "string" ? encoded : new TextDecoder().decode(encoded)

          // Check readyState (0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED)
          if (ws.readyState === 1) {
            ws.sendText(json)
          } else {
            yield* Effect.logDebug(
              `WebSocket send skipped: connection not open (state: ${ws.readyState})`,
            )
          }
        })

      const message = yield* codec.decode(data).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.logWarning("Failed to decode WebSocket message", {
              error: error.message,
              data: data.slice(0, 200),
            })

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
          // Cancel auth timeout since we're now authenticated
          if (ws.data.authTimeoutFiber) {
            yield* Fiber.interrupt(ws.data.authTimeoutFiber)
            delete ws.data.authTimeoutFiber
          }

          // Create connection object
          const connectedAt = yield* DateTime.now
          const connection: Connection = {
            clientId: result.clientId,
            auth: result,
            connectedAt,
            send,
            close: () =>
              Effect.sync(() => {
                ws.close(1000, "Server close")
              }),
          }

          // Register in ConnectionRegistry FIRST
          yield* registry.register(connection)

          // Now safe to mark as authenticated
          ws.data.authenticated = true
          ws.data.authResult = result
          ws.data.clientId = result.clientId

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
      if (!ws.data.authenticated || !ws.data.clientId) {
        yield* send(
          new AuthResultMessage({
            success: false,
            error: "Not authenticated",
          }),
        )
        return
      }

      const clientId = ws.data.clientId
      const authResult = ws.data.authResult!

      // Handle subscribe
      if (message._tag === "Subscribe") {
        const canSubscribe = yield* authService
          .canSubscribe(authResult, message.path, message.input)
          .pipe(Effect.catchAll(() => Effect.succeed(false)))

        if (!canSubscribe) {
          yield* send(
            new ErrorMessage({
              id: message.id,
              error: {
                _tag: "ForbiddenError",
                message: "Not authorized to subscribe to this path",
                cause: undefined,
              },
            }),
          )
          return
        }

        const subscriptionId = yield* subscriptions
          .subscribe(clientId, message.id, message.path, message.input)
          .pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.logWarning("Subscription failed", {
                  path: message.path,
                  error: error._tag,
                  message: error.message,
                })
                yield* send(
                  new ErrorMessage({
                    id: message.id,
                    error: {
                      _tag: error._tag,
                      message: error.message,
                      cause: undefined,
                    },
                  }),
                )
                return null as SubscriptionId | null
              }),
            ),
          )

        if (subscriptionId) {
          yield* send(
            new SubscribedMessage({
              id: message.id,
              subscriptionId,
            }),
          )
        }
        return
      }

      // Handle unsubscribe
      if (message._tag === "Unsubscribe") {
        yield* subscriptions.unsubscribe(clientId, message.id as SubscriptionId)
        return
      }

      // Handle client data (bidirectional)
      if (message._tag === "ClientData") {
        yield* subscriptions
          .sendToSubscription(clientId, message.id as SubscriptionId, message.data)
          .pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.logWarning("Failed to send data to subscription", {
                  subscriptionId: message.id,
                  error: error._tag,
                  message: error.message,
                })
                yield* send(
                  new ErrorMessage({
                    id: message.id,
                    error: {
                      _tag: error._tag,
                      message: error.message,
                      cause: undefined,
                    },
                  }),
                )
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

  // Handle connection close
  const handleClose = (ws: BunWebSocket<WebSocketData>) =>
    Effect.gen(function* () {
      // Atomically set cleanup guard to prevent race conditions with message handling
      if (ws.data.cleanupGuard) {
        const wasCleaningUp = yield* Ref.getAndSet(ws.data.cleanupGuard, true)
        if (wasCleaningUp) {
          // Already cleaning up - skip to prevent double cleanup
          yield* Effect.logDebug("Skipping cleanup: already in progress", { clientId: ws.data.clientId })
          return
        }
      }

      // Cancel auth timeout if still pending
      if (ws.data.authTimeoutFiber) {
        yield* Fiber.interrupt(ws.data.authTimeoutFiber)
      }

      if (ws.data.clientId) {
        const registry = yield* ConnectionRegistry
        const subscriptions = yield* SubscriptionManager
        yield* subscriptions.cleanupClient(ws.data.clientId)
        yield* registry.unregister(ws.data.clientId, "Connection closed")
      }
    })

  const runCleanup = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
    forkTracked(effect, { allowDuringDisposing: true })
  }

  return {
    websocket: {
      message(ws, message) {
        const data = typeof message === "string" ? message : new TextDecoder().decode(message)
        forkTracked(handleMessage(ws, data))
      },
      open(ws) {
        const admission = Effect.runSync(runtimeState.connectionAdmission)
        if (admission._tag !== "Accept") {
          rejectConnection(ws, admission)
          return
        }

        // Create cleanup guard for this connection (prevents race conditions during cleanup)
        const cleanupGuard = Effect.runSync(Ref.make(false))

        // Initialize connection data
        ws.data = { authenticated: false, cleanupGuard }

        // Start auth timeout
        const authTimeoutFiber = managedRuntime.runFork(
          Effect.gen(function* () {
            yield* Effect.sleep(Duration.seconds(authTimeoutSeconds))
            if (!ws.data.authenticated) {
              yield* Effect.logDebug("Closing unauthenticated connection after timeout")
              ws.close(4001, "Authentication timeout")
            }
          }).pipe(Effect.ignore),
        )
        attachTrackedFiber(authTimeoutFiber)
        ws.data.authTimeoutFiber = authTimeoutFiber
      },
      close(ws, _code, _reason) {
        runCleanup(handleClose(ws))
      },
      idleTimeout,
      maxPayloadLength,
    },

    broadcast: (message) =>
      Effect.async<void>((resume) => {
        forkTracked(
          Effect.gen(function* () {
            const reg = yield* ConnectionRegistry
            yield* reg.broadcast(message)
          }),
        )
        resume(Effect.void)
      }),

    broadcastToUser: (userId, message) =>
      Effect.async<void>((resume) => {
        forkTracked(
          Effect.gen(function* () {
            const reg = yield* ConnectionRegistry
            yield* reg.broadcastToUser(userId, message)
          }),
        )
        resume(Effect.void)
      }),

    connectionCount: Effect.tryPromise(() =>
      managedRuntime.runPromise(
        Effect.gen(function* () {
          const reg = yield* ConnectionRegistry
          return yield* reg.count
        }),
      ),
    ).pipe(Effect.catchAllCause(() => Effect.succeed(0))),

    dispose: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* runtimeState.markDisposing
          yield* runtimeState.interruptTrackedFibers
          yield* runtimeState.clearTrackedFibers
          yield* Effect.tryPromise(() => managedRuntime.dispose()).pipe(
            Effect.catchAllCause(() => Effect.void),
          )
          yield* runtimeState.markDisposed
        }),
      ),
  }
}
