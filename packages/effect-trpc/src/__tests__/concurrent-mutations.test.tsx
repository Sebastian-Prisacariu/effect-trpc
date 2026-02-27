// @vitest-environment jsdom
/**
 * @module effect-trpc/__tests__/concurrent-mutations
 *
 * Tests for concurrent mutation behavior including:
 * - Race conditions with simultaneous mutations
 * - Optimistic updates with concurrent mutations
 * - Error rollback during concurrent updates
 * - Mutation state isolation between components
 *
 * These tests verify the 3-tier atom hierarchy from DECISION-007:
 * - Tier 1: Main Atom (shared across callers)
 * - Tier 2: Writable Atom (for optimistic updates)
 * - Tier 3: Caller Atom (isolated per hook instance)
 */

import { NodeHttpClient } from "@effect/platform-node"
import { act, renderHook, waitFor } from "@testing-library/react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import * as React from "react"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { procedure, procedures, Procedures, Router } from "../index.js"
import { createHandler, nodeToWebRequest, webToNodeResponse } from "../node/index.js"
import { createTRPCReact } from "../react/create-client.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Schemas
// ─────────────────────────────────────────────────────────────────────────────

const CounterSchema = Schema.Struct({
  value: Schema.Number,
  lastUpdatedBy: Schema.String,
})

type Counter = typeof CounterSchema.Type

const IncrementInputSchema = Schema.Struct({
  amount: Schema.Number,
  caller: Schema.String,
})

const ItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

type Item = typeof ItemSchema.Type

const CreateItemInputSchema = Schema.Struct({
  name: Schema.String,
})

const DeleteItemInputSchema = Schema.Struct({
  id: Schema.String,
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Procedures
// ─────────────────────────────────────────────────────────────────────────────

// Error schema for failing mutations
const MutationErrorSchema = Schema.Struct({
  _tag: Schema.Literal("MutationError"),
  message: Schema.String,
})

class MutationError extends Schema.TaggedError<MutationError>()("MutationError", {
  message: Schema.String,
}) {}

const CounterProcedures = procedures("counter", {
  get: procedure.output(CounterSchema).query(),

  increment: procedure.input(IncrementInputSchema).output(CounterSchema).mutation(),

  incrementSlow: procedure.input(IncrementInputSchema).output(CounterSchema).mutation(),

  incrementFail: procedure
    .input(IncrementInputSchema)
    .output(CounterSchema)
    .error(MutationErrorSchema)
    .mutation(),
})

const ItemProcedures = procedures("item", {
  list: procedure.output(Schema.Array(ItemSchema)).query(),

  create: procedure.input(CreateItemInputSchema).output(ItemSchema).mutation(),

  delete: procedure
    .input(DeleteItemInputSchema)
    .output(Schema.Struct({ success: Schema.Boolean }))
    .mutation(),

  deleteSlow: procedure
    .input(DeleteItemInputSchema)
    .output(Schema.Struct({ success: Schema.Boolean }))
    .mutation(),

  deleteFail: procedure
    .input(DeleteItemInputSchema)
    .output(Schema.Struct({ success: Schema.Boolean }))
    .error(MutationErrorSchema)
    .mutation(),
})

const appRouter = Router.make({
  counter: CounterProcedures,
  item: ItemProcedures,
})

type AppRouter = Effect.Effect.Success<typeof appRouter>

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Mock Implementation
// ─────────────────────────────────────────────────────────────────────────────

// In-memory store
let counterStore: Counter = { value: 0, lastUpdatedBy: "" }
let itemStore: Item[] = []
let nextItemId = 1

// Delay helper for slow mutations
const delay = (ms: number) => Effect.sleep(`${ms} millis`)

const CounterHandlersLive = Procedures.toLayer(CounterProcedures, {
  get: (_ctx) => Effect.succeed(counterStore),

  increment: (_ctx, input) =>
    Effect.sync(() => {
      counterStore = {
        value: counterStore.value + input.amount,
        lastUpdatedBy: input.caller,
      }
      return counterStore
    }),

  incrementSlow: (_ctx, input) =>
    Effect.gen(function* () {
      yield* delay(100) // 100ms delay
      counterStore = {
        value: counterStore.value + input.amount,
        lastUpdatedBy: input.caller,
      }
      return counterStore
    }),

  incrementFail: (_ctx, input) =>
    Effect.gen(function* () {
      yield* delay(50)
      if (input.caller === "fail") {
        return yield* new MutationError({ message: `Mutation failed for ${input.caller}` })
      }
      counterStore = {
        value: counterStore.value + input.amount,
        lastUpdatedBy: input.caller,
      }
      return counterStore
    }),
})

const ItemHandlersLive = Procedures.toLayer(ItemProcedures, {
  list: (_ctx) => Effect.succeed(itemStore),

  create: (_ctx, input) =>
    Effect.sync(() => {
      const item: Item = { id: String(nextItemId++), name: input.name }
      itemStore.push(item)
      return item
    }),

  delete: (_ctx, input) =>
    Effect.sync(() => {
      itemStore = itemStore.filter((i) => i.id !== input.id)
      return { success: true }
    }),

  deleteSlow: (_ctx, input) =>
    Effect.gen(function* () {
      yield* delay(100)
      itemStore = itemStore.filter((i) => i.id !== input.id)
      return { success: true }
    }),

  deleteFail: (_ctx, input) =>
    Effect.gen(function* () {
      yield* delay(50)
      return yield* new MutationError({ message: `Delete failed for ${input.id}` })
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let serverUrl: string
let httpServer: Server
let disposeHandler: () => Promise<void>

describe("Concurrent Mutations", () => {
  beforeAll(async () => {
    // Create handlers layer
    const AllHandlersLive = Layer.merge(CounterHandlersLive, ItemHandlersLive)

    // Create the fetch handler
    const handler = createHandler({
      router: appRouter,
      handlers: AllHandlersLive,
      path: "/rpc",
      spanPrefix: "@test",
    })

    disposeHandler = handler.dispose

    // Create HTTP server
    httpServer = createServer((req, res) => {
      void (async () => {
        try {
          const request = await nodeToWebRequest(req)
          const response = await handler.fetch(request)
          await webToNodeResponse(response, res)
        } catch (error) {
          console.error("Handler error:", error)
          res.writeHead(500)
          res.end("Internal Server Error")
        }
      })()
    })

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address() as AddressInfo
        serverUrl = `http://localhost:${address.port}/rpc`
        resolve()
      })
    })
  })

  afterAll(async () => {
    if (disposeHandler) {
      await disposeHandler()
    }
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    }
  })

  beforeEach(() => {
    // Reset stores before each test
    counterStore = { value: 0, lastUpdatedBy: "" }
    itemStore = []
    nextItemId = 1
  })

  // Helper to create a fresh client and wrapper for each test
  // This ensures complete isolation between tests
  const createClientAndWrapper = () => {
    const trpc = createTRPCReact<AppRouter>({
      url: serverUrl,
      httpClient: NodeHttpClient.layer,
    })
    const Wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(trpc.Provider, { children })
    return { trpc, wrapper: Wrapper, dispose: () => trpc.dispose() }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Simultaneous Mutations
  // ─────────────────────────────────────────────────────────────────────────

  describe("Simultaneous Mutations", () => {
    it("handles two simultaneous mutations to same resource correctly", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const { result } = renderHook(
          () => ({
            mutation1: trpc.procedures.counter.increment.useMutation(),
            mutation2: trpc.procedures.counter.increment.useMutation(),
          }),
          { wrapper },
        )

        // Both start idle
        expect(result.current.mutation1.isIdle).toBe(true)
        expect(result.current.mutation2.isIdle).toBe(true)

        // Start both mutations and wait for completion
        await act(async () => {
          const promise1 = result.current.mutation1.mutateAsync({ amount: 1, caller: "caller1" })
          const promise2 = result.current.mutation2.mutateAsync({ amount: 2, caller: "caller2" })
          const [exit1, exit2] = await Promise.all([promise1, promise2])

          expect(Exit.isSuccess(exit1)).toBe(true)
          expect(Exit.isSuccess(exit2)).toBe(true)
        })

        // Final state should reflect both operations
        expect(counterStore.value).toBe(3) // 1 + 2
      } finally {
        await dispose()
      }
    })

    it("handles rapid sequential mutations from same hook", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const { result } = renderHook(() => trpc.procedures.counter.increment.useMutation(), {
          wrapper,
        })

        // Fire multiple mutations rapidly and await all
        await act(async () => {
          const promises: Promise<Exit.Exit<Counter, unknown>>[] = []
          for (let i = 1; i <= 5; i++) {
            promises.push(result.current.mutateAsync({ amount: 1, caller: `caller${i}` }))
          }

          const exits = await Promise.all(promises)
          exits.forEach((exit) => {
            expect(Exit.isSuccess(exit)).toBe(true)
          })
        })

        // Final counter should be 5
        expect(counterStore.value).toBe(5)
      } finally {
        await dispose()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Loading State Isolation
  // ─────────────────────────────────────────────────────────────────────────

  describe("Loading State Isolation", () => {
    it("maintains correct loading state for concurrent mutations", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        // Use incrementSlow which has a 100ms delay
        const { result } = renderHook(
          () => ({
            mutation1: trpc.procedures.counter.incrementSlow.useMutation(),
            mutation2: trpc.procedures.counter.incrementSlow.useMutation(),
          }),
          { wrapper },
        )

        // Both start idle
        expect(result.current.mutation1.isPending).toBe(false)
        expect(result.current.mutation2.isPending).toBe(false)

        // Start mutations within act
        let promise1: Promise<Exit.Exit<Counter, unknown>> | undefined
        let promise2: Promise<Exit.Exit<Counter, unknown>> | undefined

        // Start mutation1
        act(() => {
          promise1 = result.current.mutation1.mutateAsync({ amount: 1, caller: "slow1" })
        })

        // mutation1 should be pending, mutation2 should be idle
        await waitFor(() => {
          expect(result.current.mutation1.isPending).toBe(true)
          expect(result.current.mutation2.isPending).toBe(false)
        })

        // Now start mutation2
        act(() => {
          promise2 = result.current.mutation2.mutateAsync({ amount: 2, caller: "slow2" })
        })

        // Both should be pending
        await waitFor(() => {
          expect(result.current.mutation1.isPending).toBe(true)
          expect(result.current.mutation2.isPending).toBe(true)
        })

        // Wait for both to complete
        await act(async () => {
          await Promise.all([promise1!, promise2!])
        })

        // Both should complete independently
        await waitFor(() => {
          expect(result.current.mutation1.isPending).toBe(false)
          expect(result.current.mutation2.isPending).toBe(false)
        })

        // Final state should reflect both
        expect(counterStore.value).toBe(3)
      } finally {
        await dispose()
      }
    })

    it("each hook instance has independent loading state", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        // Simulate two separate "components" using the same mutation
        const { result: result1 } = renderHook(
          () => trpc.procedures.counter.incrementSlow.useMutation(),
          { wrapper },
        )

        const { result: result2 } = renderHook(
          () => trpc.procedures.counter.incrementSlow.useMutation(),
          { wrapper },
        )

        // Both start idle
        expect(result1.current.isPending).toBe(false)
        expect(result2.current.isPending).toBe(false)

        // Start only the first
        let promise1: Promise<Exit.Exit<Counter, unknown>> | undefined
        act(() => {
          promise1 = result1.current.mutateAsync({ amount: 10, caller: "component1" })
        })

        // First should be pending, second should still be idle
        await waitFor(() => {
          expect(result1.current.isPending).toBe(true)
          expect(result2.current.isPending).toBe(false)
          expect(result2.current.isIdle).toBe(true)
        })

        // Complete the first mutation
        await act(async () => {
          await promise1!
        })

        await waitFor(() => {
          expect(result1.current.isPending).toBe(false)
          expect(result1.current.isSuccess).toBe(true)
          // Second is still idle
          expect(result2.current.isPending).toBe(false)
          expect(result2.current.isIdle).toBe(true)
        })
      } finally {
        await dispose()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Optimistic Update Conflicts
  // ─────────────────────────────────────────────────────────────────────────

  describe("Optimistic Update Conflicts", () => {
    it("handles optimistic update conflicts with rollback", async () => {
      // Pre-populate items
      itemStore = [
        { id: "1", name: "Item 1" },
        { id: "2", name: "Item 2" },
        { id: "3", name: "Item 3" },
      ]

      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const onMutate1 = vi.fn()
        const onError1 = vi.fn()
        const onMutate2 = vi.fn()
        const onError2 = vi.fn()

        const { result } = renderHook(
          () => ({
            // mutation1 will fail (uses deleteFail)
            failingMutation: trpc.procedures.item.deleteFail.useMutation({
              onMutate: onMutate1,
              onError: onError1,
              optimistic: {
                onMutate: (input: { id: string }, cache) => {
                  // Save previous state for rollback
                  const previousItems = cache.getQueryData<Item[]>("item.list", undefined)
                  // Optimistically remove the item
                  cache.setQueryData<Item[]>("item.list", undefined, (old: Item[] | undefined) =>
                    (old ?? []).filter((i) => i.id !== input.id),
                  )
                  return { previousItems }
                },
                onError: (_error: unknown, _input: { id: string }, cache, context: unknown) => {
                  // Rollback to previous state
                  const ctx = context as { previousItems?: Item[] }
                  if (ctx?.previousItems) {
                    cache.setQueryData("item.list", undefined, ctx.previousItems)
                  }
                },
              },
            }),
            // mutation2 will succeed (uses deleteSlow)
            succeedingMutation: trpc.procedures.item.deleteSlow.useMutation({
              onMutate: onMutate2,
              onError: onError2,
              optimistic: {
                onMutate: (input: { id: string }, cache) => {
                  const previousItems = cache.getQueryData<Item[]>("item.list", undefined)
                  cache.setQueryData<Item[]>("item.list", undefined, (old: Item[] | undefined) =>
                    (old ?? []).filter((i) => i.id !== input.id),
                  )
                  return { previousItems }
                },
                onError: (_error: unknown, _input: { id: string }, cache, context: unknown) => {
                  const ctx = context as { previousItems?: Item[] }
                  if (ctx?.previousItems) {
                    cache.setQueryData("item.list", undefined, ctx.previousItems)
                  }
                },
              },
            }),
          }),
          { wrapper },
        )

        // Start both mutations simultaneously
        await act(async () => {
          const promise1 = result.current.failingMutation.mutateAsync({ id: "1" })
          const promise2 = result.current.succeedingMutation.mutateAsync({ id: "2" })

          // Wait for both to complete
          const [exit1, exit2] = await Promise.all([promise1, promise2])

          // First should have failed
          expect(Exit.isFailure(exit1)).toBe(true)

          // Second should have succeeded
          expect(Exit.isSuccess(exit2)).toBe(true)
        })

        // Both should have called onMutate
        expect(onMutate1).toHaveBeenCalledTimes(1)
        expect(onMutate2).toHaveBeenCalledTimes(1)

        // First should have error callback called
        expect(onError1).toHaveBeenCalledTimes(1)
        expect(onError2).not.toHaveBeenCalled()

        // Server state should reflect:
        // - Item 1 still exists (delete failed)
        // - Item 2 removed (delete succeeded)
        // - Item 3 still exists (untouched)
        expect(itemStore).toHaveLength(2)
        expect(itemStore.find((i) => i.id === "1")).toBeDefined()
        expect(itemStore.find((i) => i.id === "2")).toBeUndefined()
        expect(itemStore.find((i) => i.id === "3")).toBeDefined()
      } finally {
        await dispose()
      }
    })

    it("optimistic updates apply immediately before server response", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        let optimisticUpdateApplied = false
        let serverResponseReceived = false

        const { result } = renderHook(
          () =>
            trpc.procedures.counter.incrementSlow.useMutation({
              optimistic: {
                onMutate: () => {
                  optimisticUpdateApplied = true
                  expect(serverResponseReceived).toBe(false) // Should be false
                  return {}
                },
                onSuccess: () => {
                  serverResponseReceived = true
                  expect(optimisticUpdateApplied).toBe(true) // Should be true
                },
              },
            }),
          { wrapper },
        )

        await act(async () => {
          await result.current.mutateAsync({ amount: 5, caller: "test" })
        })

        expect(optimisticUpdateApplied).toBe(true)
        expect(serverResponseReceived).toBe(true)
      } finally {
        await dispose()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Error State Isolation
  // ─────────────────────────────────────────────────────────────────────────

  describe("Error State Isolation", () => {
    it("isolates error state between components", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        // Two separate hook instances
        const { result: result1 } = renderHook(
          () => trpc.procedures.counter.incrementFail.useMutation(),
          { wrapper },
        )

        const { result: result2 } = renderHook(
          () => trpc.procedures.counter.incrementFail.useMutation(),
          { wrapper },
        )

        // Both start without errors
        expect(result1.current.isError).toBe(false)
        expect(result2.current.isError).toBe(false)

        // Make mutation1 fail (caller === "fail" triggers failure)
        await act(async () => {
          await result1.current.mutateAsync({ amount: 1, caller: "fail" })
        })

        // mutation1 should have error, mutation2 should NOT have error
        await waitFor(() => {
          expect(result1.current.isError).toBe(true)
          expect(result1.current.error).toBeDefined()
          expect(result2.current.isError).toBe(false)
          expect(result2.current.error).toBeUndefined()
        })

        // Now make mutation2 succeed
        await act(async () => {
          await result2.current.mutateAsync({ amount: 1, caller: "success" })
        })

        // mutation2 should succeed, mutation1 should STILL have its error (isolated state)
        await waitFor(() => {
          expect(result2.current.isSuccess).toBe(true)
          expect(result2.current.isError).toBe(false)
          expect(result1.current.isError).toBe(true) // Still has error
        })
      } finally {
        await dispose()
      }
    })

    it("one component error does not affect the other", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const onError1 = vi.fn()
        const onError2 = vi.fn()

        const { result: result1 } = renderHook(
          () =>
            trpc.procedures.counter.incrementFail.useMutation({
              onError: onError1,
            }),
          { wrapper },
        )

        const { result: result2 } = renderHook(
          () =>
            trpc.procedures.counter.incrementFail.useMutation({
              onError: onError2,
            }),
          { wrapper },
        )

        // First mutation fails
        await act(async () => {
          await result1.current.mutateAsync({ amount: 1, caller: "fail" })
        })

        expect(onError1).toHaveBeenCalledTimes(1)
        expect(onError2).not.toHaveBeenCalled()

        // Second mutation fails separately
        await act(async () => {
          await result2.current.mutateAsync({ amount: 1, caller: "fail" })
        })

        expect(onError1).toHaveBeenCalledTimes(1) // Still only 1 call
        expect(onError2).toHaveBeenCalledTimes(1)
      } finally {
        await dispose()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Callback Isolation
  // ─────────────────────────────────────────────────────────────────────────

  describe("Callback Isolation", () => {
    it("calls correct callbacks for each mutation instance", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const onSuccess1 = vi.fn()
        const onSuccess2 = vi.fn()
        const onSettled1 = vi.fn()
        const onSettled2 = vi.fn()

        const { result } = renderHook(
          () => ({
            mutation1: trpc.procedures.counter.increment.useMutation({
              onSuccess: onSuccess1,
              onSettled: onSettled1,
            }),
            mutation2: trpc.procedures.counter.increment.useMutation({
              onSuccess: onSuccess2,
              onSettled: onSettled2,
            }),
          }),
          { wrapper },
        )

        // Execute mutation1 only
        await act(async () => {
          await result.current.mutation1.mutateAsync({ amount: 1, caller: "test1" })
        })

        expect(onSuccess1).toHaveBeenCalledTimes(1)
        expect(onSettled1).toHaveBeenCalledTimes(1)
        expect(onSuccess2).not.toHaveBeenCalled()
        expect(onSettled2).not.toHaveBeenCalled()

        // Execute mutation2 only
        await act(async () => {
          await result.current.mutation2.mutateAsync({ amount: 2, caller: "test2" })
        })

        expect(onSuccess1).toHaveBeenCalledTimes(1) // Still 1
        expect(onSettled1).toHaveBeenCalledTimes(1) // Still 1
        expect(onSuccess2).toHaveBeenCalledTimes(1)
        expect(onSettled2).toHaveBeenCalledTimes(1)
      } finally {
        await dispose()
      }
    })

    it("passes correct data to callbacks", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const onSuccess = vi.fn()
        const onSettled = vi.fn()

        const { result } = renderHook(
          () =>
            trpc.procedures.counter.increment.useMutation({
              onSuccess,
              onSettled,
            }),
          { wrapper },
        )

        await act(async () => {
          await result.current.mutateAsync({ amount: 5, caller: "dataTest" })
        })

        // onSuccess should receive (data, input)
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ value: 5, lastUpdatedBy: "dataTest" }),
          { amount: 5, caller: "dataTest" },
        )

        // onSettled should receive (data, error, input)
        expect(onSettled).toHaveBeenCalledWith(
          expect.objectContaining({ value: 5, lastUpdatedBy: "dataTest" }),
          undefined,
          { amount: 5, caller: "dataTest" },
        )
      } finally {
        await dispose()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Reset Behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe("Reset Behavior", () => {
    it("reset clears local state but does not affect other instances", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const { result: result1 } = renderHook(
          () => trpc.procedures.counter.incrementFail.useMutation(),
          { wrapper },
        )

        const { result: result2 } = renderHook(
          () => trpc.procedures.counter.incrementFail.useMutation(),
          { wrapper },
        )

        // Both fail
        await act(async () => {
          await result1.current.mutateAsync({ amount: 1, caller: "fail" })
          await result2.current.mutateAsync({ amount: 1, caller: "fail" })
        })

        // Both have errors
        await waitFor(() => {
          expect(result1.current.isError).toBe(true)
          expect(result2.current.isError).toBe(true)
        })

        // Reset only the first
        act(() => {
          result1.current.reset()
        })

        // First should be idle, second should still have error
        await waitFor(() => {
          expect(result1.current.isIdle).toBe(true)
          expect(result1.current.isError).toBe(false)
          expect(result2.current.isError).toBe(true)
        })
      } finally {
        await dispose()
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Test: Race Condition Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe("Race Condition Handling", () => {
    it("handles rapid fire mutations without state corruption", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const { result } = renderHook(() => trpc.procedures.counter.increment.useMutation(), {
          wrapper,
        })

        // Fire 10 mutations as fast as possible
        await act(async () => {
          const promises: Promise<Exit.Exit<Counter, unknown>>[] = []
          for (let i = 0; i < 10; i++) {
            promises.push(result.current.mutateAsync({ amount: 1, caller: `rapid${i}` }))
          }

          const exits = await Promise.all(promises)
          const successCount = exits.filter((e) => Exit.isSuccess(e)).length
          expect(successCount).toBe(10)
        })

        // Counter should be exactly 10
        expect(counterStore.value).toBe(10)

        // Hook should not be in pending state
        expect(result.current.isPending).toBe(false)
      } finally {
        await dispose()
      }
    })

    it("superseded mutation callbacks are not called", async () => {
      const { trpc, wrapper, dispose } = createClientAndWrapper()

      try {
        const onSuccess = vi.fn()

        const { result } = renderHook(
          () =>
            trpc.procedures.counter.incrementSlow.useMutation({
              onSuccess,
            }),
          { wrapper },
        )

        // Start both mutations and await them
        await act(async () => {
          const promise1 = result.current.mutateAsync({ amount: 1, caller: "first" })
          const promise2 = result.current.mutateAsync({ amount: 2, caller: "second" })
          await Promise.all([promise1, promise2])
        })

        // Only the second mutation's callback should be called
        // (first was superseded by the version check)
        expect(onSuccess).toHaveBeenCalledTimes(1)
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ lastUpdatedBy: "second" }),
          { amount: 2, caller: "second" },
        )
      } finally {
        await dispose()
      }
    })
  })
})
