/**
 * @module effect-trpc/ws/server/WebSocketMetrics
 *
 * Metrics collection for WebSocket server monitoring.
 * Uses Effect's Metric module for observability.
 *
 * @example
 * ```ts
 * import { WebSocketMetrics } from 'effect-trpc/ws/server'
 * import * as Metric from 'effect/Metric'
 *
 * // Access metrics for monitoring
 * const program = Effect.gen(function* () {
 *   const metrics = yield* WebSocketMetrics
 *   
 *   // Increment counters manually if needed
 *   yield* metrics.messageReceived()
 *   yield* metrics.messageSent()
 *   
 *   // Get current gauge values
 *   const connections = yield* Metric.value(WebSocketMetrics.activeConnections)
 *   const subscriptions = yield* Metric.value(WebSocketMetrics.activeSubscriptions)
 * })
 * ```
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Metric from "effect/Metric"
import * as Ref from "effect/Ref"

// ─────────────────────────────────────────────────────────────────────────────
// Metric Prefix
// ─────────────────────────────────────────────────────────────────────────────

const METRIC_PREFIX = "effect_trpc_ws"

// ─────────────────────────────────────────────────────────────────────────────
// Metric Instances
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gauge: Number of active WebSocket connections.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const activeConnections = Metric.gauge(`${METRIC_PREFIX}_connections_active`, {
  description: "Number of active WebSocket connections",
})

/**
 * Gauge: Number of active subscriptions.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const activeSubscriptions = Metric.gauge(`${METRIC_PREFIX}_subscriptions_active`, {
  description: "Number of active subscriptions",
})

/**
 * Counter: Total messages received from clients.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const messagesReceived = Metric.counter(`${METRIC_PREFIX}_messages_received_total`, {
  description: "Total messages received from clients",
})

/**
 * Counter: Total messages sent to clients.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const messagesSent = Metric.counter(`${METRIC_PREFIX}_messages_sent_total`, {
  description: "Total messages sent to clients",
})

/**
 * Counter: Total subscriptions created.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const subscriptionsCreated = Metric.counter(`${METRIC_PREFIX}_subscriptions_created_total`, {
  description: "Total subscriptions created",
})

/**
 * Counter: Total subscriptions completed successfully.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const subscriptionsCompleted = Metric.counter(`${METRIC_PREFIX}_subscriptions_completed_total`, {
  description: "Total subscriptions completed successfully",
})

/**
 * Counter: Total subscriptions failed with errors.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const subscriptionsErrored = Metric.counter(`${METRIC_PREFIX}_subscriptions_errored_total`, {
  description: "Total subscriptions failed with errors",
})

/**
 * Counter: Total connections established.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const connectionsOpened = Metric.counter(`${METRIC_PREFIX}_connections_opened_total`, {
  description: "Total connections established",
})

/**
 * Counter: Total connections closed.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const connectionsClosed = Metric.counter(`${METRIC_PREFIX}_connections_closed_total`, {
  description: "Total connections closed",
})

/**
 * Counter: Total authentication failures.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const authFailures = Metric.counter(`${METRIC_PREFIX}_auth_failures_total`, {
  description: "Total authentication failures",
})

/**
 * Counter: Total broadcast messages sent.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const broadcastsSent = Metric.counter(`${METRIC_PREFIX}_broadcasts_sent_total`, {
  description: "Total broadcast messages sent",
})

/**
 * Counter: Total broadcast failures.
 *
 * @since 0.1.0
 * @category Metrics
 */
export const broadcastFailures = Metric.counter(`${METRIC_PREFIX}_broadcast_failures_total`, {
  description: "Total broadcast failures",
})

// ─────────────────────────────────────────────────────────────────────────────
// Service Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for WebSocket metrics collection.
 *
 * @since 0.1.0
 * @category Models
 */
export interface WebSocketMetricsService {
  /**
   * Record a new connection opened.
   * Increments both the counter and gauge.
   */
  readonly connectionOpened: Effect.Effect<void>

  /**
   * Record a connection closed.
   * Increments the counter and decrements the gauge.
   */
  readonly connectionClosed: Effect.Effect<void>

  /**
   * Record a subscription created.
   * Increments both the counter and gauge.
   */
  readonly subscriptionCreated: Effect.Effect<void>

  /**
   * Record a subscription completed successfully.
   * Increments the counter and decrements the gauge.
   */
  readonly subscriptionCompleted: Effect.Effect<void>

  /**
   * Record a subscription failed with error.
   * Increments the counter and decrements the gauge.
   */
  readonly subscriptionErrored: Effect.Effect<void>

  /**
   * Record a message received from a client.
   */
  readonly messageReceived: Effect.Effect<void>

  /**
   * Record a message sent to a client.
   */
  readonly messageSent: Effect.Effect<void>

  /**
   * Record an authentication failure.
   */
  readonly authFailed: Effect.Effect<void>

  /**
   * Record a successful broadcast.
   * @param sent - Number of clients that received the message
   */
  readonly broadcastSent: (sent: number) => Effect.Effect<void>

  /**
   * Record broadcast failures.
   * @param failed - Number of clients that failed to receive
   */
  readonly broadcastFailed: (failed: number) => Effect.Effect<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service for collecting WebSocket metrics.
 *
 * @example
 * ```ts
 * import { WebSocketMetrics } from 'effect-trpc/ws/server'
 *
 * const program = Effect.gen(function* () {
 *   const metrics = yield* WebSocketMetrics
 *   yield* metrics.connectionOpened
 *   // ... later
 *   yield* metrics.connectionClosed
 * }).pipe(Effect.provide(WebSocketMetrics.Live))
 *
 * // Or use the no-op layer for testing
 * const testProgram = program.pipe(Effect.provide(WebSocketMetrics.Disabled))
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class WebSocketMetrics extends Context.Tag("@effect-trpc/WebSocketMetrics")<
  WebSocketMetrics,
  WebSocketMetricsService
>() {
  /**
   * Live layer that collects metrics.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<WebSocketMetrics>

  /**
   * No-op layer for testing or when metrics are disabled.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Disabled: Layer.Layer<WebSocketMetrics>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely decrement a gauge, preventing negative values.
 * Logs a warning if a decrement is attempted when the count is already zero.
 *
 * @internal
 */
const safeDecrementGauge = (
  countRef: Ref.Ref<number>,
  gauge: Metric.Metric.Gauge<number>,
  metricName: string,
): Effect.Effect<void> =>
  Ref.get(countRef).pipe(
    Effect.flatMap((currentCount) => {
      if (currentCount <= 0) {
        return Effect.logWarning(
          `Attempted to decrement ${metricName} below zero (current: ${currentCount}). ` +
            "This indicates a bug: decrement called without matching increment.",
        )
      }
      return Effect.zipRight(
        Ref.set(countRef, currentCount - 1),
        Metric.incrementBy(gauge, -1),
      )
    }),
  )

/**
 * Safely increment a gauge with internal tracking.
 *
 * @internal
 */
const safeIncrementGauge = (
  countRef: Ref.Ref<number>,
  gauge: Metric.Metric.Gauge<number>,
): Effect.Effect<void> =>
  Effect.zipRight(
    Ref.update(countRef, (n) => n + 1),
    Metric.increment(gauge),
  )

const makeWebSocketMetrics: Effect.Effect<WebSocketMetricsService> = Effect.map(
  Effect.all([Ref.make(0), Ref.make(0)]),
  ([connectionCountRef, subscriptionCountRef]) => {
    // Internal refs to track actual counts and prevent negative gauges
    const service: WebSocketMetricsService = {
      connectionOpened: Effect.all([
        Metric.increment(connectionsOpened),
        safeIncrementGauge(connectionCountRef, activeConnections),
      ]).pipe(Effect.asVoid),

      connectionClosed: Effect.all([
        Metric.increment(connectionsClosed),
        safeDecrementGauge(connectionCountRef, activeConnections, "activeConnections"),
      ]).pipe(Effect.asVoid),

      subscriptionCreated: Effect.all([
        Metric.increment(subscriptionsCreated),
        safeIncrementGauge(subscriptionCountRef, activeSubscriptions),
      ]).pipe(Effect.asVoid),

      subscriptionCompleted: Effect.all([
        Metric.increment(subscriptionsCompleted),
        safeDecrementGauge(subscriptionCountRef, activeSubscriptions, "activeSubscriptions"),
      ]).pipe(Effect.asVoid),

      subscriptionErrored: Effect.all([
        Metric.increment(subscriptionsErrored),
        safeDecrementGauge(subscriptionCountRef, activeSubscriptions, "activeSubscriptions"),
      ]).pipe(Effect.asVoid),

      messageReceived: Metric.increment(messagesReceived),

      messageSent: Metric.increment(messagesSent),

      authFailed: Metric.increment(authFailures),

      broadcastSent: (sent: number) => Metric.incrementBy(broadcastsSent, sent),

      broadcastFailed: (failed: number) => Metric.incrementBy(broadcastFailures, failed),
    }

    return service
  },
)

const makeNoOpMetrics = Effect.succeed<WebSocketMetricsService>({
  connectionOpened: Effect.void,
  connectionClosed: Effect.void,
  subscriptionCreated: Effect.void,
  subscriptionCompleted: Effect.void,
  subscriptionErrored: Effect.void,
  messageReceived: Effect.void,
  messageSent: Effect.void,
  authFailed: Effect.void,
  broadcastSent: () => Effect.void,
  broadcastFailed: () => Effect.void,
})

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live layer that collects metrics using Effect's Metric module.
 *
 * @since 0.1.0
 * @category Layers
 */
export const WebSocketMetricsLive: Layer.Layer<WebSocketMetrics> = Layer.effect(
  WebSocketMetrics,
  makeWebSocketMetrics,
)

/**
 * No-op layer for testing or when metrics collection is disabled.
 *
 * @since 0.1.0
 * @category Layers
 */
export const WebSocketMetricsDisabled: Layer.Layer<WebSocketMetrics> = Layer.effect(
  WebSocketMetrics,
  makeNoOpMetrics,
)

// Assign static properties
WebSocketMetrics.Live = WebSocketMetricsLive
WebSocketMetrics.Disabled = WebSocketMetricsDisabled
