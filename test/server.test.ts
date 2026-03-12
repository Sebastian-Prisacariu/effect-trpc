/**
 * Server Module Tests
 * 
 * Tests for route handlers, layer requirements, and server-side execution.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Schema, Context, Layer } from "effect"

import { Procedure, Router, Server } from "../src/server.js"

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

const UserProcedures = Procedure.family("user", {
  list: Procedure.query({
    success: Schema.Array(User),
    handler: () => Effect.flatMap(UserRepository, (repo) => repo.findAll()),
  }),
  byId: Procedure.query({
    payload: Schema.Struct({ id: Schema.String }),
    success: User,
    error: NotFoundError,
    handler: ({ id }) =>
      Effect.flatMap(UserRepository, (repo) => repo.findById(id)),
  }),
  create: Procedure.mutation({
    payload: CreateUserInput,
    success: User,
    error: ValidationError,
    invalidates: ["user.list"],
    handler: (input) =>
      Effect.flatMap(UserRepository, (repo) => repo.create(input)),
  }),
})

const AppRouter = Router.make({
  user: UserProcedures,
})

type AppRouter = typeof AppRouter

// =============================================================================
// Server.createRouteHandler Tests
// =============================================================================

describe("Server.createRouteHandler", () => {
  it("creates Next.js route handler", () => {
    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      findById: (id) => Effect.fail(new NotFoundError({ id })),
      create: (input) =>
        Effect.succeed(new User({ id: "1", ...input })),
    })

    const handler = Server.createRouteHandler(AppRouter, {
      layer: UserRepositoryLive,
    })

    expect(handler.GET).toBeTypeOf("function")
    expect(handler.POST).toBeTypeOf("function")
  })

  it("requires layer that satisfies all requirements", () => {
    // @ts-expect-error - missing UserRepository layer
    Server.createRouteHandler(AppRouter, {
      layer: Layer.empty,
    })
  })

  it("layer must provide all procedure requirements", () => {
    const IncompleteLayer = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      // @ts-expect-error - missing findById and create
    })

    // This should fail because the layer doesn't fully implement UserRepository
  })

  it("accepts onError callback", () => {
    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      findById: (id) => Effect.fail(new NotFoundError({ id })),
      create: (input) => Effect.succeed(new User({ id: "1", ...input })),
    })

    const handler = Server.createRouteHandler(AppRouter, {
      layer: UserRepositoryLive,
      onError: (error, path) => {
        console.error(`Error in ${path}:`, error)
      },
    })

    expect(handler).toBeDefined()
  })
})

// =============================================================================
// Server.createCaller Tests
// =============================================================================

describe("Server.createCaller", () => {
  it("creates a server-side caller", () => {
    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      findById: (id) => Effect.fail(new NotFoundError({ id })),
      create: (input) => Effect.succeed(new User({ id: "1", ...input })),
    })

    const caller = Server.createCaller(AppRouter, {
      layer: UserRepositoryLive,
    })

    expect(caller.user).toBeDefined()
    expect(caller.user.list).toBeDefined()
  })

  it("caller methods return promises", async () => {
    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([new User({ id: "1", name: "Test", email: "test@example.com" })]),
      findById: (id) => Effect.fail(new NotFoundError({ id })),
      create: (input) => Effect.succeed(new User({ id: "1", ...input })),
    })

    const caller = Server.createCaller(AppRouter, {
      layer: UserRepositoryLive,
    })

    const users = await caller.user.list()
    
    expectTypeOf(users).toEqualTypeOf<readonly User[]>()
  })

  it("caller passes payload correctly", async () => {
    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      findById: (id) =>
        Effect.succeed(new User({ id, name: `User ${id}`, email: `${id}@example.com` })),
      create: (input) => Effect.succeed(new User({ id: "1", ...input })),
    })

    const caller = Server.createCaller(AppRouter, {
      layer: UserRepositoryLive,
    })

    // Should require payload
    const user = await caller.user.byId({ id: "123" })

    expect(user.id).toBe("123")
  })

  it("caller throws on procedure error", async () => {
    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      findById: (id) => Effect.fail(new NotFoundError({ id })),
      create: (input) => Effect.succeed(new User({ id: "1", ...input })),
    })

    const caller = Server.createCaller(AppRouter, {
      layer: UserRepositoryLive,
    })

    await expect(caller.user.byId({ id: "not-found" })).rejects.toThrow()
  })
})

// =============================================================================
// Layer Requirement Tests
// =============================================================================

describe("Layer requirements", () => {
  it("router requirements are inferred from handlers", () => {
    type Requirements = Router.RequirementsOf<typeof AppRouter>

    expectTypeOf<Requirements>().toMatchTypeOf<UserRepository>()
  })

  it("combining layers satisfies combined requirements", () => {
    class AnotherService extends Context.Tag("AnotherService")<
      AnotherService,
      { readonly doSomething: () => Effect.Effect<void> }
    >() {}

    const router = Router.make({
      user: Procedure.family("user", {
        list: Procedure.query({
          success: Schema.Array(User),
          handler: () => Effect.flatMap(UserRepository, (r) => r.findAll()),
        }),
      }),
      other: Procedure.family("other", {
        action: Procedure.mutation({
          success: Schema.Void,
          invalidates: [],
          handler: () =>
            Effect.flatMap(AnotherService, (s) => s.doSomething()),
        }),
      }),
    })

    const UserRepositoryLive = Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([]),
      findById: () => Effect.fail(new NotFoundError({ id: "" })),
      create: () => Effect.succeed(new User({ id: "", name: "", email: "" })),
    })

    const AnotherServiceLive = Layer.succeed(AnotherService, {
      doSomething: () => Effect.void,
    })

    const CombinedLayer = Layer.mergeAll(UserRepositoryLive, AnotherServiceLive)

    // This should compile - combined layer satisfies all requirements
    Server.createRouteHandler(router, {
      layer: CombinedLayer,
    })
  })
})

// =============================================================================
// Request/Response Tests
// =============================================================================

describe("Request handling", () => {
  effectIt.effect("handles single request", () =>
    Effect.gen(function* () {
      const UserRepositoryLive = Layer.succeed(UserRepository, {
        findAll: () =>
          Effect.succeed([
            new User({ id: "1", name: "Test", email: "test@example.com" }),
          ]),
        findById: () => Effect.fail(new NotFoundError({ id: "" })),
        create: () => Effect.succeed(new User({ id: "", name: "", email: "" })),
      })

      const handler = Server.createRouteHandler(AppRouter, {
        layer: UserRepositoryLive,
      })

      const request = new Request("http://localhost/api/trpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "1",
          path: "user.list",
          payload: {},
        }),
      })

      const response = yield* Effect.promise(() => handler.POST(request))
      const body = yield* Effect.promise(() => response.json())

      expect(body._tag).toBe("Success")
      expect(body.value).toHaveLength(1)
    })
  )

  effectIt.effect("handles batch request", () =>
    Effect.gen(function* () {
      const UserRepositoryLive = Layer.succeed(UserRepository, {
        findAll: () => Effect.succeed([]),
        findById: (id) =>
          Effect.succeed(new User({ id, name: `User ${id}`, email: "" })),
        create: () => Effect.succeed(new User({ id: "", name: "", email: "" })),
      })

      const handler = Server.createRouteHandler(AppRouter, {
        layer: UserRepositoryLive,
      })

      const request = new Request("http://localhost/api/trpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { id: "1", path: "user.list", payload: {} },
          { id: "2", path: "user.byId", payload: { id: "123" } },
        ]),
      })

      const response = yield* Effect.promise(() => handler.POST(request))
      const body = yield* Effect.promise(() => response.json())

      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(2)
    })
  )
})
