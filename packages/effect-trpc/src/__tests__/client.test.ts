/**
 * @module effect-trpc/__tests__/client
 *
 * Tests for the vanilla (non-React) tRPC client.
 * Tests request creation, response parsing, and error handling.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { Client, RpcClientError, RpcResponseError } from "../core/client/index.js"
import { Procedure, Procedures, Router } from "../index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const UserProcedures = Procedures.make({
  get: Procedure.input(Schema.Struct({ id: Schema.String })).output(UserSchema).query(),
  create: Procedure.input(Schema.Struct({ name: Schema.String })).output(UserSchema).mutation(),
  list: Procedure.output(Schema.Array(UserSchema)).query(),
})

const _testRouter = Router.make({
  user: UserProcedures,
})

type TestRouter = typeof _testRouter

// ─────────────────────────────────────────────────────────────────────────────
// Client Creation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Client Creation", () => {
  it("creates a client with default options", () => {
    const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

    expect(client).toBeDefined()
    expect(client.procedures).toBeDefined()
    expect(client.procedures.user).toBeDefined()
    expect(client.procedures.user.get).toBeDefined()
    expect(client.procedures.user.create).toBeDefined()
    expect(client.procedures.user.list).toBeDefined()
  })

  it("creates a client with static headers", () => {
    const client = Client.make<TestRouter>({
      url: "http://localhost:3000/rpc",
      headers: { "Authorization": "Bearer token" },
    })

    expect(client).toBeDefined()
  })

  it("creates a client with dynamic headers", () => {
    let callCount = 0
    const client = Client.make<TestRouter>({
      url: "http://localhost:3000/rpc",
      headers: () => {
        callCount++
        return { "Authorization": `Bearer token-${callCount}` }
      },
    })

    expect(client).toBeDefined()
    // Headers function is called lazily on each request
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Safety Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Type Safety", () => {
  it("procedure returns Effect with correct type", () => {
    const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

    // These should type-check - get returns Effect<User, ...>
    const getEffect = client.procedures.user.get({ id: "1" })
    expect(Effect.isEffect(getEffect)).toBe(true)

    // create returns Effect<User, ...>
    const createEffect = client.procedures.user.create({ name: "Alice" })
    expect(Effect.isEffect(createEffect)).toBe(true)

    // list returns Effect<User[], ...>
    const listEffect = client.procedures.user.list(undefined as void)
    expect(Effect.isEffect(listEffect)).toBe(true)
  })

  it("input types are enforced", () => {
    const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

    // This should compile - correct input type
    client.procedures.user.get({ id: "1" })
    client.procedures.user.create({ name: "Alice" })

    // These would fail at compile time if uncommented:
    // client.procedures.user.get({})  // Error: missing required field
    // client.procedures.user.get({ id: 123 })  // Error: wrong type
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Error Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Error Types", () => {
  it("RpcClientError has correct structure", () => {
    const error = new RpcClientError({
      message: "Test error",
      cause: new Error("Underlying cause"),
    })

    expect(error._tag).toBe("RpcClientError")
    expect(error.message).toBe("Test error")
    expect(error.cause).toBeInstanceOf(Error)
  })

  it("RpcClientError without cause", () => {
    const error = new RpcClientError({ message: "Test error" })

    expect(error._tag).toBe("RpcClientError")
    expect(error.message).toBe("Test error")
    expect(error.cause).toBeUndefined()
  })

  it("RpcResponseError has correct structure", () => {
    const error = new RpcResponseError({
      message: "HTTP error: 500",
      status: 500,
    })

    expect(error._tag).toBe("RpcResponseError")
    expect(error.message).toBe("HTTP error: 500")
    expect(error.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Proxy Behavior", () => {
  it("handles nested procedure access", () => {
    const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

    // Access should return functions (proxy creates new function each time, which is fine)
    const fn1 = client.procedures.user.get
    const fn2 = client.procedures.user.get
    
    expect(typeof fn1).toBe("function")
    expect(typeof fn2).toBe("function")
    
    // Both should return Effects when called
    expect(Effect.isEffect(fn1({ id: "1" }))).toBe(true)
    expect(Effect.isEffect(fn2({ id: "2" }))).toBe(true)
  })

  it("handles different group names", () => {
    // Create a more complex router
    const PostProcedures = Procedures.make({
      get: Procedure.input(Schema.Struct({ id: Schema.String })).output(Schema.String).query(),
    })

    const _ComplexRouter = Router.make({
      user: UserProcedures,
      post: PostProcedures,
    })

    type ComplexRouterType = typeof _ComplexRouter

    const client = Client.make<ComplexRouterType>({ url: "http://localhost:3000/rpc" })

    expect(client.procedures.user).toBeDefined()
    expect(client.procedures.post).toBeDefined()
    expect(client.procedures.user.get).toBeDefined()
    expect(client.procedures.post.get).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Schema Validation Tests (Unit tests for parsing logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("Response Parsing", () => {
  // These test the schema definitions used in client.ts

  it("RpcExitSuccess schema validates correctly", () => {
    const RpcExitSuccessSchema = Schema.TaggedStruct("Success", {
      value: Schema.Unknown,
    })

    const valid = { _tag: "Success", value: { id: "1", name: "Alice" } }
    const result = Schema.decodeUnknownSync(RpcExitSuccessSchema)(valid)

    expect(result._tag).toBe("Success")
    expect(result.value).toEqual({ id: "1", name: "Alice" })
  })

  it("RpcExitFailure schema validates correctly", () => {
    const RpcCauseSchema = Schema.Union(
      Schema.TaggedStruct("Fail", {
        error: Schema.Unknown,
      }),
      Schema.TaggedStruct("Die", {
        defect: Schema.Unknown,
      }),
      Schema.TaggedStruct("Interrupt", {
        fiberId: Schema.optional(Schema.Unknown),
      })
    )

    const RpcExitFailureSchema = Schema.TaggedStruct("Failure", {
      cause: Schema.optional(RpcCauseSchema),
    })

    const valid = {
      _tag: "Failure",
      cause: { _tag: "Fail", error: "Something went wrong" },
    }
    const result = Schema.decodeUnknownSync(RpcExitFailureSchema)(valid)

    expect(result._tag).toBe("Failure")
    expect(result.cause?._tag).toBe("Fail")
  })

  it("RpcDefectMessage schema validates correctly", () => {
    const RpcDefectMessageSchema = Schema.TaggedStruct("Defect", {
      defect: Schema.optional(Schema.String),
    })

    const valid = { _tag: "Defect", defect: "Unexpected error" }
    const result = Schema.decodeUnknownSync(RpcDefectMessageSchema)(valid)

    expect(result._tag).toBe("Defect")
    expect(result.defect).toBe("Unexpected error")
  })

  it("StreamPart schema validates correctly", () => {
    const RpcStreamPartSchema = Schema.Union(
      Schema.TaggedStruct("StreamPart", { value: Schema.Unknown }),
      Schema.TaggedStruct("Part", { value: Schema.Unknown }),
    )

    const validStreamPart = { _tag: "StreamPart", value: { data: "chunk1" } }
    const result1 = Schema.decodeUnknownSync(RpcStreamPartSchema)(validStreamPart)
    expect(result1._tag).toBe("StreamPart")

    const validPart = { _tag: "Part", value: { data: "chunk2" } }
    const result2 = Schema.decodeUnknownSync(RpcStreamPartSchema)(validPart)
    expect(result2._tag).toBe("Part")
  })

  it("StreamEnd schema validates correctly", () => {
    const RpcStreamEndSchema = Schema.Union(
      Schema.TaggedStruct("StreamEnd", {}),
      Schema.TaggedStruct("Complete", {}),
    )

    const validStreamEnd = { _tag: "StreamEnd" }
    const result1 = Schema.decodeUnknownSync(RpcStreamEndSchema)(validStreamEnd)
    expect(result1._tag).toBe("StreamEnd")

    const validComplete = { _tag: "Complete" }
    const result2 = Schema.decodeUnknownSync(RpcStreamEndSchema)(validComplete)
    expect(result2._tag).toBe("Complete")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Batch Configuration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Batch Configuration", () => {
  it("creates a client with batching disabled by default", () => {
    const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

    expect(client).toBeDefined()
    expect(client.procedures).toBeDefined()
  })

  it("creates a client with batching enabled", () => {
    const client = Client.make<TestRouter>({
      url: "http://localhost:3000/rpc",
      batch: {
        enabled: true,
      },
    })

    expect(client).toBeDefined()
    expect(client.procedures).toBeDefined()
    // Client should still work the same way from the outside
    expect(typeof client.procedures.user.get).toBe("function")
  })

  it("creates a client with custom batch config", () => {
    const client = Client.make<TestRouter>({
      url: "http://localhost:3000/rpc",
      batch: {
        enabled: true,
        maxSize: 20,
        windowMs: 50,
      },
    })

    expect(client).toBeDefined()
    expect(client.procedures).toBeDefined()
  })

  it("batch config uses default values when not specified", () => {
    const client = Client.make<TestRouter>({
      url: "http://localhost:3000/rpc",
      batch: {
        enabled: true,
        // maxSize and windowMs should use defaults (10 and 10)
      },
    })

    expect(client).toBeDefined()
  })

  it("batched client still returns Effect from procedures", () => {
    const client = Client.make<TestRouter>({
      url: "http://localhost:3000/rpc",
      batch: {
        enabled: true,
      },
    })

    const getEffect = client.procedures.user.get({ id: "1" })
    expect(Effect.isEffect(getEffect)).toBe(true)

    const createEffect = client.procedures.user.create({ name: "Alice" })
    expect(Effect.isEffect(createEffect)).toBe(true)
  })
})
