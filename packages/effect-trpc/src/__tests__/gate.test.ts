import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

import { Gate, GateClosedError, isGate } from "../core/gate/index.js"

describe("Gate", () => {
  describe("make", () => {
    it("creates an open gate by default", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test")
            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("creates a closed gate when initiallyOpen is false", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })
            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(false)
    })

    it("respects closedBehavior option", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", {
              initiallyOpen: false,
              closedBehavior: "fail",
            })
            return gate.closedBehavior
          }),
        ),
      )

      expect(result).toBe("fail")
    })
  })

  describe("makeUnscoped", () => {
    it("creates a gate without requiring Scope", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const gate = yield* Gate.makeUnscoped("test")
          return yield* Gate.isOpen(gate)
        }),
      )

      expect(result).toBe(true)
    })
  })

  describe("open/close/toggle", () => {
    it("opens a closed gate", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })

            expect(yield* Gate.isOpen(gate)).toBe(false)

            yield* Gate.open(gate)

            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("closes an open gate", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            expect(yield* Gate.isOpen(gate)).toBe(true)

            yield* Gate.close(gate)

            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(false)
    })

    it("toggle switches gate state", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            expect(yield* Gate.isOpen(gate)).toBe(true)

            yield* Gate.toggle(gate)
            expect(yield* Gate.isOpen(gate)).toBe(false)

            yield* Gate.toggle(gate)
            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("open is idempotent", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            yield* Gate.open(gate)
            yield* Gate.open(gate)
            yield* Gate.open(gate)

            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("close is idempotent", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })

            yield* Gate.close(gate)
            yield* Gate.close(gate)
            yield* Gate.close(gate)

            return yield* Gate.isOpen(gate)
          }),
        ),
      )

      expect(result).toBe(false)
    })
  })

  describe("whenOpen", () => {
    it("executes effect immediately when gate is open", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            return yield* Gate.whenOpen(gate, Effect.succeed(42))
          }),
        ),
      )

      expect(result).toBe(42)
    })

    it("waits for gate to open with wait behavior", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", {
              initiallyOpen: false,
              closedBehavior: "wait",
            })

            // Start a fiber that will wait for the gate
            const fiber = yield* Effect.fork(Gate.whenOpen(gate, Effect.succeed(42)))

            // Open the gate after a short delay
            yield* Effect.sleep("10 millis")
            yield* Gate.open(gate)

            // The fiber should now complete
            return yield* Fiber.join(fiber)
          }),
        ),
      )

      expect(result).toBe(42)
    })

    it("fails immediately with fail behavior when gate is closed", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", {
              initiallyOpen: false,
              closedBehavior: "fail",
            })

            return yield* Gate.whenOpen(gate, Effect.succeed(42)).pipe(
              Effect.catchTag("GateClosedError", (e) => Effect.succeed(`error: ${e.gate}`)),
            )
          }),
        ),
      )

      expect(result).toBe("error: test")
    })
  })

  describe("whenAllOpen", () => {
    it("executes when all gates are open", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate1 = yield* Gate.make("gate1", { initiallyOpen: true })
            const gate2 = yield* Gate.make("gate2", { initiallyOpen: true })
            const gate3 = yield* Gate.make("gate3", { initiallyOpen: true })

            return yield* Gate.whenAllOpen([gate1, gate2, gate3], Effect.succeed(42))
          }),
        ),
      )

      expect(result).toBe(42)
    })

    it("waits when any gate is closed", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate1 = yield* Gate.make("gate1", { initiallyOpen: true })
            const gate2 = yield* Gate.make("gate2", { initiallyOpen: false })

            // Start a fiber that will wait for all gates
            const fiber = yield* Effect.fork(
              Gate.whenAllOpen([gate1, gate2], Effect.succeed(42)),
            )

            // Open gate2 after a short delay
            yield* Effect.sleep("10 millis")
            yield* Gate.open(gate2)

            return yield* Fiber.join(fiber)
          }),
        ),
      )

      expect(result).toBe(42)
    })
  })

  describe("observation", () => {
    it("getState returns full state", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            return yield* Gate.getState(gate)
          }),
        ),
      )

      expect(result.isOpen).toBe(true)
      expect(result.openedAt).toBeTypeOf("number")
      expect(result.closedAt).toBe(null)
    })

    it("isClosed is opposite of isOpen", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })

            const isOpen = yield* Gate.isOpen(gate)
            const isClosed = yield* Gate.isClosed(gate)

            return { isOpen, isClosed }
          }),
        ),
      )

      expect(result.isOpen).toBe(true)
      expect(result.isClosed).toBe(false)
    })

    it("awaitOpen completes immediately when gate is open", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: true })
            yield* Gate.awaitOpen(gate)
            return "completed"
          }),
        ),
      )

      expect(result).toBe("completed")
    })

    it("awaitClose completes immediately when gate is closed", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test", { initiallyOpen: false })
            yield* Gate.awaitClose(gate)
            return "completed"
          }),
        ),
      )

      expect(result).toBe("completed")
    })
  })

  describe("isGate", () => {
    it("returns true for Gate instances", async () => {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const gate = yield* Gate.make("test")
            return isGate(gate)
          }),
        ),
      )

      expect(result).toBe(true)
    })

    it("returns false for non-Gate values", () => {
      expect(isGate(null)).toBe(false)
      expect(isGate(undefined)).toBe(false)
      expect(isGate({})).toBe(false)
      expect(isGate({ _tag: "Gate" })).toBe(false) // Missing other fields
      expect(isGate("gate")).toBe(false)
    })
  })

  describe("GateClosedError", () => {
    it("has correct properties", () => {
      const error = new GateClosedError({ gate: "auth", closedAt: 12345 })

      expect(error._tag).toBe("GateClosedError")
      expect(error.gate).toBe("auth")
      expect(error.closedAt).toBe(12345)
      expect(error.isRetryable).toBe(true)
      expect(error.message).toContain("auth")
    })
  })
})
