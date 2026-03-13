/**
 * Optimistic Updates Tests
 */

import { describe, it, expect, vi } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Ref } from "effect"

import { Optimistic } from "../src/index.js"

// =============================================================================
// Test Types
// =============================================================================

interface User {
  id: string
  name: string
  email: string
}

interface CreateUserInput {
  name: string
  email: string
}

// =============================================================================
// Procedure Integration Tests
// =============================================================================

describe("fromProcedureConfig", () => {
  it("converts procedure config to runtime config", () => {
    const procedureConfig: Optimistic.ProcedureOptimisticConfig<User[], CreateUserInput, User> = {
      target: "users.list",
      reducer: (list, input) => [...list, { id: "temp", ...input }],
      reconcile: (list, _input, result) => 
        list.map(u => u.id === "temp" ? result : u),
    }
    
    const runtimeConfig = Optimistic.fromProcedureConfig(procedureConfig)
    
    // Test optimisticUpdate
    const cache = { "users.list": [{ id: "1", name: "Alice", email: "a@test.com" }] }
    const updated = runtimeConfig.optimisticUpdate(cache, { name: "Bob", email: "bob@test.com" })
    
    expect((updated["users.list"] as User[]).length).toBe(2)
    expect((updated["users.list"] as User[])[1].id).toBe("temp")
    
    // Test onSuccess
    const result: User = { id: "real-123", name: "Bob", email: "bob@test.com" }
    const reconciled = runtimeConfig.onSuccess!(result, updated, { name: "Bob", email: "bob@test.com" })
    
    expect((reconciled["users.list"] as User[])[1].id).toBe("real-123")
  })

  it("handles missing reconcile (uses invalidation)", () => {
    const procedureConfig: Optimistic.ProcedureOptimisticConfig<User[], CreateUserInput, User> = {
      target: "users.list",
      reducer: (list, input) => [...list, { id: "temp", ...input }],
      // No reconcile - will use invalidation instead
    }
    
    const runtimeConfig = Optimistic.fromProcedureConfig(procedureConfig)
    
    expect(runtimeConfig.onSuccess).toBeUndefined()
  })
})

// =============================================================================
// Helper Utilities Tests
// =============================================================================

describe("listUpdater", () => {
  it("adds item to list", () => {
    const updater = Optimistic.listUpdater<User, CreateUserInput>(
      "users.list",
      (list, input) => [...list, { id: "temp", ...input }]
    )
    
    const cache = {
      "users.list": [{ id: "1", name: "Alice", email: "alice@test.com" }],
    }
    
    const result = updater(cache, { name: "Bob", email: "bob@test.com" })
    
    expect(result["users.list"]).toHaveLength(2)
    expect((result["users.list"] as User[])[1].name).toBe("Bob")
    expect((result["users.list"] as User[])[1].id).toBe("temp")
  })

  it("handles empty list", () => {
    const updater = Optimistic.listUpdater<User, CreateUserInput>(
      "users.list",
      (list, input) => [...list, { id: "temp", ...input }]
    )
    
    const cache = {}
    
    const result = updater(cache, { name: "Bob", email: "bob@test.com" })
    
    expect(result["users.list"]).toHaveLength(1)
  })
})

describe("replaceUpdater", () => {
  it("replaces item", () => {
    const updater = Optimistic.replaceUpdater<User, Partial<User>>(
      "user.current",
      (current, input) => ({ ...current!, ...input })
    )
    
    const cache = {
      "user.current": { id: "1", name: "Alice", email: "alice@test.com" },
    }
    
    const result = updater(cache, { name: "Alicia" })
    
    expect((result["user.current"] as User).name).toBe("Alicia")
    expect((result["user.current"] as User).id).toBe("1")
  })
})

describe("removeFromList", () => {
  it("removes matching item", () => {
    const updater = Optimistic.removeFromList<User, { id: string }>(
      "users.list",
      (user, input) => user.id === input.id
    )
    
    const cache = {
      "users.list": [
        { id: "1", name: "Alice", email: "alice@test.com" },
        { id: "2", name: "Bob", email: "bob@test.com" },
      ],
    }
    
    const result = updater(cache, { id: "1" })
    
    expect(result["users.list"]).toHaveLength(1)
    expect((result["users.list"] as User[])[0].id).toBe("2")
  })
})

describe("updateInList", () => {
  it("updates matching item", () => {
    const updater = Optimistic.updateInList<User, { id: string; name: string }>(
      "users.list",
      (user, input) => user.id === input.id,
      (user, input) => ({ ...user, name: input.name })
    )
    
    const cache = {
      "users.list": [
        { id: "1", name: "Alice", email: "alice@test.com" },
        { id: "2", name: "Bob", email: "bob@test.com" },
      ],
    }
    
    const result = updater(cache, { id: "1", name: "Alicia" })
    
    expect((result["users.list"] as User[])[0].name).toBe("Alicia")
    expect((result["users.list"] as User[])[1].name).toBe("Bob")
  })
})

// =============================================================================
// createOptimisticMutation Tests
// =============================================================================

describe("createOptimisticMutation", () => {
  effectIt.effect("applies optimistic update and succeeds", () =>
    Effect.gen(function* () {
      const cacheRef = yield* Ref.make<Optimistic.CacheSnapshot>({
        "users.list": [{ id: "1", name: "Alice" }],
      })
      
      const mutation = (input: CreateUserInput) =>
        Effect.succeed({ id: "2", ...input })
      
      const optimisticMutation = Optimistic.createOptimisticMutation(
        mutation,
        {
          optimisticUpdate: (cache, input) => ({
            ...cache,
            "users.list": [...(cache["users.list"] as User[]), { id: "temp", ...input, email: input.email }],
          }),
        },
        cacheRef
      )
      
      // Run mutation
      const result = yield* optimisticMutation({ name: "Bob", email: "bob@test.com" })
      
      // Should return the result
      expect(result.id).toBe("2")
      expect(result.name).toBe("Bob")
      
      // Cache should be updated (with temp ID since no onSuccess)
      const finalCache = yield* Ref.get(cacheRef)
      expect((finalCache["users.list"] as User[]).length).toBe(2)
    })
  )

  effectIt.effect("rolls back on error", () =>
    Effect.gen(function* () {
      const cacheRef = yield* Ref.make<Optimistic.CacheSnapshot>({
        "users.list": [{ id: "1", name: "Alice" }],
      })
      
      const onErrorSpy = vi.fn()
      
      const mutation = (_input: CreateUserInput) =>
        Effect.fail(new Error("Network error"))
      
      const optimisticMutation = Optimistic.createOptimisticMutation(
        mutation,
        {
          optimisticUpdate: (cache, input) => ({
            ...cache,
            "users.list": [...(cache["users.list"] as User[]), { id: "temp", ...input, email: input.email }],
          }),
          onError: onErrorSpy,
        },
        cacheRef
      )
      
      // Run mutation (should fail)
      const result = yield* Effect.either(
        optimisticMutation({ name: "Bob", email: "bob@test.com" })
      )
      
      // Should have failed
      expect(result._tag).toBe("Left")
      
      // Cache should be rolled back
      const finalCache = yield* Ref.get(cacheRef)
      expect((finalCache["users.list"] as User[]).length).toBe(1)
      expect((finalCache["users.list"] as User[])[0].name).toBe("Alice")
      
      // onError should have been called
      expect(onErrorSpy).toHaveBeenCalled()
    })
  )

  effectIt.effect("applies onSuccess update", () =>
    Effect.gen(function* () {
      const cacheRef = yield* Ref.make<Optimistic.CacheSnapshot>({
        "users.list": [{ id: "1", name: "Alice" }],
      })
      
      const mutation = (input: CreateUserInput) =>
        Effect.succeed({ id: "real-id-123", ...input })
      
      const optimisticMutation = Optimistic.createOptimisticMutation(
        mutation,
        {
          optimisticUpdate: (cache, input) => ({
            ...cache,
            "users.list": [...(cache["users.list"] as User[]), { id: "temp", ...input, email: input.email }],
          }),
          onSuccess: (result, cache, _input) => ({
            ...cache,
            "users.list": (cache["users.list"] as User[]).map(u =>
              u.id === "temp" ? result : u
            ),
          }),
        },
        cacheRef
      )
      
      // Run mutation
      yield* optimisticMutation({ name: "Bob", email: "bob@test.com" })
      
      // Cache should have real ID now
      const finalCache = yield* Ref.get(cacheRef)
      expect((finalCache["users.list"] as User[]).length).toBe(2)
      expect((finalCache["users.list"] as User[])[1].id).toBe("real-id-123")
    })
  )

  effectIt.effect("calls onSettled after success", () =>
    Effect.gen(function* () {
      const cacheRef = yield* Ref.make<Optimistic.CacheSnapshot>({})
      const onSettledSpy = vi.fn()
      
      const mutation = () => Effect.succeed({ id: "1" })
      
      const optimisticMutation = Optimistic.createOptimisticMutation(
        mutation,
        {
          optimisticUpdate: (cache) => cache,
          onSettled: onSettledSpy,
        },
        cacheRef
      )
      
      yield* optimisticMutation({} as any)
      
      expect(onSettledSpy).toHaveBeenCalled()
    })
  )

  effectIt.effect("calls onSettled after error", () =>
    Effect.gen(function* () {
      const cacheRef = yield* Ref.make<Optimistic.CacheSnapshot>({})
      const onSettledSpy = vi.fn()
      
      const mutation = () => Effect.fail(new Error("fail"))
      
      const optimisticMutation = Optimistic.createOptimisticMutation(
        mutation,
        {
          optimisticUpdate: (cache) => cache,
          onSettled: onSettledSpy,
        },
        cacheRef
      )
      
      yield* Effect.either(optimisticMutation({} as any))
      
      expect(onSettledSpy).toHaveBeenCalled()
    })
  )
})
