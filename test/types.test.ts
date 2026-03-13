/**
 * Type-Level Tests
 * 
 * These tests verify that TypeScript correctly catches type errors.
 * They use @ts-expect-error to assert that certain code should not compile.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema, Context } from "effect"

import { Procedure, Router, Client, Server, Middleware } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
}) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String }
) {}

// =============================================================================
// Procedure Type Tests
// =============================================================================

describe("Procedure types", () => {
  it("query requires success schema", () => {
    // @ts-expect-error - success is required
    Procedure.query({})
  })

  it("mutation requires success schema", () => {
    // @ts-expect-error - success is required
    Procedure.mutation({ invalidates: [] })
  })

  it("mutation requires invalidates array", () => {
    // @ts-expect-error - invalidates is required
    Procedure.mutation({ success: User })
  })

  it("stream requires success schema", () => {
    // @ts-expect-error - success is required
    Procedure.stream({})
  })

  it("query does not accept invalidates", () => {
    // @ts-expect-error - queries don't have invalidates
    Procedure.query({
      success: User,
      invalidates: ["something"],
    })
  })

  it("Procedure.Payload extracts correct type", () => {
    const getUser = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    })

    type Payload = Procedure.Payload<typeof getUser>
    expectTypeOf<Payload>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("Procedure.Success extracts correct type", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type Success = Procedure.Success<typeof listUsers>
    expectTypeOf<Success>().toEqualTypeOf<readonly User[]>()
  })

  it("Procedure.Error extracts correct type", () => {
    const getUser = Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    })

    type Err = Procedure.Error<typeof getUser>
    expectTypeOf<Err>().toEqualTypeOf<NotFoundError>()
  })

  it("Procedure.Error defaults to never", () => {
    const listUsers = Procedure.query({
      success: Schema.Array(User),
    })

    type Err = Procedure.Error<typeof listUsers>
    expectTypeOf<Err>().toEqualTypeOf<never>()
  })
})

// =============================================================================
// Router Type Tests
// =============================================================================

describe("Router types", () => {
  const router = Router.make("@api", {
    users: {
      list: Procedure.query({ success: Schema.Array(User) }),
      get: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
        error: NotFoundError,
      }),
      create: Procedure.mutation({
        payload: CreateUserInput,
        success: User,
        invalidates: ["users"],
      }),
    },
    health: Procedure.query({ success: Schema.String }),
  })

  it("Router.Paths extracts all valid paths", () => {
    type Paths = Router.Paths<typeof router.definition>
    
    // These should all be valid paths
    const p1: Paths = "users"
    const p2: Paths = "users.list"
    const p3: Paths = "users.get"
    const p4: Paths = "users.create"
    const p5: Paths = "health"
    
    // Use to avoid unused warnings
    expect([p1, p2, p3, p4, p5]).toHaveLength(5)
  })

  it("Router.ProcedureAt extracts procedure type at path", () => {
    type ListProc = Router.ProcedureAt<typeof router.definition, "users.list">
    
    expectTypeOf<ListProc>().toMatchTypeOf<Procedure.Query<any, any, any>>()
  })
})

// =============================================================================
// Client Type Tests
// =============================================================================

describe("Client types", () => {
  const router = Router.make("@api", {
    users: {
      list: Procedure.query({ success: Schema.Array(User) }),
      get: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
        error: NotFoundError,
      }),
    },
  })

  it("Client.ProcedurePayload extracts void for no payload", () => {
    type Payload = Client.ProcedurePayload<typeof router.definition.users.list>
    expectTypeOf<Payload>().toEqualTypeOf<void>()
  })

  it("Client.ProcedurePayload extracts struct for payload", () => {
    type Payload = Client.ProcedurePayload<typeof router.definition.users.get>
    expectTypeOf<Payload>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("Client.ProcedureSuccess extracts success type", () => {
    type Success = Client.ProcedureSuccess<typeof router.definition.users.list>
    expectTypeOf<Success>().toEqualTypeOf<readonly User[]>()
  })

  it("Client.ProcedureError extracts error type", () => {
    type Err = Client.ProcedureError<typeof router.definition.users.get>
    expectTypeOf<Err>().toEqualTypeOf<NotFoundError>()
  })
})

// =============================================================================
// Server Type Tests
// =============================================================================

describe("Server types", () => {
  const router = Router.make("@api", {
    users: {
      list: Procedure.query({ success: Schema.Array(User) }),
      get: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
        error: NotFoundError,
      }),
    },
    health: Procedure.query({ success: Schema.String }),
  })

  it("Server.HandlerFor extracts handler type for query without payload", () => {
    type Handler = Server.HandlerFor<typeof router.definition.users.list>
    
    expectTypeOf<Handler>().toEqualTypeOf<
      (payload: void) => Effect.Effect<readonly User[], never, never>
    >()
  })

  it("Server.HandlerFor extracts handler type for query with payload", () => {
    type Handler = Server.HandlerFor<typeof router.definition.users.get>
    
    expectTypeOf<Handler>().toEqualTypeOf<
      (payload: { readonly id: string }) => Effect.Effect<User, NotFoundError, never>
    >()
  })

  it("Server.Handlers mirrors router structure", () => {
    type Handlers = Server.Handlers<typeof router.definition>
    
    expectTypeOf<Handlers>().toHaveProperty("users")
    expectTypeOf<Handlers>().toHaveProperty("health")
  })

  it("handler return type must match procedure", () => {
    // This should compile - correct return type
    const handlers: Server.Handlers<typeof router.definition> = {
      users: {
        list: () => Effect.succeed([]),
        get: ({ id }) => Effect.succeed(new User({ id, name: "Test" })),
      },
      health: () => Effect.succeed("OK"),
    }

    expect(handlers).toBeDefined()
  })
})

// =============================================================================
// Middleware Type Tests
// =============================================================================

describe("Middleware types", () => {
  class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

  it("Middleware.Tag creates typed middleware", () => {
    const AuthMiddleware = Middleware.Tag<User, NotFoundError>(
      "AuthMiddleware",
      CurrentUser
    )

    // Middleware should be applicable
    expect(Middleware.isMiddlewareTag(AuthMiddleware)).toBe(true)
    
    // provides property should match
    expect(AuthMiddleware.provides).toBe(CurrentUser)
  })
})

// =============================================================================
// Cross-Module Type Flow Tests
// =============================================================================

describe("Type flow across modules", () => {
  const listUsers = Procedure.query({ success: Schema.Array(User) })
  const getUser = Procedure.query({
    payload: Schema.Struct({ id: Schema.String }),
    success: User,
    error: NotFoundError,
  })

  const router = Router.make("@api", {
    users: { list: listUsers, get: getUser },
  })

  const handlers: Server.Handlers<typeof router.definition> = {
    users: {
      list: () => Effect.succeed([]),
      get: ({ id }) => Effect.succeed(new User({ id, name: "Test" })),
    },
  }

  it("Procedure → Router → Server → Client type flow is consistent", () => {
    // Procedure defines the shape
    type ProcPayload = Procedure.Payload<typeof getUser>
    
    // Router preserves the shape
    type RouterPayload = Client.ProcedurePayload<typeof router.definition.users.get>
    
    // Server handler uses the shape
    type HandlerArg = Parameters<Server.HandlerFor<typeof router.definition.users.get>>[0]
    
    // All should be the same
    expectTypeOf<ProcPayload>().toEqualTypeOf<RouterPayload>()
    expectTypeOf<RouterPayload>().toEqualTypeOf<HandlerArg>()
    expectTypeOf<HandlerArg>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("error types flow from Procedure to Client", () => {
    type ProcError = Procedure.Error<typeof getUser>
    type ClientError = Client.ProcedureError<typeof router.definition.users.get>
    
    expectTypeOf<ProcError>().toEqualTypeOf<ClientError>()
    expectTypeOf<ClientError>().toEqualTypeOf<NotFoundError>()
  })
})
