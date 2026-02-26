/**
 * @module effect-trpc/tests/middleware
 *
 * Tests for the new middleware builder pattern system.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import {
  Middleware,
  getMiddlewareContext,
  requireMiddlewareContext,
  type BaseContext,
  type AuthenticatedContext,
  type MiddlewareDefinition,
  type MiddlewareService,
  MiddlewareAuthError,
  LoggingMiddleware,
  LoggingMiddlewareLive,
  TimingMiddleware,
  TimingMiddlewareLive,
  AuthMiddleware,
  createAuthMiddlewareLive,
} from "../core/middleware.js"
import { procedure } from "../core/procedure.js"
import { procedures } from "../core/procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createBaseContext = (procedureName = "test.procedure"): BaseContext => ({
  procedure: procedureName,
  headers: new Headers(),
  signal: new AbortController().signal,
  clientId: 1,
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Schemas
// ─────────────────────────────────────────────────────────────────────────────

const OrgSlugSchema = Schema.Struct({
  organizationSlug: Schema.String,
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Errors
// ─────────────────────────────────────────────────────────────────────────────

class NotOrgMember extends Schema.TaggedError<NotOrgMember>()("NotOrgMember", {
  organizationSlug: Schema.String,
}) {}

class TestError extends Schema.TaggedError<TestError>()("TestError", {
  message: Schema.String,
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Builder Pattern Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Middleware builder pattern", () => {
  it("creates a middleware definition with name", () => {
    const mw = Middleware("test").provides<{}>()

    expect(mw._tag).toBe("MiddlewareDefinition")
    expect(mw.name).toBe("test")
  })

  it("middleware definition has serviceTag for runtime retrieval", () => {
    const mw = Middleware("test").provides<{}>()

    expect(mw.serviceTag).toBeDefined()
    expect(typeof mw.serviceTag).toBe("object")
  })

  it("creates middleware with input schema", () => {
    const mw = Middleware("org")
      .input(OrgSlugSchema)
      .provides<{ orgId: string }>()

    expect(mw.inputSchema).toBeDefined()
  })

  it("creates middleware with error types", () => {
    const mw = Middleware("org")
      .error(Schema.instanceOf(NotOrgMember), Schema.instanceOf(TestError))
      .provides<{}>()

    expect(mw.errorSchemas).toBeDefined()
    expect(mw.errorSchemas).toHaveLength(2)
  })

  it("creates Layer from toLayer()", () => {
    const mwDef = Middleware("test").provides<{ added: boolean }>()

    const layer = mwDef.toLayer((ctx, _input) =>
      Effect.succeed({ ...ctx, added: true }),
    )

    // Layer should be properly typed
    expect(Layer.isLayer(layer)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Execution Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Middleware execution via Layer", () => {
  it("executes middleware handler when provided via Layer", async () => {
    // Define middleware
    const TestMiddleware = Middleware("test").provides<{ wasExecuted: boolean }>()

    // Create Layer
    const TestMiddlewareLive = TestMiddleware.toLayer((ctx, _input) =>
      Effect.succeed({ ...ctx, wasExecuted: true }),
    )

    // Create an Effect that uses the middleware service
    const program = Effect.gen(function* () {
      const service = yield* TestMiddleware.serviceTag
      const baseCtx = createBaseContext()
      const result = yield* service.handler(baseCtx, {}) as Effect.Effect<
        BaseContext & { wasExecuted: boolean },
        never,
        never
      >
      return result
    })

    // Run with the Layer provided
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TestMiddlewareLive)),
    )

    expect(result.wasExecuted).toBe(true)
    expect(result.procedure).toBe("test.procedure")
  })

  it("middleware receives input from the request", async () => {
    const OrgMiddleware = Middleware("org")
      .input(OrgSlugSchema)
      .provides<{ orgSlug: string }>()

    const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
      Effect.succeed({ ...ctx, orgSlug: input.organizationSlug }),
    )

    const program = Effect.gen(function* () {
      const service = yield* OrgMiddleware.serviceTag
      const baseCtx = createBaseContext()
      return yield* service.handler(baseCtx, { organizationSlug: "acme" }) as Effect.Effect<
        BaseContext & { orgSlug: string },
        never,
        never
      >
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(OrgMiddlewareLive)),
    )

    expect(result.orgSlug).toBe("acme")
  })

  it("middleware can fail with typed errors", async () => {
    const FailingMiddleware = Middleware("failing")
      .error(Schema.instanceOf(TestError))
      .provides<{}>()

    const FailingMiddlewareLive = FailingMiddleware.toLayer((_ctx, _input) =>
      Effect.fail(new TestError({ message: "intentional failure" })),
    )

    const program = Effect.gen(function* () {
      const service = yield* FailingMiddleware.serviceTag
      const baseCtx = createBaseContext()
      return yield* service.handler(baseCtx, {}) as Effect.Effect<
        BaseContext,
        TestError,
        never
      >
    })

    const result = await Effect.runPromiseExit(
      program.pipe(Effect.provide(FailingMiddlewareLive)),
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const error = result.cause
      expect(error._tag).toBe("Fail")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Middleware Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Built-in middleware", () => {
  it("LoggingMiddleware is defined", () => {
    expect(LoggingMiddleware._tag).toBe("MiddlewareDefinition")
    expect(LoggingMiddleware.name).toBe("logging")
  })

  it("TimingMiddleware provides startTime", async () => {
    const program = Effect.gen(function* () {
      const service = yield* TimingMiddleware.serviceTag
      const baseCtx = createBaseContext()
      const result = yield* service.handler(baseCtx, {}) as Effect.Effect<
        BaseContext & { startTime: number },
        never,
        never
      >
      return result
    })

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TimingMiddlewareLive)),
    )

    expect(result.startTime).toBeDefined()
    expect(typeof result.startTime).toBe("number")
  })

  it("AuthMiddleware factory creates middleware", () => {
    const mw = AuthMiddleware<{ id: string; name: string }>()

    expect(mw._tag).toBe("MiddlewareDefinition")
    expect(mw.name).toBe("auth")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Procedure middleware integration", () => {
  const OrgMiddleware = Middleware("org")
    .input(OrgSlugSchema)
    .error(Schema.instanceOf(NotOrgMember))
    .provides<{ orgId: string }>()

  it("procedure tracks middleware in middlewares array", () => {
    const def = procedure
      .use(OrgMiddleware)
      .input(Schema.Struct({ data: Schema.String }))
      .output(Schema.Void)
      .mutation()

    expect(def.middlewares).toHaveLength(1)
    expect(def.middlewares[0]!.name).toBe("org")
  })

  it("procedure input schema merges middleware input", () => {
    const def = procedure
      .use(OrgMiddleware)
      .input(Schema.Struct({ data: Schema.String }))
      .output(Schema.Void)
      .mutation()

    // The merged input schema should include both organizationSlug and data
    expect(def.inputSchema).toBeDefined()
  })

  it("multiple middleware are tracked in order", () => {
    const SecondMiddleware = Middleware("second").provides<{ second: true }>()

    const def = procedure
      .use(OrgMiddleware)
      .use(SecondMiddleware)
      .input(Schema.Struct({ data: Schema.String }))
      .mutation()

    expect(def.middlewares).toHaveLength(2)
    expect(def.middlewares[0]!.name).toBe("org")
    expect(def.middlewares[1]!.name).toBe("second")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Context FiberRef Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Middleware context FiberRef", () => {
  it("getMiddlewareContext returns None when not set", async () => {
    const result = await Effect.runPromise(getMiddlewareContext())
    expect(Option.isNone(result)).toBe(true)
  })
})
