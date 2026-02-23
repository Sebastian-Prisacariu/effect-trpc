/**
 * @module effect-trpc/ws/server/WebSocketMetrics
 *
 * Tests for WebSocket metrics collection.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Metric from "effect/Metric"
import {
  WebSocketMetrics,
  WebSocketMetricsLive,
  WebSocketMetricsDisabled,
  activeConnections,
  activeSubscriptions,
  messagesReceived,
  messagesSent,
  subscriptionsCreated,
  subscriptionsCompleted,
  subscriptionsErrored,
  connectionsOpened,
  connectionsClosed,
  authFailures,
  broadcastsSent,
  broadcastFailures,
} from "../ws/server/WebSocketMetrics.js"

describe("WebSocketMetrics", () => {
  describe("Live layer", () => {
    it("tracks connection opened/closed", async () => {
      const program = Effect.gen(function* () {
        const metrics = yield* WebSocketMetrics

        // Open 3 connections
        yield* metrics.connectionOpened
        yield* metrics.connectionOpened
        yield* metrics.connectionOpened

        // Close 1 connection
        yield* metrics.connectionClosed

        // Check values
        const active = yield* Metric.value(activeConnections)
        const opened = yield* Metric.value(connectionsOpened)
        const closed = yield* Metric.value(connectionsClosed)

        return { active, opened, closed }
      }).pipe(Effect.provide(WebSocketMetricsLive))

      const result = await Effect.runPromise(program)

      // Gauge should be 2 (3 opened - 1 closed)
      expect(result.active.value).toBe(2)
      // Counter should be 3 (total opened)
      expect(result.opened.count).toBe(3)
      // Counter should be 1 (total closed)
      expect(result.closed.count).toBe(1)
    })

    it("tracks subscription lifecycle", async () => {
      const program = Effect.gen(function* () {
        const metrics = yield* WebSocketMetrics

        // Create 5 subscriptions
        yield* metrics.subscriptionCreated
        yield* metrics.subscriptionCreated
        yield* metrics.subscriptionCreated
        yield* metrics.subscriptionCreated
        yield* metrics.subscriptionCreated

        // Complete 2
        yield* metrics.subscriptionCompleted
        yield* metrics.subscriptionCompleted

        // Error 1
        yield* metrics.subscriptionErrored

        // Check values
        const active = yield* Metric.value(activeSubscriptions)
        const created = yield* Metric.value(subscriptionsCreated)
        const completed = yield* Metric.value(subscriptionsCompleted)
        const errored = yield* Metric.value(subscriptionsErrored)

        return { active, created, completed, errored }
      }).pipe(Effect.provide(WebSocketMetricsLive))

      const result = await Effect.runPromise(program)

      // Gauge should be 2 (5 created - 2 completed - 1 errored)
      expect(result.active.value).toBe(2)
      // Counters
      expect(result.created.count).toBe(5)
      expect(result.completed.count).toBe(2)
      expect(result.errored.count).toBe(1)
    })

    it("tracks messages sent/received", async () => {
      const program = Effect.gen(function* () {
        const metrics = yield* WebSocketMetrics

        // Receive 10 messages
        for (let i = 0; i < 10; i++) {
          yield* metrics.messageReceived
        }

        // Send 5 messages
        for (let i = 0; i < 5; i++) {
          yield* metrics.messageSent
        }

        const received = yield* Metric.value(messagesReceived)
        const sent = yield* Metric.value(messagesSent)

        return { received, sent }
      }).pipe(Effect.provide(WebSocketMetricsLive))

      const result = await Effect.runPromise(program)

      expect(result.received.count).toBe(10)
      expect(result.sent.count).toBe(5)
    })

    it("tracks auth failures", async () => {
      const program = Effect.gen(function* () {
        const metrics = yield* WebSocketMetrics

        yield* metrics.authFailed
        yield* metrics.authFailed
        yield* metrics.authFailed

        const failures = yield* Metric.value(authFailures)
        return failures
      }).pipe(Effect.provide(WebSocketMetricsLive))

      const result = await Effect.runPromise(program)
      expect(result.count).toBe(3)
    })

    it("tracks broadcast metrics", async () => {
      const program = Effect.gen(function* () {
        const metrics = yield* WebSocketMetrics

        // Broadcast to 100 clients, 5 failed
        yield* metrics.broadcastSent(95)
        yield* metrics.broadcastFailed(5)

        // Another broadcast to 50 clients, 2 failed
        yield* metrics.broadcastSent(48)
        yield* metrics.broadcastFailed(2)

        const sent = yield* Metric.value(broadcastsSent)
        const failed = yield* Metric.value(broadcastFailures)

        return { sent, failed }
      }).pipe(Effect.provide(WebSocketMetricsLive))

      const result = await Effect.runPromise(program)

      expect(result.sent.count).toBe(143) // 95 + 48
      expect(result.failed.count).toBe(7) // 5 + 2
    })
  })

  describe("Disabled layer", () => {
    it("provides no-op implementations", async () => {
      const program = Effect.gen(function* () {
        const metrics = yield* WebSocketMetrics

        // All operations should succeed but do nothing
        yield* metrics.connectionOpened
        yield* metrics.connectionClosed
        yield* metrics.subscriptionCreated
        yield* metrics.subscriptionCompleted
        yield* metrics.subscriptionErrored
        yield* metrics.messageReceived
        yield* metrics.messageSent
        yield* metrics.authFailed
        yield* metrics.broadcastSent(100)
        yield* metrics.broadcastFailed(5)

        return "completed"
      }).pipe(Effect.provide(WebSocketMetricsDisabled))

      const result = await Effect.runPromise(program)
      expect(result).toBe("completed")
    })
  })

  describe("Static layer properties", () => {
    it("exposes Live layer via static property", () => {
      expect(WebSocketMetrics.Live).toBe(WebSocketMetricsLive)
    })

    it("exposes Disabled layer via static property", () => {
      expect(WebSocketMetrics.Disabled).toBe(WebSocketMetricsDisabled)
    })
  })
})
