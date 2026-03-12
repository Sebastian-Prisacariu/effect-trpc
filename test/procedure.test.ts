/**
 * Procedure Module Tests
 * 
 * Tests for defining queries, mutations, and streams.
 * Verifies type inference, required fields, and JSDoc availability.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Schema } from "effect"

import { Procedure } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
  email: Schema.String,
}) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String }
) {}

class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { field: Schema.String, message: Schema.String }
) {}

// =============================================================================
// Query Tests
// =============================================================================

describe("Procedure.query", () => {
  it("creates a query with just success schema", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    expect(listUsers._tag).toBe("Query")
    expect(listUsers.successSchema).toBeDefined()
  })

  it("creates a query with payload and success", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    })

    expect(getUserById._tag).toBe("Query")
    expect(getUserById.payloadSchema).toBeDefined()
    expect(getUserById.successSchema).toBeDefined()
  })

  it("creates a query with payload, success, and error", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    })

    expect(getUserById._tag).toBe("Query")
    expect(getUserById.errorSchema).toBeDefined()
  })

  it("infers payload type correctly", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    })

    type PayloadType = Procedure.Payload<typeof getUserById>
    expectTypeOf<PayloadType>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("infers success type correctly", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type SuccessType = Procedure.Success<typeof listUsers>
    expectTypeOf<SuccessType>().toEqualTypeOf<readonly User[]>()
  })

  it("infers error type correctly", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    })

    type ErrorType = Procedure.Error<typeof getUserById>
    expectTypeOf<ErrorType>().toEqualTypeOf<NotFoundError>()
  })

  it("defaults error to never when not specified", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type ErrorType = Procedure.Error<typeof listUsers>
    expectTypeOf<ErrorType>().toEqualTypeOf<never>()
  })

  it("is pipeable", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    // Should have pipe method
    expect(typeof listUsers.pipe).toBe("function")
  })
})

// =============================================================================
// Mutation Tests
// =============================================================================

describe("Procedure.mutation", () => {
  it("requires invalidates array", () => {
    const createUser = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users"],
    })

    expect(createUser._tag).toBe("Mutation")
    expect(createUser.invalidates).toEqual(["users"])
  })

  it("accepts multiple invalidation targets", () => {
    const deleteUser = Procedure.mutation({
      payload: Schema.Struct({ id: Schema.String }),
      success: Schema.Void,
      invalidates: ["users", "users.count", "stats"],
    })

    expect(deleteUser.invalidates).toHaveLength(3)
  })

  it("accepts empty invalidates array", () => {
    const doSomething = Procedure.mutation({
      success: Schema.Void,
      invalidates: [],
    })

    expect(doSomething.invalidates).toEqual([])
  })

  it("accepts optimistic update config", () => {
    const createUser = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users"],
      optimistic: {
        target: "users",
        reducer: (users: readonly User[], input: CreateUserInput) => [
          ...users,
          new User({ id: `temp-${Date.now()}`, ...input }),
        ],
      },
    })

    expect(createUser.optimistic).toBeDefined()
    expect(createUser.optimistic?.target).toBe("users")
  })

  it("optimistic reconcile is optional", () => {
    const createUser = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users"],
      optimistic: {
        target: "users",
        reducer: (users: readonly User[], input: CreateUserInput) => [...users, input as unknown as User],
        reconcile: (users, _input, result) =>
          users.map((u) => (u.id.startsWith("temp") ? result : u)),
      },
    })

    expect(createUser.optimistic?.reconcile).toBeDefined()
  })

  it("extracts invalidates type", () => {
    const createUser = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users", "users.count"] as const,
    })

    type Invalidates = Procedure.Invalidates<typeof createUser>
    expectTypeOf<Invalidates>().toEqualTypeOf<readonly ["users", "users.count"]>()
  })
})

// =============================================================================
// Stream Tests
// =============================================================================

describe("Procedure.stream", () => {
  it("creates a stream procedure", () => {
    const watchUsers = Procedure.stream({
      success: User,
    })

    expect(watchUsers._tag).toBe("Stream")
  })

  it("stream success type is the chunk type, not array", () => {
    const watchUsers = Procedure.stream({
      success: User,
    })

    // Each chunk is a User, not User[]
    type SuccessType = Procedure.Success<typeof watchUsers>
    expectTypeOf<SuccessType>().toEqualTypeOf<User>()
  })

  it("accepts payload for filtered streams", () => {
    const watchUserActivity = Procedure.stream({
      payload: Schema.Struct({ userId: Schema.String }),
      success: Schema.Struct({
        type: Schema.String,
        timestamp: Schema.Number,
      }),
    })

    expect(watchUserActivity.payloadSchema).toBeDefined()
  })
})

// =============================================================================
// Guards Tests
// =============================================================================

describe("Procedure guards", () => {
  it("isProcedure identifies procedures", () => {
    const q = Procedure.query({ success: User })
    const m = Procedure.mutation({ success: User, invalidates: [] })
    const s = Procedure.stream({ success: User })

    expect(Procedure.isProcedure(q)).toBe(true)
    expect(Procedure.isProcedure(m)).toBe(true)
    expect(Procedure.isProcedure(s)).toBe(true)
    expect(Procedure.isProcedure({})).toBe(false)
    expect(Procedure.isProcedure(null)).toBe(false)
  })

  it("isQuery identifies queries", () => {
    const q = Procedure.query({ success: User })
    const m = Procedure.mutation({ success: User, invalidates: [] })

    expect(Procedure.isQuery(q)).toBe(true)
    expect(Procedure.isQuery(m)).toBe(false)
  })

  it("isMutation identifies mutations", () => {
    const q = Procedure.query({ success: User })
    const m = Procedure.mutation({ success: User, invalidates: [] })

    expect(Procedure.isMutation(q)).toBe(false)
    expect(Procedure.isMutation(m)).toBe(true)
  })

  it("isStream identifies streams", () => {
    const q = Procedure.query({ success: User })
    const s = Procedure.stream({ success: User })

    expect(Procedure.isStream(q)).toBe(false)
    expect(Procedure.isStream(s)).toBe(true)
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe("Procedure type safety", () => {
  it("success is required for all procedure types", () => {
    // @ts-expect-error - success is required
    Procedure.query({})

    // @ts-expect-error - success is required
    Procedure.mutation({
      invalidates: [],
    })

    // @ts-expect-error - success is required
    Procedure.stream({})
  })

  it("mutation requires invalidates", () => {
    // @ts-expect-error - invalidates is required
    Procedure.mutation({
      payload: CreateUserInput,
      success: User,
    })
  })

  it("query does not accept invalidates", () => {
    // @ts-expect-error - queries don't have invalidates
    Procedure.query({
      success: User,
      invalidates: ["something"],
    })
  })
})
