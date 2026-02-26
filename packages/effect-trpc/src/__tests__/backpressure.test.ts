/**
 * @module effect-trpc/ws/server/BackpressureController
 *
 * Tests for WebSocket backpressure signaling.
 */

import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"

import {
  BackpressureController,
  BackpressureControllerDisabled,
  BackpressureControllerLive,
  makeBackpressureControllerLayer,
} from "../ws/server/BackpressureController.js"
import type { Connection } from "../ws/server/ConnectionRegistry.js"
import type { ClientId, SubscriptionId } from "../ws/types.js"

// Mock connection for testing
const createMockConnection = (): { connection: Connection; sentMessages: unknown[] } => {
  const sentMessages: unknown[] = []
  const clientId = "client_test" as ClientId
  const connection: Connection = {
    clientId,
    auth: {
      userId: "user_test",
      clientId,
      metadata: {},
    },
    connectedAt: DateTime.unsafeMake(Date.now()),
    send: (message) => {
      sentMessages.push(message)
      return Effect.void
    },
    close: () => Effect.void,
  }
  return { connection, sentMessages }
}

describe("BackpressureController", () => {
  describe("Live layer", () => {
    it("registers and unregisters subscriptions", async () => {
      const { connection } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        // Register
        yield* bp.register(subscriptionId, clientId, connection)

        // Check state exists
        const state1 = yield* bp.getState(subscriptionId)
        expect(Option.isSome(state1)).toBe(true)
        expect(state1.pipe(Option.map((s) => s.isPaused))).toEqual(Option.some(false))

        // Unregister
        yield* bp.unregister(subscriptionId)

        // Check state is gone
        const state2 = yield* bp.getState(subscriptionId)
        expect(Option.isNone(state2)).toBe(true)
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })

    it("sends Pause signal when queue exceeds threshold", async () => {
      const { connection, sentMessages } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register(subscriptionId, clientId, connection)

        // Record queue at 85% (above default 80% threshold)
        const canAccept = yield* bp.recordQueueState(subscriptionId, 85, 100)

        // Should have sent Pause message
        expect(sentMessages.length).toBe(1)
        expect((sentMessages[0] as any)._tag).toBe("Pause")
        expect((sentMessages[0] as any).id).toBe(subscriptionId)
        expect((sentMessages[0] as any).queueFillPercent).toBe(85)

        // canAccept should be false (paused but not acknowledged)
        expect(canAccept).toBe(false)

        // Check state is paused
        const state = yield* bp.getState(subscriptionId)
        expect(state.pipe(Option.map((s) => s.isPaused))).toEqual(Option.some(true))
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })

    it("sends Resume signal when queue drops below threshold", async () => {
      const { connection, sentMessages } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register(subscriptionId, clientId, connection)

        // First, trigger pause
        yield* bp.recordQueueState(subscriptionId, 85, 100)
        expect(sentMessages.length).toBe(1)

        // Now, queue drops to 45% (below 50% resume threshold)
        const canAccept = yield* bp.recordQueueState(subscriptionId, 45, 100)

        // Should have sent Resume message
        expect(sentMessages.length).toBe(2)
        expect((sentMessages[1] as any)._tag).toBe("Resume")
        expect((sentMessages[1] as any).id).toBe(subscriptionId)

        // canAccept should be true (resumed)
        expect(canAccept).toBe(true)

        // Check state is not paused
        const state = yield* bp.getState(subscriptionId)
        expect(state.pipe(Option.map((s) => s.isPaused))).toEqual(Option.some(false))
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })

    it("handles acknowledgment correctly", async () => {
      const { connection } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register(subscriptionId, clientId, connection)

        // Trigger pause
        yield* bp.recordQueueState(subscriptionId, 85, 100)

        // Before ack, canAcceptData should be false
        const canAccept1 = yield* bp.canAcceptData(subscriptionId)
        expect(canAccept1).toBe(false)

        // Acknowledge pause
        yield* bp.handleAck(subscriptionId, true)

        // After ack, canAcceptData should be true (paused but acknowledged)
        const canAccept2 = yield* bp.canAcceptData(subscriptionId)
        expect(canAccept2).toBe(true)

        // State should show acknowledged
        const state = yield* bp.getState(subscriptionId)
        expect(state.pipe(Option.map((s) => s.isAcknowledged))).toEqual(Option.some(true))
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })

    it("force resume works", async () => {
      const { connection, sentMessages } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register(subscriptionId, clientId, connection)

        // Trigger pause
        yield* bp.recordQueueState(subscriptionId, 85, 100)
        expect(sentMessages.length).toBe(1)

        // Force resume
        yield* bp.forceResume(subscriptionId)

        // Should have sent Resume message
        expect(sentMessages.length).toBe(2)
        expect((sentMessages[1] as any)._tag).toBe("Resume")

        // Check state is not paused
        const state = yield* bp.getState(subscriptionId)
        expect(state.pipe(Option.map((s) => s.isPaused))).toEqual(Option.some(false))
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })

    it("cleanupClient removes all subscriptions for client", async () => {
      const { connection } = createMockConnection()
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        // Register multiple subscriptions for same client
        yield* bp.register("sub_1" as SubscriptionId, clientId, connection)
        yield* bp.register("sub_2" as SubscriptionId, clientId, connection)
        yield* bp.register("sub_3" as SubscriptionId, clientId, connection)

        // Clean up client
        yield* bp.cleanupClient(clientId)

        // All subscriptions should be gone
        const state1 = yield* bp.getState("sub_1" as SubscriptionId)
        const state2 = yield* bp.getState("sub_2" as SubscriptionId)
        const state3 = yield* bp.getState("sub_3" as SubscriptionId)

        expect(Option.isNone(state1)).toBe(true)
        expect(Option.isNone(state2)).toBe(true)
        expect(Option.isNone(state3)).toBe(true)
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })

    it("getPausedSubscriptions returns only paused subscriptions", async () => {
      const { connection } = createMockConnection()
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register("sub_1" as SubscriptionId, clientId, connection)
        yield* bp.register("sub_2" as SubscriptionId, clientId, connection)

        // Pause only sub_1
        yield* bp.recordQueueState("sub_1" as SubscriptionId, 85, 100)

        const paused = yield* bp.getPausedSubscriptions

        expect(paused.length).toBe(1)
        expect(paused[0]?.subscriptionId).toBe("sub_1")
      }).pipe(Effect.provide(BackpressureControllerLive))

      await Effect.runPromise(program)
    })
  })

  describe("Custom config", () => {
    it("uses custom thresholds", async () => {
      const { connection, sentMessages } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      // Custom config: pause at 60%, resume at 30%
      const customLayer = makeBackpressureControllerLayer({
        pauseThreshold: 60,
        resumeThreshold: 30,
      })

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register(subscriptionId, clientId, connection)

        // 65% should trigger pause with custom threshold
        yield* bp.recordQueueState(subscriptionId, 65, 100)
        expect(sentMessages.length).toBe(1)
        expect((sentMessages[0] as any)._tag).toBe("Pause")

        // 35% should NOT trigger resume (above 30%)
        yield* bp.recordQueueState(subscriptionId, 35, 100)
        expect(sentMessages.length).toBe(1) // Still only 1 message

        // 25% should trigger resume
        yield* bp.recordQueueState(subscriptionId, 25, 100)
        expect(sentMessages.length).toBe(2)
        expect((sentMessages[1] as any)._tag).toBe("Resume")
      }).pipe(Effect.provide(customLayer))

      await Effect.runPromise(program)
    })

    it("disabled config always returns true", async () => {
      const { connection, sentMessages } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const disabledLayer = makeBackpressureControllerLayer({
        enabled: false,
      })

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        yield* bp.register(subscriptionId, clientId, connection)

        // Even at 100% fill, should still accept
        const canAccept = yield* bp.recordQueueState(subscriptionId, 100, 100)
        expect(canAccept).toBe(true)

        // No messages should be sent
        expect(sentMessages.length).toBe(0)
      }).pipe(Effect.provide(disabledLayer))

      await Effect.runPromise(program)
    })
  })

  describe("Disabled layer", () => {
    it("provides no-op implementations", async () => {
      const { connection } = createMockConnection()
      const subscriptionId = "sub_test" as SubscriptionId
      const clientId = "client_test" as ClientId

      const program = Effect.gen(function* () {
        const bp = yield* BackpressureController

        // All operations should succeed but do nothing
        yield* bp.register(subscriptionId, clientId, connection)

        const canAccept = yield* bp.recordQueueState(subscriptionId, 100, 100)
        expect(canAccept).toBe(true)

        const canAcceptData = yield* bp.canAcceptData(subscriptionId)
        expect(canAcceptData).toBe(true)

        const state = yield* bp.getState(subscriptionId)
        expect(Option.isNone(state)).toBe(true)

        const paused = yield* bp.getPausedSubscriptions
        expect(paused.length).toBe(0)

        // Should not throw
        yield* bp.handleAck(subscriptionId, true)
        yield* bp.forceResume(subscriptionId)
        yield* bp.unregister(subscriptionId)
        yield* bp.cleanupClient(clientId)
      }).pipe(Effect.provide(BackpressureControllerDisabled))

      await Effect.runPromise(program)
    })
  })

  describe("Static layer properties", () => {
    it("exposes Live layer via static property", () => {
      expect(BackpressureController.Live).toBe(BackpressureControllerLive)
    })

    it("exposes Disabled layer via static property", () => {
      expect(BackpressureController.Disabled).toBe(BackpressureControllerDisabled)
    })

    it("exposes withConfig via static property", () => {
      expect(BackpressureController.withConfig).toBe(makeBackpressureControllerLayer)
    })
  })
})
