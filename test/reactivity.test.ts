/**
 * Reactivity Module Tests
 * 
 * Tests for path-based cache invalidation.
 */

import { describe, it, expect } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, Scope } from "effect"

import { Reactivity } from "../src/index.js"

// =============================================================================
// Path Utilities
// =============================================================================

describe("normalizePath", () => {
  it("converts dots to slashes", () => {
    expect(Reactivity.normalizePath("users.list")).toBe("users/list")
  })

  it("handles single segment", () => {
    expect(Reactivity.normalizePath("users")).toBe("users")
  })

  it("handles deeply nested paths", () => {
    expect(Reactivity.normalizePath("admin.users.permissions.list"))
      .toBe("admin/users/permissions/list")
  })
})

describe("shouldInvalidate", () => {
  it("returns true for exact match", () => {
    expect(Reactivity.shouldInvalidate("users/list", "users/list")).toBe(true)
  })

  it("returns true when parent invalidates child", () => {
    expect(Reactivity.shouldInvalidate("users/list", "users")).toBe(true)
  })

  it("returns true for deeply nested descendants", () => {
    expect(Reactivity.shouldInvalidate("users/permissions/edit", "users")).toBe(true)
  })

  it("returns false for sibling paths", () => {
    expect(Reactivity.shouldInvalidate("posts/list", "users")).toBe(false)
  })

  it("returns false for partial matches", () => {
    // "user" is not a parent of "users/list"
    expect(Reactivity.shouldInvalidate("users/list", "user")).toBe(false)
  })

  it("returns false when child tries to invalidate parent", () => {
    // Invalidating "users/list" should NOT invalidate "users" subscription
    expect(Reactivity.shouldInvalidate("users", "users/list")).toBe(false)
  })
})

// =============================================================================
// PathReactivity Service
// =============================================================================

describe("PathReactivity", () => {
  const testLayer = Reactivity.layer

  effectIt.effect("register adds path to registry", () =>
    Effect.gen(function* () {
      const service = yield* Reactivity.PathReactivity
      
      // Register in a scope
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* service.register("users.list")
          
          const paths = yield* service.getRegisteredPaths()
          expect(paths).toContain("users/list")
        })
      )
    }).pipe(Effect.provide(testLayer))
  )

  effectIt.effect("unregister removes path when scope closes", () =>
    Effect.gen(function* () {
      const service = yield* Reactivity.PathReactivity
      
      // Register in a scope, then let it close
      yield* Effect.scoped(
        service.register("users.list")
      )
      
      // Path should be gone
      const paths = yield* service.getRegisteredPaths()
      expect(paths).not.toContain("users/list")
    }).pipe(Effect.provide(testLayer))
  )

  effectIt.effect("reference counting - multiple registrations", () =>
    Effect.gen(function* () {
      const service = yield* Reactivity.PathReactivity
      
      // First registration
      const scope1 = yield* Scope.make()
      yield* service.register("users.list").pipe(Scope.extend(scope1))
      
      // Second registration (same path)
      const scope2 = yield* Scope.make()
      yield* service.register("users.list").pipe(Scope.extend(scope2))
      
      // Path should be registered
      let paths = yield* service.getRegisteredPaths()
      expect(paths).toContain("users/list")
      
      // Close first scope - path should still be registered
      yield* Scope.close(scope1, { _tag: "Success", value: void 0 })
      paths = yield* service.getRegisteredPaths()
      expect(paths).toContain("users/list")
      
      // Close second scope - path should be gone
      yield* Scope.close(scope2, { _tag: "Success", value: void 0 })
      paths = yield* service.getRegisteredPaths()
      expect(paths).not.toContain("users/list")
    }).pipe(Effect.provide(testLayer))
  )

  effectIt.effect("invalidate triggers hierarchical invalidation", () =>
    Effect.gen(function* () {
      const service = yield* Reactivity.PathReactivity
      
      yield* Effect.scoped(
        Effect.gen(function* () {
          // Register some paths
          yield* service.register("users.list")
          yield* service.register("users.get")
          yield* service.register("posts.list")
          
          // Verify all registered
          const paths = yield* service.getRegisteredPaths()
          expect(paths).toContain("users/list")
          expect(paths).toContain("users/get")
          expect(paths).toContain("posts/list")
          
          // Invalidate "users" - should affect users/* but not posts/*
          // (The actual invalidation goes to inner Reactivity)
          yield* service.invalidate(["users"])
        })
      )
    }).pipe(Effect.provide(testLayer))
  )

  effectIt.effect("normalizes dot-separated paths", () =>
    Effect.gen(function* () {
      const service = yield* Reactivity.PathReactivity
      
      yield* Effect.scoped(
        Effect.gen(function* () {
          // Register with dots
          yield* service.register("admin.users.list")
          
          const paths = yield* service.getRegisteredPaths()
          expect(paths).toContain("admin/users/list")
          
          // Invalidate with dots
          yield* service.invalidate(["admin.users"])
        })
      )
    }).pipe(Effect.provide(testLayer))
  )
})

// =============================================================================
// Convenience Functions
// =============================================================================

describe("Convenience functions", () => {
  const testLayer = Reactivity.layer

  effectIt.effect("register function works", () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Reactivity.register("users.list")
          
          const paths = yield* Reactivity.getRegisteredPaths()
          expect(paths).toContain("users/list")
        })
      )
    }).pipe(Effect.provide(testLayer))
  )

  effectIt.effect("invalidate function works", () =>
    Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Reactivity.register("users.list")
          yield* Reactivity.invalidate(["users"])
        })
      )
    }).pipe(Effect.provide(testLayer))
  )
})
