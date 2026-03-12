/**
 * Procedure Module Tests
 * 
 * Tests for defining queries, mutations, and streams.
 * Verifies type inference, required fields, and JSDoc availability.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema } from "effect"

// These imports will fail until we implement them
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
    expect(listUsers.success).toBeDefined()
  })

  it("creates a query with payload and success", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    })

    expect(getUserById._tag).toBe("Query")
    expect(getUserById.payload).toBeDefined()
    expect(getUserById.success).toBeDefined()
  })

  it("creates a query with payload, success, and error", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    })

    expect(getUserById._tag).toBe("Query")
    expect(getUserById.error).toBeDefined()
  })

  it("infers payload type correctly", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    })

    // Type test: payload should be { id: string }
    type Payload = Procedure.PayloadOf<typeof getUserById>
    expectTypeOf<Payload>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("infers success type correctly", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type Success = Procedure.SuccessOf<typeof listUsers>
    expectTypeOf<Success>().toEqualTypeOf<readonly User[]>()
  })

  it("infers error type correctly", () => {
    const getUserById = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    })

    type Error = Procedure.ErrorOf<typeof getUserById>
    expectTypeOf<Error>().toEqualTypeOf<NotFoundError>()
  })

  it("defaults error to never when not specified", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type Error = Procedure.ErrorOf<typeof listUsers>
    expectTypeOf<Error>().toEqualTypeOf<never>()
  })

  it("defaults payload to void when not specified", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type Payload = Procedure.PayloadOf<typeof listUsers>
    expectTypeOf<Payload>().toEqualTypeOf<void>()
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
      invalidates: ["user.list"],
    })

    expect(createUser._tag).toBe("Mutation")
    expect(createUser.invalidates).toEqual(["user.list"])
  })

  it("accepts multiple invalidation targets", () => {
    const deleteUser = Procedure.mutation({
      payload: Schema.Struct({ id: Schema.String }),
      success: Schema.Void,
      invalidates: ["user.list", "user.byId", "user.count"],
    })

    expect(createUser.invalidates).toHaveLength(3)
  })

  it("accepts optimistic update config", () => {
    const createUser = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["user.list"],
      optimistic: {
        target: "user.list",
        reducer: (users: User[], input) => [
          ...users,
          new User({ id: `temp-${Date.now()}`, ...input }),
        ],
      },
    })

    expect(createUser.optimistic).toBeDefined()
    expect(createUser.optimistic?.target).toBe("user.list")
  })

  it("optimistic reconcile is optional", () => {
    const createUser = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["user.list"],
      optimistic: {
        target: "user.list",
        reducer: (users: User[], input) => [...users, input as User],
        reconcile: (users, input, result) =>
          users.map((u) => (u.id.startsWith("temp") ? result : u)),
      },
    })

    expect(createUser.optimistic?.reconcile).toBeDefined()
  })

  // @ts-expect-error - mutation without invalidates should be a type error
  it.fails("fails without invalidates", () => {
    Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      // Missing invalidates!
    })
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
    type Success = Procedure.SuccessOf<typeof watchUsers>
    expectTypeOf<Success>().toEqualTypeOf<User>()
  })

  it("accepts payload for filtered streams", () => {
    const watchUserActivity = Procedure.stream({
      payload: Schema.Struct({ userId: Schema.String }),
      success: Schema.Struct({
        type: Schema.String,
        timestamp: Schema.Number,
      }),
    })

    expect(watchUserActivity.payload).toBeDefined()
  })
})

// =============================================================================
// Family Tests
// =============================================================================

describe("Procedure.family", () => {
  it("groups procedures with a namespace", () => {
    const userProcedures = Procedure.family("user", {
      list: Procedure.query({ success: Schema.Array(User) }),
      byId: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
        error: NotFoundError,
      }),
      create: Procedure.mutation({
        payload: CreateUserInput,
        success: User,
        invalidates: ["user.list"],
      }),
    })

    expect(userProcedures._tag).toBe("Family")
    expect(userProcedures.name).toBe("user")
    expect(userProcedures.procedures.list).toBeDefined()
    expect(userProcedures.procedures.byId).toBeDefined()
    expect(userProcedures.procedures.create).toBeDefined()
  })

  it("family procedures are accessible by name", () => {
    const userProcedures = Procedure.family("user", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    expect(userProcedures.procedures.list._tag).toBe("Query")
  })
})

// =============================================================================
// Type Safety Tests
// =============================================================================

describe("Procedure type safety", () => {
  it("query cannot have invalidates", () => {
    // @ts-expect-error - queries don't have invalidates
    Procedure.query({
      success: User,
      invalidates: ["something"],
    })
  })

  it("mutation requires invalidates", () => {
    // @ts-expect-error - mutations require invalidates
    Procedure.mutation({
      payload: CreateUserInput,
      success: User,
    })
  })

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

  it("payload schema must be a Schema", () => {
    // @ts-expect-error - payload must be a Schema
    Procedure.query({
      payload: { id: "string" },
      success: User,
    })
  })
})
