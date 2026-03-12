/**
 * Integration Tests
 * 
 * End-to-end tests verifying the full flow from client to server.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Schema, Context, Layer, Stream } from "effect"

import {
  Procedure,
  Router,
  Client,
  Transport,
  Server,
  Middleware,
} from "../src/index.js"

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
  { entity: Schema.String, id: Schema.String }
) {}

class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { field: Schema.String, message: Schema.String }
) {}

class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String }
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
    readonly delete: (id: string) => Effect.Effect<void, NotFoundError>
  }
>() {}

// =============================================================================
// Test Router & Handlers
// =============================================================================

const appRouter = Router.make("@test", {
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
      error: ValidationError,
      invalidates: ["users"],
    }),
  },
  health: Procedure.query({
    success: Schema.Struct({ status: Schema.String }),
  }),
})

const handlers = {
  users: {
    list: () =>
      Effect.flatMap(UserRepository, (repo) => repo.findAll()),
    get: ({ id }: { id: string }) =>
      Effect.flatMap(UserRepository, (repo) => repo.findById(id)),
    create: (input: CreateUserInput) =>
      Effect.flatMap(UserRepository, (repo) => repo.create(input)),
  },
  health: () => Effect.succeed({ status: "ok" }),
}

const server = Server.make(appRouter, handlers)

// =============================================================================
// Test Fixtures
// =============================================================================

const testUsers = [
  new User({ id: "1", name: "Alice", email: "alice@test.com" }),
  new User({ id: "2", name: "Bob", email: "bob@test.com" }),
]

const UserRepositoryLive = Layer.succeed(UserRepository, {
  findAll: () => Effect.succeed(testUsers),
  findById: (id) =>
    Effect.fromNullable(testUsers.find((u) => u.id === id)).pipe(
      Effect.mapError(() => new NotFoundError({ entity: "User", id }))
    ),
  create: (input) =>
    Effect.succeed(new User({ id: "new-1", name: input.name, email: input.email })),
  delete: (id) =>
    testUsers.find((u) => u.id === id)
      ? Effect.void
      : Effect.fail(new NotFoundError({ entity: "User", id })),
})

// =============================================================================
// Server Handle Tests
// =============================================================================

describe("Server handling", () => {
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

  effectIt.effect("handles query with dependencies", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-2",
        tag: "@test/users/list",
        payload: undefined,
      })

      expect(response._tag).toBe("Success")
      if (response._tag === "Success") {
        expect((response.value as User[]).length).toBe(2)
      }
    }).pipe(Effect.provide(UserRepositoryLive))
  )

  effectIt.effect("handles query with payload", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-3",
        tag: "@test/users/get",
        payload: { id: "1" },
      })

      expect(response._tag).toBe("Success")
      if (response._tag === "Success") {
        expect((response.value as User).name).toBe("Alice")
      }
    }).pipe(Effect.provide(UserRepositoryLive))
  )

  effectIt.effect("returns errors correctly", () =>
    Effect.gen(function* () {
      const response = yield* server.handle({
        id: "req-4",
        tag: "@test/users/get",
        payload: { id: "not-found" },
      })

      expect(response._tag).toBe("Failure")
      if (response._tag === "Failure") {
        expect((response.error as any)._tag).toBe("NotFoundError")
      }
    }).pipe(Effect.provide(UserRepositoryLive))
  )
})

// =============================================================================
// Loopback Transport Tests
// =============================================================================

describe("Loopback transport", () => {
  // Note: We need to provide UserRepositoryLive to each effect individually
  // because the loopback transport runs server handlers which need the dependency
  const loopbackTransport = Transport.loopback(server)
  const clientLayer = Client.ClientServiceLive.pipe(
    Layer.provide(loopbackTransport)
  )

  effectIt.effect("sends requests to server", () =>
    Effect.gen(function* () {
      const clientService = yield* Client.ClientServiceTag
      const response = yield* clientService.send(
        "@test/health",
        undefined,
        appRouter.definition.health.successSchema,
        appRouter.definition.health.errorSchema
      )

      expect(response).toEqual({ status: "ok" })
    }).pipe(
      Effect.provide(clientLayer),
      Effect.provide(UserRepositoryLive)
    )
  )

  effectIt.effect("handles errors through transport", () =>
    Effect.gen(function* () {
      const clientService = yield* Client.ClientServiceTag
      const getProc = appRouter.definition.users.get
      
      const result = yield* clientService.send(
        "@test/users/get",
        { id: "missing" },
        getProc.successSchema,
        getProc.errorSchema
      ).pipe(Effect.either)

      expect(result._tag).toBe("Left")
    }).pipe(
      Effect.provide(clientLayer),
      Effect.provide(UserRepositoryLive)
    )
  )
})

// =============================================================================
// Type Flow Tests
// =============================================================================

describe("Type flow", () => {
  it("Router paths are correctly typed", () => {
    type Paths = Router.Paths<typeof appRouter.definition>
    
    expectTypeOf<Paths>().toMatchTypeOf<
      "users.list" | "users.get" | "users.create" | "health"
    >()
  })

  it("Client payload types match procedures", () => {
    type GetPayload = Client.ProcedurePayload<typeof appRouter.definition.users.get>
    expectTypeOf<GetPayload>().toEqualTypeOf<{ readonly id: string }>()
  })

  it("Client success types match procedures", () => {
    type ListSuccess = Client.ProcedureSuccess<typeof appRouter.definition.users.list>
    expectTypeOf<ListSuccess>().toEqualTypeOf<readonly User[]>()
  })

  it("Handler types match procedure types", () => {
    type ListHandler = Server.HandlerFor<typeof appRouter.definition.users.list>
    expectTypeOf<ListHandler>().toMatchTypeOf<
      () => Effect.Effect<readonly User[], never, any>
    >()
  })
})

// =============================================================================
// Middleware Integration Tests
// =============================================================================

describe("Middleware integration", () => {
  class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}
  
  const AuthMiddleware = Middleware.Tag<User, UnauthorizedError>(
    "AuthMiddleware",
    CurrentUser
  )

  it("middleware can be applied to server", () => {
    const serverWithAuth = Server.make(appRouter, handlers).pipe(
      Server.middleware(AuthMiddleware)
    )

    expect(serverWithAuth.middlewares).toContain(AuthMiddleware)
  })

  it("middleware can be applied to procedures", () => {
    const secureQuery = Procedure.query({
      success: User,
    }).middleware(AuthMiddleware)

    expect(secureQuery.middlewares).toContain(AuthMiddleware)
  })

  it("middleware can be applied to groups", () => {
    const secureGroup = Router.withMiddleware([AuthMiddleware], {
      me: Procedure.query({ success: User }),
      settings: Procedure.query({ success: Schema.Unknown }),
    })

    expect(secureGroup.middlewares).toContain(AuthMiddleware)
  })
})
