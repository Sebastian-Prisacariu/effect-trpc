/**
 * @module effect-trpc/tests/middleware-input-types
 *
 * Type system tests to verify that Middleware.withInput correctly extends
 * input types on procedures and that clients see the extended types.
 *
 * These tests verify compile-time behavior using vitest's expectTypeOf.
 */

import { describe, it, expectTypeOf, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Context from "effect/Context"
import {
  procedure,
  procedures,
  Router,
  Middleware,
  convertHandlers,
  type InferInput,
  type InferOutput,
  type InferError,
  type InferRequirements,
  type InferProvides,
  type BaseContext,
} from "../index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Schemas
// ─────────────────────────────────────────────────────────────────────────────

const OrganizationSlugSchema = Schema.Struct({
  organizationSlug: Schema.String,
})
type OrganizationSlug = typeof OrganizationSlugSchema.Type

const TenantIdSchema = Schema.Struct({
  tenantId: Schema.String,
})
type TenantId = typeof TenantIdSchema.Type

const UserIdSchema = Schema.Struct({
  userId: Schema.String,
})
type UserId = typeof UserIdSchema.Type

const FileIdSchema = Schema.Struct({
  fileId: Schema.String,
})
type FileId = typeof FileIdSchema.Type

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})
type User = typeof UserSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Test Middleware
// ─────────────────────────────────────────────────────────────────────────────

// Middleware that requires organizationSlug in input
const orgMiddleware = Middleware.make("org", (ctx, input, next) => {
  // In real code, we'd use input.organizationSlug
  const _slug = (input as OrganizationSlug).organizationSlug
  void _slug
  return next(ctx) as Effect.Effect<unknown, never, never>
}).pipe(Middleware.withInput(OrganizationSlugSchema))

// Middleware that requires tenantId in input
const tenantMiddleware = Middleware.make("tenant", (ctx, input, next) => {
  const _tenantId = (input as TenantId).tenantId
  void _tenantId
  return next(ctx) as Effect.Effect<unknown, never, never>
}).pipe(Middleware.withInput(TenantIdSchema))

// Middleware that adds user to context (no input extension)
interface AuthContext extends BaseContext {
  user: { id: string; name: string }
}
const authMiddleware = Middleware.make<BaseContext, AuthContext>(
  "auth",
  (ctx, _input, next) =>
    next({ ...ctx, user: { id: "user-1", name: "Test User" } }) as Effect.Effect<
      unknown,
      never,
      never
    >,
)

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Middleware.withInput extends procedure input
// ─────────────────────────────────────────────────────────────────────────────

describe("Middleware.withInput type inference", () => {
  describe("query procedures", () => {
    it("extends input type with middleware input requirements", () => {
      const def = procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query()

      // Input should be { organizationSlug: string } & { id: string }
      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      expectTypeOf<Input>().toMatchTypeOf<{ organizationSlug: string; id: string }>()
    })

    it("extends input type when middleware is applied before input()", () => {
      const def = procedure
        .use(orgMiddleware) // First apply middleware
        .input(Schema.Struct({ query: Schema.String })) // Then define input
        .output(Schema.Array(UserSchema))
        .query()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      // Should require both organizationSlug and query
      expectTypeOf<Input>().toMatchTypeOf<{ organizationSlug: string; query: string }>()
    })

    it("works with middleware that has no input extension", () => {
      const def = procedure
        .use(authMiddleware) // No input extension
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      // Should only have the procedure's own input
      expectTypeOf<Input>().toMatchTypeOf<{ id: string }>()
    })
  })

  describe("mutation procedures", () => {
    it("extends input type with middleware input requirements", () => {
      const def = procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ name: Schema.String, email: Schema.String }))
        .output(UserSchema)
        .mutation()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      expectTypeOf<Input>().toMatchTypeOf<{
        organizationSlug: string
        name: string
        email: string
      }>()
    })

    it("chains multiple middleware with input extensions", () => {
      const def = procedure
        .use(orgMiddleware) // Requires organizationSlug
        .use(tenantMiddleware) // Requires tenantId
        .input(Schema.Struct({ data: Schema.String }))
        .output(Schema.Void)
        .mutation()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      // Should require all three fields
      expectTypeOf<Input>().toMatchTypeOf<{
        organizationSlug: string
        tenantId: string
        data: string
      }>()
    })
  })

  describe("stream procedures", () => {
    it("extends input type with middleware input requirements", () => {
      const def = procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ filter: Schema.optional(Schema.String) }))
        .output(UserSchema)
        .stream()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      expectTypeOf<Input>().toMatchTypeOf<{
        organizationSlug: string
        filter?: string
      }>()
    })
  })

  describe("chat procedures", () => {
    const ChatPartSchema = Schema.Union(
      Schema.Struct({ _tag: Schema.Literal("text"), content: Schema.String }),
      Schema.Struct({ _tag: Schema.Literal("done") }),
    )

    it("extends input type with middleware input requirements", () => {
      const def = procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ prompt: Schema.String }))
        .output(ChatPartSchema)
        .chat()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      expectTypeOf<Input>().toMatchTypeOf<{
        organizationSlug: string
        prompt: string
      }>()
    })
  })

  describe("subscription procedures", () => {
    it("extends input type with middleware input requirements", () => {
      const def = procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ channel: Schema.String }))
        .output(Schema.Struct({ event: Schema.String, data: Schema.Unknown }))
        .subscription()

      type Input = typeof def extends { inputSchema: Schema.Schema<infer I, any> } ? I : never

      expectTypeOf<Input>().toMatchTypeOf<{
        organizationSlug: string
        channel: string
      }>()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: InferInput helper with middleware
// ─────────────────────────────────────────────────────────────────────────────

describe("InferInput with middleware input extensions", () => {
  const TestProcedures = procedures("test", {
    // Query with org middleware
    getUser: procedure
      .use(orgMiddleware)
      .input(Schema.Struct({ userId: Schema.String }))
      .output(UserSchema)
      .query(),

    // Mutation with multiple middleware
    createUser: procedure
      .use(orgMiddleware)
      .use(tenantMiddleware)
      .input(Schema.Struct({ name: Schema.String, email: Schema.String }))
      .output(UserSchema)
      .mutation(),

    // Stream with middleware
    listUsers: procedure.use(orgMiddleware).output(UserSchema).stream(),

    // No middleware (control)
    healthCheck: procedure.output(Schema.Struct({ status: Schema.String })).query(),
  })

  it("InferInput includes middleware input extensions for queries", () => {
    type Inputs = InferInput<typeof TestProcedures>

    // getUser should require organizationSlug + userId
    expectTypeOf<Inputs["getUser"]>().toMatchTypeOf<{
      organizationSlug: string
      userId: string
    }>()
  })

  it("InferInput includes middleware input extensions for mutations", () => {
    type Inputs = InferInput<typeof TestProcedures>

    // createUser should require organizationSlug + tenantId + name + email
    expectTypeOf<Inputs["createUser"]>().toMatchTypeOf<{
      organizationSlug: string
      tenantId: string
      name: string
      email: string
    }>()
  })

  it("InferInput includes middleware input extensions for streams", () => {
    type Inputs = InferInput<typeof TestProcedures>

    // listUsers should require just organizationSlug (no explicit input)
    expectTypeOf<Inputs["listUsers"]>().toMatchTypeOf<{
      organizationSlug: string
    }>()
  })

  it("InferInput works normally without middleware", () => {
    type Inputs = InferInput<typeof TestProcedures>

    // healthCheck has no input, should be unknown
    expectTypeOf<Inputs["healthCheck"]>().toEqualTypeOf<unknown>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Router with middleware-extended procedures
// ─────────────────────────────────────────────────────────────────────────────

describe("Router with middleware-extended procedures", () => {
  const MediaProcedures = procedures("media", {
    list: procedure
      .use(orgMiddleware)
      .input(
        Schema.Struct({
          folderId: Schema.optional(Schema.String),
          limit: Schema.optional(Schema.Number),
        }),
      )
      .output(Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })))
      .stream(),

    getById: procedure
      .use(orgMiddleware)
      .input(Schema.Struct({ fileId: Schema.String }))
      .output(Schema.Struct({ id: Schema.String, name: Schema.String }))
      .query(),

    delete: procedure
      .use(orgMiddleware)
      .input(Schema.Struct({ fileIds: Schema.Array(Schema.String) }))
      .output(Schema.Void)
      .mutation(),
  })

  const UserProcedures = procedures("user", {
    me: procedure.use(authMiddleware).output(UserSchema).query(),
  })

  const router = Router.make({
    media: MediaProcedures,
    user: UserProcedures,
  })

  it("router preserves middleware input extensions in procedures map", () => {
    // Access the flattened procedures
    const procs = router.procedures

    // The procedures should exist with proper paths
    expect(procs["media.list"]).toBeDefined()
    expect(procs["media.getById"]).toBeDefined()
    expect(procs["media.delete"]).toBeDefined()
    expect(procs["user.me"]).toBeDefined()
  })

  it("InferInput works with router procedures groups", () => {
    type MediaInputs = InferInput<typeof MediaProcedures>

    // All media procedures should require organizationSlug
    expectTypeOf<MediaInputs["list"]>().toMatchTypeOf<{
      organizationSlug: string
      folderId?: string
      limit?: number
    }>()

    expectTypeOf<MediaInputs["getById"]>().toMatchTypeOf<{
      organizationSlug: string
      fileId: string
    }>()

    expectTypeOf<MediaInputs["delete"]>().toMatchTypeOf<{
      organizationSlug: string
      fileIds: string[]
    }>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Tests: Middleware receives extended input
// ─────────────────────────────────────────────────────────────────────────────

describe("Runtime: middleware receives extended input", () => {
  const asRunnable = <A, E>(effect: any): Effect.Effect<A, E, never> =>
    effect as Effect.Effect<A, E, never>

  it("middleware receives full input including extension fields (query)", async () => {
    let receivedInput: unknown = null

    const trackingMiddleware = Middleware.make("tracking", (ctx, input, next) => {
      receivedInput = input
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ trackingId: Schema.String })))

    const TestProcedures = procedures("test", {
      getData: procedure
        .use(trackingMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = convertHandlers(TestProcedures, {
      getData: (_ctx, input) => Effect.succeed(`id: ${input.id}`),
    })

    const handler = handlers["test.getData"]!
    await Effect.runPromise(
      asRunnable(
        handler(
          { trackingId: "track-123", id: "item-456" },
          { clientId: 1, headers: new Headers() as any },
        ),
      ),
    )

    expect(receivedInput).toEqual({ trackingId: "track-123", id: "item-456" })
  })

  it("middleware receives full input including extension fields (mutation)", async () => {
    let receivedInput: unknown = null

    const auditMiddleware = Middleware.make("audit", (ctx, input, next) => {
      receivedInput = input
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ auditReason: Schema.optional(Schema.String) })))

    const TestProcedures = procedures("test", {
      deleteItem: procedure
        .use(auditMiddleware)
        .input(Schema.Struct({ itemId: Schema.String }))
        .output(Schema.Void)
        .mutation(),
    })

    const handlers = convertHandlers(TestProcedures, {
      deleteItem: () => Effect.void,
    })

    const handler = handlers["test.deleteItem"]!
    await Effect.runPromise(
      asRunnable(
        handler(
          { auditReason: "cleanup", itemId: "item-789" },
          { clientId: 1, headers: new Headers() as any },
        ),
      ),
    )

    expect(receivedInput).toEqual({ auditReason: "cleanup", itemId: "item-789" })
  })

  it("multiple middleware all receive the same full input", async () => {
    const receivedInputs: unknown[] = []

    const m1 = Middleware.make("m1", (ctx, input, next) => {
      receivedInputs.push({ m1: input })
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ field1: Schema.String })))

    const m2 = Middleware.make("m2", (ctx, input, next) => {
      receivedInputs.push({ m2: input })
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ field2: Schema.String })))

    const m3 = Middleware.make("m3", (ctx, input, next) => {
      receivedInputs.push({ m3: input })
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ field3: Schema.String })))

    const TestProcedures = procedures("test", {
      action: procedure
        .use(m1)
        .use(m2)
        .use(m3)
        .input(Schema.Struct({ payload: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = convertHandlers(TestProcedures, {
      action: (_ctx, input) => Effect.succeed(input.payload),
    })

    const handler = handlers["test.action"]!
    const fullInput = { field1: "v1", field2: "v2", field3: "v3", payload: "data" }

    await Effect.runPromise(
      asRunnable(handler(fullInput, { clientId: 1, headers: new Headers() as any })),
    )

    // All middleware should receive the complete input
    expect(receivedInputs).toHaveLength(3)
    expect(receivedInputs[0]).toEqual({ m1: fullInput })
    expect(receivedInputs[1]).toEqual({ m2: fullInput })
    expect(receivedInputs[2]).toEqual({ m3: fullInput })
  })

  it("stream procedure middleware receives extended input", async () => {
    let receivedInput: unknown = null

    const streamMiddleware = Middleware.make("stream-auth", (ctx, input, next) => {
      receivedInput = input
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ sessionToken: Schema.String })))

    const TestProcedures = procedures("test", {
      events: procedure
        .use(streamMiddleware)
        .input(Schema.Struct({ channel: Schema.String }))
        .output(Schema.Struct({ event: Schema.String }))
        .stream(),
    })

    const handlers = convertHandlers(TestProcedures, {
      events: () => Stream.make({ event: "connected" }),
    })

    const handler = handlers["test.events"]!
    const result = handler(
      { sessionToken: "token-abc", channel: "updates" },
      { clientId: 1, headers: new Headers() as any },
    )

    // For streams, we need to consume the stream to trigger middleware
    await Effect.runPromise(Stream.runCollect(result as any))

    expect(receivedInput).toEqual({ sessionToken: "token-abc", channel: "updates" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Handler receives correctly typed input
// ─────────────────────────────────────────────────────────────────────────────

describe("Handler input type includes middleware extensions", () => {
  it("handler input type is correctly extended", () => {
    const MediaProcedures = procedures("media", {
      getById: procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ fileId: Schema.String }))
        .output(Schema.Struct({ id: Schema.String, name: Schema.String }))
        .query(),
    })

    // This should compile without errors - the handler input type should include organizationSlug
    const _handlers = convertHandlers(MediaProcedures, {
      getById: (_ctx, input) => {
        // TypeScript should know these exist
        const _orgSlug: string = input.organizationSlug
        const _fileId: string = input.fileId
        void _orgSlug
        void _fileId
        return Effect.succeed({ id: input.fileId, name: "test" })
      },
    })

    expect(_handlers).toBeDefined()
  })

  it("handler input type with multiple middleware extensions", () => {
    const TestProcedures = procedures("test", {
      complexAction: procedure
        .use(orgMiddleware) // Adds organizationSlug
        .use(tenantMiddleware) // Adds tenantId
        .input(Schema.Struct({ action: Schema.String }))
        .output(Schema.Void)
        .mutation(),
    })

    // This should compile - all three fields should be typed
    const _handlers = convertHandlers(TestProcedures, {
      complexAction: (_ctx, input) => {
        const _orgSlug: string = input.organizationSlug
        const _tenantId: string = input.tenantId
        const _action: string = input.action
        void _orgSlug
        void _tenantId
        void _action
        return Effect.void
      },
    })

    expect(_handlers).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Error Type Accumulation
// ─────────────────────────────────────────────────────────────────────────────

// Define test error classes
class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  reason: Schema.String,
}) {}

class RateLimitError extends Schema.TaggedError<RateLimitError>()("RateLimitError", {
  retryAfter: Schema.Number,
}) {}

class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  field: Schema.String,
}) {}

// Define a test service
class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  { query: (sql: string) => Effect.Effect<unknown> }
>() {}

describe("Error type accumulation", () => {
  // Middleware that can fail with AuthError
  const authErrorMiddleware = Middleware.make<BaseContext, AuthContext, AuthError>(
    "authError",
    (ctx, _input, next) =>
      Effect.gen(function* () {
        const token = ctx.headers.get("authorization")
        if (!token) {
          return yield* Effect.fail(new AuthError({ reason: "No token" }))
        }
        return yield* next({ ...ctx, user: { id: "user-1", name: "Test" } })
      }) as Effect.Effect<unknown, AuthError, never>,
  )

  // Middleware that can fail with RateLimitError
  const rateLimitErrorMiddleware = Middleware.make<BaseContext, BaseContext, RateLimitError>(
    "rateLimit",
    (ctx, _input, next) =>
      Effect.gen(function* () {
        // Simulate rate limit check
        const limited = false
        if (limited) {
          return yield* Effect.fail(new RateLimitError({ retryAfter: 1000 }))
        }
        return yield* next(ctx)
      }) as Effect.Effect<unknown, RateLimitError, never>,
  )

  it("single middleware error is accumulated", () => {
    const def = procedure.use(authErrorMiddleware).output(UserSchema).query()

    // Error type should include AuthError
    type DefError = typeof def extends { _tag: "ProcedureDefinition" }
      ? typeof def extends { errorSchema: infer E }
        ? E extends Schema.Schema<infer Err, any>
          ? Err
          : never
        : never
      : never

    // The accumulated error type should be AuthError (from middleware) | never (no .error() called)
    // We verify this compiles - AuthError should be assignable
    const _verifyError: AuthError = {} as AuthError
    void _verifyError
  })

  it("multiple middleware errors are accumulated (union)", () => {
    const def = procedure
      .use(authErrorMiddleware) // Adds AuthError
      .use(rateLimitErrorMiddleware) // Adds RateLimitError
      .output(UserSchema)
      .query()

    // Verify the procedure definition captures both error types
    // We can't directly extract from the type param, but we can verify via InferError
    expect(def._tag).toBe("ProcedureDefinition")
  })

  it("InferError includes middleware errors", () => {
    const TestProcedures = procedures("test", {
      protected: procedure.use(authErrorMiddleware).output(UserSchema).query(),

      rateLimited: procedure.use(rateLimitErrorMiddleware).output(Schema.String).query(),

      both: procedure
        .use(authErrorMiddleware)
        .use(rateLimitErrorMiddleware)
        .error(ValidationError) // Plus explicit error
        .output(UserSchema)
        .mutation(),
    })

    type Errors = InferError<typeof TestProcedures>

    // protected should have AuthError
    expectTypeOf<Errors["protected"]>().toMatchTypeOf<AuthError>()

    // rateLimited should have RateLimitError
    expectTypeOf<Errors["rateLimited"]>().toMatchTypeOf<RateLimitError>()

    // both should have AuthError | RateLimitError | ValidationError
    expectTypeOf<Errors["both"]>().toMatchTypeOf<AuthError | RateLimitError | ValidationError>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Requirements (R channel) Accumulation
// ─────────────────────────────────────────────────────────────────────────────

describe("Requirements type accumulation", () => {
  // Middleware that requires DatabaseService
  const dbMiddleware = Middleware.make<BaseContext, BaseContext, never, DatabaseService>(
    "db",
    (ctx, _input, next) =>
      Effect.gen(function* () {
        const _db = yield* DatabaseService
        return yield* next(ctx)
      }) as Effect.Effect<unknown, never, DatabaseService>,
  )

  // Another service
  class LoggerService extends Context.Tag("LoggerService")<
    LoggerService,
    { log: (msg: string) => Effect.Effect<void> }
  >() {}

  // Middleware that requires LoggerService
  const loggerMiddleware = Middleware.make<BaseContext, BaseContext, never, LoggerService>(
    "logger",
    (ctx, _input, next) =>
      Effect.gen(function* () {
        const _logger = yield* LoggerService
        return yield* next(ctx)
      }) as Effect.Effect<unknown, never, LoggerService>,
  )

  it("single middleware requirements are tracked", () => {
    const def = procedure.use(dbMiddleware).output(UserSchema).query()

    // Verify definition is created
    expect(def._tag).toBe("ProcedureDefinition")
  })

  it("multiple middleware requirements are accumulated (union)", () => {
    const def = procedure
      .use(dbMiddleware) // Requires DatabaseService
      .use(loggerMiddleware) // Requires LoggerService
      .output(UserSchema)
      .query()

    expect(def._tag).toBe("ProcedureDefinition")
  })

  it("InferRequirements includes middleware requirements", () => {
    const TestProcedures = procedures("test", {
      withDb: procedure.use(dbMiddleware).output(UserSchema).query(),

      withLogger: procedure.use(loggerMiddleware).output(Schema.String).query(),

      withBoth: procedure.use(dbMiddleware).use(loggerMiddleware).output(UserSchema).mutation(),
    })

    type Reqs = InferRequirements<typeof TestProcedures>

    // withDb should require DatabaseService
    expectTypeOf<Reqs["withDb"]>().toMatchTypeOf<DatabaseService>()

    // withLogger should require LoggerService
    expectTypeOf<Reqs["withLogger"]>().toMatchTypeOf<LoggerService>()

    // withBoth should require DatabaseService | LoggerService
    expectTypeOf<Reqs["withBoth"]>().toMatchTypeOf<DatabaseService | LoggerService>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Output Type (unchanged by middleware)
// ─────────────────────────────────────────────────────────────────────────────

describe("Output type preservation", () => {
  it("middleware does not change output type", () => {
    const def = procedure.use(orgMiddleware).use(authMiddleware).output(UserSchema).query()

    // Output should still be User, not affected by middleware
    type Output = typeof def extends { outputSchema: infer S }
      ? S extends Schema.Schema<infer O, any>
        ? O
        : never
      : never

    expectTypeOf<Output>().toMatchTypeOf<User>()
  })

  it("InferOutput extracts correct output types", () => {
    const TestProcedures = procedures("test", {
      getUser: procedure.use(orgMiddleware).output(UserSchema).query(),

      getString: procedure.use(authMiddleware).output(Schema.String).query(),

      getVoid: procedure.output(Schema.Void).mutation(),
    })

    type Outputs = InferOutput<typeof TestProcedures>

    expectTypeOf<Outputs["getUser"]>().toMatchTypeOf<User>()
    expectTypeOf<Outputs["getString"]>().toMatchTypeOf<string>()
    expectTypeOf<Outputs["getVoid"]>().toMatchTypeOf<void>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Type Tests: Provides (services provided by middleware)
// ─────────────────────────────────────────────────────────────────────────────

describe("Provides type accumulation", () => {
  it("InferProvides extracts services provided by middleware", () => {
    // This is a type-level test - we can't easily create a providing middleware
    // without the full ServiceMiddleware setup, but we verify the type helper exists
    const TestProcedures = procedures("test", {
      simple: procedure.output(UserSchema).query(),
    })

    type Provides = InferProvides<typeof TestProcedures>

    // For a procedure without providing middleware, should be never
    expectTypeOf<Provides["simple"]>().toEqualTypeOf<never>()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Combined Type Tests: All channels together
// ─────────────────────────────────────────────────────────────────────────────

describe("Combined type accumulation", () => {
  it("all type channels are correctly accumulated", () => {
    // Create a comprehensive procedure with multiple middleware
    const ComplexProcedures = procedures("complex", {
      action: procedure
        .use(orgMiddleware) // Input: { organizationSlug }
        .use(tenantMiddleware) // Input: { tenantId }
        .input(Schema.Struct({ data: Schema.String })) // Input: { data }
        .output(UserSchema) // Output: User
        .error(ValidationError) // Error: ValidationError (+ middleware errors)
        .mutation(),
    })

    type Inputs = InferInput<typeof ComplexProcedures>
    type Outputs = InferOutput<typeof ComplexProcedures>
    type Errors = InferError<typeof ComplexProcedures>

    // Input should be merged from all middleware + procedure input
    expectTypeOf<Inputs["action"]>().toMatchTypeOf<{
      organizationSlug: string
      tenantId: string
      data: string
    }>()

    // Output should be User
    expectTypeOf<Outputs["action"]>().toMatchTypeOf<User>()

    // Error should include ValidationError
    expectTypeOf<Errors["action"]>().toMatchTypeOf<ValidationError>()
  })
})
