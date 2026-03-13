/**
 * Client Module Tests
 * 
 * Tests for the Client module: proxy, hooks, Provider, type inference.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema, Context, Layer, Stream } from "effect"

import { Procedure, Router, Client, Transport, Result } from "../src/index.js"

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
// Test Router
// =============================================================================

const appRouter = Router.make("@api", {
  users: {
    list: Procedure.query({
      success: Schema.Array(User),
    }),
    get: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    }),
    create: Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      error: ValidationError,
      invalidates: ["users"],
    }),
    delete: Procedure.mutation({
      payload: Schema.Struct({ id: Schema.String }),
      success: Schema.Void,
      invalidates: ["users"],
    }),
  },
  contracts: {
    public: {
      list: Procedure.query({ success: Schema.Array(Schema.String) }),
    },
  },
})

type AppRouter = typeof appRouter

// =============================================================================
// Client.make Tests
// =============================================================================

describe("Client.make", () => {
  it("creates a client from router", () => {
    const api = Client.make(appRouter)
    
    expect(api).toBeDefined()
  })

  it("client has nested structure matching router", () => {
    const api = Client.make(appRouter)
    
    expect(api.users).toBeDefined()
    expect(api.users.list).toBeDefined()
    expect(api.users.get).toBeDefined()
    expect(api.users.create).toBeDefined()
    expect(api.contracts.public.list).toBeDefined()
  })
})

// =============================================================================
// Client.provide Tests
// =============================================================================

describe("Client.provide", () => {
  it("binds transport to client", () => {
    const api = Client.make(appRouter)
    const mockLayer = Transport.mock({})
    const bound = api.provide(mockLayer)
    
    expect(bound).toBeDefined()
  })

  it("bound client has same structure", () => {
    const api = Client.make(appRouter)
    const mockLayer = Transport.mock({})
    const bound = api.provide(mockLayer)
    
    expect(bound.users.list).toBeDefined()
    expect(bound.users.get).toBeDefined()
  })
})

// =============================================================================
// Procedure Client Tests
// =============================================================================

describe("Procedure client methods", () => {
  const api = Client.make(appRouter)
  const mockLayer = Transport.mock({
    "users.list": () => Effect.succeed([]),
  })
  const bound = api.provide(mockLayer)

  it("query client has useQuery stub", () => {
    expect(bound.users.list.useQuery).toBeDefined()
  })

  it("mutation client has useMutation stub", () => {
    expect(bound.users.create.useMutation).toBeDefined()
  })
})

// =============================================================================
// Client.ClientServiceTag Tests
// =============================================================================

describe("Client.ClientServiceTag", () => {
  it("is defined", () => {
    expect(Client.ClientServiceTag).toBeDefined()
  })
})

// =============================================================================
// Client.ClientServiceLive Tests
// =============================================================================

describe("Client.ClientServiceLive", () => {
  it("is a Layer that requires Transport", () => {
    expect(Client.ClientServiceLive).toBeDefined()
    expect(Layer.isLayer(Client.ClientServiceLive)).toBe(true)
  })

  it("can be composed with transport layer", () => {
    const transportLayer = Transport.mock({})
    const clientLayer = Client.ClientServiceLive.pipe(
      Layer.provide(transportLayer)
    )
    
    expect(clientLayer).toBeDefined()
    expect(Layer.isLayer(clientLayer)).toBe(true)
  })
})

// =============================================================================
// Type Inference Tests
// =============================================================================

describe("Client type inference", () => {
  it("query with void payload", () => {
    const api = Client.make(appRouter)
    
    // users.list has void payload
    type ListPayload = Client.ProcedurePayload<typeof appRouter.definition.users.list>
    expectTypeOf<ListPayload>().toEqualTypeOf<void>()
  })

  it("query with struct payload", () => {
    const api = Client.make(appRouter)
    
    // users.get has { id: string } payload
    type GetPayload = Client.ProcedurePayload<typeof appRouter.definition.users.get>
    expectTypeOf<GetPayload>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("query success type", () => {
    const api = Client.make(appRouter)
    
    type ListSuccess = Client.ProcedureSuccess<typeof appRouter.definition.users.list>
    expectTypeOf<ListSuccess>().toEqualTypeOf<readonly User[]>()
  })

  it("query error type", () => {
    const api = Client.make(appRouter)
    
    type GetError = Client.ProcedureError<typeof appRouter.definition.users.get>
    expectTypeOf<GetError>().toEqualTypeOf<NotFoundError>()
  })

  it("mutation payload type", () => {
    const api = Client.make(appRouter)
    
    type CreatePayload = Client.ProcedurePayload<typeof appRouter.definition.users.create>
    expectTypeOf<CreatePayload>().toEqualTypeOf<CreateUserInput>()
  })

  it("mutation success type", () => {
    const api = Client.make(appRouter)
    
    type CreateSuccess = Client.ProcedureSuccess<typeof appRouter.definition.users.create>
    expectTypeOf<CreateSuccess>().toEqualTypeOf<User>()
  })

  it("mutation error type", () => {
    const api = Client.make(appRouter)
    
    type CreateError = Client.ProcedureError<typeof appRouter.definition.users.create>
    expectTypeOf<CreateError>().toEqualTypeOf<ValidationError>()
  })
})

// =============================================================================
// Nested Router Type Tests
// =============================================================================

describe("Nested router types", () => {
  it("deeply nested procedures are accessible", () => {
    const api = Client.make(appRouter)
    
    expect(api.contracts.public.list).toBeDefined()
  })

  it("nested query has correct success type", () => {
    type ListSuccess = Client.ProcedureSuccess<typeof appRouter.definition.contracts.public.list>
    expectTypeOf<ListSuccess>().toEqualTypeOf<readonly string[]>()
  })
})

// =============================================================================
// Result Type Tests
// =============================================================================

describe("Result type", () => {
  it("Result is exported from Client", () => {
    expect(Result).toBeDefined()
  })
})

// =============================================================================
// Hook Stub Tests
// =============================================================================

describe("Hook stubs", () => {
  const api = Client.make(appRouter)
  const mockLayer = Transport.mock({})
  const bound = api.provide(mockLayer)

  it("useQuery exists on query client", () => {
    // The stub throws when called outside React, but the method should exist
    expect(typeof bound.users.list.useQuery).toBe("function")
  })

  it("useMutation exists on mutation client", () => {
    expect(typeof bound.users.create.useMutation).toBe("function")
  })

  it("useQuery throws outside React context", () => {
    // Now throws because React hooks can't be used outside of component/Provider
    expect(() => bound.users.list.useQuery()).toThrow()
  })

  it("useMutation throws outside React context", () => {
    expect(() => bound.users.create.useMutation()).toThrow()
  })
})

// =============================================================================
// api.invalidate Tests
// =============================================================================

describe("api.invalidate", () => {
  it("invalidate method exists on bound client", () => {
    const api = Client.make(appRouter)
    const mockLayer = Transport.mock({})
    const bound = api.provide(mockLayer)
    
    expect(bound.invalidate).toBeDefined()
  })
})
