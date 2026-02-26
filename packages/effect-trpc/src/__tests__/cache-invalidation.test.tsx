// @vitest-environment jsdom
/**
 * @module effect-trpc/__tests__/cache-invalidation
 *
 * Tests for cache invalidation behavior in effect-trpc React client.
 *
 * These tests verify:
 * 1. Query key generation and registration
 * 2. Invalidation functions work correctly at the registry level
 * 3. Cache utilities (getQueryData, setQueryData)
 * 4. Procedure metadata extraction for invalidates
 * 5. Prefix matching behavior
 *
 * Note: These tests verify the invalidation logic works correctly at the
 * effect-atom registry level. The integration with React hooks (useQuery,
 * useMutation) and automatic refetching is tested in integration tests
 * that use actual HTTP servers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as React from "react"
import { renderHook, act, waitFor, cleanup } from "@testing-library/react"
import * as Schema from "effect/Schema"
import * as AtomRegistry from "@effect-atom/atom/Registry"
import * as AtomResult from "@effect-atom/atom/Result"
import { RegistryContext } from "@effect-atom/atom-react"

import { Procedure } from "../core/index.js"
import { Procedures } from "../core/index.js"
import { Router, extractMetadata } from "../core/server/router.js"
import {
  RegistryProvider,
  queryAtomFamily,
  generateQueryKey,
  registerQueryKey,
  invalidateQueryByKey,
  invalidateQueriesByPrefix,
  invalidateAllQueries,
  getQueryData,
  setQueryData,
  getRegisteredQueryKeys,
  createAtomCacheUtils,
  initialQueryState,
  clearQueryKeyRegistry,
  type QueryAtomState,
} from "../react/atoms.js"
import { useAtomValue, useAtomSet, useAtomMount } from "@effect-atom/atom-react"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Schemas
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

type User = typeof UserSchema.Type

const PostSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  userId: Schema.String,
})

type Post = typeof PostSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Procedures (for metadata extraction)
// ─────────────────────────────────────────────────────────────────────────────

const UserProcedures = Procedures.make({
  list: Procedure.output(Schema.Array(UserSchema)).query(),

  byId: Procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(Schema.Union(UserSchema, Schema.Null))
    .query(),

  create: Procedure
    .input(Schema.Struct({ name: Schema.String }))
    .output(UserSchema)
    .invalidates(["user.list"]) // Should invalidate user.list after mutation
    .mutation(),

  update: Procedure
    .input(Schema.Struct({ id: Schema.String, name: Schema.String }))
    .output(UserSchema)
    .invalidates(["user.list", "user.byId"]) // Multiple invalidations
    .mutation(),
})

const PostProcedures = Procedures.make({
  list: Procedure.output(Schema.Array(PostSchema)).query(),

  byUser: Procedure
    .input(Schema.Struct({ userId: Schema.String }))
    .output(Schema.Array(PostSchema))
    .query(),

  create: Procedure
    .input(Schema.Struct({ title: Schema.String, userId: Schema.String }))
    .output(PostSchema)
    .invalidates(["post.list", "post.byUser"]) // Invalidates all post queries
    .mutation(),
})

const testRouter = Router.make({
  user: UserProcedures,
  post: PostProcedures,
})

// Extract metadata from router for invalidation
const routerMetadata = extractMetadata(testRouter)

// ─────────────────────────────────────────────────────────────────────────────
// Registry Wrapper for Tests
// ─────────────────────────────────────────────────────────────────────────────

// Track current test registry for cleanup
let currentTestRegistry: AtomRegistry.Registry | null = null

/**
 * Create a test wrapper with a fresh, isolated registry.
 * Each call creates a completely new registry to avoid state leaking between tests.
 */
const createTestWrapper = () => {
  // Create a fresh registry for this test
  const registry = AtomRegistry.make()
  currentTestRegistry = registry

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      RegistryContext.Provider,
      { value: registry },
      children,
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper to get registry in tests
// ─────────────────────────────────────────────────────────────────────────────

const useTestRegistry = () => {
  const registry = React.useContext(RegistryContext) as AtomRegistry.Registry
  return registry
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper to create success state
// ─────────────────────────────────────────────────────────────────────────────

const makeSuccessState = (data: unknown): QueryAtomState<unknown, unknown> => ({
  result: AtomResult.success(data),
  lastFetchedAt: Date.now(),
  previousError: null,
})

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Cache Invalidation", () => {
  // Clean up after each test to ensure proper isolation
  afterEach(() => {
    cleanup()
    if (currentTestRegistry) {
      // Reset and dispose the registry to clean up any state
      currentTestRegistry.reset()
      currentTestRegistry.dispose()
      currentTestRegistry = null
    }
  })

  describe("Query Key Generation", () => {
    it("generates stable query keys for same path and input", () => {
      const key1 = generateQueryKey("user.list", undefined)
      const key2 = generateQueryKey("user.list", undefined)
      expect(key1).toBe(key2)
    })

    it("generates different keys for different inputs", () => {
      const key1 = generateQueryKey("user.byId", { id: "1" })
      const key2 = generateQueryKey("user.byId", { id: "2" })
      expect(key1).not.toBe(key2)
    })

    it("generates different keys for different paths", () => {
      const key1 = generateQueryKey("user.list", undefined)
      const key2 = generateQueryKey("post.list", undefined)
      expect(key1).not.toBe(key2)
    })

    it("handles complex nested inputs with stable stringification", () => {
      const key1 = generateQueryKey("user.search", {
        filters: { status: "active", role: "admin" },
        pagination: { page: 1, limit: 10 },
      })

      const key2 = generateQueryKey("user.search", {
        pagination: { limit: 10, page: 1 },
        filters: { role: "admin", status: "active" },
      })

      // Should produce same key regardless of property order
      expect(key1).toBe(key2)
    })
  })

  describe("Query Key Registration", () => {
    it("registers query keys in the registry", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)

      // Check initial state
      const keysBefore = getRegisteredQueryKeys(result.current)
      expect(keysBefore.has(key)).toBe(false)

      // Register key
      act(() => {
        registerQueryKey(result.current, key)
      })

      // Check after registration
      const keysAfter = getRegisteredQueryKeys(result.current)
      expect(keysAfter.has(key)).toBe(true)
    })

    it("registers multiple keys independently", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key1 = generateQueryKey("user.list", undefined)
      const key2 = generateQueryKey("user.byId", { id: "1" })
      const key3 = generateQueryKey("post.list", undefined)

      act(() => {
        registerQueryKey(result.current, key1)
        registerQueryKey(result.current, key2)
        registerQueryKey(result.current, key3)
      })

      const keys = getRegisteredQueryKeys(result.current)
      expect(keys.has(key1)).toBe(true)
      expect(keys.has(key2)).toBe(true)
      expect(keys.has(key3)).toBe(true)
      expect(keys.size).toBe(3)
    })
  })

  describe("Invalidation Functions (Registry Level)", () => {
    it("invalidateQueryByKey resets specific query to initial state", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)
      const atom = queryAtomFamily(key)

      // Register and set data
      act(() => {
        registerQueryKey(result.current, key)
        result.current.set(atom, makeSuccessState([{ id: "1", name: "Alice" }]))
      })

      // Verify data is set
      const stateBefore = result.current.get(atom)
      expect(AtomResult.isSuccess(stateBefore.result)).toBe(true)

      // Invalidate
      act(() => {
        invalidateQueryByKey(result.current, key)
      })

      // Verify state is reset to initial
      const stateAfter = result.current.get(atom)
      expect(AtomResult.isInitial(stateAfter.result)).toBe(true)
      expect(stateAfter.lastFetchedAt).toBe(null)
    })

    it("invalidateQueryByKey only affects registered keys", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)
      const atom = queryAtomFamily(key)

      // Set data WITHOUT registering the key
      act(() => {
        result.current.set(atom, makeSuccessState([{ id: "1", name: "Alice" }]))
      })

      // Try to invalidate (should be a no-op since key isn't registered)
      act(() => {
        invalidateQueryByKey(result.current, key)
      })

      // Data should still be there (not invalidated)
      const stateAfter = result.current.get(atom)
      expect(AtomResult.isSuccess(stateAfter.result)).toBe(true)
    })

    it("invalidateQueriesByPrefix resets matching queries", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const userListKey = generateQueryKey("user.list", undefined)
      const userByIdKey = generateQueryKey("user.byId", { id: "1" })
      const postListKey = generateQueryKey("post.list", undefined)

      const userListAtom = queryAtomFamily(userListKey)
      const userByIdAtom = queryAtomFamily(userByIdKey)
      const postListAtom = queryAtomFamily(postListKey)

      // Register and set data
      act(() => {
        registerQueryKey(result.current, userListKey)
        registerQueryKey(result.current, userByIdKey)
        registerQueryKey(result.current, postListKey)

        result.current.set(userListAtom, makeSuccessState([{ id: "1", name: "Alice" }]))
        result.current.set(userByIdAtom, makeSuccessState({ id: "1", name: "Alice" }))
        result.current.set(postListAtom, makeSuccessState([{ id: "1", title: "Post" }]))
      })

      // Invalidate by "user" prefix
      act(() => {
        invalidateQueriesByPrefix(result.current, "user")
      })

      // User queries should be reset
      expect(AtomResult.isInitial(result.current.get(userListAtom).result)).toBe(true)
      expect(AtomResult.isInitial(result.current.get(userByIdAtom).result)).toBe(true)

      // Post query should still have data
      expect(AtomResult.isSuccess(result.current.get(postListAtom).result)).toBe(true)
    })

    it("invalidateQueriesByPrefix with specific path only invalidates exact matches", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const userListKey = generateQueryKey("user.list", undefined)
      const userByIdKey = generateQueryKey("user.byId", { id: "1" })

      const userListAtom = queryAtomFamily(userListKey)
      const userByIdAtom = queryAtomFamily(userByIdKey)

      act(() => {
        registerQueryKey(result.current, userListKey)
        registerQueryKey(result.current, userByIdKey)

        result.current.set(userListAtom, makeSuccessState([]))
        result.current.set(userByIdAtom, makeSuccessState({}))
      })

      // Invalidate by "user.list" prefix (more specific)
      act(() => {
        invalidateQueriesByPrefix(result.current, "user.list")
      })

      // user.list should be reset
      expect(AtomResult.isInitial(result.current.get(userListAtom).result)).toBe(true)

      // user.byId should NOT be reset (doesn't start with "user.list")
      expect(AtomResult.isSuccess(result.current.get(userByIdAtom).result)).toBe(true)
    })

    it("invalidateAllQueries resets all registered queries", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const userListKey = generateQueryKey("user.list", undefined)
      const postListKey = generateQueryKey("post.list", undefined)

      const userListAtom = queryAtomFamily(userListKey)
      const postListAtom = queryAtomFamily(postListKey)

      act(() => {
        registerQueryKey(result.current, userListKey)
        registerQueryKey(result.current, postListKey)

        result.current.set(userListAtom, makeSuccessState([]))
        result.current.set(postListAtom, makeSuccessState([]))
      })

      // Invalidate all
      act(() => {
        invalidateAllQueries(result.current)
      })

      // Both should be reset
      expect(AtomResult.isInitial(result.current.get(userListAtom).result)).toBe(true)
      expect(AtomResult.isInitial(result.current.get(postListAtom).result)).toBe(true)
    })
  })

  describe("Cache Data Functions", () => {
    it("getQueryData returns cached data", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)
      const atom = queryAtomFamily(key)

      // Register and set data
      act(() => {
        registerQueryKey(result.current, key)
        result.current.set(atom, makeSuccessState([{ id: "1", name: "Alice" }]))
      })

      // Get data via helper
      const data = getQueryData<User[]>(result.current, "user.list", undefined)
      expect(data).toEqual([{ id: "1", name: "Alice" }])
    })

    it("getQueryData returns undefined for unregistered keys", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      // Don't register the key
      const data = getQueryData<User[]>(result.current, "user.list", undefined)
      expect(data).toBeUndefined()
    })

    it("getQueryData returns undefined for initial state", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)

      // Register but don't set data
      act(() => {
        registerQueryKey(result.current, key)
      })

      const data = getQueryData<User[]>(result.current, "user.list", undefined)
      expect(data).toBeUndefined()
    })

    it("setQueryData updates cache directly", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)
      const atom = queryAtomFamily(key)

      // Set data via helper (doesn't require registration)
      act(() => {
        setQueryData(result.current, "user.list", undefined, [{ id: "1", name: "Bob" }])
      })

      // Verify state updated
      const state = result.current.get(atom)
      expect(AtomResult.isSuccess(state.result)).toBe(true)
      if (AtomResult.isSuccess(state.result)) {
        expect(state.result.value).toEqual([{ id: "1", name: "Bob" }])
      }
    })

    it("setQueryData supports updater function", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const key = generateQueryKey("user.list", undefined)
      const atom = queryAtomFamily(key)

      // Set initial data
      act(() => {
        registerQueryKey(result.current, key)
        result.current.set(atom, makeSuccessState([{ id: "1", name: "Alice" }]))
      })

      // Update via updater function
      act(() => {
        setQueryData<User[]>(result.current, "user.list", undefined, (old) => [
          ...(old ?? []),
          { id: "2", name: "Bob" },
        ])
      })

      // Verify state updated
      const state = result.current.get(atom)
      expect(AtomResult.isSuccess(state.result)).toBe(true)
      if (AtomResult.isSuccess(state.result)) {
        const users = state.result.value as User[]
        expect(users).toHaveLength(2)
        expect(users[1]?.name).toBe("Bob")
      }
    })
  })

  describe("AtomCacheUtils", () => {
    it("provides getQueryData, setQueryData, and invalidate", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const cacheUtils = createAtomCacheUtils(result.current)

      // Test setQueryData
      act(() => {
        registerQueryKey(result.current, generateQueryKey("user.list", undefined))
        cacheUtils.setQueryData("user.list", undefined, [{ id: "1", name: "Alice" }])
      })

      // Test getQueryData
      const data = cacheUtils.getQueryData<User[]>("user.list", undefined)
      expect(data).toEqual([{ id: "1", name: "Alice" }])

      // Test invalidate with specific input
      act(() => {
        cacheUtils.invalidate("user.list", undefined)
      })

      const atom = queryAtomFamily(generateQueryKey("user.list", undefined))
      expect(AtomResult.isInitial(result.current.get(atom).result)).toBe(true)
    })

    it("invalidate with no input uses prefix matching", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      const cacheUtils = createAtomCacheUtils(result.current)

      const userListKey = generateQueryKey("user.list", undefined)
      const userByIdKey = generateQueryKey("user.byId", { id: "1" })

      const userListAtom = queryAtomFamily(userListKey)
      const userByIdAtom = queryAtomFamily(userByIdKey)

      act(() => {
        registerQueryKey(result.current, userListKey)
        registerQueryKey(result.current, userByIdKey)
        result.current.set(userListAtom, makeSuccessState([]))
        result.current.set(userByIdAtom, makeSuccessState({}))
      })

      // Invalidate all "user" queries (no input = prefix match)
      act(() => {
        cacheUtils.invalidate("user")
      })

      expect(AtomResult.isInitial(result.current.get(userListAtom).result)).toBe(true)
      expect(AtomResult.isInitial(result.current.get(userByIdAtom).result)).toBe(true)
    })
  })

  describe("Procedure Metadata Extraction", () => {
    it("extracts invalidates from mutation procedures", () => {
      expect(routerMetadata["user.create"]).toEqual({
        invalidates: ["user.list"],
      })
    })

    it("extracts multiple invalidates", () => {
      expect(routerMetadata["user.update"]).toEqual({
        invalidates: ["user.list", "user.byId"],
      })
    })

    it("extracts invalidates from nested procedures", () => {
      expect(routerMetadata["post.create"]).toEqual({
        invalidates: ["post.list", "post.byUser"],
      })
    })

    it("does not extract metadata from query procedures", () => {
      expect(routerMetadata["user.list"]).toBeUndefined()
      expect(routerMetadata["user.byId"]).toBeUndefined()
      expect(routerMetadata["post.list"]).toBeUndefined()
    })
  })

  describe("Prefix Matching Behavior", () => {
    it("user prefix matches user.list and user.byId keys", () => {
      const userListKey = generateQueryKey("user.list", undefined)
      const userByIdKey = generateQueryKey("user.byId", { id: "1" })
      const postListKey = generateQueryKey("post.list", undefined)

      expect(userListKey.startsWith("user")).toBe(true)
      expect(userByIdKey.startsWith("user")).toBe(true)
      expect(postListKey.startsWith("user")).toBe(false)
    })

    it("user.list prefix matches user.list but not user.byId", () => {
      const userListKey = generateQueryKey("user.list", undefined)
      const userByIdKey = generateQueryKey("user.byId", { id: "1" })

      expect(userListKey.startsWith("user.list")).toBe(true)
      expect(userByIdKey.startsWith("user.list")).toBe(false)
    })

    it("post prefix matches post.list and post.byUser", () => {
      const postListKey = generateQueryKey("post.list", undefined)
      const postByUserKey = generateQueryKey("post.byUser", { userId: "1" })

      expect(postListKey.startsWith("post")).toBe(true)
      expect(postByUserKey.startsWith("post")).toBe(true)
    })
  })

  describe("Edge Cases", () => {
    it("invalidating non-existent key is a no-op", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      // Should not throw
      expect(() => {
        invalidateQueryByKey(result.current, "nonexistent.key||")
      }).not.toThrow()
    })

    it("invalidating with non-matching prefix is a no-op", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      // Should not throw
      expect(() => {
        invalidateQueriesByPrefix(result.current, "nonexistent")
      }).not.toThrow()
    })

    it("invalidating empty registry is a no-op", () => {
      const wrapper = createTestWrapper()

      const { result } = renderHook(() => useTestRegistry(), { wrapper })

      // Should not throw on fresh registry
      expect(() => {
        invalidateAllQueries(result.current)
      }).not.toThrow()
    })
  })
})
