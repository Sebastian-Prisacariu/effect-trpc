/**
 * Reactivity Module Tests
 * 
 * Tests for cache invalidation and subscription management.
 */

import { describe, it, expect, vi } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Reactivity } from "../src/index.js"

// =============================================================================
// Reactivity.make Tests
// =============================================================================

describe("Reactivity.make", () => {
  it("creates a ReactivityService", () => {
    const service = Reactivity.make()
    
    expect(service.subscribe).toBeDefined()
    expect(service.invalidate).toBeDefined()
    expect(service.getSubscribedTags).toBeDefined()
  })
})

// =============================================================================
// Subscribe Tests
// =============================================================================

describe("subscribe", () => {
  it("adds callback to subscriptions", () => {
    const service = Reactivity.make()
    const callback = vi.fn()
    
    service.subscribe("@api/users/list", callback)
    
    expect(service.getSubscribedTags()).toContain("@api/users/list")
  })

  it("returns unsubscribe function", () => {
    const service = Reactivity.make()
    const callback = vi.fn()
    
    const unsubscribe = service.subscribe("@api/users/list", callback)
    
    expect(typeof unsubscribe).toBe("function")
    
    unsubscribe()
    expect(service.getSubscribedTags()).not.toContain("@api/users/list")
  })

  it("allows multiple callbacks per tag", () => {
    const service = Reactivity.make()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    
    service.subscribe("@api/users/list", cb1)
    service.subscribe("@api/users/list", cb2)
    
    service.invalidate(["@api/users/list"])
    
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
  })

  it("unsubscribe only removes specific callback", () => {
    const service = Reactivity.make()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    
    const unsub1 = service.subscribe("@api/users/list", cb1)
    service.subscribe("@api/users/list", cb2)
    
    unsub1()
    service.invalidate(["@api/users/list"])
    
    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// Invalidate Tests
// =============================================================================

describe("invalidate", () => {
  it("calls exact match callbacks", () => {
    const service = Reactivity.make()
    const callback = vi.fn()
    
    service.subscribe("@api/users/list", callback)
    service.invalidate(["@api/users/list"])
    
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("does not call non-matching callbacks", () => {
    const service = Reactivity.make()
    const usersCallback = vi.fn()
    const postsCallback = vi.fn()
    
    service.subscribe("@api/users/list", usersCallback)
    service.subscribe("@api/posts/list", postsCallback)
    
    service.invalidate(["@api/users/list"])
    
    expect(usersCallback).toHaveBeenCalledTimes(1)
    expect(postsCallback).not.toHaveBeenCalled()
  })

  it("supports hierarchical invalidation (parent invalidates children)", () => {
    const service = Reactivity.make()
    const listCallback = vi.fn()
    const getCallback = vi.fn()
    
    service.subscribe("@api/users/list", listCallback)
    service.subscribe("@api/users/get", getCallback)
    
    // Invalidating parent should trigger children
    service.invalidate(["@api/users"])
    
    expect(listCallback).toHaveBeenCalledTimes(1)
    expect(getCallback).toHaveBeenCalledTimes(1)
  })

  it("supports reverse hierarchical (child invalidates parent listener)", () => {
    const service = Reactivity.make()
    const usersCallback = vi.fn()
    
    // Subscribe to parent
    service.subscribe("@api/users", usersCallback)
    
    // Invalidate child
    service.invalidate(["@api/users/list"])
    
    // Parent should be notified
    expect(usersCallback).toHaveBeenCalledTimes(1)
  })

  it("handles multiple tags", () => {
    const service = Reactivity.make()
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const cb3 = vi.fn()
    
    service.subscribe("@api/users/list", cb1)
    service.subscribe("@api/posts/list", cb2)
    service.subscribe("@api/comments/list", cb3)
    
    service.invalidate(["@api/users/list", "@api/posts/list"])
    
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(cb3).not.toHaveBeenCalled()
  })

  it("only calls each callback once even with multiple matching tags", () => {
    const service = Reactivity.make()
    const callback = vi.fn()
    
    service.subscribe("@api/users/list", callback)
    
    // Both tags would match the same callback
    service.invalidate(["@api/users", "@api/users/list"])
    
    // Should only be called once
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("continues if a callback throws", () => {
    const service = Reactivity.make()
    const cb1 = vi.fn(() => { throw new Error("oops") })
    const cb2 = vi.fn()
    
    service.subscribe("@api/users/list", cb1)
    service.subscribe("@api/users/list", cb2)
    
    // Should not throw
    expect(() => service.invalidate(["@api/users/list"])).not.toThrow()
    
    // cb2 should still be called
    expect(cb2).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// pathsToTags Tests
// =============================================================================

describe("pathsToTags", () => {
  it("converts dot-separated paths to tag format", () => {
    const tags = Reactivity.pathsToTags("@api", ["users", "users.list"])
    
    expect(tags).toEqual(["@api/users", "@api/users/list"])
  })

  it("handles single segment paths", () => {
    const tags = Reactivity.pathsToTags("@api", ["health"])
    
    expect(tags).toEqual(["@api/health"])
  })

  it("handles deeply nested paths", () => {
    const tags = Reactivity.pathsToTags("@api", ["admin.users.permissions.list"])
    
    expect(tags).toEqual(["@api/admin/users/permissions/list"])
  })
})

// =============================================================================
// shouldInvalidate Tests
// =============================================================================

describe("shouldInvalidate", () => {
  it("returns true for exact match", () => {
    expect(Reactivity.shouldInvalidate("@api/users/list", "@api/users/list")).toBe(true)
  })

  it("returns true when parent invalidates child", () => {
    expect(Reactivity.shouldInvalidate("@api/users/list", "@api/users")).toBe(true)
  })

  it("returns true when child invalidates parent subscription", () => {
    expect(Reactivity.shouldInvalidate("@api/users", "@api/users/list")).toBe(true)
  })

  it("returns false for unrelated tags", () => {
    expect(Reactivity.shouldInvalidate("@api/users/list", "@api/posts/list")).toBe(false)
  })

  it("returns false for partial matches", () => {
    // "@api/user" is not a parent of "@api/users/list"
    expect(Reactivity.shouldInvalidate("@api/users/list", "@api/user")).toBe(false)
  })
})

// =============================================================================
// Effect-based API Tests
// =============================================================================

describe("Effect-based API", () => {
  effectIt.effect("subscribe returns unsubscribe function", () =>
    Effect.gen(function* () {
      const unsub = yield* Reactivity.subscribe("@api/users", () => {})
      
      expect(typeof unsub).toBe("function")
    }).pipe(Effect.provide(Reactivity.ReactivityLive))
  )

  effectIt.effect("invalidate triggers callbacks", () =>
    Effect.gen(function* () {
      let called = false
      
      yield* Reactivity.subscribe("@api/users", () => { called = true })
      yield* Reactivity.invalidate(["@api/users"])
      
      expect(called).toBe(true)
    }).pipe(Effect.provide(Reactivity.ReactivityLive))
  )

  effectIt.effect("getSubscribedTags returns active subscriptions", () =>
    Effect.gen(function* () {
      yield* Reactivity.subscribe("@api/users", () => {})
      yield* Reactivity.subscribe("@api/posts", () => {})
      
      const tags = yield* Reactivity.getSubscribedTags
      
      expect(tags).toContain("@api/users")
      expect(tags).toContain("@api/posts")
    }).pipe(Effect.provide(Reactivity.ReactivityLive))
  )
})

// =============================================================================
// ReactivityLive Layer Tests
// =============================================================================

describe("ReactivityLive", () => {
  effectIt.effect("provides Reactivity service", () =>
    Effect.gen(function* () {
      const service = yield* Reactivity.Reactivity
      
      expect(service.subscribe).toBeDefined()
      expect(service.invalidate).toBeDefined()
    }).pipe(Effect.provide(Reactivity.ReactivityLive))
  )
})
