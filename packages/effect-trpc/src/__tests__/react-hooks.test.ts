/**
 * @module effect-trpc/__tests__/react-hooks
 *
 * Tests for React hooks utilities.
 *
 * Note: These tests focus on the utilities that power the React hooks.
 * Full hook tests would require a React testing environment (e.g., @testing-library/react).
 */

import { describe, it, expect } from "vitest"

import { generateQueryKey } from "../react/atoms.js"
import { Result, toQueryResult, toMutationResult } from "../react/result.js"

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
// Result Type Tests - effect-atom API
// ─────────────────────────────────────────────────────────────────────────────

describe("Result (effect-atom)", () => {
  describe("state constructors", () => {
    it("creates initial state", () => {
      const result = Result.initial()
      expect(Result.isInitial(result)).toBe(true)
      expect(Result.isSuccess(result)).toBe(false)
      expect(Result.isFailure(result)).toBe(false)
    })

    it("creates initial with waiting flag", () => {
      const result = Result.initial(true)
      expect(Result.isInitial(result)).toBe(true)
      expect(result.waiting).toBe(true)
    })

    it("creates success state", () => {
      const result = Result.success("data")
      expect(Result.isSuccess(result)).toBe(true)
      expect(result.value).toBe("data")
    })

    it("creates success with waiting flag (refetching)", () => {
      const result = Result.success("data", { waiting: true })
      expect(Result.isSuccess(result)).toBe(true)
      expect(result.value).toBe("data")
      expect(result.waiting).toBe(true)
    })

    it("creates failure from error", () => {
      const result = Result.fail("my-error")
      expect(Result.isFailure(result)).toBe(true)
    })
  })

  describe("type guards", () => {
    it("isInitial identifies initial state", () => {
      expect(Result.isInitial(Result.initial())).toBe(true)
      expect(Result.isInitial(Result.success("x"))).toBe(false)
      expect(Result.isInitial(Result.fail("e"))).toBe(false)
    })

    it("isSuccess identifies success state", () => {
      expect(Result.isSuccess(Result.initial())).toBe(false)
      expect(Result.isSuccess(Result.success("x"))).toBe(true)
      expect(Result.isSuccess(Result.fail("e"))).toBe(false)
    })

    it("isFailure identifies failure state", () => {
      expect(Result.isFailure(Result.initial())).toBe(false)
      expect(Result.isFailure(Result.success("x"))).toBe(false)
      expect(Result.isFailure(Result.fail("e"))).toBe(true)
    })

    it("isWaiting checks waiting flag", () => {
      expect(Result.isWaiting(Result.initial())).toBe(false)
      expect(Result.isWaiting(Result.initial(true))).toBe(true)
      expect(Result.isWaiting(Result.success("x"))).toBe(false)
      expect(Result.isWaiting(Result.success("x", { waiting: true }))).toBe(true)
    })
  })

  describe("value extraction", () => {
    it("value returns Option with data", () => {
      const initial = Result.initial()
      const success = Result.success("data")

      expect(Result.value(initial)._tag).toBe("None")
      expect(Result.value(success)._tag).toBe("Some")
      if (Result.value(success)._tag === "Some") {
        expect(Result.value(success).value).toBe("data")
      }
    })

    it("getOrElse returns value or fallback", () => {
      const success = Result.success(42)
      const initial = Result.initial()

      expect(Result.getOrElse(success, () => 0)).toBe(42)
      expect(Result.getOrElse(initial, () => 0)).toBe(0)
    })

    it("error returns Option with error", () => {
      const success = Result.success("data")
      const failure = Result.fail("my-error")

      expect(Result.error(success)._tag).toBe("None")
      expect(Result.error(failure)._tag).toBe("Some")
      if (Result.error(failure)._tag === "Some") {
        expect(Result.error(failure).value).toBe("my-error")
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toQueryResult Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("toQueryResult", () => {
  it("converts initial correctly", () => {
    const qr = toQueryResult(Result.initial())
    expect(qr.data).toBeUndefined()
    expect(qr.error).toBeUndefined()
    expect(qr.isLoading).toBe(true)
    expect(qr.isError).toBe(false)
    expect(qr.isSuccess).toBe(false)
    expect(qr.isRefetching).toBe(false)
  })

  it("converts initial with waiting correctly", () => {
    const qr = toQueryResult(Result.initial(true))
    expect(qr.isLoading).toBe(true)
    expect(qr.isRefetching).toBe(false)
  })

  it("converts success correctly", () => {
    const qr = toQueryResult(Result.success("data"))
    expect(qr.data).toBe("data")
    expect(qr.error).toBeUndefined()
    expect(qr.isLoading).toBe(false)
    expect(qr.isError).toBe(false)
    expect(qr.isSuccess).toBe(true)
    expect(qr.isRefetching).toBe(false)
  })

  it("converts success with refetching correctly", () => {
    const qr = toQueryResult(Result.success("data", { waiting: true }))
    expect(qr.data).toBe("data")
    expect(qr.isLoading).toBe(false)
    expect(qr.isSuccess).toBe(false) // Not settled yet
    expect(qr.isRefetching).toBe(true)
  })

  it("converts failure correctly", () => {
    const qr = toQueryResult(Result.fail("error"))
    expect(qr.data).toBeUndefined()
    expect(qr.error).toBe("error")
    expect(qr.isLoading).toBe(false)
    expect(qr.isError).toBe(true)
    expect(qr.isSuccess).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toMutationResult Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("toMutationResult", () => {
  it("converts initial correctly (idle)", () => {
    const mr = toMutationResult(Result.initial())
    expect(mr.data).toBeUndefined()
    expect(mr.error).toBeUndefined()
    expect(mr.isPending).toBe(false)
    expect(mr.isError).toBe(false)
    expect(mr.isSuccess).toBe(false)
    expect(mr.isIdle).toBe(true)
  })

  it("converts initial with waiting correctly (pending)", () => {
    const mr = toMutationResult(Result.initial(true))
    expect(mr.isPending).toBe(true)
    expect(mr.isIdle).toBe(false)
  })

  it("converts success correctly", () => {
    const mr = toMutationResult(Result.success("data"))
    expect(mr.data).toBe("data")
    expect(mr.isPending).toBe(false)
    expect(mr.isSuccess).toBe(true)
    expect(mr.isIdle).toBe(false)
  })

  it("converts failure correctly", () => {
    const mr = toMutationResult(Result.fail("error"))
    expect(mr.error).toBe("error")
    expect(mr.isPending).toBe(false)
    expect(mr.isError).toBe(true)
    expect(mr.isIdle).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Query Deduplication Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Query Deduplication", () => {
  it("same query key produces same cache entry", () => {
    const key1 = generateQueryKey("user.get", { id: "123" })
    const key2 = generateQueryKey("user.get", { id: "123" })
    expect(key1).toBe(key2)
  })

  it("different inputs produce different cache entries", () => {
    const key1 = generateQueryKey("user.get", { id: "1" })
    const key2 = generateQueryKey("user.get", { id: "2" })
    expect(key1).not.toBe(key2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Pattern Matching (builder pattern)
// ─────────────────────────────────────────────────────────────────────────────

describe("Result builder pattern", () => {
  it("matches initial state", () => {
    const result = Result.initial()
    const output = Result.builder(result)
      .onInitial(() => "loading")
      .onSuccess(() => "success")
      .onError(() => "error")
      .orNull()

    expect(output).toBe("loading")
  })

  it("matches success state", () => {
    const result = Result.success("data")
    const output = Result.builder(result)
      .onInitial(() => "loading")
      .onSuccess((value: string) => `got: ${value}`)
      .onError(() => "error")
      .orNull()

    expect(output).toBe("got: data")
  })

  it("matches failure state", () => {
    const result = Result.fail<string>("oops")
    const output = Result.builder(result)
      .onInitial(() => "loading")
      .onSuccess(() => "success")
      .onError((err: string) => `error: ${err}`)
      .orNull()

    expect(output).toBe("error: oops")
  })

  it("uses orNull for unhandled cases", () => {
    const result = Result.initial()
    const output = Result.builder(result)
      .onSuccess(() => "success")
      .orNull()

    expect(output).toBeNull()
  })
})
