/**
 * Server Module Tests
 * 
 * Tests for Server.make, handlers, and middleware integration.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Schema, Context, Layer, Stream } from "effect"

import { Procedure, Router, Server, Transport } from "../src/index.js"

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
// Test Services
// =============================================================================

class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  {
    readonly findAll: () => Effect.Effect<User[]>
    readonly findById: (id: string) => Effect.Effect<User, NotFoundError>
    readonly create: (input: CreateUserInput) => Effect.Effect<User, ValidationError>
  }
>() {}

// =============================================================================
// Test Router
// =============================================================================

const appRouter = Router.make("@test", {
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
  },
  health: Procedure.query({
    success: Schema.Struct({ status: Schema.String }),
  }),
})

type AppRouter = typeof appRouter

// =============================================================================
// Server.make Tests
// =============================================================================

describe("Server.make", () => {
  it("creates a server from router and handlers", () => {
    const handlers = {
      users: {
        list: () => Effect.succeed([]),
        get: ({ id }: { id: string }) => 
          Effect.fail(new NotFoundError({ id })),
        create: (input: CreateUserInput) =>
          Effect.succeed(new User({ id: "1", ...input })),
      },
      health: () => Effect.succeed({ status: "ok" }),
    }

    const server = Server.make(appRouter, handlers)

    expect(server).toBeDefined()
    expect(Server.isServer(server)).toBe(true)
  })

  it("server has router reference", () => {
    const handlers = {
      users: {
        list: () => Effect.succeed([]),
        get: ({ id }: { id: string }) => Effect.fail(new NotFoundError({ id })),
        create: (input: CreateUserInput) => Effect.succeed(new User({ id: "1", ...input })),
      },
      health: () => Effect.succeed({ status: "ok" }),
    }

    const server = Server.make(appRouter, handlers)

    expect(server.router).toBe(appRouter)
  })
})

// =============================================================================
// Server.handle Tests
// =============================================================================

describe("Server.handle", () => {
  const handlers = {
    users: {
      list: () => Effect.succeed([
        new User({ id: "1", name: "Alice", email: "alice@example.com" }),
      ]),
      get: ({ id }: { id: string }) =>
        id === "1"
          ? Effect.succeed(new User({ id: "1", name: "Alice", email: "alice@example.com" }))
          : Effect.fail(new NotFoundError({ id })),
      create: (input: CreateUserInput) =>
        Effect.succeed(new User({ id: "new", name: input.name, email: input.email })),
    },
    health: () => Effect.succeed({ status: "ok" }),
  }

  const server = Server.make(appRouter, handlers)

  effectIt.effect("handles query requests", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-1",
        tag: "@test/health",
        payload: undefined,
      })

      expect(response._tag).toBe("Success")
      if (response._tag === "Success") {
        expect(response.value).toEqual({ status: "ok" })
      }
    })
  )

  effectIt.effect("handles query with payload", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-2",
        tag: "@test/users/get",
        payload: { id: "1" },
      })

      expect(response._tag).toBe("Success")
      if (response._tag === "Success") {
        expect((response.value as User).name).toBe("Alice")
      }
    })
  )

  effectIt.effect("handles errors", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-3",
        tag: "@test/users/get",
        payload: { id: "not-found" },
      })

      expect(response._tag).toBe("Failure")
      if (response._tag === "Failure") {
        expect((response.error as any)._tag).toBe("NotFoundError")
      }
    })
  )

  effectIt.effect("handles unknown procedures", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-4",
        tag: "@test/unknown/procedure",
        payload: undefined,
      })

      expect(response._tag).toBe("Failure")
    })
  )
})

// =============================================================================
// Server.handleStream Tests
// =============================================================================

describe("Server.handleStream", () => {
  const streamRouter = Router.make("@test", {
    numbers: Procedure.stream({
      payload: Schema.Struct({ count: Schema.Number }),
      success: Schema.Number,
    }),
  })

  const handlers = {
    numbers: ({ count }: { count: number }) =>
      Stream.fromIterable(Array.from({ length: count }, (_, i) => i + 1)),
  }

  const server = Server.make(streamRouter, handlers)

  effectIt.effect("handles stream requests", () =>
    Effect.gen(function* () {
      const responses = yield* server.handleStream({
        id: "stream-1",
        tag: "@test/numbers",
        payload: { count: 3 },
      }).pipe(Stream.runCollect)

      const arr = Array.from(responses)
      
      // Should have 3 chunks + StreamEnd
      expect(arr.length).toBe(4)
      expect(arr[0]._tag).toBe("StreamChunk")
      expect(arr[3]._tag).toBe("StreamEnd")
    })
  )
})

// =============================================================================
// Handler Type Tests
// =============================================================================

describe("Handler types", () => {
  it("HandlerFor extracts correct types for query", () => {
    type ListHandler = Server.HandlerFor<typeof appRouter.definition.users.list>
    
    expectTypeOf<ListHandler>().toEqualTypeOf<
      (payload: void) => Effect.Effect<readonly User[], never, never>
    >()
  })

  it("HandlerFor extracts correct types for query with payload", () => {
    type GetHandler = Server.HandlerFor<typeof appRouter.definition.users.get>
    
    expectTypeOf<GetHandler>().toEqualTypeOf<
      (payload: { readonly id: string }) => Effect.Effect<User, NotFoundError, never>
    >()
  })

  it("HandlerFor extracts correct types for mutation", () => {
    type CreateHandler = Server.HandlerFor<typeof appRouter.definition.users.create>
    
    expectTypeOf<CreateHandler>().toEqualTypeOf<
      (payload: CreateUserInput) => Effect.Effect<User, ValidationError, never>
    >()
  })

  it("Handlers type mirrors router structure", () => {
    type AppHandlers = Server.Handlers<typeof appRouter.definition>
    
    expectTypeOf<AppHandlers>().toHaveProperty("users")
    expectTypeOf<AppHandlers>().toHaveProperty("health")
  })
})

// =============================================================================
// Server.middleware Tests
// =============================================================================

describe("Server.middleware", () => {
  const handlers = {
    users: {
      list: () => Effect.succeed([]),
      get: ({ id }: { id: string }) => Effect.fail(new NotFoundError({ id })),
      create: (input: CreateUserInput) => Effect.succeed(new User({ id: "1", ...input })),
    },
    health: () => Effect.succeed({ status: "ok" }),
  }

  it("adds middleware to server", () => {
    const middleware = {} as any // Placeholder middleware

    const server = Server.make(appRouter, handlers).pipe(
      Server.middleware(middleware)
    )

    expect(server.middlewares).toContain(middleware)
  })

  it("chains multiple middlewares", () => {
    const m1 = { name: "m1" } as any
    const m2 = { name: "m2" } as any

    const server = Server.make(appRouter, handlers).pipe(
      Server.middleware(m1),
      Server.middleware(m2)
    )

    expect(server.middlewares).toHaveLength(2)
  })
})

// =============================================================================
// Server.isServer Tests
// =============================================================================

describe("Server.isServer", () => {
  it("returns true for servers", () => {
    const handlers = {
      users: {
        list: () => Effect.succeed([]),
        get: ({ id }: { id: string }) => Effect.fail(new NotFoundError({ id })),
        create: (input: CreateUserInput) => Effect.succeed(new User({ id: "1", ...input })),
      },
      health: () => Effect.succeed({ status: "ok" }),
    }

    const server = Server.make(appRouter, handlers)

    expect(Server.isServer(server)).toBe(true)
  })

  it("returns false for non-servers", () => {
    expect(Server.isServer({})).toBe(false)
    expect(Server.isServer(null)).toBe(false)
    expect(Server.isServer(undefined)).toBe(false)
  })
})
