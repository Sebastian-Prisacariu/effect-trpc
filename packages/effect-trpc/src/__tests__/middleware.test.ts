/**
 * @module effect-trpc/tests/middleware
 *
 * Coverage for the v2 middleware builder API.
 */

import { describe, it, expect } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  Middleware,
  MiddlewareAuthError,
  MiddlewareTimeoutError,
  authMiddleware,
  rateLimitMiddleware,
  requirePermission,
  timeoutMiddleware,
  type AuthenticatedContext,
  type BaseContext,
} from "../core/server/middleware.js"
import { Procedure } from "../core/server/procedure.js"
import { Procedures } from "../core/server/procedures.js"
import { convertHandlers, type RpcHandlerOptions } from "../core/rpc/index.js"

const mockOptions = (headers: Record<string, string> = {}): RpcHandlerOptions =>
  ({
    clientId: 1,
    headers: headers as unknown as RpcHandlerOptions["headers"],
  })

const asRunnable = <A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>

describe("Middleware builder", () => {
  it("requires middleware implementation layer at runtime", async () => {
    const AuthMiddleware = Middleware<BaseContext>("auth").provides<{ userId: string }>()

    const TestProcedures = Procedures.make({
      me: Procedure.use(AuthMiddleware).output(Schema.String).query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        me: (ctx) => Effect.succeed(ctx.userId),
      },
      "test.",
    )

    const noLayerExit = await Effect.runPromiseExit(
      asRunnable(handlers["test.me"]!(undefined, mockOptions())),
    )
    expect(noLayerExit._tag).toBe("Failure")

    const AuthMiddlewareLive = AuthMiddleware.toLayer((ctx) =>
      Effect.succeed({ ...ctx, userId: "user-1" }),
    )

    const value = await Effect.runPromise(
      Effect.provide(asRunnable(handlers["test.me"]!(undefined, mockOptions())), AuthMiddlewareLive),
    )
    expect(value).toBe("user-1")
  })

  it("passes extended input to middleware implementation", async () => {
    const TrackingSchema = Schema.Struct({ trackingId: Schema.String })
    const TrackingMiddleware = Middleware("tracking").input(TrackingSchema)

    let seenInput: { trackingId: string } | undefined

    const TrackingMiddlewareLive = TrackingMiddleware.toLayer((ctx, input) =>
      Effect.sync(() => {
        seenInput = input
        return ctx
      }),
    )

    const TestProcedures = Procedures.make({
      get: Procedure
        .use(TrackingMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        get: (_ctx, input) => Effect.succeed(input.id),
      },
      "test.",
    )

    const output = await Effect.runPromise(
      Effect.provide(
        asRunnable(handlers["test.get"]!({ trackingId: "trk-1", id: "42" }, mockOptions())),
        TrackingMiddlewareLive,
      ),
    )

    expect(output).toBe("42")
    expect(seenInput).toEqual({ trackingId: "trk-1", id: "42" })
  })

  it("propagates middleware-declared tagged errors", async () => {
    class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
      reason: Schema.String,
    }) {}

    const AuthMiddleware = Middleware("auth").error(AuthError)
    const AuthMiddlewareLive = AuthMiddleware.toLayer((_ctx) =>
      Effect.fail(new AuthError({ reason: "invalid token" })),
    )

    const TestProcedures = Procedures.make({
      secure: Procedure
        .use(AuthMiddleware)
        .output(Schema.String)
        .error(AuthError)
        .query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        secure: () => Effect.succeed("ok"),
      },
      "test.",
    )

    const exit = await Effect.runPromiseExit(
      Effect.provide(asRunnable(handlers["test.secure"]!(undefined, mockOptions())), AuthMiddlewareLive),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const error = Cause.squash(exit.cause)
      expect((error as { _tag?: string })._tag).toBe("AuthError")
    }
  })
})

describe("Built-in middleware", () => {
  it("timeoutMiddleware fails with MiddlewareTimeoutError", async () => {
    const tm = timeoutMiddleware(5)

    const TestProcedures = Procedures.make({
      slow: Procedure.use(tm).output(Schema.String).error(MiddlewareTimeoutError).query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        slow: () => Effect.sleep("20 millis").pipe(Effect.as("ok")),
      },
      "test.",
    )

    const exit = await Effect.runPromiseExit(
      asRunnable(handlers["test.slow"]!(undefined, mockOptions())),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      const error = Cause.squash(exit.cause)
      expect((error as { _tag?: string })._tag).toBe("MiddlewareTimeoutError")
    }
  })

  it("rateLimitMiddleware rejects requests over limit", async () => {
    const limiter = await Effect.runPromise(
      rateLimitMiddleware({
        maxRequests: 1,
        windowMs: 60_000,
      }),
    )

    const TestProcedures = Procedures.make({
      get: Procedure.use(limiter).output(Schema.String).query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        get: () => Effect.succeed("ok"),
      },
      "test.",
    )

    await Effect.runPromise(asRunnable(handlers["test.get"]!(undefined, mockOptions())))
    const secondExit = await Effect.runPromiseExit(
      asRunnable(handlers["test.get"]!(undefined, mockOptions())),
    )

    expect(secondExit._tag).toBe("Failure")
  })

  it("authMiddleware and requirePermission compose through Procedure.use", async () => {
    interface User {
      readonly id: string
      readonly permissions: ReadonlyArray<string>
    }

    const verifyToken = (token: string) =>
      token === "valid-token"
        ? Effect.succeed<User>({ id: "u1", permissions: ["admin"] })
        : Effect.fail(new MiddlewareAuthError({ procedure: "test.me", reason: "invalid token" }))

    const auth = authMiddleware(verifyToken)
    const requireAdmin = requirePermission<User>(
      "admin",
      (user, permission) => user.permissions.includes(permission),
    )

    const TestProcedures = Procedures.make({
      me: Procedure
        .use(auth)
        .use(requireAdmin)
        .output(Schema.Struct({ id: Schema.String }))
        .query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        me: (ctx: AuthenticatedContext<User>) => Effect.succeed({ id: ctx.user.id }),
      },
      "test.",
    )

    const value = await Effect.runPromise(
      asRunnable(
        handlers["test.me"]!(
          undefined,
          mockOptions({
            authorization: "Bearer valid-token",
          }),
        ),
      ),
    )

    expect(value).toEqual({ id: "u1" })
  })

  it("rejects invalid auth token", async () => {
    const auth = authMiddleware((_token) =>
      Effect.fail(new MiddlewareAuthError({ procedure: "test.me", reason: "invalid token" })),
    )

    const TestProcedures = Procedures.make({
      me: Procedure.use(auth).output(Schema.String).query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        me: () => Effect.succeed("ok"),
      },
      "test.",
    )

    const exit = await Effect.runPromiseExit(
      asRunnable(handlers["test.me"]!(undefined, mockOptions({ authorization: "Bearer bad" }))),
    )
    expect(exit._tag).toBe("Failure")
  })
})
