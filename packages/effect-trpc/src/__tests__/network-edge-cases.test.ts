/**
 * Edge case tests for the Network service.
 *
 * These tests cover:
 * - Layer composition
 * - Service access patterns
 * - Gate integration
 * - Concurrent operations
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"

import {
  Network,
  NetworkBrowserLive,
  NetworkAlwaysOnline,
  isOnline as networkIsOnline,
  getState as networkGetState,
  awaitOnline as networkAwaitOnline,
  whenOnline as networkWhenOnline,
} from "../core/network/index.js"
import { Gate } from "../core/gate/index.js"

describe("Network Edge Cases", () => {
  describe("layer composition", () => {
    it("NetworkAlwaysOnline can be composed with other layers", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const online = yield* network.isOnline
          return online
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(true)
    })

    it("NetworkBrowserLive can be composed with other layers", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const online = yield* network.isOnline
          return online
        }).pipe(Effect.provide(NetworkBrowserLive)),
      )

      // In Node.js test env, defaults to online
      expect(result).toBe(true)
    })
  })

  describe("convenience accessors", () => {
    it("networkIsOnline accessor requires Network in context", async () => {
      const result = await Effect.runPromise(
        networkIsOnline.pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(true)
    })

    it("networkGetState accessor requires Network in context", async () => {
      const result = await Effect.runPromise(
        networkGetState.pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result.isOnline).toBe(true)
      expect(result.lastOnlineAt).toBeTypeOf("number")
    })

    it("networkAwaitOnline accessor completes immediately when online", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* networkAwaitOnline
          return "completed"
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("completed")
    })

    it("networkWhenOnline accessor runs effect when online", async () => {
      const result = await Effect.runPromise(
        networkWhenOnline(Effect.succeed(42)).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(42)
    })
  })

  describe("gate integration", () => {
    it("exposes underlying gate for composition", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const gate = network.gate

          // Gate should be open (online)
          const isOpen = yield* Gate.isOpen(gate)
          return isOpen
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(true)
    })

    it("gate can be used with Gate.whenOpen", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const gate = network.gate

          return yield* Gate.whenOpen(gate, Effect.succeed(42))
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(42)
    })

    it("gate can be composed with other gates via whenAllOpen", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const network = yield* Network
            const authGate = yield* Gate.make("auth", { initiallyOpen: true })

            // Both network gate and auth gate must be open
            return yield* Gate.whenAllOpen(
              [network.gate, authGate],
              Effect.succeed("authorized and online"),
            )
          }).pipe(Effect.provide(NetworkAlwaysOnline)),
        ),
      )

      expect(result).toBe("authorized and online")
    })
  })

  describe("concurrent operations", () => {
    it("handles concurrent isOnline checks", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network

          // Fire 10 concurrent checks
          const results = yield* Effect.all(
            Array.from({ length: 10 }, () => network.isOnline),
            { concurrency: "unbounded" },
          )

          return results.every((r) => r === true)
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(true)
    })

    it("handles concurrent state reads", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network

          // Fire 10 concurrent state reads
          const results = yield* Effect.all(
            Array.from({ length: 10 }, () => network.state),
            { concurrency: "unbounded" },
          )

          return results.every((r) => r.isOnline === true)
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(true)
    })

    it("handles concurrent whenOnline calls", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const counter = yield* Ref.make(0)

          // Fire 10 concurrent whenOnline calls
          yield* Effect.all(
            Array.from({ length: 10 }, () =>
              network.whenOnline(Ref.update(counter, (n) => n + 1)),
            ),
            { concurrency: "unbounded" },
          )

          return yield* Ref.get(counter)
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(10)
    })
  })

  describe("NetworkAlwaysOnline specific behavior", () => {
    it("awaitOffline never completes", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network

          // Race awaitOffline against a timeout
          const raceResult = yield* Effect.race(
            network.awaitOffline.pipe(Effect.map(() => "offline")),
            Effect.sleep("50 millis").pipe(Effect.map(() => "timeout")),
          )

          return raceResult
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("timeout")
    })

    it("whenOffline never executes", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const executed = yield* Ref.make(false)

          // Race whenOffline against a timeout
          const raceResult = yield* Effect.race(
            network.whenOffline(Ref.set(executed, true)).pipe(Effect.map(() => "offline")),
            Effect.sleep("50 millis").pipe(Effect.map(() => "timeout")),
          )

          const wasExecuted = yield* Ref.get(executed)
          return { raceResult, wasExecuted }
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result.raceResult).toBe("timeout")
      expect(result.wasExecuted).toBe(false)
    })

    it("changes stream is empty", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const changes: boolean[] = []

          // Subscribe and wait a bit
          const cleanup = network.subscribe((isOnline) => changes.push(isOnline))
          yield* Effect.sleep("50 millis")
          cleanup()

          return changes
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      // No changes emitted for AlwaysOnline
      expect(result).toEqual([])
    })

    it("subscribeToReconnect returns noop", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          let called = false

          const cleanup = network.subscribeToReconnect(() => {
            called = true
          })

          // Cleanup should be a function
          expect(typeof cleanup).toBe("function")
          cleanup()

          return called
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(false)
    })
  })

  describe("service isolation", () => {
    it("multiple program runs get isolated service instances", async () => {
      // Run two programs with the same layer
      const result1 = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const state = yield* network.state
          return state.lastOnlineAt
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      await Effect.runPromise(Effect.sleep("5 millis"))

      const result2 = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const state = yield* network.state
          return state.lastOnlineAt
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      // Each run should have a different timestamp
      expect(result2).toBeGreaterThan(result1!)
    })
  })

  describe("error handling", () => {
    it("propagates effect errors through whenOnline", async () => {
      class TestError {
        readonly _tag = "TestError"
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network

          return yield* network.whenOnline(Effect.fail(new TestError())).pipe(
            Effect.catchTag("TestError", () => Effect.succeed("caught")),
          )
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("caught")
    })
  })
})
