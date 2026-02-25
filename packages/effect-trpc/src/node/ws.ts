/**
 * @module effect-trpc/node/ws
 *
 * WebSocket-only Node.js adapter for effect-trpc.
 * Use this alongside the HTTP adapter for subscription support.
 *
 * @example
 * ```ts
 * import { createWebSocketHandler } from "effect-trpc/node/ws"
 * import { WebSocketServer } from "ws"
 * import { appRouter } from "./router"
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
 * const wss = new WebSocketServer({ port: 3001 })
 *
 * wss.on("connection", (ws) => {
 *   Effect.runFork(wsHandler.handleConnection(ws))
 * })
 *
 * // Cleanup on shutdown
 * process.on("SIGINT", async () => {
 *   await wsHandler.dispose()
 *   wss.close()
 * })
 * ```
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import type * as DateTime from "effect/DateTime"
import * as Clock from "effect/Clock"
import * as Schedule from "effect/Schedule"
import * as Duration from "effect/Duration"
import * as NodeContext from "@effect/platform-node/NodeContext"
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import type { Router } from "../core/router.js"
import {
  createWebSocketRuntimeWithHandlers,
  extractSubscriptionHandlersFromLayer,
  registerHandlers,
  handleMessage,
  cleanupConnection,
  initialConnectionState,
  makeCleanupGuard,
  WebSocketCodec,
  ConnectionRegistry,
  type ConnectionStateData,
  type AuthResult,
  type Connection,
  type WebSocketAuthHandler,
} from "../ws/shared/index.js"
import { makeAdapterRuntimeState, type ConnectionAdmission } from "../ws/shared/adapter-runtime-state.js"
import {
  type FromServerMessage,
} from "../ws/protocol.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Handler Types
// ─────────────────────────────────────────────────────────────────────────────

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
   * Heartbeat interval in milliseconds.
   * @default 30000
   */
  readonly heartbeatIntervalMs?: number

  /**
   * Connection timeout in milliseconds.
   * Connections are closed if no message received within this time.
   * @default 60000
   */
  readonly connectionTimeoutMs?: number

  /**
   * Authentication timeout in milliseconds.
   * Unauthenticated connections are closed after this time.
   * Prevents resource exhaustion from connections that never authenticate.
   * @default 10000
   */
  readonly authTimeoutMs?: number
}

/**
 * WebSocket handler for Node.js.
 */
export interface WebSocketHandler {
  /**
   * Handle a WebSocket connection.
   * Call this when a new WebSocket connects.
   *
   * @param ws - The WebSocket instance (from 'ws' package)
   * @returns Effect that runs until the connection closes
   */
  readonly handleConnection: (
    ws: WebSocketLike,
  ) => Effect.Effect<void, never, never>

  /**
   * Broadcast a message to all connected clients.
   */
  readonly broadcast: (message: FromServerMessage) => Effect.Effect<void>

  /**
   * Broadcast a message to a specific user (all their connections).
   */
  readonly broadcastToUser: (
    userId: string,
    message: FromServerMessage,
  ) => Effect.Effect<void>

  /**
   * Get count of connected clients.
   */
  readonly connectionCount: Effect.Effect<number>

  /**
   * Dispose of handler resources.
   */
  readonly dispose: () => Promise<void>
}

/**
 * Minimal WebSocket interface compatible with 'ws' package.
 */
export interface WebSocketLike {
  readonly readyState: number
  readonly OPEN: number
  readonly CLOSED: number
  send(data: string, callback?: (err?: Error) => void): void
  close(code?: number, reason?: string): void
  on(event: "message", listener: (data: Buffer | ArrayBuffer | string) => void): void
  on(event: "close", listener: (code: number, reason: Buffer) => void): void
  on(event: "error", listener: (error: Error) => void): void
  on(event: "pong", listener: () => void): void
  off(event: "message", listener: (data: Buffer | ArrayBuffer | string) => void): void
  off(event: "close", listener: (code: number, reason: Buffer) => void): void
  off(event: "error", listener: (error: Error) => void): void
  off(event: "pong", listener: () => void): void
  ping(data?: Buffer | string): void
}

// Re-export types for convenience
export type { WebSocketAuthHandler, FromServerMessage }

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Handler Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocket handler for subscription procedures.
 *
 * @example
 * ```ts
 * import { createWebSocketHandler } from "effect-trpc/node/ws"
 * import { WebSocketServer } from "ws"
 * import { appRouter } from "./router"
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
 * const wss = new WebSocketServer({ port: 3001 })
 *
 * wss.on("connection", (ws) => {
 *   Effect.runFork(wsHandler.handleConnection(ws))
 * })
 *
 * // Cleanup on shutdown
 * process.on("SIGINT", async () => {
 *   await wsHandler.dispose()
 *   wss.close()
 * })
 * ```
 */
export function createWebSocketHandler<TRouter extends Router>(
  options: CreateWebSocketHandlerOptions<TRouter>,
): WebSocketHandler {
  const {
    router,
    auth,
    handlers,
    heartbeatIntervalMs = 30000,
    connectionTimeoutMs = 60000,
    authTimeoutMs = 10000,
  } = options

  const handlersWithNodeRuntime = handlers?.pipe(
    Layer.provide(NodeHttpPlatform.layer),
    Layer.provide(NodeContext.layer),
  )

  // Create managed runtime with shared layer and handlers
  const managedRuntime = createWebSocketRuntimeWithHandlers(auth, handlersWithNodeRuntime)

  const runtimeState = Effect.runSync(makeAdapterRuntimeState)

  const attachTrackedFiber = <A, E>(fiber: Fiber.RuntimeFiber<A, E>) => {
    Effect.runSync(runtimeState.trackFiber(fiber))
    fiber.addObserver(() => {
      Effect.runSync(runtimeState.untrackFiber(fiber))
    })
  }

  const forkTracked = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly allowDuringDisposing?: boolean },
  ) => {
    const canRun = Effect.runSync(
      options?.allowDuringDisposing === true
        ? runtimeState.canRunCleanupWork
        : runtimeState.canRunNewWork,
    )
    if (!canRun) return

    const fiber = managedRuntime.runFork(effect)
    attachTrackedFiber(fiber)
  }

  const rejectConnection = (ws: WebSocketLike, admission: ConnectionAdmission) => {
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
  // This retrieves real handler implementations, not stubs
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
      // Log the error since handler registration failure is critical
      console.error("Failed to register WebSocket handlers:", error)
    },
  )

  // Handle a single WebSocket connection
  const handleConnection = (ws: WebSocketLike) =>
    Effect.gen(function* () {
      const codec = yield* WebSocketCodec

      // Connection state using Ref for immutability
      const stateRef = yield* Ref.make<ConnectionStateData>(initialConnectionState)

      // Cleanup guard to prevent race conditions between message handling and cleanup
      const cleanupGuard = yield* makeCleanupGuard

      // Create send function (Node.js specific - uses callback-based ws.send)
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
          
          const json = typeof encoded === "string" 
            ? encoded 
            : new TextDecoder().decode(encoded)
            
          yield* Effect.async<void, never>((resume) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(json, (err) => {
                // Log WebSocket send errors but don't fail the effect
                if (err) {
                  Effect.runFork(
                    Effect.logWarning(`WebSocket send failed: ${err.message}`),
                  )
                }
                resume(Effect.void)
              })
            } else {
              // Log when trying to send to non-open WebSocket
              Effect.runFork(
                Effect.logDebug(`WebSocket send skipped: connection not open (state: ${ws.readyState})`),
              )
              resume(Effect.void)
            }
          })
        })

      // Create connection factory for auth
      const createConnection = (authResult: AuthResult, connectedAt: DateTime.Utc): Connection => ({
        clientId: authResult.clientId,
        auth: authResult,
        connectedAt,
        send,
        close: () => Effect.sync(() => ws.close(1000, "Server close")),
      })

      // Handle incoming messages using shared logic
      const onMessage = (data: string) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          yield* handleMessage({
            data,
            state,
            updateState: (newState) => Ref.set(stateRef, newState),
            send,
            createConnection,
            cleanupGuard,
          })
        })

      // Track last activity time using Ref
      const lastActivityRef = yield* Ref.make(yield* Clock.currentTimeMillis)

      // Helper to update last activity
      const updateLastActivity = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* Ref.set(lastActivityRef, now)
      })

      // Heartbeat fiber - sends ping at regular intervals
      const heartbeatFiber = yield* Effect.fork(
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(heartbeatIntervalMs))
          if (ws.readyState === ws.OPEN) {
            ws.ping()
          }
        }).pipe(
          Effect.repeat(Schedule.spaced(Duration.millis(heartbeatIntervalMs))),
          Effect.ignore,
        ),
      )

      // Timeout check fiber - closes connection if no activity
      const timeoutFiber = yield* Effect.fork(
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(connectionTimeoutMs / 2))
          const now = yield* Clock.currentTimeMillis
          const lastActivity = yield* Ref.get(lastActivityRef)
          if (now - lastActivity > connectionTimeoutMs) {
            ws.close(1000, "Connection timeout")
            return true // Signal to stop
          }
          return false // Continue checking
        }).pipe(
          Effect.repeat(
            Schedule.recurWhile((shouldStop: boolean) => !shouldStop).pipe(
              Schedule.addDelay(() => Duration.millis(connectionTimeoutMs / 2)),
            ),
          ),
          Effect.ignore,
        ),
      )

      // Auth timeout fiber - closes connection if not authenticated within timeout
      // This prevents resource exhaustion from connections that never authenticate
      const authTimeoutFiber = yield* Effect.fork(
        Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(authTimeoutMs))
          const state = yield* Ref.get(stateRef)
          if (!state.authenticated) {
            yield* Effect.logDebug("Closing unauthenticated connection after timeout")
            ws.close(4001, "Authentication timeout")
          }
        }).pipe(Effect.ignore),
      )

      // Set up WebSocket event handlers with proper cleanup
      // Track handlers for explicit removal to prevent memory leaks
      yield* Effect.async<void>((resume) => {
        const handleMessage = (data: unknown) => {
          // Update last activity
          managedRuntime.runFork(updateLastActivity)
          
          let dataStr: string
          if (typeof data === "string") {
            dataStr = data
          } else if (data instanceof ArrayBuffer) {
            dataStr = new TextDecoder().decode(data)
          } else if (Buffer.isBuffer(data)) {
            dataStr = data.toString("utf8")
          } else {
            // Buffer[] case - concatenate
            dataStr = Buffer.concat(data as Buffer[]).toString("utf8")
          }
          managedRuntime.runFork(onMessage(dataStr))
        }

        const handlePong = () => {
          managedRuntime.runFork(updateLastActivity)
        }

        const handleClose = () => {
          // Interrupt all connection fibers
          managedRuntime.runFork(
            Effect.gen(function* () {
              yield* Fiber.interrupt(heartbeatFiber)
              yield* Fiber.interrupt(timeoutFiber)
              yield* Fiber.interrupt(authTimeoutFiber)
              const state = yield* Ref.get(stateRef)
              if (state.clientId) {
                yield* cleanupConnection({
                  clientId: state.clientId,
                  reason: "Connection closed",
                  cleanupGuard,
                })
              }
            }),
          )
          resume(Effect.void)
        }

        const handleError = () => {
          managedRuntime.runFork(
            Effect.gen(function* () {
              yield* Fiber.interrupt(heartbeatFiber)
              yield* Fiber.interrupt(timeoutFiber)
              yield* Fiber.interrupt(authTimeoutFiber)
              const state = yield* Ref.get(stateRef)
              if (state.clientId) {
                yield* cleanupConnection({
                  clientId: state.clientId,
                  reason: "Connection error",
                  cleanupGuard,
                })
              }
            }),
          )
          resume(Effect.void)
        }

        // Register all handlers
        ws.on("message", handleMessage)
        ws.on("pong", handlePong)
        ws.on("close", handleClose)
        ws.on("error", handleError)

        // Return cleanup function to remove handlers on cancellation
        // This prevents memory leaks if the Effect is interrupted
        return Effect.sync(() => {
          ws.off("message", handleMessage)
          ws.off("pong", handlePong)
          ws.off("close", handleClose)
          ws.off("error", handleError)
        })
      })
    })

  // Wrapper that runs the connection effect in the shared runtime
  const handleConnectionWrapped = (ws: WebSocketLike): Effect.Effect<void> =>
    Effect.sync(() => {
      const admission = Effect.runSync(runtimeState.connectionAdmission)
      if (admission._tag !== "Accept") {
        rejectConnection(ws, admission)
        return
      }

      forkTracked(handleConnection(ws))
    })

  return {
    handleConnection: handleConnectionWrapped,

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
