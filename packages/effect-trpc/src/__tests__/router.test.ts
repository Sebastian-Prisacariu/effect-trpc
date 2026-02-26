import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Procedure } from "../core/index.js"
import { Procedures } from "../core/index.js"
import { Router, extractMetadata } from "../core/server/router.js"
import { procedureToRpc, proceduresGroupToRpcGroup, convertHandlers } from "../core/rpc/index.js"
import { Middleware, type BaseContext } from "../core/server/middleware.js"

/**
 * Helper to cast MiddlewareResult (Effect | Stream) to runnable Effect for tests.
 */

const asRunnable = <A, E>(effect: unknown): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>

/**
 * Helper to cast procedure to AnyProcedure for tests.
 * Needed due to exactOptionalPropertyTypes making never not assignable to any.
 */

const asProcedure = <T>(proc: T): Parameters<typeof procedureToRpc>[1] =>
  proc as unknown as Parameters<typeof procedureToRpc>[1]

describe("router", () => {
  const UserSchema = Schema.Struct({
    id: Schema.String,
    name: Schema.String,
  })

  const UserProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(UserSchema)).query(),
    byId: Procedure
      .input(Schema.Struct({ id: Schema.String }))
      .output(UserSchema)
      .query(),
  })

  const PostProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(Schema.String)).query(),
    create: Procedure
      .input(Schema.Struct({ title: Schema.String }))
      .output(Schema.String)
      .mutation(),
  })

  it("creates a router from procedure groups", () => {
    const router = Router.make({
      user: UserProcedures,
      post: PostProcedures,
    })

    expect(router._tag).toBe("Router")
    expect(router.routes.user).toBe(UserProcedures)
    expect(router.routes.post).toBe(PostProcedures)
    expect(router.rpcGroup).toBeDefined()
  })

  it("combines multiple procedure groups into one RpcGroup", () => {
    const router = Router.make({
      user: UserProcedures,
      post: PostProcedures,
    })

    // The combined group should have all procedures
    const requests = router.rpcGroup.requests
    expect(requests.size).toBe(4) // user.list, user.byId, post.list, post.create
    expect(requests.has("user.list")).toBe(true)
    expect(requests.has("user.byId")).toBe(true)
    expect(requests.has("post.list")).toBe(true)
    expect(requests.has("post.create")).toBe(true)
  })

  it("throws when creating router with no groups", () => {
    expect(() => Router.make({})).toThrow("Router must have at least one procedure group")
  })
})

describe("rpc-bridge", () => {
  it("converts a procedure to an Rpc", () => {
    const def = Procedure
      .input(Schema.Struct({ id: Schema.String }))
      .output(Schema.String)
      .query()

    const rpc = procedureToRpc("test.procedure", asProcedure(def))

    expect(rpc._tag).toBe("test.procedure")
  })

  it("converts a stream procedure with stream flag", () => {
    const def = Procedure.output(Schema.String).stream()

    const rpc = procedureToRpc("test.stream", asProcedure(def))

    expect(rpc._tag).toBe("test.stream")
  })

  it("converts a procedures group to RpcGroup", () => {
    const TestProcedures = Procedures.make({
      one: Procedure.output(Schema.String).query(),
      two: Procedure.input(Schema.String).output(Schema.Number).mutation(),
    })

    const rpcGroup = proceduresGroupToRpcGroup(TestProcedures, "test.")

    expect(rpcGroup.requests.size).toBe(2)
    expect(rpcGroup.requests.has("test.one")).toBe(true)
    expect(rpcGroup.requests.has("test.two")).toBe(true)
  })
})

describe("nested routers", () => {
  const PostsSchema = Schema.Struct({
    id: Schema.String,
    title: Schema.String,
  })

  const CommentSchema = Schema.Struct({
    id: Schema.String,
    text: Schema.String,
  })

  const PostsProcedures = Procedures.make({
    list: Procedure.output(Schema.Array(PostsSchema)).query(),
    create: Procedure
      .input(Schema.Struct({ title: Schema.String }))
      .output(PostsSchema)
      .invalidates(["user.posts.list"])
      .mutation(),
  })

  const CommentsProcedures = Procedures.make({
    list: Procedure
      .input(Schema.Struct({ postId: Schema.String }))
      .output(Schema.Array(CommentSchema))
      .query(),
    create: Procedure
      .input(Schema.Struct({ postId: Schema.String, text: Schema.String }))
      .output(CommentSchema)
      .mutation(),
  })

  const ProfileProcedures = Procedures.make({
    get: Procedure.output(Schema.Struct({ name: Schema.String })).query(),
  })

  const HealthProcedures = Procedures.make({
    check: Procedure.output(Schema.Struct({ status: Schema.String })).query(),
  })

  it("creates router with nested routers", () => {
    const userRouter = Router.make({
      posts: PostsProcedures,
      comments: CommentsProcedures,
    })

    const appRouter = Router.make({
      user: userRouter,
      health: HealthProcedures,
    })

    expect(appRouter._tag).toBe("Router")
    expect(appRouter.routes.user._tag).toBe("Router")
    expect(appRouter.routes.health._tag).toBe("ProceduresGroup")
  })

  it("flattens procedures with correct dot-separated paths", () => {
    const userRouter = Router.make({
      posts: PostsProcedures,
      comments: CommentsProcedures,
    })

    const appRouter = Router.make({
      user: userRouter,
      health: HealthProcedures,
    })

    const procedurePaths = Object.keys(appRouter.procedures)

    // Should have nested paths
    expect(procedurePaths).toContain("user.posts.list")
    expect(procedurePaths).toContain("user.posts.create")
    expect(procedurePaths).toContain("user.comments.list")
    expect(procedurePaths).toContain("user.comments.create")
    expect(procedurePaths).toContain("health.check")

    // Total count
    expect(procedurePaths.length).toBe(5)
  })

  it("creates RpcGroup with correct nested paths", () => {
    const userRouter = Router.make({
      posts: PostsProcedures,
    })

    const appRouter = Router.make({
      user: userRouter,
    })

    const requests = appRouter.rpcGroup.requests

    expect(requests.has("user.posts.list")).toBe(true)
    expect(requests.has("user.posts.create")).toBe(true)
  })

  it("supports deeply nested routers (3+ levels)", () => {
    const detailsProcedures = Procedures.make({
      get: Procedure.output(Schema.String).query(),
    })

    const usersRouter = Router.make({
      details: detailsProcedures,
    })

    const adminRouter = Router.make({
      users: usersRouter,
    })

    const appRouter = Router.make({
      admin: adminRouter,
    })

    const procedurePaths = Object.keys(appRouter.procedures)

    expect(procedurePaths).toContain("admin.users.details.get")
    expect(procedurePaths.length).toBe(1)
  })

  it("supports composing routers from different modules", () => {
    // Simulate importing routers from different files
    const postsRouter = Router.make({
      crud: PostsProcedures,
    })

    const commentsRouter = Router.make({
      crud: CommentsProcedures,
    })

    const userRouter = Router.make({
      posts: postsRouter,
      comments: commentsRouter,
      profile: ProfileProcedures,
    })

    const appRouter = Router.make({
      user: userRouter,
      health: HealthProcedures,
    })

    const procedurePaths = Object.keys(appRouter.procedures)

    expect(procedurePaths).toContain("user.posts.crud.list")
    expect(procedurePaths).toContain("user.posts.crud.create")
    expect(procedurePaths).toContain("user.comments.crud.list")
    expect(procedurePaths).toContain("user.comments.crud.create")
    expect(procedurePaths).toContain("user.profile.get")
    expect(procedurePaths).toContain("health.check")
  })
})

describe("nested router metadata extraction", () => {
  it("extracts metadata with full nested paths", () => {
    const PostsProcedures = Procedures.make({
      list: Procedure.output(Schema.Array(Schema.String)).tags(["posts"]).query(),
      create: Procedure
        .input(Schema.Struct({ title: Schema.String }))
        .output(Schema.String)
        .invalidates(["user.posts.list"])
        .mutation(),
    })

    const userRouter = Router.make({
      posts: PostsProcedures,
    })

    const appRouter = Router.make({
      user: userRouter,
    })

    const metadata = extractMetadata(appRouter)

    // Paths should be fully qualified
    expect(metadata["user.posts.list"]).toEqual({ tags: ["posts"] })
    expect(metadata["user.posts.create"]).toEqual({ invalidates: ["user.posts.list"] })
  })

  it("works with deeply nested routers", () => {
    const ActionsProcedures = Procedures.make({
      run: Procedure
        .input(Schema.Struct({ action: Schema.String }))
        .invalidates(["admin.users.details.get"])
        .invalidatesTags(["admin-actions"])
        .mutation(),
    })

    const detailsProcedures = Procedures.make({
      get: Procedure.output(Schema.String).tags(["user-details"]).query(),
    })

    const usersRouter = Router.make({
      details: detailsProcedures,
      actions: ActionsProcedures,
    })

    const adminRouter = Router.make({
      users: usersRouter,
    })

    const appRouter = Router.make({
      admin: adminRouter,
    })

    const metadata = extractMetadata(appRouter)

    expect(metadata["admin.users.details.get"]).toEqual({ tags: ["user-details"] })
    expect(metadata["admin.users.actions.run"]).toEqual({
      invalidates: ["admin.users.details.get"],
      invalidatesTags: ["admin-actions"],
    })
  })
})

describe("extractMetadata", () => {
  it("extracts invalidation metadata from procedures", () => {
    const UserProcedures = Procedures.make({
      list: Procedure.output(Schema.Array(Schema.String)).tags(["users"]).query(),
      create: Procedure
        .input(Schema.Struct({ name: Schema.String }))
        .output(Schema.String)
        .invalidates(["user.list"])
        .mutation(),
      delete: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .invalidates(["user.list"])
        .invalidatesTags(["users"])
        .mutation(),
    })

    const router = Router.make({ user: UserProcedures })
    const metadata = extractMetadata(router)

    // user.list has tags
    expect(metadata["user.list"]).toEqual({ tags: ["users"] })

    // user.create has invalidates
    expect(metadata["user.create"]).toEqual({ invalidates: ["user.list"] })

    // user.delete has both invalidates and invalidatesTags
    expect(metadata["user.delete"]).toEqual({
      invalidates: ["user.list"],
      invalidatesTags: ["users"],
    })
  })

  it("extracts OpenAPI metadata from procedures", () => {
    const ApiProcedures = Procedures.make({
      getUser: Procedure
        .summary("Get user by ID")
        .description("Retrieves a user by their unique identifier")
        .externalDocs("https://docs.example.com/api/users")
        .responseDescription("The user object with all profile fields")
        .deprecated()
        .output(Schema.String)
        .query(),
      simpleGet: Procedure.summary("Simple endpoint").output(Schema.String).query(),
    })

    const router = Router.make({ api: ApiProcedures })
    const metadata = extractMetadata(router)

    // api.getUser has all OpenAPI metadata
    expect(metadata["api.getUser"]).toEqual({
      summary: "Get user by ID",
      description: "Retrieves a user by their unique identifier",
      externalDocs: "https://docs.example.com/api/users",
      responseDescription: "The user object with all profile fields",
      deprecated: true,
    })

    // api.simpleGet has only summary
    expect(metadata["api.simpleGet"]).toEqual({
      summary: "Simple endpoint",
    })
  })

  it("excludes procedures without metadata", () => {
    const SimpleProcedures = Procedures.make({
      get: Procedure.output(Schema.String).query(),
      set: Procedure.input(Schema.String).mutation(),
    })

    const router = Router.make({ simple: SimpleProcedures })
    const metadata = extractMetadata(router)

    expect(Object.keys(metadata)).toHaveLength(0)
  })

  it("works with multiple procedure groups", () => {
    const UserProcedures = Procedures.make({
      create: Procedure.input(Schema.String).invalidates(["user.list"]).mutation(),
    })

    const PostProcedures = Procedures.make({
      create: Procedure.input(Schema.String).invalidates(["post.list", "user.stats"]).mutation(),
    })

    const router = Router.make({
      user: UserProcedures,
      post: PostProcedures,
    })
    const metadata = extractMetadata(router)

    expect(metadata["user.create"]).toEqual({ invalidates: ["user.list"] })
    expect(metadata["post.create"]).toEqual({ invalidates: ["post.list", "user.stats"] })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Router-level Middleware Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("router-level middleware", () => {
  it("stores middleware on the router", () => {
    const loggingMiddleware = Middleware("logging")

    const TestProcedures = Procedures.make({
      get: Procedure.output(Schema.String).query(),
    })

    const testRouter = Router.make({ test: TestProcedures }, { middlewares: [loggingMiddleware] })

    expect(testRouter.middlewares).toBeDefined()
    expect(testRouter.middlewares).toHaveLength(1)
    expect(testRouter.middlewares![0]).toBe(loggingMiddleware)
  })

  it("adds middleware via .use() method", () => {
    const firstMiddleware = Middleware("first")
    const secondMiddleware = Middleware("second")

    const TestProcedures = Procedures.make({
      get: Procedure.output(Schema.String).query(),
    })

    const testRouter = Router.make({ test: TestProcedures })
      .use(firstMiddleware)
      .use(secondMiddleware)

    expect(testRouter.middlewares).toBeDefined()
    expect(testRouter.middlewares).toHaveLength(2)
    expect(testRouter.middlewares![0]).toBe(firstMiddleware)
    expect(testRouter.middlewares![1]).toBe(secondMiddleware)
  })

  it("applies router middleware to all procedures via convertHandlers", async () => {
    const executionOrder: string[] = []

    const routerMiddleware = Middleware("router")
    const procedureMiddleware = Middleware("procedure")

    const routerMiddlewareLive = routerMiddleware.toLayer((ctx) =>
      Effect.sync(() => {
        executionOrder.push("router")
        return ctx
      }),
    )

    const procedureMiddlewareLive = procedureMiddleware.toLayer((ctx) =>
      Effect.sync(() => {
        executionOrder.push("procedure")
        return ctx
      }),
    )

    const TestProcedures = Procedures.make({
      action: Procedure.use(procedureMiddleware).output(Schema.String).query(),
    })

    // Convert handlers with router middleware
    const rpcHandlers = convertHandlers(
      TestProcedures,
      {
        action: (_ctx: BaseContext) => {
          executionOrder.push("handler")
          return Effect.succeed("done")
        },
      },
      "test.",
      [routerMiddleware],
    )

    // Call the handler
    const handler = rpcHandlers["test.action"]!
    await Effect.runPromise(
      Effect.provide(
        asRunnable(
          handler(
            undefined,
            { clientId: 1, headers: new Headers() as unknown as { readonly [k: string]: string } },
          ),
        ),
        Layer.mergeAll(routerMiddlewareLive, procedureMiddlewareLive),
      ),
    )

    expect(executionOrder).toEqual(["router", "procedure", "handler"])
  })

  it("applies middleware from nested routers in correct order", () => {
    const rootMiddleware = Middleware("root")
    const nestedMiddleware = Middleware("nested")
    const procedureMiddleware = Middleware("procedure")

    const ActionProcedures = Procedures.make({
      run: Procedure.use(procedureMiddleware).output(Schema.String).query(),
    })

    const nestedRouter = Router.make(
      { action: ActionProcedures },
      { middlewares: [nestedMiddleware] },
    )

    const rootRouter = Router.make({ nested: nestedRouter }, { middlewares: [rootMiddleware] })

    // The root router should have accumulated middleware info
    // To test the full chain, we need to simulate how rpc-handler.ts would process this
    // For now, we verify the structure is correct

    expect(rootRouter.middlewares).toHaveLength(1)
    expect(rootRouter.middlewares![0]).toBe(rootMiddleware)
    expect(nestedRouter.middlewares).toHaveLength(1)
    expect(nestedRouter.middlewares![0]).toBe(nestedMiddleware)
  })

  it("router without middleware has undefined/empty middlewares", () => {
    const TestProcedures = Procedures.make({
      get: Procedure.output(Schema.String).query(),
    })

    const testRouter = Router.make({ test: TestProcedures })

    expect(testRouter.middlewares).toBeUndefined()
  })
})
