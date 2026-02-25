/**
 * @module effect-trpc/ws/client/SubscriptionRegistry
 *
 * Service for tracking client-side subscriptions.
 * Routes incoming messages to the correct subscription handlers.
 */

import * as Context from "effect/Context"
import type * as DateTimeType from "effect/DateTime"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"

import { pipe } from "effect"
import { SubscriptionNotFoundError } from "../errors.js"
import type { FromServerMessage } from "../protocol.js"
import type { SubscriptionId } from "../types.js"
import { generateSubscriptionId } from "../types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Subscription State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client-side subscription state.
 *
 * @since 0.1.0
 * @category models
 */
export type SubscriptionState =
  | { readonly _tag: "Subscribing" }
  | { readonly _tag: "Active"; readonly subscribedAt: DateTimeType.Utc }
  | { readonly _tag: "Error"; readonly error: unknown }
  | { readonly _tag: "Complete" }
  | { readonly _tag: "Unsubscribed" }

/**
 * SubscriptionState constructors.
 *
 * @since 0.1.0
 * @category constructors
 */
export const SubscriptionState = {
  Subscribing: { _tag: "Subscribing" } as SubscriptionState,
  Active: (subscribedAt: DateTimeType.Utc): SubscriptionState => ({
    _tag: "Active",
    subscribedAt,
  }),
  Error: (error: unknown): SubscriptionState => ({
    _tag: "Error",
    error,
  }),
  Complete: { _tag: "Complete" } as SubscriptionState,
  Unsubscribed: { _tag: "Unsubscribed" } as SubscriptionState,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Active Subscription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a client-side active subscription.
 *
 * @since 0.1.0
 * @category models
 */
export interface ClientSubscription<A = unknown> {
  /** Unique subscription ID (client correlation ID) */
  readonly id: SubscriptionId
  /** Server-generated subscription ID (available after Subscribed) */
  readonly serverId: SubscriptionId | undefined
  /** Procedure path */
  readonly path: string
  /** Original input for resubscription */
  readonly input: unknown
  /** Current state */
  readonly state: SubscriptionState
  /** Queue for incoming subscription events */
  readonly dataQueue: Queue.Queue<SubscriptionEvent<A>>
  /** When the subscription was created */
  readonly createdAt: DateTimeType.Utc
  /** Ref to track consumer fiber for cleanup */
  readonly consumerFiberRef: Ref.Ref<Fiber.RuntimeFiber<void, unknown> | null>
  /**
   * Whether this subscription is under backpressure.
   * When true, the client should pause sending data to the server.
   * @since 0.1.0
   */
  readonly isPaused: boolean
  /**
   * Last queue fill percentage reported by server (0-100).
   * @since 0.1.0
   */
  readonly lastQueueFillPercent: number
}

/**
 * Events that can be pushed to a subscription's data queue.
 *
 * @since 0.1.0
 * @category models
 */
export type SubscriptionEvent<A = unknown> =
  | { readonly _tag: "Subscribed" }
  | { readonly _tag: "Data"; readonly data: A }
  | { readonly _tag: "ServerData"; readonly data: A }
  | { readonly _tag: "Error"; readonly error: unknown }
  | { readonly _tag: "Complete" }

/**
 * SubscriptionEvent constructors.
 *
 * @since 0.1.0
 * @category constructors
 */
export const SubscriptionEvent = {
  Subscribed: { _tag: "Subscribed" } as SubscriptionEvent<never>,
  Data: <A>(data: A): SubscriptionEvent<A> => ({ _tag: "Data", data }),
  ServerData: <A>(data: A): SubscriptionEvent<A> => ({
    _tag: "ServerData",
    data,
  }),
  Error: (error: unknown): SubscriptionEvent<never> => ({ _tag: "Error", error }),
  Complete: { _tag: "Complete" } as SubscriptionEvent<never>,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callback for backpressure state changes.
 * Called when receiving Pause/Resume from server.
 * The client should send BackpressureAck in response.
 *
 * @since 0.1.0
 * @category models
 */
export type BackpressureCallback = (
  subscriptionId: SubscriptionId,
  paused: boolean,
) => Effect.Effect<void>

/**
 * Service interface for client subscription registry.
 *
 * @since 0.1.0
 * @category services
 */
export interface SubscriptionRegistryShape {
  /**
   * Create a new subscription.
   * Returns the subscription ID and a stream of data.
   */
  readonly create: <A>(
    path: string,
    input: unknown,
  ) => Effect.Effect<{
    readonly id: SubscriptionId
    readonly stream: Stream.Stream<A, unknown>
  }>

  /**
   * Route an incoming server message to the correct subscription.
   */
  readonly routeMessage: (message: FromServerMessage) => Effect.Effect<void>

  /**
   * Get a subscription by ID.
   */
  readonly get: (id: SubscriptionId) => Effect.Effect<ClientSubscription, SubscriptionNotFoundError>

  /**
   * Remove a subscription (called when unsubscribing or complete).
   */
  readonly remove: (id: SubscriptionId) => Effect.Effect<void>

  /**
   * Update the input for a subscription.
   * This ensures resubscription after reconnection uses the latest input.
   *
   * @since 0.1.0
   */
  readonly updateInput: (id: SubscriptionId, input: unknown) => Effect.Effect<void>

  /**
   * Get all active subscriptions (for resubscription on reconnect).
   */
  readonly getAll: Effect.Effect<ReadonlyArray<ClientSubscription>>

  /**
   * Get subscription count.
   */
  readonly count: Effect.Effect<number>

  /**
   * Clear all subscriptions.
   */
  readonly clear: Effect.Effect<void>

  /**
   * Check if a subscription is currently paused due to backpressure.
   *
   * @since 0.1.0
   */
  readonly isPaused: (id: SubscriptionId) => Effect.Effect<boolean>

  /**
   * Set the callback for backpressure state changes.
   * The callback is invoked when Pause/Resume messages are received.
   *
   * @since 0.1.0
   */
  readonly setBackpressureCallback: (callback: BackpressureCallback | null) => Effect.Effect<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context tag for SubscriptionRegistry service.
 *
 * @example
 * ```ts
 * import { SubscriptionRegistry } from 'effect-trpc/ws/client'
 *
 * const program = Effect.gen(function* () {
 *   const registry = yield* SubscriptionRegistry
 *   // ...
 * }).pipe(Effect.provide(SubscriptionRegistry.Live))
 * ```
 *
 * @since 0.1.0
 * @category tags
 */
export class SubscriptionRegistry extends Context.Tag("@effect-trpc/SubscriptionRegistry")<
  SubscriptionRegistry,
  SubscriptionRegistryShape
>() {
  /**
   * Default layer for subscription registry.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<SubscriptionRegistry>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the subscription registry implementation.
 */
const makeSubscriptionRegistry = Effect.gen(function* () {
  // Active subscriptions by ID
  const subscriptions = yield* Ref.make(HashMap.empty<SubscriptionId, ClientSubscription>())

  // Callback for backpressure state changes
  const backpressureCallbackRef = yield* Ref.make<BackpressureCallback | null>(null)

  const service: SubscriptionRegistryShape = {
    create: <A>(path: string, input: unknown) =>
      Effect.gen(function* () {
        const id = yield* generateSubscriptionId
        const createdAt = yield* DateTime.now
        // Use sliding bounded queue to prevent memory accumulation on slow consumers
        // 1000 messages max per subscription, drops oldest when full
        const dataQueue = yield* Queue.sliding<SubscriptionEvent<A>>(1000)

        // Create fiber ref BEFORE subscription so it can be stored
        const consumerFiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, unknown> | null>(null)

        const subscription: ClientSubscription<A> = {
          id,
          serverId: undefined,
          path,
          input,
          state: SubscriptionState.Subscribing,
          dataQueue,
          createdAt,
          consumerFiberRef,
          isPaused: false,
          lastQueueFillPercent: 0,
        }

        yield* Ref.update(subscriptions, HashMap.set(id, subscription as ClientSubscription))

        const isTerminalSubscriptionEvent = (event: SubscriptionEvent<A>): boolean =>
          Predicate.isTagged(event, "Error") || Predicate.isTagged(event, "Complete")

        // Create stream from queue and map control events to stream behavior
        const stream: Stream.Stream<A, unknown> = pipe(
          Stream.fromQueue(dataQueue),
          Stream.takeUntil(isTerminalSubscriptionEvent),
          Stream.flatMap((event) => {
            switch (event._tag) {
              case "Data":
              case "ServerData":
                return Stream.succeed(event.data)
              case "Error":
                return Stream.fail(event.error)
              case "Subscribed":
              case "Complete":
                return Stream.empty
            }
          }),
        )

        return { id, stream }
      }).pipe(Effect.withSpan("SubscriptionRegistry.create", { attributes: { path } })),

    routeMessage: (message) =>
      Effect.gen(function* () {
        // Only handle subscription-related messages
        if (
          message._tag !== "Subscribed" &&
          message._tag !== "Data" &&
          message._tag !== "ServerData" &&
          message._tag !== "Error" &&
          message._tag !== "Complete" &&
          message._tag !== "Pause" &&
          message._tag !== "Resume"
        ) {
          return
        }

        const id = message.id as SubscriptionId
        const map = yield* Ref.get(subscriptions)

        let sub = HashMap.get(map, id)
        if (Option.isNone(sub)) {
          // Try finding by serverId
          const found = Array.from(HashMap.values(map)).find((s) => s.serverId === id)
          if (found) {
            sub = Option.some(found)
          }
        }

        if (Option.isNone(sub)) {
          // Subscription not found, ignore
          return
        }

        const subscription = sub.value
        // Use the original client ID for map updates
        const clientId = subscription.id

        if (message._tag === "Subscribed") {
          // Update state to active
          const subscribedAt = yield* DateTime.now
          yield* Ref.update(
            subscriptions,
            HashMap.set(clientId, {
              ...subscription,
              serverId: message.subscriptionId as SubscriptionId,
              state: SubscriptionState.Active(subscribedAt),
            } as ClientSubscription),
          )
          yield* Queue.offer(subscription.dataQueue, SubscriptionEvent.Subscribed)
        } else if (message._tag === "Data") {
          yield* Queue.offer(subscription.dataQueue, SubscriptionEvent.Data(message.data))
        } else if (message._tag === "ServerData") {
          yield* Queue.offer(subscription.dataQueue, SubscriptionEvent.ServerData(message.data))
        } else if (message._tag === "Error") {
          // Update state and push error
          yield* Ref.update(
            subscriptions,
            HashMap.set(clientId, {
              ...subscription,
              state: SubscriptionState.Error(message.error),
            } as ClientSubscription),
          )
          yield* Queue.offer(subscription.dataQueue, SubscriptionEvent.Error(message.error))
        } else if (message._tag === "Complete") {
          // Update state and offer complete event
          // Don't shutdown queue here - let the stream handle it via takeUntil
          yield* Ref.update(
            subscriptions,
            HashMap.set(clientId, {
              ...subscription,
              state: SubscriptionState.Complete,
            } as ClientSubscription),
          )
          yield* Queue.offer(subscription.dataQueue, SubscriptionEvent.Complete)
        } else if (message._tag === "Pause") {
          // Server is telling us to slow down sending data
          yield* Ref.update(
            subscriptions,
            HashMap.set(clientId, {
              ...subscription,
              isPaused: true,
              lastQueueFillPercent: message.queueFillPercent,
            } as ClientSubscription),
          )
          // Invoke callback to send BackpressureAck
          const callback = yield* Ref.get(backpressureCallbackRef)
          if (callback) {
            yield* callback(clientId, true).pipe(Effect.ignore)
          }
        } else if (message._tag === "Resume") {
          // Server says we can resume sending data
          yield* Ref.update(
            subscriptions,
            HashMap.set(clientId, {
              ...subscription,
              isPaused: false,
              lastQueueFillPercent: 0,
            } as ClientSubscription),
          )
          // Invoke callback to send BackpressureAck
          const callback = yield* Ref.get(backpressureCallbackRef)
          if (callback) {
            yield* callback(clientId, false).pipe(Effect.ignore)
          }
        }
      }).pipe(
        Effect.withSpan("SubscriptionRegistry.routeMessage", {
          attributes: { messageTag: message._tag },
        }),
      ),

    get: (id) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(subscriptions)
        const sub = HashMap.get(map, id)

        if (Option.isNone(sub)) {
          return yield* Effect.fail(new SubscriptionNotFoundError({ subscriptionId: id }))
        }

        return sub.value
      }).pipe(Effect.withSpan("SubscriptionRegistry.get", { attributes: { subscriptionId: id } })),

    remove: (id) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(subscriptions)
        const sub = HashMap.get(map, id)

        if (Option.isSome(sub)) {
          // Interrupt the consumer fiber to prevent memory leak
          const fiber = yield* Ref.get(sub.value.consumerFiberRef)
          if (fiber) {
            yield* Fiber.interrupt(fiber)
          }
          yield* Queue.shutdown(sub.value.dataQueue)
          yield* Ref.update(subscriptions, HashMap.remove(id))
        }
      }).pipe(
        Effect.withSpan("SubscriptionRegistry.remove", { attributes: { subscriptionId: id } }),
      ),

    updateInput: (id, input) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(subscriptions)
        const sub = HashMap.get(map, id)

        if (Option.isSome(sub)) {
          yield* Ref.update(
            subscriptions,
            HashMap.set(id, {
              ...sub.value,
              input,
            } as ClientSubscription),
          )
        }
      }).pipe(
        Effect.withSpan("SubscriptionRegistry.updateInput", { attributes: { subscriptionId: id } }),
      ),

    getAll: Effect.gen(function* () {
      const map = yield* Ref.get(subscriptions)
      return Array.from(HashMap.values(map))
    }).pipe(Effect.withSpan("SubscriptionRegistry.getAll")),

    count: Effect.gen(function* () {
      const map = yield* Ref.get(subscriptions)
      return HashMap.size(map)
    }).pipe(Effect.withSpan("SubscriptionRegistry.count")),

    clear: Effect.gen(function* () {
      const map = yield* Ref.get(subscriptions)

      // Interrupt all consumer fibers and shutdown queues
      yield* Effect.forEach(
        HashMap.values(map),
        (sub) =>
          Effect.gen(function* () {
            // Interrupt consumer fiber if running
            const fiber = yield* Ref.get(sub.consumerFiberRef)
            if (fiber) {
              yield* Fiber.interrupt(fiber)
            }
            // Shutdown the queue
            yield* Queue.shutdown(sub.dataQueue)
          }),
        { concurrency: "unbounded", discard: true },
      )

      yield* Ref.set(subscriptions, HashMap.empty())
    }).pipe(Effect.withSpan("SubscriptionRegistry.clear")),

    isPaused: (id) =>
      Effect.gen(function* () {
        const map = yield* Ref.get(subscriptions)
        const sub = HashMap.get(map, id)
        if (Option.isNone(sub)) {
          return false
        }
        return sub.value.isPaused
      }).pipe(
        Effect.withSpan("SubscriptionRegistry.isPaused", { attributes: { subscriptionId: id } }),
      ),

    setBackpressureCallback: (callback) => Ref.set(backpressureCallbackRef, callback),
  }

  return service
})

// ─────────────────────────────────────────────────────────────────────────────
// Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default layer for subscription registry.
 *
 * @since 0.1.0
 * @category layers
 */
export const SubscriptionRegistryLive: Layer.Layer<SubscriptionRegistry> = Layer.effect(
  SubscriptionRegistry,
  makeSubscriptionRegistry,
)

// Assign static property after layer is defined
SubscriptionRegistry.Live = SubscriptionRegistryLive
