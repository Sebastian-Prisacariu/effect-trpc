/**
 * @module effect-trpc/tests/react-types
 *
 * Type system tests for React hooks.
 * Tests use effect-atom's Result types and our custom converters.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import type * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import {
  Result,
  toQueryResult,
  toMutationResult,
  type QueryResult,
  type MutationResult,
  type UseQueryReturn,
  type UseMutationReturn,
  type UseStreamReturn,
  type UseChatReturn,
} from "../react/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Result Type Tests (using effect-atom's Result)
// ─────────────────────────────────────────────────────────────────────────────

describe("Result type", () => {
  it("initial has correct type", () => {
    const result = Result.initial()

    expect(Result.isInitial(result)).toBe(true)
    expectTypeOf(result).toMatchTypeOf<Result.Initial<never, never>>()
  })

  it("initial with waiting has correct type", () => {
    const result = Result.initial(true)

    expect(Result.isInitial(result)).toBe(true)
    expect(result.waiting).toBe(true)
  })

  it("success has correct type", () => {
    const result = Result.success({ id: "1", name: "Alice" })

    expect(Result.isSuccess(result)).toBe(true)
    expectTypeOf(result).toMatchTypeOf<Result.Success<{ id: string; name: string }, never>>()
    expectTypeOf(result.value).toMatchTypeOf<{ id: string; name: string }>()
  })

  it("success with waiting has correct type (refetching)", () => {
    const result = Result.success("data", { waiting: true })

    expect(Result.isSuccess(result)).toBe(true)
    expect(result.waiting).toBe(true)
  })

  it("failure has correct type", () => {
    const result = Result.fail<Error, string>(new Error("test"))

    expect(Result.isFailure(result)).toBe(true)
    expectTypeOf(result).toMatchTypeOf<Result.Failure<string, Error>>()
  })

  it("Result union includes all states", () => {
    type TestResult = Result.Result<string, Error>

    expectTypeOf<TestResult>().toMatchTypeOf<
      Result.Initial<string, Error> | Result.Success<string, Error> | Result.Failure<string, Error>
    >()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Guards Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result guards", () => {
  it("isInitial narrows type", () => {
    const result: Result.Result<string, Error> = Result.initial()

    if (Result.isInitial(result)) {
      expectTypeOf(result).toMatchTypeOf<Result.Initial<string, Error>>()
    }
  })

  it("isSuccess narrows type", () => {
    const result: Result.Result<string, Error> = Result.success("hello")

    if (Result.isSuccess(result)) {
      expectTypeOf(result).toMatchTypeOf<Result.Success<string, Error>>()
      expectTypeOf(result.value).toEqualTypeOf<string>()
    }
  })

  it("isFailure narrows type", () => {
    const result: Result.Result<string, Error> = Result.fail(new Error("test"))

    if (Result.isFailure(result)) {
      expectTypeOf(result).toMatchTypeOf<Result.Failure<string, Error>>()
    }
  })

  it("isWaiting checks waiting flag", () => {
    const initial = Result.initial()
    const initialWaiting = Result.initial(true)
    const success = Result.success("x")
    const successWaiting = Result.success("x", { waiting: true })

    expect(Result.isWaiting(initial)).toBe(false)
    expect(Result.isWaiting(initialWaiting)).toBe(true)
    expect(Result.isWaiting(success)).toBe(false)
    expect(Result.isWaiting(successWaiting)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Accessors Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result accessors", () => {
  it("value returns Option with data", () => {
    const result: Result.Result<number, Error> = Result.success(42)
    const valueOption = Result.value(result)

    expect(valueOption._tag).toBe("Some")
    if (valueOption._tag === "Some") {
      expect(valueOption.value).toBe(42)
    }
  })

  it("getOrElse returns value or fallback", () => {
    const success: Result.Result<number, Error> = Result.success(42)
    const initial: Result.Result<number, Error> = Result.initial()

    expect(Result.getOrElse(success, () => 0)).toBe(42)
    expect(Result.getOrElse(initial, () => 0)).toBe(0)
  })

  it("error returns Option with error", () => {
    const failure = Result.fail<string>("my-error")
    const errorOption = Result.error(failure)

    expect(errorOption._tag).toBe("Some")
    if (errorOption._tag === "Some") {
      expect(errorOption.value).toBe("my-error")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Pattern Matching Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result pattern matching", () => {
  it("match returns correct type", () => {
    const result: Result.Result<number, string> = Result.success(42)

    const output = Result.match(result, {
      onInitial: () => "initial",
      onSuccess: (s) => `success: ${s.value}`,
      onFailure: () => "failure",
    })

    expect(output).toBe("success: 42")
  })

  it("builder pattern works correctly", () => {
    const result: Result.Result<string, string> = Result.success("data")

    const output = Result.builder(result)
      .onSuccess((value: string) => `got: ${value}`)
      .orNull()

    expect(output).toBe("got: data")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// QueryResult / MutationResult Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("QueryResult type", () => {
  it("toQueryResult has correct shape", () => {
    const result: Result.Result<string, Error> = Result.success("hello")
    const queryResult = toQueryResult(result)

    // Runtime checks that the types are correct
    expect(typeof queryResult.isLoading).toBe("boolean")
    expect(typeof queryResult.isError).toBe("boolean")
    expect(typeof queryResult.isSuccess).toBe("boolean")
    expect(typeof queryResult.isRefetching).toBe("boolean")

    // These verify the shape compiles correctly
    expectTypeOf(queryResult).toHaveProperty("data")
    expectTypeOf(queryResult).toHaveProperty("error")
    expectTypeOf(queryResult).toHaveProperty("result")
  })

  it("toQueryResult converts success correctly", () => {
    const result = Result.success("hello")
    const qr = toQueryResult(result)

    expect(qr.data).toBe("hello")
    expect(qr.isSuccess).toBe(true)
    expect(qr.isLoading).toBe(false)
    expect(qr.isRefetching).toBe(false)
  })

  it("toQueryResult converts refetching correctly", () => {
    const result = Result.success("hello", { waiting: true })
    const qr = toQueryResult(result)

    expect(qr.data).toBe("hello")
    expect(qr.isRefetching).toBe(true)
    expect(qr.isLoading).toBe(false)
  })
})

describe("MutationResult type", () => {
  it("toMutationResult has correct shape", () => {
    const result: Result.Result<number, string> = Result.initial()
    const mutationResult = toMutationResult(result)

    // Runtime checks that the types are correct
    expect(typeof mutationResult.isPending).toBe("boolean")
    expect(typeof mutationResult.isError).toBe("boolean")
    expect(typeof mutationResult.isSuccess).toBe("boolean")
    expect(typeof mutationResult.isIdle).toBe("boolean")

    // These verify the shape compiles correctly
    expectTypeOf(mutationResult).toHaveProperty("data")
    expectTypeOf(mutationResult).toHaveProperty("error")
    expectTypeOf(mutationResult).toHaveProperty("result")
  })

  it("toMutationResult converts idle correctly", () => {
    const result = Result.initial()
    const mr = toMutationResult(result)

    expect(mr.isIdle).toBe(true)
    expect(mr.isPending).toBe(false)
  })

  it("toMutationResult converts pending correctly", () => {
    const result = Result.initial(true)
    const mr = toMutationResult(result)

    expect(mr.isIdle).toBe(false)
    expect(mr.isPending).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Hook Return Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Hook return types", () => {
  it("UseQueryReturn has correct shape", () => {
    type TestQueryReturn = UseQueryReturn<{ id: string }, Error>

    expectTypeOf<TestQueryReturn["data"]>().toEqualTypeOf<{ id: string } | undefined>()
    expectTypeOf<TestQueryReturn["error"]>().toEqualTypeOf<Error | undefined>()
    expectTypeOf<TestQueryReturn["isLoading"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestQueryReturn["isError"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestQueryReturn["isSuccess"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestQueryReturn["refetch"]>().toBeFunction()
  })

  it("UseMutationReturn has correct shape", () => {
    type TestMutationReturn = UseMutationReturn<{ id: string }, Error, { name: string }>

    expectTypeOf<TestMutationReturn["data"]>().toEqualTypeOf<{ id: string } | undefined>()
    expectTypeOf<TestMutationReturn["error"]>().toEqualTypeOf<Error | undefined>()
    expectTypeOf<TestMutationReturn["isPending"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestMutationReturn["mutateAsync"]>().toMatchTypeOf<
      (input: { name: string }) => Promise<Exit.Exit<{ id: string }, Error>>
    >()
    expectTypeOf<TestMutationReturn["mutate"]>().toMatchTypeOf<
      (input: { name: string }) => Effect.Effect<{ id: string }, Error>
    >()
    expectTypeOf<TestMutationReturn["reset"]>().toBeFunction()
  })

  it("UseStreamReturn has correct shape", () => {
    type TestStreamReturn = UseStreamReturn<{ chunk: string }, Error>

    expectTypeOf<TestStreamReturn["data"]>().toEqualTypeOf<ReadonlyArray<{ chunk: string }>>()
    expectTypeOf<TestStreamReturn["error"]>().toEqualTypeOf<Error | undefined>()
    expectTypeOf<TestStreamReturn["isStreaming"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestStreamReturn["isComplete"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestStreamReturn["isError"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestStreamReturn["restart"]>().toBeFunction()
    expectTypeOf<TestStreamReturn["stop"]>().toBeFunction()
  })

  it("UseChatReturn has correct shape with typed send", () => {
    type ChatInput = { message: string; conversationId: string }
    type ChatPart = { type: "text"; text: string } | { type: "tool"; name: string }
    type ChatError = { code: string; message: string }

    type TestChatReturn = UseChatReturn<ChatInput, ChatPart, ChatError>

    // Verify send accepts the correct input type
    expectTypeOf<TestChatReturn["send"]>().toMatchTypeOf<(input: ChatInput) => void>()
    expectTypeOf<TestChatReturn["send"]>().toMatchTypeOf<
      (input: { message: string; conversationId: string }) => void
    >()

    // Verify parts are correctly typed
    expectTypeOf<TestChatReturn["parts"]>().toEqualTypeOf<ReadonlyArray<ChatPart>>()

    // Verify error is correctly typed
    expectTypeOf<TestChatReturn["error"]>().toEqualTypeOf<ChatError | undefined>()

    // Verify other properties
    expectTypeOf<TestChatReturn["text"]>().toEqualTypeOf<string>()
    expectTypeOf<TestChatReturn["isStreaming"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestChatReturn["isError"]>().toEqualTypeOf<boolean>()
    expectTypeOf<TestChatReturn["reset"]>().toBeFunction()
    expectTypeOf<TestChatReturn["stop"]>().toBeFunction()
  })
})
