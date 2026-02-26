/**
 * @module effect-trpc/__tests__/procedures
 *
 * Tests for procedures groups and the toLayer() API.
 * Validates that layers work correctly for providing handler implementations.
 *
 * Note: Type assertions (e.g., `as Effect.Effect<A, E, never>`) are used in these tests
 * because TypeScript's inference with `exactOptionalPropertyTypes: true` doesn't properly
 * narrow the R parameter through complex Effect/Layer compositions. The handlers themselves
 * return `Effect<A, E, never>`, but the service access pattern causes inference of `R = unknown`.
 * These assertions are safe because `Effect.provide(layer)` does eliminate the requirements.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import { Procedure } from "../core/index.js"
import { Procedures, type ProceduresService } from "../core/index.js"
import type { BaseContext } from "../core/server/middleware.js"

// Mock context for testing handlers directly
const mockCtx: BaseContext = {
  procedure: "test",
  headers: new Headers(),
  signal: new AbortController().signal,
  clientId: 1,
}

describe("procedures group", () => {
  const UserSchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
  })

  const CreateUserSchema = Schema.Struct({
    name: Schema.String,
  })

  it("creates a procedures group with correct structure", () => {
    const UserProcedures = Procedures.make({
      list: Procedure.output(Schema.Array(UserSchema)).query(),
      byId: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      create: Procedure
        .input(CreateUserSchema)
        .output(UserSchema)
        .invalidates(["user.list"])
        .mutation(),
    })

    expect(UserProcedures._tag).toBe("ProceduresGroup")
    expect(UserProcedures.name).toBe("")
    expect(UserProcedures.procedures["list"]?.type).toBe("query")
    expect(UserProcedures.procedures["byId"]?.type).toBe("query")
    expect(UserProcedures.procedures["create"]?.type).toBe("mutation")
  })

  it("creates a layer from static handlers", () => {
    const UserProcedures = Procedures.make({
      list: Procedure.output(Schema.Array(UserSchema)).query(),
    })

    const layer = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed([{ id: "1", name: "Alice" }]),
    })

    expect(layer).toBeDefined()
    expect(Layer.isLayer(layer)).toBe(true)
  })

  it("creates a layer from Effect with dependencies", () => {
    const UserProcedures = Procedures.make({
      list: Procedure.output(Schema.Array(UserSchema)).query(),
    })

    const layer = UserProcedures.toLayer(
      Effect.sync(() => {
        return {
          list: (_ctx) => Effect.succeed([{ id: "1", name: "Alice" }]),
        }
      }),
    )

    expect(layer).toBeDefined()
    expect(Layer.isLayer(layer)).toBe(true)
  })
})

describe("procedures layer execution", () => {
  interface User {
    id: string
    name: string
    email: string
  }

  const UserSchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
  })

  const CreateUserSchema = Schema.Struct({
    name: Schema.String,
    email: Schema.String,
  })

  const UserProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(UserSchema)).query(),
    byId: Procedure
      .input(Schema.Struct({ id: Schema.String }))
      .output(Schema.NullOr(UserSchema))
      .query(),
    create: Procedure
      .input(CreateUserSchema)
      .output(UserSchema)
      .mutation(),
  })

  type UserServiceType = ProceduresService<"", typeof UserProcedures.procedures>
  const UserService = Context.GenericTag<UserServiceType>("@effect-trpc/user")

  it("executes handlers through the layer", async () => {
    const mockUsers: User[] = [
      { id: "1", name: "Alice", email: "alice@test.com" },
      { id: "2", name: "Bob", email: "bob@test.com" },
    ]

    const MockUserHandlers = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed(mockUsers),
      byId: (_ctx, { id }) => Effect.succeed(mockUsers.find((u) => u.id === id) ?? null),
      create: (_ctx, { name, email }) => Effect.succeed({ id: "3", name, email }),
    })

    const listProgram = UserService.pipe(
      Effect.flatMap((service) => service.handlers.list(mockCtx, undefined)),
      Effect.provide(MockUserHandlers),
    ) as Effect.Effect<readonly User[], never, never>

    const users = await Effect.runPromise(listProgram)
    expect(users).toHaveLength(2)
    expect(users[0]?.name).toBe("Alice")
  })

  it("executes query with input through the layer", async () => {
    const mockUsers: User[] = [{ id: "1", name: "Alice", email: "alice@test.com" }]

    const MockUserHandlers = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed(mockUsers),
      byId: (_ctx, { id }) => Effect.succeed(mockUsers.find((u) => u.id === id) ?? null),
      create: (_ctx, { name, email }) => Effect.succeed({ id: "2", name, email }),
    })

    const program = UserService.pipe(
      Effect.flatMap((service) => service.handlers.byId(mockCtx, { id: "1" })),
      Effect.provide(MockUserHandlers),
    ) as Effect.Effect<User | null, never, never>

    const user = await Effect.runPromise(program)
    expect(user).toEqual({ id: "1", name: "Alice", email: "alice@test.com" })
  })

  it("executes mutation through the layer", async () => {
    let createdUser: User | null = null

    const MockUserHandlers = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed([]),
      byId: (_ctx) => Effect.succeed(null),
      create: (_ctx, { name, email }) =>
        Effect.sync(() => {
          createdUser = { id: "new-id", name, email }
          return createdUser
        }),
    })

    const program = UserService.pipe(
      Effect.flatMap((service) => service.handlers.create(mockCtx, { name: "Charlie", email: "charlie@test.com" })),
      Effect.provide(MockUserHandlers),
    ) as Effect.Effect<User, never, never>

    const result = await Effect.runPromise(program)
    expect(result).toEqual({ id: "new-id", name: "Charlie", email: "charlie@test.com" })
    expect(createdUser).toEqual(result)
  })

  it("returns null for non-existent entity", async () => {
    const MockUserHandlers = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed([]),
      byId: (_ctx) => Effect.succeed(null),
      create: (_ctx, { name, email }) => Effect.succeed({ id: "1", name, email }),
    })

    const program = UserService.pipe(
      Effect.flatMap((service) => service.handlers.byId(mockCtx, { id: "nonexistent" })),
      Effect.provide(MockUserHandlers),
    ) as Effect.Effect<User | null, never, never>

    const result = await Effect.runPromise(program)
    expect(result).toBeNull()
  })
})

describe("procedures with dependencies", () => {
  interface Database {
    readonly query: <T>(sql: string) => Effect.Effect<T[]>
    readonly insert: <T>(table: string, data: T) => Effect.Effect<T>
  }

  const Database = Context.GenericTag<Database>("Database")

  interface User {
    id: string
    name: string
  }

  const UserSchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
  })

  const UserProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(UserSchema)).query(),
    create: Procedure
      .input(Schema.Struct({ name: Schema.String }))
      .output(UserSchema)
      .mutation(),
  })

  const UserService = Context.GenericTag<ProceduresService<"", typeof UserProcedures.procedures>>(
    "@effect-trpc/user",
  )

  it("creates handlers that depend on services", async () => {
    const UserHandlersLive = UserProcedures.toLayer(
      Effect.gen(function* () {
        const db = yield* Database
        return {
          list: (_ctx) => db.query<User>("SELECT * FROM users"),
          create: (_ctx, { name }) => db.insert<User>("users", { id: "new", name }),
        }
      }),
    )

    const mockUsers: User[] = [{ id: "1", name: "Alice" }]
    const MockDatabase = Layer.succeed(Database, {
      query: <T>() => Effect.succeed(mockUsers as T[]),
      insert: <T>(_table: string, data: T) => Effect.succeed(data),
    })

    const TestLayer = UserHandlersLive.pipe(Layer.provide(MockDatabase))

    const program = UserService.pipe(
      Effect.flatMap((service) =>
        Effect.all({
          users: service.handlers.list(mockCtx, undefined),
          created: service.handlers.create(mockCtx, { name: "Bob" }),
        }),
      ),
      Effect.provide(TestLayer),
    ) as Effect.Effect<{ users: readonly User[]; created: User }, never, never>

    const result = await Effect.runPromise(program)
    expect(result.users).toHaveLength(1)
    expect(result.users[0]?.name).toBe("Alice")
    expect(result.created.name).toBe("Bob")
  })
})

describe("multiple procedure groups", () => {
  interface User {
    id: string
    name: string
  }

  interface Post {
    id: string
    title: string
    authorId: string
  }

  const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
  const PostSchema = Schema.Struct({ id: Schema.String, title: Schema.String, authorId: Schema.String })

  const UserProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(UserSchema)).query(),
  })

  const PostProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(PostSchema)).query(),
    byAuthor: Procedure
      .input(Schema.Struct({ authorId: Schema.String }))
      .output(Schema.Array(PostSchema))
      .query(),
  })

  const UserService = Context.GenericTag<ProceduresService<"", typeof UserProcedures.procedures>>(
    "@effect-trpc/user",
  )

  const PostService = Context.GenericTag<ProceduresService<"", typeof PostProcedures.procedures>>(
    "@effect-trpc/post",
  )

  it("composes multiple handler layers", async () => {
    const mockUsers: User[] = [{ id: "1", name: "Alice" }]
    const mockPosts: Post[] = [
      { id: "p1", title: "Hello World", authorId: "1" },
      { id: "p2", title: "Effect is great", authorId: "1" },
    ]

    const UserHandlers = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed(mockUsers),
    })

    const PostHandlers = PostProcedures.toLayer({
      list: (_ctx) => Effect.succeed(mockPosts),
      byAuthor: (_ctx, { authorId }) =>
        Effect.succeed(mockPosts.filter((p) => p.authorId === authorId)),
    })

    const AllHandlers = Layer.mergeAll(UserHandlers, PostHandlers)

    const program = Effect.all([UserService, PostService]).pipe(
      Effect.flatMap(([userService, postService]) =>
        Effect.all({
          users: userService.handlers.list(mockCtx, undefined),
          posts: postService.handlers.byAuthor(mockCtx, { authorId: "1" }),
        }),
      ),
      Effect.provide(AllHandlers),
    ) as Effect.Effect<{ users: readonly User[]; posts: readonly Post[] }, never, never>

    const result = await Effect.runPromise(program)
    expect(result.users).toHaveLength(1)
    expect(result.posts).toHaveLength(2)
    expect(result.posts[0]?.title).toBe("Hello World")
  })
})
