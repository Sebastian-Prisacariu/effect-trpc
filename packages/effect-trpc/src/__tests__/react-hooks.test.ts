/**
 * @module effect-trpc/__tests__/react-hooks
 *
 * Tests for React hooks utilities.
 *
 * Note: These tests focus on the utilities that power the React hooks.
 * Full hook tests would require a React testing environment (e.g., @testing-library/react).
 */

import { describe, it, expect } from "vitest"
import * as Exit from "effect/Exit"

import { generateQueryKey } from "../react/atoms.js"
import * as Result from "../react/result.js"

// ─────────────────────────────────────────────────────────────────────────────
// Query Key Generation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("generateQueryKey", () => {
  it("generates key with undefined input", () => {
    const key = generateQueryKey("user.get", undefined)
    expect(key).toBe("user.get:")
  })

  it("generates key with string input", () => {
    const key = generateQueryKey("user.get", "123")
    expect(key).toBe('user.get:"123"')
  })

  it("generates key with number input", () => {
    const key = generateQueryKey("user.get", 42)
    expect(key).toBe("user.get:42")
  })

  it("generates key with object input", () => {
    const key = generateQueryKey("user.get", { id: "123", name: "Alice" })
    expect(key).toBe('user.get:{"id":"123","name":"Alice"}')
  })

  it("generates key with array input", () => {
    const key = generateQueryKey("user.list", [1, 2, 3])
    expect(key).toBe("user.list:[1,2,3]")
  })

  it("generates key with BigInt input", () => {
    const key = generateQueryKey("user.get", BigInt(12345))
    expect(key).toBe('user.get:"BigInt(12345)"')
  })

  it("handles nested objects", () => {
    const key = generateQueryKey("user.search", {
      filters: { status: "active" },
      pagination: { page: 1, limit: 10 },
    })
    expect(key).toBe(
      'user.search:{"filters":{"status":"active"},"pagination":{"page":1,"limit":10}}',
    )
  })

  it("produces same key for same input", () => {
    const input = { id: "123", name: "Alice" }
    const key1 = generateQueryKey("user.get", input)
    const key2 = generateQueryKey("user.get", input)
    expect(key1).toBe(key2)
  })

  it("produces different keys for different inputs", () => {
    const key1 = generateQueryKey("user.get", { id: "1" })
    const key2 = generateQueryKey("user.get", { id: "2" })
    expect(key1).not.toBe(key2)
  })

  it("produces different keys for different paths", () => {
    const key1 = generateQueryKey("user.get", { id: "1" })
    const key2 = generateQueryKey("user.list", { id: "1" })
    expect(key1).not.toBe(key2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Type Tests (Additional to react-types.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("Result utilities", () => {
  describe("getValue", () => {
    it("returns undefined for initial", () => {
      expect(Result.getValue(Result.initial)).toBeUndefined()
    })

    it("returns previous for loading", () => {
      expect(Result.getValue(Result.loading(42))).toBe(42)
      expect(Result.getValue(Result.loading())).toBeUndefined()
    })

    it("returns value for success", () => {
      expect(Result.getValue(Result.success("data"))).toBe("data")
    })

    it("returns previous for failure", () => {
      expect(Result.getValue(Result.failure("error", "prev"))).toBe("prev")
      expect(Result.getValue(Result.failure("error"))).toBeUndefined()
    })
  })

  describe("getOrElse", () => {
    it("returns value for success", () => {
      expect(Result.getOrElse(Result.success(42), () => 0)).toBe(42)
    })

    it("returns fallback for non-success", () => {
      expect(Result.getOrElse(Result.initial, () => "fallback")).toBe("fallback")
      expect(Result.getOrElse(Result.loading(), () => "fallback")).toBe("fallback")
      expect(Result.getOrElse(Result.failure("err"), () => "fallback")).toBe("fallback")
    })
  })

  describe("getError", () => {
    it("returns error for failure", () => {
      expect(Result.getError(Result.failure("my-error"))).toBe("my-error")
    })

    it("returns undefined for non-failure", () => {
      expect(Result.getError(Result.initial)).toBeUndefined()
      expect(Result.getError(Result.loading())).toBeUndefined()
      expect(Result.getError(Result.success("data"))).toBeUndefined()
    })
  })

  describe("isPending", () => {
    it("returns true for initial", () => {
      expect(Result.isPending(Result.initial)).toBe(true)
    })

    it("returns true for loading", () => {
      expect(Result.isPending(Result.loading())).toBe(true)
    })

    it("returns true for success with refetching", () => {
      expect(Result.isPending(Result.success("data", true))).toBe(true)
    })

    it("returns false for success without refetching", () => {
      expect(Result.isPending(Result.success("data", false))).toBe(false)
    })

    it("returns true for failure with retrying", () => {
      expect(Result.isPending(Result.failure("err", undefined, true))).toBe(true)
    })

    it("returns false for failure without retrying", () => {
      expect(Result.isPending(Result.failure("err", undefined, false))).toBe(false)
    })
  })

  describe("toQueryResult", () => {
    it("converts initial correctly", () => {
      const qr = Result.toQueryResult(Result.initial)
      expect(qr.data).toBeUndefined()
      expect(qr.error).toBeUndefined()
      expect(qr.isLoading).toBe(true)
      expect(qr.isError).toBe(false)
      expect(qr.isSuccess).toBe(false)
      expect(qr.isRefetching).toBe(false)
    })

    it("converts loading correctly", () => {
      const qr = Result.toQueryResult(Result.loading("prev"))
      expect(qr.data).toBe("prev")
      expect(qr.error).toBeUndefined()
      expect(qr.isLoading).toBe(true)
      expect(qr.isError).toBe(false)
      expect(qr.isSuccess).toBe(false)
      expect(qr.isRefetching).toBe(false)
    })

    it("converts success correctly", () => {
      const qr = Result.toQueryResult(Result.success("data"))
      expect(qr.data).toBe("data")
      expect(qr.error).toBeUndefined()
      expect(qr.isLoading).toBe(false)
      expect(qr.isError).toBe(false)
      expect(qr.isSuccess).toBe(true)
      expect(qr.isRefetching).toBe(false)
    })

    it("converts success with refetching correctly", () => {
      const qr = Result.toQueryResult(Result.success("data", true))
      expect(qr.data).toBe("data")
      expect(qr.isRefetching).toBe(true)
    })

    it("converts failure correctly", () => {
      const qr = Result.toQueryResult(Result.failure("error", "prev"))
      expect(qr.data).toBe("prev")
      expect(qr.error).toBe("error")
      expect(qr.isLoading).toBe(false)
      expect(qr.isError).toBe(true)
      expect(qr.isSuccess).toBe(false)
    })
  })

  describe("toMutationResult", () => {
    it("converts initial correctly", () => {
      const mr = Result.toMutationResult(Result.initial)
      expect(mr.data).toBeUndefined()
      expect(mr.error).toBeUndefined()
      expect(mr.isPending).toBe(false)
      expect(mr.isError).toBe(false)
      expect(mr.isSuccess).toBe(false)
      expect(mr.isIdle).toBe(true)
    })

    it("converts loading correctly", () => {
      const mr = Result.toMutationResult(Result.loading())
      expect(mr.isPending).toBe(true)
      expect(mr.isIdle).toBe(false)
    })

    it("converts success correctly", () => {
      const mr = Result.toMutationResult(Result.success("data"))
      expect(mr.data).toBe("data")
      expect(mr.isPending).toBe(false)
      expect(mr.isSuccess).toBe(true)
      expect(mr.isIdle).toBe(false)
    })

    it("converts failure correctly", () => {
      const mr = Result.toMutationResult(Result.failure("error"))
      expect(mr.error).toBe("error")
      expect(mr.isPending).toBe(false)
      expect(mr.isError).toBe(true)
      expect(mr.isIdle).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Structural Equality Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result structural equality", () => {
  it("initial is singleton", () => {
    expect(Result.initial).toBe(Result.initial)
  })

  it("same success values are equal", () => {
    const a = Result.success({ id: "1", name: "Alice" })
    const b = Result.success({ id: "1", name: "Alice" })
    
    // Data.TaggedClass provides structural equality via Effect's Equal
    expect(a._tag).toBe(b._tag)
    expect(a.value).toEqual(b.value)
    expect(a.isRefetching).toBe(b.isRefetching)
  })

  it("different success values are not equal", () => {
    const a = Result.success({ id: "1" })
    const b = Result.success({ id: "2" })
    
    expect(a.value).not.toEqual(b.value)
  })

  it("loading preserves previous value", () => {
    const prev = { id: "1", name: "Alice" }
    const loading = Result.loading(prev)
    
    expect(loading.previous).toBe(prev)
  })

  it("failure preserves previous and error", () => {
    const prev = { id: "1" }
    const error = new Error("test")
    const failure = Result.failure(error, prev)
    
    expect(failure.error).toBe(error)
    expect(failure.previous).toBe(prev)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Query Deduplication Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Query Deduplication", () => {
  /**
   * Simulates the deduplication logic used in createTRPCReact.
   * This is a unit test for the deduplication pattern.
   */
  const createDeduplicator = () => {
    const inFlightQueries = new Map<string, Promise<Exit.Exit<unknown, unknown>>>()

    return {
      execute: <A, E>(
        key: string,
        effectFn: () => Promise<Exit.Exit<A, E>>,
      ): Promise<Exit.Exit<A, E>> => {
        const existing = inFlightQueries.get(key)
        if (existing) {
          return existing as Promise<Exit.Exit<A, E>>
        }

        const promise = effectFn().finally(() => {
          inFlightQueries.delete(key)
        })

        inFlightQueries.set(key, promise as Promise<Exit.Exit<unknown, unknown>>)
        return promise
      },
      getInFlightCount: () => inFlightQueries.size,
      hasInFlight: (key: string) => inFlightQueries.has(key),
    }
  }

  it("deduplicates concurrent requests with same key", async () => {
    const deduplicator = createDeduplicator()
    let callCount = 0

    const mockFetch = () => {
      callCount++
      return new Promise<Exit.Exit<string, never>>((resolve) => {
        setTimeout(() => resolve(Exit.succeed("data")), 50)
      })
    }

    // Start 3 concurrent requests with the same key
    const key = generateQueryKey("user.get", { id: "123" })
    const promise1 = deduplicator.execute(key, mockFetch)
    const promise2 = deduplicator.execute(key, mockFetch)
    const promise3 = deduplicator.execute(key, mockFetch)

    // All should share the same promise
    expect(promise1).toBe(promise2)
    expect(promise2).toBe(promise3)

    // Only one request should be in-flight
    expect(deduplicator.getInFlightCount()).toBe(1)
    expect(deduplicator.hasInFlight(key)).toBe(true)

    // Wait for all to complete
    const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

    // All should get the same result
    expect(Exit.isSuccess(result1) && result1.value).toBe("data")
    expect(Exit.isSuccess(result2) && result2.value).toBe("data")
    expect(Exit.isSuccess(result3) && result3.value).toBe("data")

    // Only one actual fetch should have been made
    expect(callCount).toBe(1)

    // In-flight should be cleared
    expect(deduplicator.getInFlightCount()).toBe(0)
    expect(deduplicator.hasInFlight(key)).toBe(false)
  })

  it("does not deduplicate requests with different keys", async () => {
    const deduplicator = createDeduplicator()
    let callCount = 0

    const mockFetch = () => {
      callCount++
      return Promise.resolve(Exit.succeed(`data-${callCount}`))
    }

    const key1 = generateQueryKey("user.get", { id: "1" })
    const key2 = generateQueryKey("user.get", { id: "2" })

    const promise1 = deduplicator.execute(key1, mockFetch)
    const promise2 = deduplicator.execute(key2, mockFetch)

    // Different keys = different promises
    expect(promise1).not.toBe(promise2)

    // Two requests should be in-flight
    expect(deduplicator.getInFlightCount()).toBe(2)

    await Promise.all([promise1, promise2])

    // Two actual fetches should have been made
    expect(callCount).toBe(2)
  })

  it("allows new request after previous completes", async () => {
    const deduplicator = createDeduplicator()
    let callCount = 0

    const mockFetch = () => {
      callCount++
      return Promise.resolve(Exit.succeed(`data-${callCount}`))
    }

    const key = generateQueryKey("user.get", { id: "123" })

    // First request
    const result1 = await deduplicator.execute(key, mockFetch)
    expect(Exit.isSuccess(result1) && result1.value).toBe("data-1")
    expect(callCount).toBe(1)

    // Second request (after first completes)
    const result2 = await deduplicator.execute(key, mockFetch)
    expect(Exit.isSuccess(result2) && result2.value).toBe("data-2")
    expect(callCount).toBe(2)
  })

  it("handles errors correctly", async () => {
    const deduplicator = createDeduplicator()
    let callCount = 0

    const mockFetch = () => {
      callCount++
      return Promise.resolve(Exit.fail(new Error("fetch failed")))
    }

    const key = generateQueryKey("user.get", { id: "123" })

    // Start 2 concurrent requests
    const promise1 = deduplicator.execute(key, mockFetch)
    const promise2 = deduplicator.execute(key, mockFetch)

    // Should share the same promise
    expect(promise1).toBe(promise2)

    const [result1, result2] = await Promise.all([promise1, promise2])

    // Both should get the same error
    expect(Exit.isFailure(result1)).toBe(true)
    expect(Exit.isFailure(result2)).toBe(true)

    // Only one fetch should have been made
    expect(callCount).toBe(1)

    // In-flight should be cleared even on error
    expect(deduplicator.getInFlightCount()).toBe(0)
  })
})
