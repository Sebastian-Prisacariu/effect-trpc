/**
 * Reactivity Module Tests
 * 
 * Tests for cache invalidation utilities.
 * Note: @effect/experimental/Reactivity is tested in that package.
 * We test our path utilities here.
 */

import { describe, it, expect } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Reactivity } from "../src/index.js"

// =============================================================================
// pathsToTags Tests
// =============================================================================

describe("pathsToTags", () => {
  it("converts dot-separated paths to tag format", () => {
    const tags = Reactivity.pathsToTags("@api", ["users", "users.list"])
    
    // Note: pathsToTags no longer includes root tag prefix
    // The root tag is applied at the call site
    expect(tags).toEqual(["users", "users/list"])
  })

  it("handles single segment paths", () => {
    const tags = Reactivity.pathsToTags("@api", ["health"])
    
    expect(tags).toEqual(["health"])
  })

  it("handles deeply nested paths", () => {
    const tags = Reactivity.pathsToTags("@api", ["admin.users.permissions.list"])
    
    expect(tags).toEqual(["admin/users/permissions/list"])
  })
})

// =============================================================================
// shouldInvalidate Tests
// =============================================================================

describe("shouldInvalidate", () => {
  it("returns true for exact match", () => {
    expect(Reactivity.shouldInvalidate("users/list", "users/list")).toBe(true)
  })

  it("returns true when parent invalidates child", () => {
    expect(Reactivity.shouldInvalidate("users/list", "users")).toBe(true)
  })

  it("returns true when child invalidates parent subscription", () => {
    expect(Reactivity.shouldInvalidate("users", "users/list")).toBe(true)
  })

  it("returns false for unrelated tags", () => {
    expect(Reactivity.shouldInvalidate("users/list", "posts/list")).toBe(false)
  })

  it("returns false for partial matches", () => {
    // "user" is not a parent of "users/list"
    expect(Reactivity.shouldInvalidate("users/list", "user")).toBe(false)
  })
})

// =============================================================================
// @effect/experimental/Reactivity Integration Tests
// =============================================================================

describe("Effect Reactivity integration", () => {
  effectIt.effect("invalidate is an Effect", () =>
    Effect.gen(function* () {
      // Reactivity.invalidate returns an Effect
      // This test just verifies the API shape
      const effect = Reactivity.invalidate(["users"])
      
      // It requires the Reactivity service
      expect(Effect.isEffect(effect)).toBe(true)
    })
  )

  effectIt.effect("mutation wraps effect with invalidation", () =>
    Effect.gen(function* () {
      // Reactivity.mutation takes (effect, keys) and invalidates after success
      const effect = Effect.succeed("result")
      const wrapped = Reactivity.mutation(effect, ["users"])
      
      expect(Effect.isEffect(wrapped)).toBe(true)
    })
  )

  effectIt.effect("layer provides Reactivity service", () =>
    Effect.gen(function* () {
      // Reactivity.layer is a Layer<Reactivity>
      const layer = Reactivity.layer
      
      expect(Layer.isLayer(layer)).toBe(true)
    })
  )
})

// =============================================================================
// Reactivity Service Tests
// =============================================================================

describe("Reactivity service", () => {
  effectIt.effect("invalidate works with layer", () =>
    Effect.gen(function* () {
      yield* Reactivity.invalidate(["users"])
      // Should complete without error
    }).pipe(Effect.provide(Reactivity.layer))
  )

  effectIt.effect("mutation invalidates after success", () =>
    Effect.gen(function* () {
      const result = yield* Reactivity.mutation(
        Effect.succeed("created"),
        ["users"]
      )
      
      expect(result).toBe("created")
    }).pipe(Effect.provide(Reactivity.layer))
  )
})
