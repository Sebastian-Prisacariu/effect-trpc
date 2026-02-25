/**
 * @module effect-trpc/ws/server/SubscriptionManager
 *
 * Service for managing active subscriptions.
 * Runs subscription handlers, tracks fibers, handles cleanup.
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as HashMap from "effect/HashMap"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as DateTimeType from "effect/DateTime"
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"

import type { ClientId, SubscriptionId } from "../types.js"
import { generateSubscriptionId } from "../types.js"
import {
  SubscriptionError,
  SubscriptionNotFoundError,
  InvalidPathError,
} from "../errors.js"
import {
  DataMessage,
  ErrorMessage,
  CompleteMessage,
} from "../protocol.js"
import type { Connection } from "./ConnectionRegistry.js"
import { ConnectionRegistry } from "./ConnectionRegistry.js"
import { BackpressureController } from "./BackpressureController.js"
import type {
  SubscriptionHandler,
  SubscriptionContext,
  UnsubscribeReason,
} from "../../core/procedures.js"
import { UnsubscribeReason as UnsubscribeReasonCtor } from "../../core/procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Active Subscription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents an active subscription.
 *
 * @since 0.1.0
 * @category Models
 */
export interface ActiveSubscription {
  /** Unique subscription ID */
  readonly id: SubscriptionId
  /** Client that owns this subscription */
  readonly clientId: ClientId
  /** Procedure path */
  readonly path: string
  /** Original input */
  readonly input: unknown
  /** When the subscription started */
  readonly startedAt: DateTimeType.Utc
  /** 
   * The running fiber, wrapped in Option to handle race conditions.
   * Initially None until the fiber is forked and assigned.
   * This prevents issues if unsubscribe is called before fork completes.
   */
  readonly fiber: Option.Option<Fiber.RuntimeFiber<void, SubscriptionError>>
  /** Queue for client messages (bidirectional) */
  readonly clientMessages: Queue.Queue<unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registered subscription handler with metadata.
 *
 * @remarks
 * Uses `Schema.Schema<any, any, never>` for schema fields because handlers
 * are registered dynamically from procedure definitions. The actual type
 * parameters are erased at this level, but the schemas are still used
 * correctly at runtime for validation. Using `any` for the first two
 * parameters avoids the need for type casts at each registration site,
 * while `never` for requirements ensures no unexpected dependencies.
 *
 * @since 0.1.0
 * @category Models
 */
export interface RegisteredHandler {
  readonly path: string
  readonly inputSchema: Schema.Schema<any, any, any> | undefined
  readonly outputSchema: Schema.Schema<any, any, any> | undefined
  readonly handler: SubscriptionHandler<unknown, unknown, unknown, never>
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum number of active subscriptions per client.
 * Prevents resource exhaustion from malicious clients.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const MAX_SUBSCRIPTIONS_PER_CLIENT = 100

/**
 * Maximum number of queued client messages per subscription.
 * Prevents memory exhaustion from message flooding.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const MAX_CLIENT_MESSAGE_QUEUE_SIZE = 1000

/**
 * Default timeout for subscription handler setup.
 * Prevents handlers from blocking indefinitely during initialization.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const DEFAULT_SUBSCRIPTION_SETUP_TIMEOUT = Duration.seconds(30)

// ─────────────────────────────────────────────────────────────────────────────
// Path Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid path format regex.
 * Paths must:
 * - Start with a letter
 * - Contain only alphanumeric characters, dots, and underscores
 * - Dots separate path segments (e.g., "user.notifications.watch")
 *
 * @since 0.1.0
 * @category Configuration
 */
export const PATH_REGEX = /^[a-zA-Z][a-zA-Z0-9_.]*$/

/**
 * Maximum path length.
 * Prevents excessively long paths that could cause performance issues.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const MAX_PATH_LENGTH = 256

/**
 * Validate a subscription path.
 *
 * Checks:
 * - Path is not empty
 * - Path does not exceed maximum length
 * - Path matches valid format (alphanumeric, dots, underscores, starts with letter)
 * - Path does not have leading/trailing dots
 * - Path does not have consecutive dots
 *
 * @since 0.1.0
 * @category Path Validation
 */
export const validatePath = (path: string): Effect.Effect<string, InvalidPathError> =>
  Effect.gen(function* () {
    // Check for empty path
    if (!path || path.length === 0) {
      return yield* Effect.fail(new InvalidPathError({ 
        path, 
        reason: "Path cannot be empty" 
      }))
    }

    // Check path length
    if (path.length > MAX_PATH_LENGTH) {
      return yield* Effect.fail(new InvalidPathError({ 
        path, 
        reason: `Path too long (max ${MAX_PATH_LENGTH} characters)` 
      }))
    }

    // Check for leading/trailing dots (slashes in path notation)
    if (path.startsWith(".") || path.endsWith(".")) {
      return yield* Effect.fail(new InvalidPathError({ 
        path, 
        reason: "Path cannot have leading or trailing dots" 
      }))
    }

    // Check for consecutive dots (empty segments)
    if (path.includes("..")) {
      return yield* Effect.fail(new InvalidPathError({ 
        path, 
        reason: "Path cannot have consecutive dots (empty segments)" 
      }))
    }

    // Check format with regex
    if (!PATH_REGEX.test(path)) {
      return yield* Effect.fail(new InvalidPathError({ 
        path, 
        reason: "Invalid path format. Use alphanumeric characters, dots, and underscores. Must start with a letter." 
      }))
    }

    return path
  })

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service for managing active subscriptions.
 *
 * @example
 * ```ts
 * import { SubscriptionManager, ConnectionRegistry } from 'effect-trpc/ws/server'
 *
 * const program = Effect.gen(function* () {
 *   const manager = yield* SubscriptionManager
 *   // ...
 * }).pipe(
 *   Effect.provide(SubscriptionManager.Live),
 *   Effect.provide(ConnectionRegistry.Live)
 * )
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class SubscriptionManager extends Context.Tag("@effect-trpc/SubscriptionManager")<
  SubscriptionManager,
  SubscriptionManager.Service
>() {
  /**
   * Default layer for SubscriptionManager.
   * Requires ConnectionRegistry.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<SubscriptionManager, never, ConnectionRegistry>
}

/**
 * @since 0.1.0
 */
export declare namespace SubscriptionManager {
  /**
   * The service interface for SubscriptionManager.
   *
   * @since 0.1.0
   * @category Models
   */
  export interface Service {
    /**
     * Register a subscription handler.
     * Called during router setup.
     */
    readonly registerHandler: (handler: RegisteredHandler) => Effect.Effect<void>

    /**
     * Start a new subscription for a client.
     * Returns the server-generated subscription ID.
     *
     * @param clientId - The client requesting the subscription
     * @param correlationId - Client-provided ID to correlate the response
     * @param path - Procedure path (e.g., "notifications.watch")
     * @param input - Procedure input
     * @returns Server-generated subscription ID
     */
    readonly subscribe: (
      clientId: ClientId,
      correlationId: string,
      path: string,
      input: unknown,
    ) => Effect.Effect<SubscriptionId, SubscriptionError, any>

    /**
     * Stop a subscription.
     */
    readonly unsubscribe: (
      clientId: ClientId,
      subscriptionId: SubscriptionId,
    ) => Effect.Effect<void>

    /**
     * Send a message from client to subscription (bidirectional).
     */
    readonly sendToSubscription: (
      clientId: ClientId,
      subscriptionId: SubscriptionId,
      data: unknown,
    ) => Effect.Effect<void, SubscriptionNotFoundError>

    /**
     * Get all subscriptions for a client.
     */
    readonly getClientSubscriptions: (
      clientId: ClientId,
    ) => Effect.Effect<ReadonlyArray<ActiveSubscription>>

    /**
     * Clean up all subscriptions for a client.
     * Called when client disconnects.
     */
    readonly cleanupClient: (clientId: ClientId) => Effect.Effect<void>

    /**
     * Get total active subscription count.
     */
    readonly count: Effect.Effect<number>

    /**
     * Get subscription by ID.
     */
    readonly get: (
      subscriptionId: SubscriptionId,
    ) => Effect.Effect<ActiveSubscription, SubscriptionNotFoundError>

    /**
     * Clean up all subscriptions.
     * Called when shutting down the server.
     */
    readonly cleanupAll: Effect.Effect<void>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the subscription manager implementation.
 */
const makeSubscriptionManager = Effect.gen(function* () {
  const registry = yield* ConnectionRegistry

  // Optional backpressure controller
  const backpressure = yield* Effect.serviceOption(BackpressureController)

  // Registered handlers by path
  const handlers = yield* Ref.make(HashMap.empty<string, RegisteredHandler>())

  // Active subscriptions by ID
  const subscriptions = yield* Ref.make(
    HashMap.empty<SubscriptionId, ActiveSubscription>(),
  )

  /**
   * Run a subscription handler in a fiber.
   */
  const runSubscription = (
    connection: Connection,
    subscriptionId: SubscriptionId,
    handler: RegisteredHandler,
    input: unknown,
    clientMessages: Queue.Queue<unknown>,
  ): Effect.Effect<void, SubscriptionError, any> =>
    Effect.gen(function* () {
      // Create subscription context
      const ctx: SubscriptionContext = {
        subscriptionId,
        clientId: connection.clientId,
        userId: connection.auth.userId,
        metadata: connection.auth.metadata,
        path: handler.path,
      }

      // Validate input if schema provided
      const validatedInput = handler.inputSchema
        ? yield* Schema.decodeUnknown(handler.inputSchema)(input).pipe(
            Effect.mapError(
              (cause) =>
                new SubscriptionError({
                  subscriptionId,
                  path: handler.path,
                  reason: "InputValidation",
                  description: "Invalid subscription input",
                  cause,
                }),
            ),
          )
        : input

      // Call onSubscribe to get the stream (with timeout to prevent indefinite blocking)
      const stream = yield* Effect.suspend(() => handler.handler.onSubscribe(validatedInput, ctx)).pipe(
        Effect.timeoutFail({
          duration: DEFAULT_SUBSCRIPTION_SETUP_TIMEOUT,
          onTimeout: () =>
            new SubscriptionError({
              subscriptionId,
              path: handler.path,
              reason: "SetupTimeout",
              description: `Subscription handler setup timed out after ${Duration.toMillis(DEFAULT_SUBSCRIPTION_SETUP_TIMEOUT)}ms`,
            }),
        }),
        Effect.mapError(
          (cause) =>
            cause instanceof SubscriptionError
              ? cause
              : new SubscriptionError({
                  subscriptionId,
                  path: handler.path,
                  reason: "HandlerError",
                  description: "Handler setup failed",
                  cause,
                }),
        ),
        Effect.catchAllDefect((defect) => Effect.logError("Subscription handler defect", { subscriptionId, path: handler.path, defect }).pipe(Effect.flatMap(() => Effect.fail(
            new SubscriptionError({
              subscriptionId,
              path: handler.path,
              reason: "HandlerError",
              description: "Handler setup failed",
              cause: defect,
            })))))
      )

      // Set up client message handler if provided
      // Store in a Ref so we can access it in the cleanup
      const clientMessageFiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null)

      if (handler.handler.onClientMessage) {
        const fiber = yield* Effect.fork(
          Stream.fromQueue(clientMessages).pipe(
            Stream.tap((data) =>
              handler.handler.onClientMessage!(data, ctx).pipe(
                Effect.catchAllCause((cause) =>
                  Effect.logWarning("onClientMessage handler failed", { cause, path: handler.path }),
                ),
              ),
            ),
            Stream.runDrain,
          ),
        )
        yield* Ref.set(clientMessageFiberRef, fiber)
      }

      // Helper to cleanup the client message fiber
      const cleanupClientMessageFiber = Effect.gen(function* () {
        const fiber = yield* Ref.get(clientMessageFiberRef)
        if (fiber) {
          yield* Fiber.interrupt(fiber)
        }
      })

      // Run the main subscription logic with cleanup on exit
      yield* Effect.gen(function* () {
        // Run the stream, sending data to client
        let reason: UnsubscribeReason = UnsubscribeReasonCtor.StreamCompleted
        let streamError: unknown = undefined

        yield* stream.pipe(
          Stream.tap((data) =>
            Effect.gen(function* () {
              // Validate output if schema provided
              let outputData = data
              if (handler.outputSchema) {
                outputData = yield* Schema.decodeUnknown(handler.outputSchema)(data).pipe(
                  Effect.mapError(
                    (cause) =>
                      new SubscriptionError({
                        subscriptionId,
                        path: handler.path,
                        reason: "OutputValidation",
                        description: "Invalid subscription output",
                        cause,
                      }),
                  ),
                )
              }

              // Send to client
              yield* connection.send(
                new DataMessage({ id: subscriptionId, data: outputData }),
              )
            }),
          ),
          Stream.runDrain,
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              reason = UnsubscribeReasonCtor.StreamErrored(cause)
              streamError = cause
            }),
          ),
        )

        // Send completion or error
        if (streamError !== undefined) {
          yield* connection.send(
            new ErrorMessage({
              id: subscriptionId,
              error: {
                _tag: "StreamError",
                message: "Subscription stream errored",
                cause: streamError,
              },
            }),
          )
        } else {
          yield* connection.send(new CompleteMessage({ id: subscriptionId }))
        }

        // Call onUnsubscribe if provided
        if (handler.handler.onUnsubscribe) {
          yield* handler.handler.onUnsubscribe(ctx, reason).pipe(Effect.ignore)
        }
      }).pipe(Effect.ensuring(cleanupClientMessageFiber), Effect.catchAllDefect((defect) => Effect.logError("Subscription fiber defect", { defect })))
    })

  const service: SubscriptionManager.Service = {
    registerHandler: Effect.fn("SubscriptionManager.registerHandler")(
      function* (handler: RegisteredHandler) {
        yield* Effect.annotateCurrentSpan("path", handler.path)
        yield* Ref.update(handlers, HashMap.set(handler.path, handler))
      },
    ),

    subscribe: Effect.fn("SubscriptionManager.subscribe")(
      function* (clientId: ClientId, correlationId: string, path: string, input: unknown) {
        yield* Effect.annotateCurrentSpan("clientId", clientId)
        yield* Effect.annotateCurrentSpan("correlationId", correlationId)
        yield* Effect.annotateCurrentSpan("path", path)

        // Validate path format FIRST (before any resource allocation)
        // This prevents malformed paths from consuming server resources
        const validatedPath = yield* validatePath(path).pipe(
          Effect.mapError((err) =>
            new SubscriptionError({
              subscriptionId: "pending", // No ID yet since validation failed early
              path: err.path,
              reason: "InputValidation",
              description: err.reason,
            }),
          ),
        )

        // Generate server-side subscription ID (security: never trust client IDs)
        const subscriptionId = yield* generateSubscriptionId

        // Check per-client subscription limit to prevent resource exhaustion
        const currentSubscriptions = yield* Ref.get(subscriptions)
        const clientSubCount = Array.from(HashMap.values(currentSubscriptions))
          .filter((s) => s.clientId === clientId).length
        
        if (clientSubCount >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
          return yield* Effect.fail(
            new SubscriptionError({
              subscriptionId,
              path: validatedPath,
              reason: "Unauthorized",
              description: `Maximum subscriptions per client (${MAX_SUBSCRIPTIONS_PER_CLIENT}) exceeded`,
            }),
          )
        }

        // Get handler - validates that the procedure exists
        const handlerMap = yield* Ref.get(handlers)
        const handler = HashMap.get(handlerMap, validatedPath)

        if (Option.isNone(handler)) {
          return yield* Effect.fail(
            new SubscriptionError({
              subscriptionId,
              path: validatedPath,
              reason: "NotFound",
              description: `No handler registered for path: ${validatedPath}`,
            }),
          )
        }

        // Get connection
        const connection = yield* registry.get(clientId).pipe(
          Effect.mapError(
            () =>
              new SubscriptionError({
                subscriptionId,
                path: validatedPath,
                reason: "NotFound",
                description: "Client connection not found",
              }),
          ),
        )

        // Create bounded client messages queue to prevent memory exhaustion
        const clientMessages = yield* Queue.bounded<unknown>(MAX_CLIENT_MESSAGE_QUEUE_SIZE)

        // Register with backpressure controller if available
        if (Option.isSome(backpressure)) {
          yield* backpressure.value.register(subscriptionId, clientId, connection)
        }

        // Store active subscription FIRST to prevent race condition
        // (fiber cleanup referencing non-existent subscription)
        // Fiber starts as None and is set after fork completes
        const startedAt = yield* DateTime.now
        const active: ActiveSubscription = {
          id: subscriptionId,
          clientId,
          path: validatedPath,
          input,
          startedAt,
          fiber: Option.none(), // Will be set after fork
          clientMessages,
        }

        yield* Ref.update(subscriptions, HashMap.set(subscriptionId, active))

        // Fork the subscription runner as a daemon so it survives the parent message handler
        // (the parent Effect from handleMessage completes after sending Subscribed, but the
        // subscription stream needs to keep running independently)
        const fiber = yield* Effect.forkDaemon(
          runSubscription(
            connection,
            subscriptionId,
            handler.value,
            input,
            clientMessages,
          ).pipe(
            Effect.ensuring(
              // Clean up on completion (including backpressure state)
              Effect.all([
                Ref.update(subscriptions, HashMap.remove(subscriptionId)),
                Option.isSome(backpressure)
                  ? backpressure.value.unregister(subscriptionId)
                  : Effect.void,
              ]),
            ),
            Effect.catchAll((error) =>
              // Send error to client
              connection.send(
                new ErrorMessage({
                  id: subscriptionId,
                  error: {
                    _tag: error._tag,
                    message: error.message,
                    cause: error.cause,
                  },
                }),
              ),
            ),
          ),
        )

        // Update subscription with real fiber reference (now wrapped in Option.some)
        const updatedActive: ActiveSubscription = { ...active, fiber: Option.some(fiber) }
        yield* Ref.update(subscriptions, HashMap.set(subscriptionId, updatedActive))

        return subscriptionId
      },
    ),

    unsubscribe: Effect.fn("SubscriptionManager.unsubscribe")(
      function* (clientId: ClientId, subscriptionId: SubscriptionId) {
        yield* Effect.annotateCurrentSpan("clientId", clientId)
        yield* Effect.annotateCurrentSpan("subscriptionId", subscriptionId)

        // Atomic read-and-remove to prevent race conditions
        const removedSub = yield* Ref.modify(subscriptions, (map) => {
          const sub = HashMap.get(map, subscriptionId)
          if (Option.isSome(sub) && sub.value.clientId === clientId) {
            return [sub, HashMap.remove(map, subscriptionId)] as const
          }
          return [Option.none<ActiveSubscription>(), map] as const
        })

        // Clean up the removed subscription (if any) outside the atomic operation
        if (Option.isSome(removedSub)) {
          // Only interrupt if fiber was set (handles race where unsubscribe called before fork completed)
          if (Option.isSome(removedSub.value.fiber)) {
            yield* Fiber.interrupt(removedSub.value.fiber.value)
          }
          yield* Queue.shutdown(removedSub.value.clientMessages)
          // Unregister from backpressure controller
          if (Option.isSome(backpressure)) {
            yield* backpressure.value.unregister(subscriptionId)
          }
        }
      },
    ),

    sendToSubscription: Effect.fn("SubscriptionManager.sendToSubscription")(
      function* (clientId: ClientId, subscriptionId: SubscriptionId, data: unknown) {
        yield* Effect.annotateCurrentSpan("clientId", clientId)
        yield* Effect.annotateCurrentSpan("subscriptionId", subscriptionId)

        const map = yield* Ref.get(subscriptions)
        const sub = HashMap.get(map, subscriptionId)

        if (Option.isNone(sub)) {
          return yield* Effect.fail(
            new SubscriptionNotFoundError({ subscriptionId }),
          )
        }

        if (sub.value.clientId !== clientId) {
          return yield* Effect.fail(
            new SubscriptionNotFoundError({ subscriptionId, clientId }),
          )
        }

        // Get current queue size for backpressure monitoring
        const currentSize = yield* Queue.size(sub.value.clientMessages)

        // Record queue state with backpressure controller (if available)
        // This may send Pause/Resume signals to the client
        if (Option.isSome(backpressure)) {
          yield* backpressure.value.recordQueueState(
            subscriptionId,
            currentSize,
            MAX_CLIENT_MESSAGE_QUEUE_SIZE,
          )
        }

        yield* Queue.offer(sub.value.clientMessages, data)
      },
    ),

    getClientSubscriptions: (clientId: ClientId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(subscriptions)
        return Array.from(HashMap.values(map)).filter(
          (s) => s.clientId === clientId,
        )
      }),

    cleanupClient: Effect.fn("SubscriptionManager.cleanupClient")(
      function* (clientId: ClientId) {
        yield* Effect.annotateCurrentSpan("clientId", clientId)

        // Atomic read-and-remove to prevent race conditions with concurrent subscribe
        const clientSubs = yield* Ref.modify(subscriptions, (map) => {
          const toRemove = Array.from(HashMap.values(map)).filter(
            (s) => s.clientId === clientId,
          )
          const newMap = toRemove.reduce(
            (acc, sub) => HashMap.remove(acc, sub.id),
            map,
          )
          return [toRemove, newMap] as const
        })

        // Clean up removed subscriptions outside the atomic operation
        yield* Effect.forEach(
          clientSubs,
          (sub) =>
            Effect.all([
              // Only interrupt if fiber was set (handles race where cleanup called before fork completed)
              Option.isSome(sub.fiber)
                ? Fiber.interrupt(sub.fiber.value)
                : Effect.void,
              Queue.shutdown(sub.clientMessages),
            ]),
          { concurrency: "unbounded", discard: true },
        )

        // Clean up backpressure state for the client
        if (Option.isSome(backpressure)) {
          yield* backpressure.value.cleanupClient(clientId)
        }
      },
    ),

    count: Effect.gen(function* () {
      const map = yield* Ref.get(subscriptions)
      return HashMap.size(map)
    }),

    get: (subscriptionId: SubscriptionId) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(subscriptions)
        const sub = HashMap.get(map, subscriptionId)

        if (Option.isNone(sub)) {
          return yield* Effect.fail(
            new SubscriptionNotFoundError({ subscriptionId }),
          )
        }

        return sub.value
      }),

    /**
     * Clean up all subscriptions.
     * Called automatically when the ManagedRuntime is disposed.
     */
    cleanupAll: Effect.gen(function* () {
      const map = yield* Ref.get(subscriptions)
      const allSubs = Array.from(HashMap.values(map))

      // Interrupt all fibers and shutdown all queues
      yield* Effect.forEach(
        allSubs,
        (sub) =>
          Effect.all([
            // Only interrupt if fiber was set (handles race where cleanup called before fork completed)
            Option.isSome(sub.fiber)
              ? Fiber.interrupt(sub.fiber.value)
              : Effect.void,
            Queue.shutdown(sub.clientMessages),
          ]),
        { concurrency: "unbounded", discard: true },
      )

      // Clear the map
      yield* Ref.set(subscriptions, HashMap.empty())
    }),
  }

  return service
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default Layer for subscription manager.
 * Requires ConnectionRegistry.
 *
 * @since 0.1.0
 * @category Layers
 */
export const SubscriptionManagerLive: Layer.Layer<
  SubscriptionManager,
  never,
  ConnectionRegistry
> = Layer.effect(SubscriptionManager, makeSubscriptionManager)

// Assign static property after layer is defined
SubscriptionManager.Live = SubscriptionManagerLive
