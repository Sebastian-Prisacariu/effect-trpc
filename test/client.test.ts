/**
 * Client Module Tests
 * 
 * Tests for the React client: hooks, Provider, type inference.
 * These tests verify the user-facing API is correct.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema, Context, Layer } from "effect"

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

const UserProcedures = Procedure.family("user", {
  list: Procedure.query({
    success: Schema.Array(User),
  }),
  byId: Procedure.query({
    payload: Schema.Struct({ id: Schema.String }),
    success: User,
    error: NotFoundError,
  }),
  create: Procedure.mutation({
    payload: CreateUserInput,
    success: User,
    error: ValidationError,
    invalidates: ["user.list"],
  }),
  delete: Procedure.mutation({
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Void,
    invalidates: ["user.list", "user.byId"],
  }),
})

const ContractProcedures = Procedure.family("contracts", {
  public: Procedure.family("public", {
    list: Procedure.query({ success: Schema.Array(Schema.String) }),
  }),
})

const AppRouter = Router.make({
  user: UserProcedures,
  contracts: ContractProcedures,
})

type AppRouter = typeof AppRouter

// =============================================================================
// Client.make Tests
// =============================================================================

describe("Client.make", () => {
  it("creates a typed client from router", () => {
    const api = Client.make<AppRouter>()

    expect(api).toBeDefined()
    expect(api.Provider).toBeDefined()
  })

  it("client has all procedure paths as properties", () => {
    const api = Client.make<AppRouter>()

    // These should exist and be typed
    expect(api.user).toBeDefined()
    expect(api.user.list).toBeDefined()
    expect(api.user.byId).toBeDefined()
    expect(api.user.create).toBeDefined()
  })

  it("client supports nested routers", () => {
    const api = Client.make<AppRouter>()

    // Deep nesting
    expect(api.contracts.public.list).toBeDefined()
  })
})

// =============================================================================
// useQuery Tests
// =============================================================================

describe("useQuery", () => {
  it("query has useQuery method", () => {
    const api = Client.make<AppRouter>()

    expect(api.user.list.useQuery).toBeTypeOf("function")
  })

  it("useQuery returns correct result shape", () => {
    const api = Client.make<AppRouter>()

    // Mock hook result type
    type QueryResult = ReturnType<typeof api.user.list.useQuery>

    expectTypeOf<QueryResult>().toHaveProperty("result")
    expectTypeOf<QueryResult>().toHaveProperty("data")
    expectTypeOf<QueryResult>().toHaveProperty("error")
    expectTypeOf<QueryResult>().toHaveProperty("isLoading")
    expectTypeOf<QueryResult>().toHaveProperty("isSuccess")
    expectTypeOf<QueryResult>().toHaveProperty("isError")
    expectTypeOf<QueryResult>().toHaveProperty("refetch")
  })

  it("useQuery data type matches success schema", () => {
    const api = Client.make<AppRouter>()

    type QueryResult = ReturnType<typeof api.user.list.useQuery>
    type Data = QueryResult["data"]

    // data should be User[] | undefined
    expectTypeOf<Data>().toEqualTypeOf<readonly User[] | undefined>()
  })

  it("useQuery error type matches error schema", () => {
    const api = Client.make<AppRouter>()

    type QueryResult = ReturnType<typeof api.user.byId.useQuery>
    type Error = QueryResult["error"]

    // error should be NotFoundError | undefined
    expectTypeOf<Error>().toEqualTypeOf<NotFoundError | undefined>()
  })

  it("useQuery requires payload for procedures with payload", () => {
    const api = Client.make<AppRouter>()

    // This should require { id: string }
    api.user.byId.useQuery({ id: "123" })

    // @ts-expect-error - missing required payload
    api.user.byId.useQuery()

    // @ts-expect-error - wrong payload shape
    api.user.byId.useQuery({ userId: "123" })
  })

  it("useQuery accepts no payload for procedures without payload", () => {
    const api = Client.make<AppRouter>()

    // No payload needed
    api.user.list.useQuery()

    // Can also pass empty object or undefined
    api.user.list.useQuery({})
    api.user.list.useQuery(undefined)
  })

  it("useQuery accepts options as second argument", () => {
    const api = Client.make<AppRouter>()

    api.user.list.useQuery(undefined, {
      enabled: false,
      staleTime: 5000,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      refetchInterval: 10000,
    })
  })
})

// =============================================================================
// useMutation Tests
// =============================================================================

describe("useMutation", () => {
  it("mutation has useMutation method", () => {
    const api = Client.make<AppRouter>()

    expect(api.user.create.useMutation).toBeTypeOf("function")
  })

  it("useMutation returns correct result shape", () => {
    const api = Client.make<AppRouter>()

    type MutationResult = ReturnType<typeof api.user.create.useMutation>

    expectTypeOf<MutationResult>().toHaveProperty("mutate")
    expectTypeOf<MutationResult>().toHaveProperty("mutateAsync")
    expectTypeOf<MutationResult>().toHaveProperty("result")
    expectTypeOf<MutationResult>().toHaveProperty("isLoading")
    expectTypeOf<MutationResult>().toHaveProperty("reset")
  })

  it("mutate accepts correct payload type", () => {
    const api = Client.make<AppRouter>()

    const mutation = api.user.create.useMutation()

    // Should accept CreateUserInput
    mutation.mutate({ name: "Test", email: "test@example.com" })

    // @ts-expect-error - wrong shape
    mutation.mutate({ username: "test" })
  })

  it("mutateAsync returns correct type", () => {
    const api = Client.make<AppRouter>()

    const mutation = api.user.create.useMutation()

    type ReturnType = Awaited<ReturnType<typeof mutation.mutateAsync>>

    expectTypeOf<ReturnType>().toEqualTypeOf<User>()
  })

  it("useMutation accepts callbacks", () => {
    const api = Client.make<AppRouter>()

    api.user.create.useMutation({
      onSuccess: (data, payload) => {
        // data should be User
        expectTypeOf(data).toEqualTypeOf<User>()
        // payload should be CreateUserInput
        expectTypeOf(payload).toEqualTypeOf<CreateUserInput>()
      },
      onError: (error, payload) => {
        // error should be ValidationError
        expectTypeOf(error).toEqualTypeOf<ValidationError>()
      },
      onSettled: () => {},
    })
  })
})

// =============================================================================
// Query vs Mutation Type Safety
// =============================================================================

describe("Query vs Mutation type safety", () => {
  it("queries do not have useMutation", () => {
    const api = Client.make<AppRouter>()

    // @ts-expect-error - queries don't have useMutation
    api.user.list.useMutation
  })

  it("mutations do not have useQuery", () => {
    const api = Client.make<AppRouter>()

    // @ts-expect-error - mutations don't have useQuery
    api.user.create.useQuery
  })
})

// =============================================================================
// Imperative API Tests
// =============================================================================

describe("Imperative API", () => {
  it("queries have .run that returns Effect", () => {
    const api = Client.make<AppRouter>()

    const effect = api.user.list.run

    // Should be an Effect
    expectTypeOf(effect).toMatchTypeOf<Effect.Effect<readonly User[], any, any>>()
  })

  it("queries have .runPromise for async usage", () => {
    const api = Client.make<AppRouter>()

    expectTypeOf(api.user.list.runPromise).toBeFunction()
  })

  it("queries have .prefetch for SSR", () => {
    const api = Client.make<AppRouter>()

    expectTypeOf(api.user.list.prefetch).toBeFunction()
  })

  it("queries have .key for cache key generation", () => {
    const api = Client.make<AppRouter>()

    const key = api.user.byId.key({ id: "123" })

    expectTypeOf(key).toEqualTypeOf<string>()
  })

  it("api.invalidate accepts array of keys", () => {
    const api = Client.make<AppRouter>()

    api.invalidate(["user.list", "user.byId"])
  })
})

// =============================================================================
// Provider Tests
// =============================================================================

describe("Client.Provider", () => {
  it("Provider requires layer prop", () => {
    const api = Client.make<AppRouter>()

    // @ts-expect-error - layer is required
    api.Provider({ children: null })

    // This should work
    api.Provider({
      children: null,
      layer: Transport.http("/api/trpc"),
    })
  })

  it("Provider accepts Transport layer", () => {
    const api = Client.make<AppRouter>()

    const httpLayer = Transport.http("/api/trpc")
    
    api.Provider({
      children: null,
      layer: httpLayer,
    })
  })
})

// =============================================================================
// Result Pattern Matching Tests
// =============================================================================

describe("Result pattern matching", () => {
  it("Result.match handles all states", () => {
    const api = Client.make<AppRouter>()

    // Simulating usage in a component
    const query = api.user.list.useQuery()

    const rendered = Result.match(query.result, {
      onInitial: () => "loading...",
      onWaiting: () => "refreshing...",
      onSuccess: (users) => `${users.length} users`,
      onFailure: (error) => `error: ${error}`,
    })

    expectTypeOf(rendered).toEqualTypeOf<string>()
  })

  it("Result.match onSuccess receives correct type", () => {
    const api = Client.make<AppRouter>()
    const query = api.user.list.useQuery()

    Result.match(query.result, {
      onInitial: () => null,
      onWaiting: () => null,
      onSuccess: (users) => {
        // users should be User[]
        expectTypeOf(users).toEqualTypeOf<readonly User[]>()
        return null
      },
      onFailure: () => null,
    })
  })

  it("Result.match onFailure receives correct error type", () => {
    const api = Client.make<AppRouter>()
    const query = api.user.byId.useQuery({ id: "123" })

    Result.match(query.result, {
      onInitial: () => null,
      onWaiting: () => null,
      onSuccess: () => null,
      onFailure: (error) => {
        // error should be NotFoundError
        expectTypeOf(error).toEqualTypeOf<NotFoundError>()

        // Can access typed properties
        if (error._tag === "NotFoundError") {
          console.log(error.id)
        }
        return null
      },
    })
  })
})
