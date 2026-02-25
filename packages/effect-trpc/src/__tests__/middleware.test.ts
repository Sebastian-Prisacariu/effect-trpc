/**
 * @module effect-trpc/tests/middleware
 *
 * Tests for the middleware system.
 */

import { describe, it, expect } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import {
  Middleware,
  composeMiddleware,
  loggingMiddleware,
  timingMiddleware,
  timeoutMiddleware,
  rateLimitMiddleware,
  authMiddleware,
  requirePermission,
  getMiddlewareContext,
  requireMiddlewareContext,
  type BaseContext,
  type AuthenticatedContext,
  MiddlewareAuthError,
  MiddlewareTimeoutError,
} from "../core/middleware.js"
import { procedure } from "../core/procedure.js"
import { procedures } from "../core/procedures.js"
import { convertHandlers } from "../core/rpc-bridge.js"

/**
 * Helper to cast MiddlewareResult (Effect | Stream) to runnable Effect for tests.
 * The convertHandlers returns MiddlewareResult<unknown, unknown, unknown> but
 * runPromise needs Effect<_, _, never>. In tests we know the handlers don't have
 * actual requirements, so this cast is safe.
 *
 * Uses `any` because MiddlewareResult is a union of Effect | Stream and we
 * need to cast it for test purposes.
 */

const asRunnable = <A, E>(effect: any): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createBaseContext = (procedure = "test.procedure"): BaseContext => ({
  procedure,
  headers: new Headers(),
  signal: new AbortController().signal,
  clientId: 1,
})

const _createAuthContext = (user: {
  id: string
  name: string
}): AuthenticatedContext<typeof user> => ({
  ...createBaseContext(),
  user,
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Creation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("middleware", () => {
  it("creates a middleware with name and function", () => {
    const m = Middleware.make("test", (ctx, _input, next) => next(ctx))

    expect(m._tag).toBe("Middleware")
    expect(m.name).toBe("test")
    expect(typeof m.fn).toBe("function")
  })

  it("middleware can transform context", async () => {
    const m = Middleware.make<BaseContext, BaseContext & { extra: string }, never, never>(
      "addExtra",
      (ctx, _input, next) =>
        next({ ...ctx, extra: "added" }) as Effect.Effect<unknown, never, never>,
    )

    let receivedContext: any = null
    const handler = (ctx: any) => {
      receivedContext = ctx
      return Effect.succeed("done")
    }

    await Effect.runPromise(m.fn(createBaseContext(), {}, handler))

    expect(receivedContext).toBeDefined()
    expect(receivedContext.extra).toBe("added")
  })

  it("middleware can short-circuit with error", async () => {
    const m = Middleware.make<BaseContext, BaseContext, Error>("block", (_ctx, _input, _next) =>
      Effect.fail(new Error("blocked")),
    )

    const handler = () => Effect.succeed("should not reach")

    const result = await Effect.runPromiseExit(m.fn(createBaseContext(), {}, handler))

    expect(result._tag).toBe("Failure")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Composition Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("composeMiddleware", () => {
  it("composes two middleware in order", async () => {
    const order: string[] = []

    const m1 = Middleware.make("first", (ctx, _input, next) => {
      order.push("first-before")
      return Effect.map(next(ctx), (result) => {
        order.push("first-after")
        return result
      })
    })

    const m2 = Middleware.make("second", (ctx, _input, next) => {
      order.push("second-before")
      return Effect.map(next(ctx), (result) => {
        order.push("second-after")
        return result
      })
    })

    const composed = composeMiddleware(m1, m2)

    const handler = () => {
      order.push("handler")
      return Effect.succeed("done")
    }

    await Effect.runPromise(
      composed.fn(createBaseContext(), {}, handler) as Effect.Effect<unknown, never, never>,
    )

    expect(order).toEqual([
      "first-before",
      "second-before",
      "handler",
      "second-after",
      "first-after",
    ])
  })

  it("composed middleware has combined name", () => {
    const m1 = Middleware.make("first", (ctx, _input, next) => next(ctx))
    const m2 = Middleware.make("second", (ctx, _input, next) => next(ctx))

    const composed = composeMiddleware(m1, m2)

    expect(composed.name).toBe("first -> second")
  })

  it("composes 4 middleware in order", async () => {
    const order: string[] = []

    const m1 = Middleware.make("m1", (ctx, _input, next) => {
      order.push("m1")
      return next(ctx)
    })
    const m2 = Middleware.make("m2", (ctx, _input, next) => {
      order.push("m2")
      return next(ctx)
    })
    const m3 = Middleware.make("m3", (ctx, _input, next) => {
      order.push("m3")
      return next(ctx)
    })
    const m4 = Middleware.make("m4", (ctx, _input, next) => {
      order.push("m4")
      return next(ctx)
    })

    const composed = composeMiddleware(m1, m2, m3, m4)

    const handler = () => {
      order.push("handler")
      return Effect.succeed("done")
    }

    await Effect.runPromise(
      composed.fn(createBaseContext(), {}, handler) as Effect.Effect<unknown, never, never>,
    )

    expect(order).toEqual(["m1", "m2", "m3", "m4", "handler"])
    expect(composed.name).toBe("m1 -> m2 -> m3 -> m4")
  })

  it("composes 5 middleware in order", async () => {
    const order: string[] = []

    const m1 = Middleware.make("m1", (ctx, _input, next) => {
      order.push("m1")
      return next(ctx)
    })
    const m2 = Middleware.make("m2", (ctx, _input, next) => {
      order.push("m2")
      return next(ctx)
    })
    const m3 = Middleware.make("m3", (ctx, _input, next) => {
      order.push("m3")
      return next(ctx)
    })
    const m4 = Middleware.make("m4", (ctx, _input, next) => {
      order.push("m4")
      return next(ctx)
    })
    const m5 = Middleware.make("m5", (ctx, _input, next) => {
      order.push("m5")
      return next(ctx)
    })

    const composed = composeMiddleware(m1, m2, m3, m4, m5)

    const handler = () => {
      order.push("handler")
      return Effect.succeed("done")
    }

    await Effect.runPromise(
      composed.fn(createBaseContext(), {}, handler) as Effect.Effect<unknown, never, never>,
    )

    expect(order).toEqual(["m1", "m2", "m3", "m4", "m5", "handler"])
    expect(composed.name).toBe("m1 -> m2 -> m3 -> m4 -> m5")
  })

  it("composes 6 middleware in order", async () => {
    const order: string[] = []

    const m1 = Middleware.make("m1", (ctx, _input, next) => {
      order.push("m1")
      return next(ctx)
    })
    const m2 = Middleware.make("m2", (ctx, _input, next) => {
      order.push("m2")
      return next(ctx)
    })
    const m3 = Middleware.make("m3", (ctx, _input, next) => {
      order.push("m3")
      return next(ctx)
    })
    const m4 = Middleware.make("m4", (ctx, _input, next) => {
      order.push("m4")
      return next(ctx)
    })
    const m5 = Middleware.make("m5", (ctx, _input, next) => {
      order.push("m5")
      return next(ctx)
    })
    const m6 = Middleware.make("m6", (ctx, _input, next) => {
      order.push("m6")
      return next(ctx)
    })

    const composed = composeMiddleware(m1, m2, m3, m4, m5, m6)

    const handler = () => {
      order.push("handler")
      return Effect.succeed("done")
    }

    await Effect.runPromise(
      composed.fn(createBaseContext(), {}, handler) as Effect.Effect<unknown, never, never>,
    )

    expect(order).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "handler"])
    expect(composed.name).toBe("m1 -> m2 -> m3 -> m4 -> m5 -> m6")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Middleware Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("loggingMiddleware", () => {
  it("exists and has correct structure", () => {
    expect(loggingMiddleware._tag).toBe("Middleware")
    expect(loggingMiddleware.name).toBe("logging")
  })
})

describe("timingMiddleware", () => {
  it("adds startTime to context", async () => {
    let receivedContext: any = null
    const handler = (ctx: any) => {
      receivedContext = ctx
      return Effect.succeed("done")
    }

    await Effect.runPromise(timingMiddleware.fn(createBaseContext(), {}, handler))

    expect(receivedContext).toBeDefined()
    expect(typeof receivedContext.startTime).toBe("number")
    expect(receivedContext.startTime).toBeLessThanOrEqual(Date.now())
  })
})

describe("timeoutMiddleware", () => {
  it("allows fast requests to succeed", async () => {
    const tm = timeoutMiddleware(100)
    const handler = () => Effect.sleep("10 millis").pipe(Effect.map(() => "ok"))

    const result = await Effect.runPromise(tm.fn(createBaseContext(), {}, handler))
    expect(result).toBe("ok")
  })

  it("fails slow requests with MiddlewareTimeoutError", async () => {
    const tm = timeoutMiddleware(10)
    const handler = () => Effect.sleep("50 millis").pipe(Effect.map(() => "ok"))

    const result = await Effect.runPromiseExit(tm.fn(createBaseContext(), {}, handler))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      // Extract the error from the failure
      const error = result.cause._tag === "Fail" ? result.cause.error : null
      expect(error).toBeInstanceOf(MiddlewareTimeoutError)
      if (error instanceof MiddlewareTimeoutError) {
        expect(error.timeoutMs).toBe(10)
        expect(error.procedure).toBe("test.procedure")
      }
    }
  })
})

describe("rateLimitMiddleware", () => {
  it("allows requests within limit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const rateLimit = yield* rateLimitMiddleware({
          maxRequests: 5,
          windowMs: 60000,
        })

        const handler = () => Effect.succeed("ok")

        // Should allow 5 requests
        for (let i = 0; i < 5; i++) {
          const result = yield* rateLimit.fn(createBaseContext(), {}, handler)
          expect(result).toBe("ok")
        }
      }),
    )
  })

  it("blocks requests over limit", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const rateLimit = yield* rateLimitMiddleware({
          maxRequests: 2,
          windowMs: 60000,
        })

        const handler = () => Effect.succeed("ok")
        const ctx = createBaseContext()

        // First 2 should succeed
        yield* rateLimit.fn(ctx, {}, handler)
        yield* rateLimit.fn(ctx, {}, handler)

        // Third should fail
        const exit = yield* Effect.exit(rateLimit.fn(ctx, {}, handler))
        expect(exit._tag).toBe("Failure")
      }),
    )
  })
})

describe("authMiddleware", () => {
  it("rejects requests without authorization header", async () => {
    const verifyToken = (_token: string) => Effect.succeed({ id: "1", name: "Test" })
    const auth = authMiddleware(verifyToken)

    const ctx = createBaseContext()
    const handler = () => Effect.succeed("ok")

    const result = await Effect.runPromiseExit(auth.fn(ctx, {}, handler))
    expect(result._tag).toBe("Failure")
  })

  it("adds user to context when token is valid", async () => {
    const user = { id: "1", name: "Test User" }
    const verifyToken = (token: string) =>
      token === "valid-token"
        ? Effect.succeed(user)
        : Effect.fail(new MiddlewareAuthError({ procedure: "test", reason: "Invalid" }))

    const auth = authMiddleware(verifyToken)

    const ctx = createBaseContext()
    ctx.headers.set("authorization", "Bearer valid-token")

    let receivedContext: any = null
    const handler = (c: any) => {
      receivedContext = c
      return Effect.succeed("ok")
    }

    await Effect.runPromise(auth.fn(ctx, {}, handler))

    expect(receivedContext).toBeDefined()
    expect(receivedContext.user).toEqual(user)
  })

  it("rejects tokens without Bearer scheme", async () => {
    const verifyToken = (_token: string) => Effect.succeed({ id: "1", name: "Test" })
    const auth = authMiddleware(verifyToken)

    const ctx = createBaseContext()
    ctx.headers.set("authorization", "Basic dXNlcjpwYXNz")

    const handler = () => Effect.succeed("ok")
    const result = await Effect.runPromiseExit(auth.fn(ctx, {}, handler))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const error = Cause.failureOption(result.cause)
      expect(Option.isSome(error)).toBe(true)
      if (Option.isSome(error)) {
        const authError = error.value as MiddlewareAuthError
        expect(authError.reason).toBe("Authorization header must use Bearer scheme")
      }
    }
  })

  it("rejects empty token after Bearer", async () => {
    const verifyToken = (_token: string) => Effect.succeed({ id: "1", name: "Test" })
    const auth = authMiddleware(verifyToken)

    const ctx = createBaseContext()
    ctx.headers.set("authorization", "Bearer ")

    const handler = () => Effect.succeed("ok")
    const result = await Effect.runPromiseExit(auth.fn(ctx, {}, handler))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const error = Cause.failureOption(result.cause)
      expect(Option.isSome(error)).toBe(true)
      if (Option.isSome(error)) {
        const authError = error.value as MiddlewareAuthError
        expect(authError.reason).toBe("No token provided after Bearer scheme")
      }
    }
  })

  it("rejects tokens containing spaces", async () => {
    const verifyToken = (_token: string) => Effect.succeed({ id: "1", name: "Test" })
    const auth = authMiddleware(verifyToken)

    const ctx = createBaseContext()
    ctx.headers.set("authorization", "Bearer invalid token with spaces")

    const handler = () => Effect.succeed("ok")
    const result = await Effect.runPromiseExit(auth.fn(ctx, {}, handler))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      const error = Cause.failureOption(result.cause)
      expect(Option.isSome(error)).toBe(true)
      if (Option.isSome(error)) {
        const authError = error.value as MiddlewareAuthError
        expect(authError.reason).toBe("Token contains invalid characters")
      }
    }
  })

  it("accepts Bearer scheme case-insensitively", async () => {
    const user = { id: "1", name: "Test User" }
    const verifyToken = () => Effect.succeed(user)
    const auth = authMiddleware(verifyToken)

    // Test various case combinations
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      const ctx = createBaseContext()
      ctx.headers.set("authorization", `${scheme} valid-token`)

      let receivedContext: any = null
      const handler = (c: any) => {
        receivedContext = c
        return Effect.succeed("ok")
      }

      await Effect.runPromise(auth.fn(ctx, {}, handler))
      expect(receivedContext?.user).toEqual(user)
    }
  })

  it("handles whitespace around header value", async () => {
    const user = { id: "1", name: "Test User" }
    const verifyToken = () => Effect.succeed(user)
    const auth = authMiddleware(verifyToken)

    const ctx = createBaseContext()
    ctx.headers.set("authorization", "  Bearer valid-token  ")

    let receivedContext: any = null
    const handler = (c: any) => {
      receivedContext = c
      return Effect.succeed("ok")
    }

    await Effect.runPromise(auth.fn(ctx, {}, handler))
    expect(receivedContext?.user).toEqual(user)
  })
})

describe("requirePermission", () => {
  it("allows when user has permission", async () => {
    type User = { id: string; permissions: string[] }
    const hasPermission = (user: User, perm: string) => user.permissions.includes(perm)
    const requireAdmin = requirePermission<User>("admin", hasPermission)

    const ctx: AuthenticatedContext<User> = {
      ...createBaseContext(),
      user: { id: "1", permissions: ["admin", "read"] },
    }

    const handler = () => Effect.succeed("ok")
    const result = await Effect.runPromise(requireAdmin.fn(ctx, {}, handler))

    expect(result).toBe("ok")
  })

  it("rejects when user lacks permission", async () => {
    type User = { id: string; permissions: string[] }
    const hasPermission = (user: User, perm: string) => user.permissions.includes(perm)
    const requireAdmin = requirePermission<User>("admin", hasPermission)

    const ctx: AuthenticatedContext<User> = {
      ...createBaseContext(),
      user: { id: "1", permissions: ["read"] },
    }

    const handler = () => Effect.succeed("ok")
    const result = await Effect.runPromiseExit(requireAdmin.fn(ctx, {}, handler))

    expect(result._tag).toBe("Failure")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RPC Bridge Middleware Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("middleware in RPC bridge", () => {
  it("applies procedure middleware through convertHandlers", async () => {
    const middlewareExecuted: string[] = []

    // Create a middleware that tracks execution
    const trackingMiddleware = Middleware.make("tracking", (ctx, _input, next) => {
      middlewareExecuted.push("before")
      return Effect.map(next(ctx), (result) => {
        middlewareExecuted.push("after")
        return result
      })
    })

    // Create a procedure with middleware
    const TestProcedures = procedures("test", {
      greet: procedure
        .use(trackingMiddleware)
        .input(Schema.Struct({ name: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    // Convert handlers through the RPC bridge (v2 signature: ctx, input)
    const rpcHandlers = convertHandlers(TestProcedures, {
      greet: (_ctx, input) => {
        middlewareExecuted.push("handler")
        return Effect.succeed(`Hello, ${input.name}!`)
      },
    })

    // Call the handler
    const handler = rpcHandlers["test.greet"]!
    const result = await Effect.runPromise(
      asRunnable(handler({ name: "World" }, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result).toBe("Hello, World!")
    expect(middlewareExecuted).toEqual(["before", "handler", "after"])
  })

  it("applies multiple middleware in correct order", async () => {
    const order: string[] = []

    const first = Middleware.make("first", (ctx, _input, next) => {
      order.push("first-before")
      return Effect.map(next(ctx), (result) => {
        order.push("first-after")
        return result
      })
    })

    const second = Middleware.make("second", (ctx, _input, next) => {
      order.push("second-before")
      return Effect.map(next(ctx), (result) => {
        order.push("second-after")
        return result
      })
    })

    const TestProcedures = procedures("test", {
      action: procedure.use(first).use(second).output(Schema.String).mutation(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      action: () => {
        order.push("handler")
        return Effect.succeed("done")
      },
    })

    const handler = rpcHandlers["test.action"]!
    await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(order).toEqual([
      "first-before",
      "second-before",
      "handler",
      "second-after",
      "first-after",
    ])
  })

  it("middleware can short-circuit and prevent handler execution", async () => {
    let handlerCalled = false

    class BlockError extends Error {
      readonly _tag = "BlockError"
    }

    const blockingMiddleware = Middleware.make("block", () =>
      Effect.fail(new BlockError("Blocked!")),
    )

    const TestProcedures = procedures("test", {
      blocked: procedure.use(blockingMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      blocked: () => {
        handlerCalled = true
        return Effect.succeed("should not reach")
      },
    })

    const handler = rpcHandlers["test.blocked"]!
    const result = await Effect.runPromiseExit(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result._tag).toBe("Failure")
    expect(handlerCalled).toBe(false)
  })

  it("procedures without middleware work normally", async () => {
    const TestProcedures = procedures("test", {
      simple: procedure.input(Schema.Number).output(Schema.Number).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      simple: (_ctx, n) => Effect.succeed(n * 2),
    })

    const handler = rpcHandlers["test.simple"]!
    const result = await Effect.runPromise(
      asRunnable(handler(5, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result).toBe(10)
  })

  it("passes clientId through to middleware context", async () => {
    let receivedClientId: number | undefined

    const clientIdMiddleware = Middleware.make("clientId", (ctx: any, _input, next) => {
      receivedClientId = ctx.clientId
      return next(ctx)
    })

    const TestProcedures = procedures("test", {
      action: procedure.use(clientIdMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      action: () => Effect.succeed("ok"),
    })

    const handler = rpcHandlers["test.action"]!
    await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 42, headers: new Headers() as any })),
    )

    expect(receivedClientId).toBe(42)
  })

  it("converts headers to standard web Headers", async () => {
    let receivedHeaders: Headers | undefined

    const headersMiddleware = Middleware.make("headers", (ctx: any, _input, next) => {
      receivedHeaders = ctx.headers
      return next(ctx)
    })

    const TestProcedures = procedures("test", {
      action: procedure.use(headersMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      action: () => Effect.succeed("ok"),
    })

    // Simulate @effect/platform Headers (plain object with string values)
    const platformHeaders = {
      "content-type": "application/json",
      "x-custom": "value",
    }

    const handler = rpcHandlers["test.action"]!
    await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: platformHeaders as any })),
    )

    expect(receivedHeaders).toBeInstanceOf(Headers)
    expect(receivedHeaders?.get("content-type")).toBe("application/json")
    expect(receivedHeaders?.get("x-custom")).toBe("value")
  })

  it("aborts signal when Effect fiber is interrupted", async () => {
    let signalAborted = false

    const signalMiddleware = Middleware.make("signal", (ctx: any, _input, next) => {
      ctx.signal.addEventListener("abort", () => {
        signalAborted = true
      })
      return next(ctx)
    })

    const TestProcedures = procedures("test", {
      slow: procedure.use(signalMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      slow: () => Effect.sleep("1 second").pipe(Effect.map(() => "done")),
    })

    const handler = rpcHandlers["test.slow"]!

    // Run with immediate interruption
    const fiber = Effect.runFork(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    // Interrupt after a small delay
    await Effect.runPromise(Effect.sleep("10 millis"))
    await Effect.runPromise(fiber.interruptAsFork(fiber.id()))

    // Give the interrupt handler time to run
    await Effect.runPromise(Effect.sleep("10 millis"))

    expect(signalAborted).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Handler Context Access Tests (FLC-99 fix verification)
// ─────────────────────────────────────────────────────────────────────────────

describe("handler context access via FiberRef", () => {
  it("handlers can access middleware context via getMiddlewareContext", async () => {
    // Create middleware that adds a user to context
    const addUserMiddleware = Middleware.make<
      BaseContext,
      AuthenticatedContext<{ id: string; name: string }>,
      never,
      never
    >(
      "addUser",
      (ctx, _input, next) =>
        next({ ...ctx, user: { id: "123", name: "Test User" } }) as Effect.Effect<
          unknown,
          never,
          never
        >,
    )

    let receivedUser: { id: string; name: string } | undefined

    const TestProcedures = procedures("test", {
      getUser: procedure.use(addUserMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      getUser: () =>
        Effect.gen(function* () {
          // Handler accesses context via getMiddlewareContext
          const ctxOpt =
            yield* getMiddlewareContext<AuthenticatedContext<{ id: string; name: string }>>()
          const ctx = Option.getOrUndefined(ctxOpt)
          receivedUser = ctx?.user
          return `Hello, ${ctx?.user?.name ?? "Unknown"}!`
        }),
    })

    const handler = rpcHandlers["test.getUser"]!
    const result = await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result).toBe("Hello, Test User!")
    expect(receivedUser).toEqual({ id: "123", name: "Test User" })
  })

  it("handlers can access base context without middleware via getMiddlewareContext", async () => {
    let receivedProcedure: string | undefined
    let receivedClientId: number | undefined

    const TestProcedures = procedures("test", {
      noMiddleware: procedure.output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      noMiddleware: () =>
        Effect.gen(function* () {
          const ctxOpt = yield* getMiddlewareContext<BaseContext>()
          const ctx = Option.getOrUndefined(ctxOpt)
          receivedProcedure = ctx?.procedure
          receivedClientId = ctx?.clientId
          return "ok"
        }),
    })

    const handler = rpcHandlers["test.noMiddleware"]!
    const result = await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 42, headers: new Headers() as any })),
    )

    expect(result).toBe("ok")
    expect(receivedProcedure).toBe("test.noMiddleware")
    expect(receivedClientId).toBe(42)
  })

  it("requireMiddlewareContext fails when context is missing (edge case)", async () => {
    class ContextMissingError extends Error {
      readonly _tag = "ContextMissingError"
    }

    // Test requireMiddlewareContext outside of middleware chain
    const result = await Effect.runPromiseExit(
      requireMiddlewareContext<BaseContext, ContextMissingError>(
        new ContextMissingError("No context"),
      ),
    )

    expect(result._tag).toBe("Failure")
  })

  it("requireMiddlewareContext succeeds when context is set", async () => {
    class ContextMissingError extends Error {
      readonly _tag = "ContextMissingError"
    }

    const TestProcedures = procedures("test", {
      withContext: procedure
        .output(Schema.String)
        .error(Schema.instanceOf(ContextMissingError))
        .query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      withContext: () =>
        Effect.gen(function* () {
          const ctx = yield* requireMiddlewareContext<BaseContext, ContextMissingError>(
            new ContextMissingError("No context"),
          )
          return `Procedure: ${ctx.procedure}`
        }),
    })

    const handler = rpcHandlers["test.withContext"]!
    const result = await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result).toBe("Procedure: test.withContext")
  })

  it("auth middleware context is accessible in handler via getMiddlewareContext", async () => {
    const user = { id: "user-1", email: "test@example.com" }
    const verifyToken = (token: string) =>
      token === "valid-token"
        ? Effect.succeed(user)
        : Effect.fail(new MiddlewareAuthError({ procedure: "test", reason: "Invalid" }))

    const auth = authMiddleware(verifyToken)

    const TestProcedures = procedures("test", {
      protectedAction: procedure
        .use(auth)
        .output(Schema.Struct({ userId: Schema.String, email: Schema.String }))
        .query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      protectedAction: () =>
        Effect.gen(function* () {
          const ctxOpt = yield* getMiddlewareContext<AuthenticatedContext<typeof user>>()
          const ctx = Option.getOrUndefined(ctxOpt)
          if (!ctx?.user) {
            // This is a test invariant: if auth middleware ran, user must exist.
            // Effect.die is correct here - this indicates a bug in the middleware.
            return yield* Effect.die(new Error("No user in context - middleware bug"))
          }
          return { userId: ctx.user.id, email: ctx.user.email }
        }),
    })

    // Create headers with auth token
    const headers = new Headers()
    headers.set("authorization", "Bearer valid-token")

    const handler = rpcHandlers["test.protectedAction"]!
    const result = await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: headers as any })),
    )

    expect(result).toEqual({ userId: "user-1", email: "test@example.com" })
  })

  it("composed middleware builds up context accessible in handler", async () => {
    // Middleware that adds timing info
    const timingMw = Middleware.make<
      BaseContext,
      BaseContext & { startTime: number },
      never,
      never
    >(
      "timing",
      (ctx, _input, next) =>
        next({ ...ctx, startTime: Date.now() }) as Effect.Effect<unknown, never, never>,
    )

    // Middleware that adds request ID
    const requestIdMw = Middleware.make<
      BaseContext & { startTime: number },
      BaseContext & { startTime: number; requestId: string },
      never,
      never
    >(
      "requestId",
      (ctx, _input, next) =>
        next({ ...ctx, requestId: "req-12345" }) as Effect.Effect<unknown, never, never>,
    )

    const composed = composeMiddleware(timingMw, requestIdMw)

    let receivedStartTime: number | undefined
    let receivedRequestId: string | undefined

    const TestProcedures = procedures("test", {
      composedContext: procedure.use(composed).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      composedContext: () =>
        Effect.gen(function* () {
          const ctxOpt = yield* getMiddlewareContext<
            BaseContext & { startTime: number; requestId: string }
          >()
          const ctx = Option.getOrUndefined(ctxOpt)
          receivedStartTime = ctx?.startTime
          receivedRequestId = ctx?.requestId
          return "ok"
        }),
    })

    const handler = rpcHandlers["test.composedContext"]!
    await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(receivedStartTime).toBeDefined()
    expect(receivedStartTime).toBeLessThanOrEqual(Date.now())
    expect(receivedRequestId).toBe("req-12345")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// v2 Typed Context Handler Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("v2 typed context handlers", () => {
  it("handlers receive context as first parameter", async () => {
    let receivedContext: BaseContext | undefined
    let receivedInput: { name: string } | undefined

    const TestProcedures = procedures("test", {
      greet: procedure
        .input(Schema.Struct({ name: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      // v2 handler signature: (ctx, input) => Effect
      greet: (ctx, input) => {
        receivedContext = ctx
        receivedInput = input
        return Effect.succeed(`Hello, ${input.name}!`)
      },
    })

    const handler = rpcHandlers["test.greet"]!
    const result = await Effect.runPromise(
      asRunnable(handler({ name: "World" }, { clientId: 42, headers: new Headers() as any })),
    )

    expect(result).toBe("Hello, World!")
    expect(receivedContext).toBeDefined()
    expect(receivedContext?.clientId).toBe(42)
    expect(receivedContext?.procedure).toBe("test.greet")
    expect(receivedInput).toEqual({ name: "World" })
  })

  it("handlers receive enriched context from middleware", async () => {
    interface User {
      id: string
      name: string
    }

    let receivedUser: User | undefined

    // Create a simple auth middleware that adds user to context
    const testAuthMiddleware = Middleware.make<
      BaseContext,
      AuthenticatedContext<User>,
      never,
      never
    >(
      "testAuth",

      (ctx, _input, next) => next({ ...ctx, user: { id: "user-1", name: "Alice" } }) as any,
    )

    const TestProcedures = procedures("test", {
      getProfile: procedure.use(testAuthMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      // v2 handler receives AuthenticatedContext<User>
      getProfile: (ctx, _input) => {
        // ctx is typed as AuthenticatedContext<User> at compile time
        receivedUser = ctx.user
        return Effect.succeed(`Profile: ${ctx.user.name}`)
      },
    })

    const handler = rpcHandlers["test.getProfile"]!
    const result = await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result).toBe("Profile: Alice")
    expect(receivedUser).toEqual({ id: "user-1", name: "Alice" })
  })

  it("handlers receive accumulated context from multiple middleware", async () => {
    interface User {
      id: string
    }
    interface Org {
      id: string
      name: string
    }

    let receivedUser: User | undefined
    let receivedOrg: Org | undefined

    // First middleware adds user
    const userMiddleware = Middleware.make<BaseContext, BaseContext & { user: User }, never, never>(
      "user",

      (ctx, _input, next) => next({ ...ctx, user: { id: "user-1" } }) as any,
    )

    // Second middleware adds org (requires user context)
    const orgMiddleware = Middleware.make<
      BaseContext & { user: User },
      BaseContext & { user: User; org: Org },
      never,
      never
    >(
      "org",

      (ctx, _input, next) => next({ ...ctx, org: { id: "org-1", name: "Acme Corp" } }) as any,
    )

    const TestProcedures = procedures("test", {
      getData: procedure.use(userMiddleware).use(orgMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      // v2 handler receives BaseContext & { user: User; org: Org }
      getData: (ctx, _input) => {
        receivedUser = ctx.user
        receivedOrg = ctx.org
        return Effect.succeed(`${ctx.user.id} @ ${ctx.org.name}`)
      },
    })

    const handler = rpcHandlers["test.getData"]!
    const result = await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    expect(result).toBe("user-1 @ Acme Corp")
    expect(receivedUser).toEqual({ id: "user-1" })
    expect(receivedOrg).toEqual({ id: "org-1", name: "Acme Corp" })
  })

  it("context is also available via FiberRef for compatibility", async () => {
    interface User {
      id: string
    }

    let contextFromParam: (BaseContext & { user: User }) | undefined
    let contextFromFiberRef: (BaseContext & { user: User }) | undefined

    const userMiddleware = Middleware.make<BaseContext, BaseContext & { user: User }, never, never>(
      "user",

      (ctx, _input, next) => next({ ...ctx, user: { id: "user-1" } }) as any,
    )

    const TestProcedures = procedures("test", {
      checkContext: procedure.use(userMiddleware).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      checkContext: (ctx, _input) =>
        Effect.gen(function* () {
          contextFromParam = ctx
          contextFromFiberRef = Option.getOrUndefined(
            yield* getMiddlewareContext<BaseContext & { user: User }>(),
          )
          return "ok"
        }),
    })

    const handler = rpcHandlers["test.checkContext"]!
    await Effect.runPromise(
      asRunnable(handler(undefined, { clientId: 1, headers: new Headers() as any })),
    )

    // Both should have the same context
    expect(contextFromParam?.user.id).toBe("user-1")
    expect(contextFromFiberRef?.user.id).toBe("user-1")
    expect(contextFromParam).toEqual(contextFromFiberRef)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware.withInput Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Middleware.withInput", () => {
  it("middleware is pipeable", () => {
    const m = Middleware.make("test", (ctx, _input, next) => next(ctx))

    // Middleware should have a pipe method
    expect(typeof m.pipe).toBe("function")
  })

  it("withInput adds inputSchema to middleware (data-last / pipeable)", () => {
    const baseMiddleware = Middleware.make("org", (ctx, input, next) =>
      Effect.gen(function* () {
        // input is typed via withInput
        const _slug = (input as { organizationSlug: string }).organizationSlug
        return yield* next(ctx)
      }),
    )

    const middlewareWithInput = baseMiddleware.pipe(
      Middleware.withInput(Schema.Struct({ organizationSlug: Schema.String })),
    )

    expect(middlewareWithInput.name).toBe("org")
    expect(middlewareWithInput.inputSchema).toBeDefined()
  })

  it("withInput adds inputSchema to middleware (data-first)", () => {
    const baseMiddleware = Middleware.make("org", (ctx, _input, next) => next(ctx))

    const middlewareWithInput = Middleware.withInput(
      baseMiddleware,
      Schema.Struct({ tenantId: Schema.String }),
    )

    expect(middlewareWithInput.name).toBe("org")
    expect(middlewareWithInput.inputSchema).toBeDefined()
  })

  it("middleware receives typed input when used with procedure", async () => {
    let receivedOrgSlug: string | undefined

    // Create middleware that requires organizationSlug in input
    const orgMiddleware = Middleware.make("org", (ctx, input, next) => {
      receivedOrgSlug = (input as { organizationSlug: string }).organizationSlug
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ organizationSlug: Schema.String })))

    const TestProcedures = procedures("test", {
      getData: procedure
        .use(orgMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      getData: (_ctx, input) => Effect.succeed(`id: ${input.id}`),
    })

    const handler = rpcHandlers["test.getData"]!
    const result = await Effect.runPromise(
      asRunnable(
        handler(
          { organizationSlug: "acme", id: "123" },
          { clientId: 1, headers: new Headers() as any },
        ),
      ),
    )

    expect(receivedOrgSlug).toBe("acme")
    expect(result).toBe("id: 123")
  })

  it("Middleware.withName renames middleware", () => {
    const m = Middleware.make("original", (ctx, _input, next) => next(ctx))
    const renamed = m.pipe(Middleware.withName("renamed"))

    expect(renamed.name).toBe("renamed")
  })

  it("composed middleware merges inputSchemas", () => {
    const m1 = Middleware.make("m1", (ctx, _input, next) => next(ctx)).pipe(
      Middleware.withInput(Schema.Struct({ field1: Schema.String })),
    )

    const m2 = Middleware.make("m2", (ctx, _input, next) => next(ctx)).pipe(
      Middleware.withInput(Schema.Struct({ field2: Schema.Number })),
    )

    const composed = composeMiddleware(m1, m2)

    // Both input schemas should be merged
    expect(composed.inputSchema).toBeDefined()
    expect(composed.name).toBe("m1 -> m2")
  })

  it("input is passed through middleware chain", async () => {
    const receivedInputs: unknown[] = []

    const m1 = Middleware.make("m1", (ctx, input, next) => {
      receivedInputs.push({ m1: input })
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ field1: Schema.String })))

    const m2 = Middleware.make("m2", (ctx, input, next) => {
      receivedInputs.push({ m2: input })
      return next(ctx)
    }).pipe(Middleware.withInput(Schema.Struct({ field2: Schema.String })))

    const TestProcedures = procedures("test", {
      action: procedure.use(m1).use(m2).output(Schema.String).query(),
    })

    const rpcHandlers = convertHandlers(TestProcedures, {
      action: () => Effect.succeed("done"),
    })

    const handler = rpcHandlers["test.action"]!
    await Effect.runPromise(
      asRunnable(
        handler(
          { field1: "value1", field2: "value2" },
          { clientId: 1, headers: new Headers() as any },
        ),
      ),
    )

    // Both middleware should receive the full input
    expect(receivedInputs).toHaveLength(2)
    expect(receivedInputs[0]).toEqual({ m1: { field1: "value1", field2: "value2" } })
    expect(receivedInputs[1]).toEqual({ m2: { field1: "value1", field2: "value2" } })
  })
})
