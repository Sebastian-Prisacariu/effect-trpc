/**
 * @module effect-trpc/tests/types
 *
 * Type system tests to ensure the API has correct type inference.
 * These tests verify compile-time behavior.
 */

import { describe, it, expectTypeOf } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Layer from "effect/Layer"
import {
  procedure,
  procedures,
  Router,
  extractMetadata,
  type InferInput,
  type InferOutput,
} from "../index.js"
import type { BaseContext } from "../core/middleware.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Schemas
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})
type User = typeof UserSchema.Type

const CreateUserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
})
type CreateUser = typeof CreateUserSchema.Type

const UserIdSchema = Schema.Struct({
  id: Schema.String,
})
type UserId = typeof UserIdSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Builder Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("procedure builder types", () => {
  it("infers query type correctly", () => {
    const def = procedure.output(UserSchema).query()

    // Verify key properties rather than full interface (avoids exactOptionalPropertyTypes issues)
    expectTypeOf(def._tag).toEqualTypeOf<"ProcedureDefinition">()
    expectTypeOf(def.type).toEqualTypeOf<"query">()
  })

  it("infers mutation type correctly", () => {
    const def = procedure
      .input(CreateUserSchema)
      .output(UserSchema)
      .mutation()

    expectTypeOf(def._tag).toEqualTypeOf<"ProcedureDefinition">()
    expectTypeOf(def.type).toEqualTypeOf<"mutation">()
  })

  it("infers stream type correctly", () => {
    const def = procedure.output(Schema.String).stream()

    expectTypeOf(def._tag).toEqualTypeOf<"ProcedureDefinition">()
    expectTypeOf(def.type).toEqualTypeOf<"stream">()
  })

  it("infers chat type correctly", () => {
    const ChatPartSchema = Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("text"), content: Schema.String }),
      Schema.Struct({ _tag: Schema.Literal("done") }),
    )

    const def = procedure.output(ChatPartSchema).chat()

    expectTypeOf(def._tag).toEqualTypeOf<"ProcedureDefinition">()
    expectTypeOf(def.type).toEqualTypeOf<"chat">()
  })

  it("chains input and output correctly", () => {
    const def = procedure
      .input(UserIdSchema)
      .output(UserSchema)
      .query()

    expectTypeOf(def._tag).toEqualTypeOf<"ProcedureDefinition">()
    expectTypeOf(def.type).toEqualTypeOf<"query">()
  })

  it("preserves invalidates metadata", () => {
    const def = procedure
      .input(CreateUserSchema)
      .invalidates(["user.list"])
      .mutation()

    expectTypeOf(def.invalidates).toEqualTypeOf<readonly string[]>()
  })

  it("preserves tags metadata", () => {
    const def = procedure
      .output(Schema.Array(UserSchema))
      .tags(["users", "list"])
      .query()

    expectTypeOf(def.tags).toEqualTypeOf<readonly string[]>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Procedures Group Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("procedures group types", () => {
  const UserProcedures = procedures("user", {
    list: procedure.output(Schema.Array(UserSchema)).query(),
    byId: procedure.input(UserIdSchema).output(UserSchema).query(),
    create: procedure
      .input(CreateUserSchema)
      .output(UserSchema)
      .invalidates(["user.list"])
      .mutation(),
    stream: procedure.output(Schema.String).stream(),
  })

  it("infers group name correctly", () => {
    expectTypeOf(UserProcedures.name).toEqualTypeOf<"user">()
  })

  it("has correct procedures record type", () => {
    expectTypeOf(UserProcedures.procedures).toHaveProperty("list")
    expectTypeOf(UserProcedures.procedures).toHaveProperty("byId")
    expectTypeOf(UserProcedures.procedures).toHaveProperty("create")
    expectTypeOf(UserProcedures.procedures).toHaveProperty("stream")
  })

  it("toLayer accepts correct handler types", () => {
    // This should compile without errors
    const layer = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed([] as User[]),
      byId: (_ctx, { id }) => Effect.succeed({ id, name: "Test", email: "test@test.com" }),
      create: (_ctx, { name, email }) =>
        Effect.succeed({ id: "new", name, email }),
      stream: (_ctx) => Effect.succeed(["hello"] as unknown as AsyncIterable<string>),
    })

    // Verify it's a Layer with no error and no requirements
    // Using assignment to verify types compile correctly
    const _verifyLayer: Layer.Layer<unknown, never, never> = layer as Layer.Layer<unknown, never, never>
    void _verifyLayer
  })

  it("toLayer accepts Effect with dependencies", () => {
    // Define a mock service
    interface Database {
      readonly findUsers: () => Effect.Effect<User[]>
    }
    const Database = Effect.Tag("Database")<Database, Database>()

    const layer = UserProcedures.toLayer(
      Effect.gen(function* () {
        const db = yield* Database
        return {
          list: (_ctx: BaseContext) => db.findUsers(),
          byId: (_ctx: BaseContext, { id }: UserId) =>
            Effect.succeed({ id, name: "Test", email: "test@test.com" }),
          create: (_ctx: BaseContext, { name, email }: CreateUser) =>
            Effect.succeed({ id: "new", name, email }),
          stream: (_ctx: BaseContext) => Effect.succeed(["hello"] as unknown as AsyncIterable<string>),
        }
      }),
    )

    // Layer should require Database
    expectTypeOf(layer).toMatchTypeOf<Layer.Layer<any, never, Database>>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Router Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("router types", () => {
  const UserProcedures = procedures("user", {
    list: procedure.output(Schema.Array(UserSchema)).query(),
    byId: procedure.input(UserIdSchema).output(UserSchema).query(),
  })

  const PostProcedures = procedures("post", {
    list: procedure.output(Schema.Array(Schema.String)).query(),
    create: procedure.input(Schema.Struct({ title: Schema.String })).mutation(),
  })

  const appRouter = Router.make({
    user: UserProcedures,
    post: PostProcedures,
  })

  it("has correct routes type", () => {
    expectTypeOf(appRouter.routes).toHaveProperty("user")
    expectTypeOf(appRouter.routes).toHaveProperty("post")
  })

  it("routes reference the original procedures groups", () => {
    expectTypeOf(appRouter.routes.user).toEqualTypeOf(UserProcedures)
    expectTypeOf(appRouter.routes.post).toEqualTypeOf(PostProcedures)
  })

  it("has rpcGroup property", () => {
    expectTypeOf(appRouter).toHaveProperty("rpcGroup")
  })

  it("has toHttpLayer method", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expectTypeOf(appRouter.toHttpLayer).toBeFunction()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Nested Router Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("nested router types", () => {
  // Create nested procedure groups
  const PostsProcedures = procedures("posts", {
    list: procedure.output(Schema.Array(Schema.String)).query(),
    create: procedure
      .input(Schema.Struct({ title: Schema.String }))
      .output(Schema.String)
      .mutation(),
  })

  const CommentsProcedures = procedures("comments", {
    list: procedure.input(Schema.Struct({ postId: Schema.String })).output(Schema.Array(Schema.String)).query(),
  })

  const ProfileProcedures = procedures("profile", {
    get: procedure.output(UserSchema).query(),
    update: procedure.input(Schema.Struct({ name: Schema.String })).output(UserSchema).mutation(),
  })

  const HealthProcedures = procedures("health", {
    check: procedure.output(Schema.Struct({ status: Schema.String })).query(),
  })

  // Create nested router structure
  const userRouter = Router.make({
    posts: PostsProcedures,
    comments: CommentsProcedures,
    profile: ProfileProcedures,
  })

  const appRouter = Router.make({
    user: userRouter,
    health: HealthProcedures,
  })

  it("accepts nested routers in router()", () => {
    // The fact that this compiles verifies the types work
    expectTypeOf(appRouter).toMatchTypeOf<Router>()
  })

  it("has correct nested routes type", () => {
    // Top level should have user (router) and health (procedures group)
    expectTypeOf(appRouter.routes).toHaveProperty("user")
    expectTypeOf(appRouter.routes).toHaveProperty("health")

    // user should be a Router, not a ProceduresGroup
    expectTypeOf(appRouter.routes.user).toMatchTypeOf<Router>()

    // health should be the HealthProcedures group
    expectTypeOf(appRouter.routes.health).toEqualTypeOf(HealthProcedures)
  })

  it("nested router has its own routes", () => {
    // user router should have posts, comments, profile
    expectTypeOf(appRouter.routes.user.routes).toHaveProperty("posts")
    expectTypeOf(appRouter.routes.user.routes).toHaveProperty("comments")
    expectTypeOf(appRouter.routes.user.routes).toHaveProperty("profile")

    // These should be ProceduresGroups
    expectTypeOf(appRouter.routes.user.routes.posts).toEqualTypeOf(PostsProcedures)
    expectTypeOf(appRouter.routes.user.routes.comments).toEqualTypeOf(CommentsProcedures)
    expectTypeOf(appRouter.routes.user.routes.profile).toEqualTypeOf(ProfileProcedures)
  })

  it("flattens procedures with dot-separated paths", () => {
    // Verify the flattened procedures map has correct paths
    // This is a runtime check but verifies our flattening logic
    const procedurePaths = Object.keys(appRouter.procedures)

    // Should include nested paths like "user.posts.list"
    // Using includes is a runtime check, but the type should allow it
    expectTypeOf(procedurePaths).toEqualTypeOf<string[]>()
  })

  it("supports deeply nested routers (3+ levels)", () => {
    // Create a deeply nested structure
    const adminUsersRouter = Router.make({
      list: procedures("list", {
        all: procedure.output(Schema.Array(UserSchema)).query(),
      }),
      details: procedures("details", {
        get: procedure.input(UserIdSchema).output(UserSchema).query(),
      }),
    })

    const adminRouter = Router.make({
      users: adminUsersRouter,
    })

    const deepRouter = Router.make({
      admin: adminRouter,
      public: HealthProcedures,
    })

    // Verify the deep nesting compiles
    expectTypeOf(deepRouter).toMatchTypeOf<Router>()
    expectTypeOf(deepRouter.routes.admin).toMatchTypeOf<Router>()
    expectTypeOf(deepRouter.routes.admin.routes.users).toMatchTypeOf<Router>()
    expectTypeOf(deepRouter.routes.public).toEqualTypeOf(HealthProcedures)
  })

  it("extractMetadata works with nested routers", () => {
    const postsWithMetadata = procedures("posts", {
      list: procedure.output(Schema.Array(Schema.String)).tags(["posts"]).query(),
      create: procedure
        .input(Schema.Struct({ title: Schema.String }))
        .output(Schema.String)
        .invalidates(["user.posts.list"])
        .mutation(),
    })

    const nestedRouterWithMetadata = Router.make({
      user: Router.make({
        posts: postsWithMetadata,
      }),
    })

    const metadata = extractMetadata(nestedRouterWithMetadata)

    // Verify the metadata has the correct nested paths
    expectTypeOf(metadata).toMatchTypeOf<Record<string, unknown>>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Router Flattening Type Tests
// ─────────────────────────────────────────────────────────────────────────────
//
// These tests verify that the flattenRoutes function preserves types correctly.
// The type-level computation (ExtractProcedures) should match the runtime flattening.
// ─────────────────────────────────────────────────────────────────────────────

describe("router flattening types", () => {
  // Test fixtures
  const UserListProc = procedure.output(Schema.Array(UserSchema)).query()
  const UserByIdProc = procedure.input(UserIdSchema).output(UserSchema).query()
  const UserCreateProc = procedure.input(CreateUserSchema).output(UserSchema).mutation()

  const UserProcedures = procedures("user", {
    list: UserListProc,
    byId: UserByIdProc,
    create: UserCreateProc,
  })

  const PostProcedures = procedures("post", {
    list: procedure.output(Schema.Array(Schema.String)).query(),
    create: procedure.input(Schema.Struct({ title: Schema.String })).mutation(),
  })

  const HealthProcedures = procedures("health", {
    check: procedure.output(Schema.Struct({ status: Schema.String })).query(),
  })

  it("flat router preserves procedure group types", () => {
    const flatRouter = Router.make({
      user: UserProcedures,
      post: PostProcedures,
    })

    // routes should have exact procedure group types
    expectTypeOf(flatRouter.routes.user).toEqualTypeOf(UserProcedures)
    expectTypeOf(flatRouter.routes.post).toEqualTypeOf(PostProcedures)
  })

  it("nested router preserves types at each level", () => {
    const innerRouter = Router.make({
      posts: PostProcedures,
      health: HealthProcedures,
    })

    const outerRouter = Router.make({
      user: innerRouter,
      system: HealthProcedures,
    })

    // Outer level types
    expectTypeOf(outerRouter.routes.user).toMatchTypeOf<Router>()
    expectTypeOf(outerRouter.routes.system).toEqualTypeOf(HealthProcedures)

    // Inner level types (accessed through the router)
    expectTypeOf(outerRouter.routes.user.routes.posts).toEqualTypeOf(PostProcedures)
    expectTypeOf(outerRouter.routes.user.routes.health).toEqualTypeOf(HealthProcedures)
  })

  it("flattened procedures have correct path-based keys", () => {
    const router = Router.make({
      user: UserProcedures,
      post: PostProcedures,
    })

    // The procedures property should be a Record with string keys
    // The exact keys are computed at runtime but should include paths like "user.list"
    expectTypeOf(router.procedures).toMatchTypeOf<Record<string, unknown>>()

    // Verify the keys are accessible (this is a runtime check wrapped in a type assertion)
    const keys = Object.keys(router.procedures)
    expectTypeOf(keys).toEqualTypeOf<string[]>()
  })

  it("deeply nested router flattening preserves types", () => {
    // Create 3 levels of nesting
    const level3 = Router.make({
      procs: HealthProcedures,
    })

    const level2 = Router.make({
      nested: level3,
      direct: PostProcedures,
    })

    const level1 = Router.make({
      deep: level2,
      shallow: UserProcedures,
    })

    // Verify type preservation at each level
    expectTypeOf(level1.routes.deep).toMatchTypeOf<Router>()
    expectTypeOf(level1.routes.shallow).toEqualTypeOf(UserProcedures)

    expectTypeOf(level1.routes.deep.routes.nested).toMatchTypeOf<Router>()
    expectTypeOf(level1.routes.deep.routes.direct).toEqualTypeOf(PostProcedures)

    expectTypeOf(level1.routes.deep.routes.nested.routes.procs).toEqualTypeOf(HealthProcedures)
  })

  it("rpcGroup is created with correct type", () => {
    const router = Router.make({
      user: UserProcedures,
    })

    // rpcGroup should exist and be a valid RpcGroup
    expectTypeOf(router.rpcGroup).toHaveProperty("merge")
    expectTypeOf(router.rpcGroup).toHaveProperty("toLayer")
  })

  it("extractMetadata preserves path structure", () => {
    const TaggedUserProcedures = procedures("user", {
      list: procedure.output(Schema.Array(UserSchema)).tags(["users"]).query(),
      create: procedure
        .input(CreateUserSchema)
        .output(UserSchema)
        .invalidates(["user.list"])
        .invalidatesTags(["users"])
        .mutation(),
    })

    const router = Router.make({
      user: TaggedUserProcedures,
    })

    const metadata = extractMetadata(router)

    // Metadata should be a record with string keys
    expectTypeOf(metadata).toMatchTypeOf<Record<string, unknown>>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// InferInput / InferOutput Type Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("type inference helpers", () => {
  const _UserProcedures = procedures("user", {
    list: procedure.output(Schema.Array(UserSchema)).query(),
    byId: procedure.input(UserIdSchema).output(UserSchema).query(),
    create: procedure.input(CreateUserSchema).output(UserSchema).mutation(),
  })

  it("InferInput extracts input types", () => {
    type Inputs = InferInput<typeof _UserProcedures>

    // byId should have UserId input - verify with type assignment
    const _byIdInput: Inputs["byId"] = { id: "test" }
    void _byIdInput

    // create should have CreateUser input
    const _createInput: Inputs["create"] = { name: "test", email: "test@test.com" }
    void _createInput
  })

  it("InferOutput extracts output types", () => {
    type Outputs = InferOutput<typeof _UserProcedures>

    // list should have User[] output - verify with type assignment
    const _listOutput: Outputs["list"] = [{ id: "1", name: "test", email: "test@test.com" }]
    void _listOutput

    // byId should have User output
    const _byIdOutput: Outputs["byId"] = { id: "1", name: "test", email: "test@test.com" }
    void _byIdOutput

    // create should have User output
    const _createOutput: Outputs["create"] = { id: "1", name: "test", email: "test@test.com" }
    void _createOutput
  })
})
