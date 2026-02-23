/**
 * @module effect-trpc/tests/ws-client
 *
 * Tests for WebSocket client services.
 * These are unit tests that mock the WebSocket connection.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Fiber from "effect/Fiber"
import * as DateTime from "effect/DateTime"

import {
  SubscriptionRegistry,
  SubscriptionRegistryLive,
  SubscriptionState,
  SubscriptionEvent,
  ClientState,
} from "../ws/client/index.js"
import {
  SubscribedMessage,
  DataMessage,
  ErrorMessage,
  CompleteMessage,
  PongMessage,
} from "../ws/protocol.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test: SubscriptionRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe("SubscriptionRegistry", () => {
  it("creates subscriptions and returns streams", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      // Initially empty
      const count1 = yield* registry.count
      expect(count1).toBe(0)

      // Create a subscription
      const { id } = yield* registry.create<number>("test.events", {
        filter: "all",
      })

      expect(id).toBeDefined()
      expect(typeof id).toBe("string")

      // Count should be 1
      const count2 = yield* registry.count
      expect(count2).toBe(1)

      // Get the subscription
      const sub = yield* registry.get(id)
      expect(sub.path).toBe("test.events")
      expect(sub.input).toEqual({ filter: "all" })
      expect(sub.state._tag).toBe("Subscribing")
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("routes Subscribed message and updates state", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      const { id } = yield* registry.create<string>("test.events", {})

      // Initially Subscribing
      const sub1 = yield* registry.get(id)
      expect(sub1.state._tag).toBe("Subscribing")

      // Route a Subscribed message
      // id is both the correlation ID and subscription ID in this case since client creates it
      yield* registry.routeMessage(new SubscribedMessage({ id, subscriptionId: id }))

      // Now should be Active
      const sub2 = yield* registry.get(id)
      expect(sub2.state._tag).toBe("Active")
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("routes Data messages to stream", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry
      const received: number[] = []

      const { id, stream } = yield* registry.create<number>("test.counter", {})

      // Start collecting stream in background
      const collectFiber = yield* Effect.fork(
        stream.pipe(
          Stream.take(3),
          Stream.runForEach((n) => Effect.sync(() => received.push(n))),
        ),
      )

      // Simulate server sending data
      yield* registry.routeMessage(new DataMessage({ id, data: 1 }))
      yield* registry.routeMessage(new DataMessage({ id, data: 2 }))
      yield* registry.routeMessage(new DataMessage({ id, data: 3 }))

      // Wait for collection
      yield* Fiber.join(collectFiber)

      expect(received).toEqual([1, 2, 3])
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("routes Error messages and fails stream", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      const { id, stream } = yield* registry.create<number>("test.failing", {})

      // Start collecting stream
      const resultFiber = yield* Effect.fork(
        stream.pipe(
          Stream.runCollect,
          Effect.exit,
        ),
      )

      // Send error
      yield* registry.routeMessage(
        new ErrorMessage({
          id,
          error: { _tag: "TestError", message: "Something went wrong" },
        }),
      )

      // Should fail
      const result = yield* Fiber.join(resultFiber)
      expect(result._tag).toBe("Failure")
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("routes Complete messages and ends stream", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      const { id, stream } = yield* registry.create<number>("test.finite", {})

      // Send data first, then complete - the stream collects everything
      yield* registry.routeMessage(new DataMessage({ id, data: 1 }))
      yield* registry.routeMessage(new DataMessage({ id, data: 2 }))
      yield* registry.routeMessage(new CompleteMessage({ id }))

      // Give queue time to process - this test is synchronous enough
      // that we just need to run collect after the data is queued
      const result = yield* stream.pipe(Stream.runCollect)
      expect(Array.from(result)).toEqual([1, 2])
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("removes subscriptions", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      const { id } = yield* registry.create<string>("test.events", {})

      // Should have 1
      const count1 = yield* registry.count
      expect(count1).toBe(1)

      // Remove
      yield* registry.remove(id)

      // Should have 0
      const count2 = yield* registry.count
      expect(count2).toBe(0)

      // Get should fail
      const result = yield* Effect.exit(registry.get(id))
      expect(result._tag).toBe("Failure")
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("getAll returns all subscriptions", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      yield* registry.create("path1", { a: 1 })
      yield* registry.create("path2", { b: 2 })
      yield* registry.create("path3", { c: 3 })

      const all = yield* registry.getAll
      expect(all.length).toBe(3)

      const paths = all.map((s) => s.path).sort()
      expect(paths).toEqual(["path1", "path2", "path3"])
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("clear removes all subscriptions", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      yield* registry.create("path1", {})
      yield* registry.create("path2", {})
      yield* registry.create("path3", {})

      const count1 = yield* registry.count
      expect(count1).toBe(3)

      yield* registry.clear

      const count2 = yield* registry.count
      expect(count2).toBe(0)
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("ignores messages for unknown subscriptions", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      // Route message for non-existent subscription - should not throw
      yield* registry.routeMessage(
        new DataMessage({ id: "unknown-sub", data: 123 }),
      )

      // Should still work fine
      const count = yield* registry.count
      expect(count).toBe(0)
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })

  it("ignores non-subscription messages", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* SubscriptionRegistry

      // Route a Pong message - should be ignored
      yield* registry.routeMessage(new PongMessage({}))

      // Should still work fine
      const count = yield* registry.count
      expect(count).toBe(0)
    })

    await Effect.runPromise(program.pipe(Effect.provide(SubscriptionRegistryLive)))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: ConnectionState
// ─────────────────────────────────────────────────────────────────────────────

describe("ClientState", () => {
  it("has correct state constructors", () => {
    expect(ClientState.Disconnected._tag).toBe("Disconnected")
    expect(ClientState.Connecting._tag).toBe("Connecting")
    expect(ClientState.Authenticating._tag).toBe("Authenticating")

    const ready = ClientState.Ready("client-123" as any)
    expect(ready._tag).toBe("Ready")
    if (ready._tag === "Ready") {
      expect(ready.clientId).toBe("client-123")
    }

    const reconnecting = ClientState.Reconnecting(3)
    expect(reconnecting._tag).toBe("Reconnecting")
    if (reconnecting._tag === "Reconnecting") {
      expect(reconnecting.attempt).toBe(3)
    }

    const error = ClientState.Error(new Error("test"))
    expect(error._tag).toBe("Error")
    if (error._tag === "Error") {
      expect(error.error).toBeInstanceOf(Error)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: SubscriptionState
// ─────────────────────────────────────────────────────────────────────────────

describe("SubscriptionState", () => {
  it("has correct state constructors", () => {
    expect(SubscriptionState.Subscribing._tag).toBe("Subscribing")
    expect(SubscriptionState.Complete._tag).toBe("Complete")
    expect(SubscriptionState.Unsubscribed._tag).toBe("Unsubscribed")

    const active = SubscriptionState.Active(DateTime.unsafeNow())
    expect(active._tag).toBe("Active")
    if (active._tag === "Active") {
      expect(active.subscribedAt._tag).toBe("Utc")
    }

    const error = SubscriptionState.Error({ message: "test" })
    expect(error._tag).toBe("Error")
    if (error._tag === "Error") {
      expect(error.error).toEqual({ message: "test" })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: SubscriptionEvent
// ─────────────────────────────────────────────────────────────────────────────

describe("SubscriptionEvent", () => {
  it("has correct event constructors", () => {
    expect(SubscriptionEvent.Subscribed._tag).toBe("Subscribed")
    expect(SubscriptionEvent.Complete._tag).toBe("Complete")

    const data = SubscriptionEvent.Data({ count: 42 })
    expect(data._tag).toBe("Data")
    if (data._tag === "Data") {
      expect(data.data).toEqual({ count: 42 })
    }

    const serverData = SubscriptionEvent.ServerData({ status: "ok" })
    expect(serverData._tag).toBe("ServerData")
    if (serverData._tag === "ServerData") {
      expect(serverData.data).toEqual({ status: "ok" })
    }

    const error = SubscriptionEvent.Error(new Error("test"))
    expect(error._tag).toBe("Error")
    if (error._tag === "Error") {
      expect(error.error).toBeInstanceOf(Error)
    }
  })
})
