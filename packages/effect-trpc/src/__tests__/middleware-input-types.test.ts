/**
 * @module effect-trpc/tests/middleware-input-types
 *
 * Type/runtime tests for v2 middleware input + context propagation.
 */

import { describe, it, expectTypeOf, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Middleware, type BaseContext } from "../core/server/middleware.js"
import {
  Procedure,
  type InferProcedureContext,
  type InferProcedureError,
  type InferProcedureInput,
} from "../core/server/procedure.js"
import { Procedures } from "../core/server/procedures.js"
import { convertHandlers, type RpcHandlerOptions } from "../core/rpc/index.js"

const asRunnable = <A, E>(effect: Effect.Effect<A, E, unknown>): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>

const mockOptions = (): RpcHandlerOptions =>
  ({
    clientId: 1,
    headers: {} as unknown as RpcHandlerOptions["headers"],
  })

const OrganizationSlugSchema = Schema.Struct({
  organizationSlug: Schema.String,
})

const TenantIdSchema = Schema.Struct({
  tenantId: Schema.String,
})

describe("v2 middleware type inference", () => {
  it("middleware input is merged into Procedure input", () => {
    const OrgMiddleware = Middleware("org").input(OrganizationSlugSchema)

    const def = Procedure
      .use(OrgMiddleware)
      .input(Schema.Struct({ id: Schema.String }))
      .output(Schema.String)
      .query()

    type Input = InferProcedureInput<typeof def>
    expectTypeOf<Input>().toMatchTypeOf<{ organizationSlug: string; id: string }>()
  })

  it("multiple middleware inputs are merged", () => {
    const OrgMiddleware = Middleware("org").input(OrganizationSlugSchema)
    const TenantMiddleware = Middleware("tenant").input(TenantIdSchema)

    const def = Procedure
      .use(OrgMiddleware)
      .use(TenantMiddleware)
      .input(Schema.Struct({ id: Schema.String }))
      .output(Schema.String)
      .query()

    type Input = InferProcedureInput<typeof def>
    expectTypeOf<Input>().toMatchTypeOf<{
      organizationSlug: string
      tenantId: string
      id: string
    }>()
  })

  it("middleware provides refines context type", () => {
    type AuthCtx = { user: { id: string } }
    const AuthMiddleware = Middleware("auth").provides<AuthCtx>()

    const def = Procedure.use(AuthMiddleware).output(Schema.String).query()

    type Ctx = InferProcedureContext<typeof def>
    expectTypeOf<Ctx>().toMatchTypeOf<BaseContext & AuthCtx>()
  })

  it("middleware errors are accumulated into Procedure error type", () => {
    class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
      reason: Schema.String,
    }) {}

    const AuthMiddleware = Middleware("auth").error(AuthError)

    const def = Procedure.use(AuthMiddleware).output(Schema.String).query()

    type ErrorType = InferProcedureError<typeof def>
    expectTypeOf<ErrorType>().toMatchTypeOf<AuthError>()
  })
})

describe("v2 middleware runtime behavior", () => {
  it("middleware implementation receives merged input", async () => {
    const OrgMiddleware = Middleware("org").input(OrganizationSlugSchema)
    let seenOrg: string | undefined

    const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
      Effect.sync(() => {
        seenOrg = input.organizationSlug
        return ctx
      }),
    )

    const TestProcedures = Procedures.make({
      getById: Procedure
        .use(OrgMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        getById: (_ctx, input) => Effect.succeed(input.id),
      },
      "test.",
    )

    const value = await Effect.runPromise(
      Effect.provide(
        asRunnable(handlers["test.getById"]!({ organizationSlug: "acme", id: "42" }, mockOptions())),
        OrgMiddlewareLive,
      ),
    )

    expect(value).toBe("42")
    expect(seenOrg).toBe("acme")
  })

  it("multiple middleware layers execute in order", async () => {
    const OrgMiddleware = Middleware("org").input(OrganizationSlugSchema)
    const TenantMiddleware = Middleware("tenant").input(TenantIdSchema)

    const events: Array<string> = []

    const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx) =>
      Effect.sync(() => {
        events.push("org")
        return ctx
      }),
    )
    const TenantMiddlewareLive = TenantMiddleware.toLayer((ctx) =>
      Effect.sync(() => {
        events.push("tenant")
        return ctx
      }),
    )

    const TestProcedures = Procedures.make({
      run: Procedure
        .use(OrgMiddleware)
        .use(TenantMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = convertHandlers(
      TestProcedures,
      {
        run: () =>
          Effect.sync(() => {
            events.push("handler")
            return "ok"
          }),
      },
      "test.",
    )

    await Effect.runPromise(
      Effect.provide(
        asRunnable(
          handlers["test.run"]!(
            { organizationSlug: "acme", tenantId: "t-1", id: "42" },
            mockOptions(),
          ),
        ),
        Layer.mergeAll(OrgMiddlewareLive, TenantMiddlewareLive),
      ),
    )

    expect(events).toEqual(["org", "tenant", "handler"])
  })
})
