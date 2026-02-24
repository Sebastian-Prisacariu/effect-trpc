/**
 * Edge case tests for the Gate primitive.
 *
 * These tests cover:
 * - Concurrent operations
 * - Empty arrays
 * - Long-running effects
 * - Multiple subscribers
 * - Error propagation
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Deferred from "effect/Deferred"
import * as Ref from "effect/Ref"

import { Gate, GateClosedError } from "../core/gate/index.js"

describe("Gate Edge Cases", () => {
  describe("concurrent operations", () => {
    it("handles concurrent open calls safely", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })

            // Fire 10 concurrent opens
            yield* Effect.all(
              Array.from({ length: 10 }, () => Gate.open(gate)),
              { concurrency: "unbounded" },
            )

            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("handles concurrent close calls safely", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            // Fire 10 concurrent closes
            yield* Effect.all(
              Array.from({ length: 10 }, () => Gate.close(gate)),
              { concurrency: "unbounded" },
            )

            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(false)
    })

    it("handles concurrent open and close calls", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            // Fire mixed open and close calls
            yield* Effect.all(
              [
                Gate.close(gate),
                Gate.open(gate),
                Gate.close(gate),
                Gate.open(gate),
                Gate.toggle(gate),
              ],
              { concurrency: "unbounded" },
            )

            // Final state depends on execution order, but should be valid
            const isOpen = yield* Gate.isOpen(gate)
            return typeof isOpen === "boolean"
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("handles concurrent toggle calls", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            // Fire 10 concurrent toggles
            yield* Effect.all(
              Array.from({ length: 10 }, () => Gate.toggle(gate)),
              { concurrency: "unbounded" },
            )

            // Should not crash, state is valid
            const isOpen = yield* Gate.isOpen(gate)
            return typeof isOpen === "boolean"
          }),
        ),
      )

      expect(result).toBe(true)
    })
  })

  describe("whenAllOpen edge cases", () => {
    it("handles empty gates array", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            // Empty array should just run the effect
            return yield* Gate.whenAllOpen([], Effect.succeed(42))
          }),
        ),
      )

      expect(result).toBe(42)
    })

    it("handles single gate array", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            return yield* Gate.whenAllOpen([gate], Effect.succeed(42))
          }),
        ),
      )

      expect(result).toBe(42)
    })

    it("fails fast if any gate with fail behavior is closed", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate1 = yield* Gate.make("gate1", { initiallyOpen: true })
            const gate2 = yield* Gate.make("gate2", {
              initiallyOpen: false,
              closedBehavior: "fail",
            })
            const gate3 = yield* Gate.make("gate3", { initiallyOpen: true })

            return yield* Gate.whenAllOpen([gate1, gate2, gate3], Effect.succeed(42)).pipe(
              Effect.catchTag("GateClosedError", (e) => Effect.succeed(`failed: ${e.gate}`)),
            )
          }),
        ),
      )

      expect(result).toBe("failed: gate2")
    })
  })

  describe("long-running effects", () => {
    it("effect continues after gate closes during execution", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            const log = yield* Ref.make<string[]>([])

            // Start a long-running effect
            const fiber = yield* Effect.fork(
              Gate.whenOpen(
                gate,
                Effect.gen(function* () {
                  yield* Ref.update(log, (l) => [...l, "started"])
                  yield* Effect.sleep("50 millis")
                  yield* Ref.update(log, (l) => [...l, "completed"])
                  return "done"
                }),
              ),
            )

            // Close gate while effect is running
            yield* Effect.sleep("10 millis")
            yield* Gate.close(gate)

            // Effect should complete (semaphore permit was already acquired)
            const result = yield* Fiber.join(fiber)
            const finalLog = yield* Ref.get(log)

            return { result, log: finalLog }
          }),
        ),
      )

      expect(result.result).toBe("done")
      expect(result.log).toEqual(["started", "completed"])
    })

    it("effect waits if gate is closed then opens", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })
            const log = yield* Ref.make<string[]>([])

            // Start effect that will wait
            const fiber = yield* Effect.fork(
              Gate.whenOpen(
                gate,
                Effect.gen(function* () {
                  yield* Ref.update(log, (l) => [...l, "executed"])
                  return "done"
                }),
              ),
            )

            // Give fiber time to start waiting
            yield* Effect.sleep("10 millis")
            yield* Ref.update(log, (l) => [...l, "before open"])

            // Open the gate
            yield* Gate.open(gate)

            const result = yield* Fiber.join(fiber)
            const finalLog = yield* Ref.get(log)

            return { result, log: finalLog }
          }),
        ),
      )

      expect(result.result).toBe("done")
      expect(result.log).toEqual(["before open", "executed"])
    })
  })

  describe("multiple subscribers", () => {
    it("supports multiple concurrent subscribers", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            const changes1: boolean[] = []
            const changes2: boolean[] = []
            const changes3: boolean[] = []

            // Set up multiple subscribers
            const cleanup1 = Gate.subscribe(gate, (isOpen) => changes1.push(isOpen))
            const cleanup2 = Gate.subscribe(gate, (isOpen) => changes2.push(isOpen))
            const cleanup3 = Gate.subscribe(gate, (isOpen) => changes3.push(isOpen))

            // Make some changes
            yield* Gate.close(gate)
            yield* Effect.sleep("10 millis")
            yield* Gate.open(gate)
            yield* Effect.sleep("10 millis")

            // Clean up
            cleanup1()
            cleanup2()
            cleanup3()

            return { changes1, changes2, changes3 }
          }),
        ),
      )

      // All subscribers should see the same changes
      // Note: subscribe() only emits on changes, not initial state
      expect(result.changes1).toEqual([false, true])
      expect(result.changes2).toEqual([false, true])
      expect(result.changes3).toEqual([false, true])
    })

    it("unsubscribing one does not affect others", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            const changes1: boolean[] = []
            const changes2: boolean[] = []

            const cleanup1 = Gate.subscribe(gate, (isOpen) => changes1.push(isOpen))
            const cleanup2 = Gate.subscribe(gate, (isOpen) => changes2.push(isOpen))

            // First change - both see it
            yield* Gate.close(gate)
            yield* Effect.sleep("10 millis")

            // Unsubscribe first
            cleanup1()

            // Second change - only second sees it
            yield* Gate.open(gate)
            yield* Effect.sleep("10 millis")

            cleanup2()

            return { changes1, changes2 }
          }),
        ),
      )

      // Note: subscribe() only emits on changes, not initial state
      expect(result.changes1).toEqual([false])
      expect(result.changes2).toEqual([false, true])
    })
  })

  describe("error propagation", () => {
    it("propagates effect errors through whenOpen", async () => {
      class TestError {
        readonly _tag = "TestError"
      }

      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            return yield* Gate.whenOpen(gate, Effect.fail(new TestError())).pipe(
              Effect.catchTag("TestError", () => Effect.succeed("caught")),
            )
          }),
        ),
      )

      expect(result).toBe("caught")
    })

    it("GateClosedError includes gate name and closedAt", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("mygate", {
              initiallyOpen: false,
              closedBehavior: "fail",
            })

            const errorInfo = yield* Gate.whenOpen(gate, Effect.succeed(42)).pipe(
              Effect.matchEffect({
                onFailure: (e) =>
                  Effect.succeed({
                    gate: e.gate,
                    hasClosedAt: e.closedAt !== undefined,
                    message: e.message,
                  }),
                onSuccess: () => Effect.succeed({ gate: "", hasClosedAt: false, message: "" }),
              }),
            )

            return errorInfo
          }),
        ),
      )

      expect(result.gate).toBe("mygate")
      expect(result.hasClosedAt).toBe(true)
      expect(result.message).toContain("mygate")
    })
  })

  describe("awaitOpen/awaitClose edge cases", () => {
    it("awaitOpen resolves multiple waiters when gate opens", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })
            const resolved = yield* Ref.make(0)

            // Start multiple waiters
            const fibers = yield* Effect.all(
              Array.from({ length: 5 }, () =>
                Effect.fork(
                  Effect.gen(function* () {
                    yield* Gate.awaitOpen(gate)
                    yield* Ref.update(resolved, (n) => n + 1)
                  }),
                ),
              ),
            )

            // Give them time to start waiting
            yield* Effect.sleep("10 millis")

            // Open gate - all should resolve
            yield* Gate.open(gate)

            // Wait for all fibers
            yield* Effect.all(fibers.map(Fiber.join))

            return yield* Ref.get(resolved)
          }),
        ),
      )

      expect(result).toBe(5)
    })

    it("awaitClose resolves multiple waiters when gate closes", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            const resolved = yield* Ref.make(0)

            // Start multiple waiters
            const fibers = yield* Effect.all(
              Array.from({ length: 5 }, () =>
                Effect.fork(
                  Effect.gen(function* () {
                    yield* Gate.awaitClose(gate)
                    yield* Ref.update(resolved, (n) => n + 1)
                  }),
                ),
              ),
            )

            // Give them time to start waiting
            yield* Effect.sleep("10 millis")

            // Close gate - all should resolve
            yield* Gate.close(gate)

            // Wait for all fibers
            yield* Effect.all(fibers.map(Fiber.join))

            return yield* Ref.get(resolved)
          }),
        ),
      )

      expect(result).toBe(5)
    })
  })

  describe("state consistency", () => {
    it("state timestamps are monotonically increasing", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            const timestamps: number[] = []

            // Record initial openedAt
            const initial = yield* Gate.getState(gate)
            timestamps.push(initial.openedAt!)

            // Close and record closedAt
            yield* Effect.sleep("5 millis")
            yield* Gate.close(gate)
            const afterClose = yield* Gate.getState(gate)
            timestamps.push(afterClose.closedAt!)

            // Open and record openedAt
            yield* Effect.sleep("5 millis")
            yield* Gate.open(gate)
            const afterOpen = yield* Gate.getState(gate)
            timestamps.push(afterOpen.openedAt!)

            return timestamps
          }),
        ),
      )

      // Each timestamp should be greater than the previous
      expect(result.length).toBe(3)
      expect(result[1]!).toBeGreaterThan(result[0]!)
      expect(result[2]!).toBeGreaterThan(result[1]!)
    })
  })
})
