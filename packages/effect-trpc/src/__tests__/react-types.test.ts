/**
 * @module effect-trpc/tests/react-types
 *
 * Type system tests for React hooks.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import type * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import {
  type Result,
  type Initial,
  type Loading,
  type Success,
  type Failure,
  type QueryResult,
  type MutationResult,
  type UseQueryReturn,
  type UseMutationReturn,
  type UseStreamReturn,
  type UseChatReturn,
  initial,
  loading,
  success,
  failure,
  isInitial,
  isLoading,
  isSuccess,
  isFailure,
  getValue,
  getOrElse,
  match,
  toQueryResult,
  toMutationResult,
} from "../react/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Result Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result type", () => {
  it("initial has correct type", () => {
    const result = initial

    expectTypeOf(result).toMatchTypeOf<Initial>()
    expectTypeOf(result._tag).toEqualTypeOf<"Initial">()
  })

  it("loading has correct type", () => {
    const result = loading<string>()

    expectTypeOf(result).toMatchTypeOf<Loading<string>>()
    expectTypeOf(result._tag).toEqualTypeOf<"Loading">()
  })

  it("loading preserves previous value type", () => {
    const result = loading<number>(42)

    expectTypeOf(result.previous).toEqualTypeOf<number | undefined>()
  })

  it("success has correct type", () => {
    const result = success({ id: "1", name: "Alice" })

    expectTypeOf(result).toMatchTypeOf<Success<{ id: string; name: string }>>()
    expectTypeOf(result.value).toMatchTypeOf<{ id: string; name: string }>()
    expectTypeOf(result.isRefetching).toEqualTypeOf<boolean>()
  })

  it("failure has correct type", () => {
    const result = failure<string, Error>(new Error("test"))

    expectTypeOf(result).toMatchTypeOf<Failure<string, Error>>()
    expectTypeOf(result.error).toEqualTypeOf<Error>()
    expectTypeOf(result.previous).toEqualTypeOf<string | undefined>()
  })

  it("Result union includes all states", () => {
    type TestResult = Result<string, Error>

    expectTypeOf<TestResult>().toMatchTypeOf<
      Initial | Loading<string> | Success<string> | Failure<string, Error>
    >()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Guards Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result guards", () => {
  it("isInitial narrows type", () => {
    const result: Result<string, Error> = initial

    if (isInitial(result)) {
      expectTypeOf(result).toMatchTypeOf<Initial>()
    }
  })

  it("isLoading narrows type", () => {
    const result: Result<string, Error> = loading()

    if (isLoading(result)) {
      expectTypeOf(result).toMatchTypeOf<Loading<string>>()
    }
  })

  it("isSuccess narrows type", () => {
    const result: Result<string, Error> = success("hello")

    if (isSuccess(result)) {
      expectTypeOf(result).toMatchTypeOf<Success<string>>()
      expectTypeOf(result.value).toEqualTypeOf<string>()
    }
  })

  it("isFailure narrows type", () => {
    const result: Result<string, Error> = failure(new Error("test"))

    if (isFailure(result)) {
      expectTypeOf(result).toMatchTypeOf<Failure<string, Error>>()
      expectTypeOf(result.error).toEqualTypeOf<Error>()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Accessors Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result accessors", () => {
  it("getValue returns value or undefined", () => {
    const result: Result<number, Error> = success(42)
    const value = getValue(result)

    expectTypeOf(value).toEqualTypeOf<number | undefined>()
  })

  it("getOrElse returns value type", () => {
    const result: Result<number, Error> = initial
    const value = getOrElse(result, () => 0)

    expectTypeOf(value).toEqualTypeOf<number>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Result Pattern Matching Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Result pattern matching", () => {
  it("match returns correct type", () => {
    const result: Result<number, string> = success(42)

    const output = match<number, string, string>(result, {
      onInitial: () => "initial",
      onLoading: () => "loading",
      onSuccess: (value) => {
        // Verify value type by assignment
        const _v: number = value
        void _v
        return "success"
      },
      onFailure: (error) => {
        // Verify error type by assignment
        const _e: string = error
        void _e
        return "failure"
      },
    })

    // Runtime check that pattern matching works
    expect(output).toBe("success")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// QueryResult / MutationResult Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("QueryResult type", () => {
  it("toQueryResult has correct shape", () => {
    const result: Result<string, Error> = success("hello")
    const queryResult: QueryResult<string, Error> = toQueryResult(result)

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
})

describe("MutationResult type", () => {
  it("toMutationResult has correct shape", () => {
    const result: Result<number, string> = initial
    const mutationResult: MutationResult<number, string> = toMutationResult(result)

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
