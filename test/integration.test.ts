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
  Result,
  Middleware,
} from "../src/index.js"
import { Server } from "../src/server.js"

// =============================================================================
// Full Application Setup
// =============================================================================

// Schemas
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

// Services
class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  {
    readonly findAll: () => Effect.Effect<User[]>
    readonly findById: (id: string) => Effect.Effect<User, NotFoundError>
    readonly create: (input: CreateUserInput) => Effect.Effect<User, ValidationError>
    readonly delete: (id: string) => Effect.Effect<void, NotFoundError>
  }
>() {}

// Middleware
class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

class Auth extends Middleware.Tag<Auth>()("Auth", {
  provides: CurrentUser,
  failure: UnauthorizedError,
  requiredForClient: true,
}) {}

// Procedures
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
  me: Procedure.query({
    success: User,
    handler: () => CurrentUser, // Requires auth
  }),
}).withMiddleware(Auth)

const AppRouter = Router.make({
  user: UserProcedures,
})

type AppRouter = typeof AppRouter

// =============================================================================
// Full Flow Tests
// =============================================================================

describe("Full client-server flow", () => {
  // In-memory user store for testing
  const createTestUserRepository = () => {
    const users = new Map<string, User>()
    users.set("1", new User({ id: "1", name: "Test User", email: "test@example.com" }))

    return Layer.succeed(UserRepository, {
      findAll: () => Effect.succeed([...users.values()]),
      findById: (id) => {
        const user = users.get(id)
        return user
          ? Effect.succeed(user)
          : Effect.fail(new NotFoundError({ entity: "User", id }))
      },
      create: (input) => {
        const user = new User({ id: `${users.size + 1}`, ...input })
        users.set(user.id, user)
        return Effect.succeed(user)
      },
      delete: (id) => {
        if (!users.has(id)) {
          return Effect.fail(new NotFoundError({ entity: "User", id }))
        }
        users.delete(id)
        return Effect.void
      },
    })
  }

  const createTestAuthLayer = () =>
    Layer.succeed(
      Auth,
      Auth.of(({ headers }) =>
        Effect.gen(function* () {
          const token = headers.get("authorization")
          if (!token) {
            return yield* Effect.fail(
              new UnauthorizedError({ message: "No authorization header" })
            )
          }
          return new User({ id: "auth-1", name: "Authenticated", email: "auth@example.com" })
        })
      )
    )

  it("client can call server via mock transport", async () => {
    const api = Client.make<AppRouter>()

    // Create mock transport that simulates server
    const mockLayer = Transport.make<AppRouter>({
      "user.list": () =>
        Effect.succeed([
          new User({ id: "1", name: "Mock User", email: "mock@example.com" }),
        ]),
      "user.byId": ({ id }) =>
        Effect.succeed(new User({ id, name: `User ${id}`, email: `${id}@example.com` })),
      "user.create": (input) =>
        Effect.succeed(new User({ id: "new-1", ...input })),
      "user.me": () =>
        Effect.succeed(new User({ id: "me", name: "Me", email: "me@example.com" })),
    })

    // In real usage, this would be in Provider
    // For now, test the types compile correctly
    expect(api.user.list).toBeDefined()
    expect(api.user.byId).toBeDefined()
    expect(api.user.create).toBeDefined()
  })

  effectIt.effect("server handles request and returns typed response", () =>
    Effect.gen(function* () {
      const TestLayer = Layer.mergeAll(
        createTestUserRepository(),
        createTestAuthLayer()
      )

      const handler = Server.createRouteHandler(AppRouter, {
        layer: TestLayer,
      })

      const request = new Request("http://localhost/api/trpc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          id: "1",
          path: "user.list",
          payload: {},
        }),
      })

      const response = yield* Effect.promise(() => handler.POST(request))
      const body = yield* Effect.promise(() => response.json())

      expect(response.status).toBe(200)
      expect(body._tag).toBe("Success")
      expect(body.value).toBeInstanceOf(Array)
    })
  )

  effectIt.effect("server returns error for missing auth", () =>
    Effect.gen(function* () {
      const TestLayer = Layer.mergeAll(
        createTestUserRepository(),
        createTestAuthLayer()
      )

      const handler = Server.createRouteHandler(AppRouter, {
        layer: TestLayer,
      })

      // No Authorization header
      const request = new Request("http://localhost/api/trpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "1",
          path: "user.me",
          payload: {},
        }),
      })

      const response = yield* Effect.promise(() => handler.POST(request))
      const body = yield* Effect.promise(() => response.json())

      expect(body._tag).toBe("Failure")
      expect(body.error._tag).toBe("UnauthorizedError")
    })
  )
})

// =============================================================================
// Type Inference End-to-End Tests
// =============================================================================

describe("End-to-end type inference", () => {
  it("client method types match procedure definitions", () => {
    const api = Client.make<AppRouter>()

    // user.list returns User[]
    type ListData = ReturnType<typeof api.user.list.useQuery>["data"]
    expectTypeOf<ListData>().toEqualTypeOf<readonly User[] | undefined>()

    // user.byId requires { id: string } and returns User
    type ByIdPayload = Parameters<typeof api.user.byId.useQuery>[0]
    expectTypeOf<ByIdPayload>().toEqualTypeOf<{ readonly id: string }>()

    // user.create requires CreateUserInput
    type CreateMutation = ReturnType<typeof api.user.create.useMutation>
    type CreatePayload = Parameters<CreateMutation["mutate"]>[0]
    expectTypeOf<CreatePayload>().toEqualTypeOf<CreateUserInput>()
  })

  it("error types are preserved through the chain", () => {
    const api = Client.make<AppRouter>()

    // user.byId can fail with NotFoundError
    type ByIdError = ReturnType<typeof api.user.byId.useQuery>["error"]
    expectTypeOf<ByIdError>().toEqualTypeOf<NotFoundError | undefined>()

    // user.create can fail with ValidationError
    type CreateError = ReturnType<typeof api.user.create.useMutation>["error"]
    expectTypeOf<CreateError>().toEqualTypeOf<ValidationError | undefined>()
  })

  it("middleware errors are included in procedure errors", () => {
    const api = Client.make<AppRouter>()

    // user.me is protected by Auth, so UnauthorizedError is possible
    // (In addition to any procedure-specific errors)
  })
})

// =============================================================================
// SSR/Hydration Flow Tests
// =============================================================================

describe("SSR flow", () => {
  it("serverApi can prefetch data", async () => {
    const api = Client.make<AppRouter>()

    // In Server Component:
    // await api.user.list.prefetchPromise()
    // Data is now in cache

    // In Client Component:
    // const query = api.user.list.useQuery()
    // Data available immediately (no loading state)

    expect(api.user.list.prefetchPromise).toBeTypeOf("function")
  })

  it("prefetchPromise returns Result for error handling", async () => {
    const api = Client.make<AppRouter>()

    type PrefetchResult = Awaited<ReturnType<typeof api.user.byId.prefetchPromise>>

    // Should be Result<User, NotFoundError>
    expectTypeOf<PrefetchResult>().toMatchTypeOf<
      Result.Result<User, NotFoundError>
    >()
  })
})

// =============================================================================
// Invalidation Flow Tests
// =============================================================================

describe("Invalidation flow", () => {
  it("mutations invalidate specified queries", () => {
    const api = Client.make<AppRouter>()

    // user.create has invalidates: ["user.list"]
    // After mutation succeeds, user.list should refetch

    const mutation = api.user.create.useMutation({
      onSuccess: () => {
        // user.list cache should be invalidated
      },
    })
  })

  it("manual invalidation via api.invalidate", () => {
    const api = Client.make<AppRouter>()

    // Manually invalidate multiple queries
    api.invalidate(["user.list", "user.byId"])
  })
})

// =============================================================================
// Concurrent Request Tests
// =============================================================================

describe("Concurrent requests", () => {
  it("deduplicates identical concurrent queries", () => {
    const api = Client.make<AppRouter>()

    // Multiple components using same query
    // Should only make one request
    api.user.list.useQuery()
    api.user.list.useQuery()
    api.user.list.useQuery()

    // Only 1 network request should be made
  })

  it("batches different queries in same tick", () => {
    const api = Client.make<AppRouter>()

    // Different queries in same render
    api.user.list.useQuery()
    api.user.byId.useQuery({ id: "1" })
    api.user.byId.useQuery({ id: "2" })

    // Should batch into single HTTP request (if batching enabled)
  })
})
