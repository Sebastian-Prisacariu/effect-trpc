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
            const started = yield* Deferred.make<void>()
            const canComplete = yield* Deferred.make<void>()

            // Start a long-running effect
            const fiber = yield* Effect.fork(
              Gate.whenOpen(
                gate,
                Effect.gen(function* () {
                  yield* Ref.update(log, (l) => [...l, "started"])
                  yield* Deferred.succeed(started, void 0)
                  // Wait for signal to continue
                  yield* Deferred.await(canComplete)
                  yield* Ref.update(log, (l) => [...l, "completed"])
                  return "done"
                }),
              ),
            )

            // Wait for effect to start
            yield* Deferred.await(started)

            // Signal effect to complete AND close gate concurrently
            // close() will wait for the effect to release the semaphore permit
            yield* Deferred.succeed(canComplete, void 0)
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

            // Yield control to allow fiber to start and block on gate
            yield* Effect.yieldNow()
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

            // Make some changes - subscribers run in forked fibers, need to yield
            yield* Gate.close(gate)
            // Poll until subscribers have received the close event
            yield* Effect.repeat(
              Effect.sync(() => changes1.length),
              { until: (n) => n >= 1 },
            ).pipe(Effect.timeout("1 second"), Effect.orDie)

            yield* Gate.open(gate)
            // Poll until subscribers have received the open event
            yield* Effect.repeat(
              Effect.sync(() => changes1.length),
              { until: (n) => n >= 2 },
            ).pipe(Effect.timeout("1 second"), Effect.orDie)

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

            // First change - both see it (subscribers run in forked fibers)
            yield* Gate.close(gate)
            // Poll until both subscribers have received the close event
            yield* Effect.repeat(
              Effect.sync(() => changes1.length + changes2.length),
              { until: (n) => n >= 2 },
            ).pipe(Effect.timeout("1 second"), Effect.orDie)

            // Unsubscribe first
            cleanup1()

            // Second change - only second sees it
            yield* Gate.open(gate)
            // Poll until second subscriber has received the open event
            yield* Effect.repeat(
              Effect.sync(() => changes2.length),
              { until: (n) => n >= 2 },
            ).pipe(Effect.timeout("1 second"), Effect.orDie)

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
            const waitersStarted = yield* Ref.make(0)

            // Start multiple waiters
            const fibers = yield* Effect.all(
              Array.from({ length: 5 }, () =>
                Effect.fork(
                  Effect.gen(function* () {
                    yield* Ref.update(waitersStarted, (n) => n + 1)
                    yield* Gate.awaitOpen(gate)
                    yield* Ref.update(resolved, (n) => n + 1)
                  }),
                ),
              ),
            )

            // Wait for all fibers to start waiting (poll until 5 waiters started)
            yield* Effect.repeat(
              Ref.get(waitersStarted),
              { until: (n) => n === 5 },
            )

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
            const waitersStarted = yield* Ref.make(0)

            // Start multiple waiters
            const fibers = yield* Effect.all(
              Array.from({ length: 5 }, () =>
                Effect.fork(
                  Effect.gen(function* () {
                    yield* Ref.update(waitersStarted, (n) => n + 1)
                    yield* Gate.awaitClose(gate)
                    yield* Ref.update(resolved, (n) => n + 1)
                  }),
                ),
              ),
            )

            // Wait for all fibers to start waiting (poll until 5 waiters started)
            yield* Effect.repeat(
              Ref.get(waitersStarted),
              { until: (n) => n === 5 },
            )

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

    it("awaitOpen is race-condition safe when gate opens immediately", async () => {
      // This test verifies the fix for the race condition where:
      // 1. awaitOpen checks state (closed)
      // 2. Another fiber opens the gate
      // 3. awaitOpen subscribes to changes
      // 4. Without the fix, it would wait forever
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })

            // Start awaitOpen and immediately open the gate
            // This maximizes the chance of hitting the race window
            const awaiter = yield* Effect.fork(Gate.awaitOpen(gate))

            // Open immediately - no yield/sleep between fork and open
            yield* Gate.open(gate)

            // The awaiter should complete, not hang
            yield* Fiber.join(awaiter).pipe(
              Effect.timeout("100 millis"),
              Effect.orDie,
            )

            return "completed"
          }),
        ),
      )

      expect(result).toBe("completed")
    })

    it("awaitClose is race-condition safe when gate closes immediately", async () => {
      // Same test for awaitClose
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            // Start awaitClose and immediately close the gate
            const awaiter = yield* Effect.fork(Gate.awaitClose(gate))

            // Close immediately - no yield/sleep between fork and close
            yield* Gate.close(gate)

            // The awaiter should complete, not hang
            yield* Fiber.join(awaiter).pipe(
              Effect.timeout("100 millis"),
              Effect.orDie,
            )

            return "completed"
          }),
        ),
      )

      expect(result).toBe("completed")
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

            // Close the gate - timestamp is set on state change
            yield* Gate.close(gate)
            const afterClose = yield* Gate.getState(gate)
            timestamps.push(afterClose.closedAt!)

            // Open the gate - timestamp is set on state change
            yield* Gate.open(gate)
            const afterOpen = yield* Gate.getState(gate)
            timestamps.push(afterOpen.openedAt!)

            return timestamps
          }),
        ),
      )

      // Each timestamp should be greater than or equal to the previous
      // (monotonically non-decreasing - may be equal if same millisecond)
      expect(result.length).toBe(3)
      expect(result[1]!).toBeGreaterThanOrEqual(result[0]!)
      expect(result[2]!).toBeGreaterThanOrEqual(result[1]!)
    })
  })
})
