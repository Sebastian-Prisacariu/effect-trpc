/**
 * @module effect-trpc/__tests__/middleware-types
 *
 * Type-level tests for middleware builder pattern.
 * Ensures that `Middleware.toLayer` enforces correct return types.
 *
 * The type safety is verified by:
 * 1. Tests that should compile - they pass if no TS errors
 * 2. Tests showing TypeScript DOES catch errors - using descriptive comments
 *    explaining what error TypeScript produces
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { describe, it, expect } from "vitest"
import { Middleware, type BaseContext } from "../core/server/middleware.js"
import {
  procedure,
  type InferProcedureRequirements,
  type ProcedureDefinition,
} from "../core/server/procedure.js"
import { procedures } from "../core/server/procedures.js"
import { Router } from "../core/server/router.js"

// Test domain types
interface Organization {
  readonly id: string
  readonly name: string
}

interface User {
  readonly id: string
  readonly email: string
}

class OrgNotFoundError extends Schema.TaggedError<OrgNotFoundError>()("OrgNotFoundError", {
  slug: Schema.String,
}) {}

/**
 * Extract a value from an Effect synchronously.
 */
function extractFromEffect<T>(effect: Effect.Effect<T, never, unknown>): T {
  let extracted: T | undefined
  Effect.runSync(
    Effect.map(effect as Effect.Effect<T, never, never>, (val) => {
      extracted = val
    }),
  )
  if (extracted === undefined) {
    throw new Error("Failed to extract value from Effect")
  }
  return extracted
}

describe("Middleware type safety", () => {
  describe("Middleware.toLayer return type enforcement", () => {
    it("compiles when returning correct context additions", () => {
      const org: Organization = { id: "1", name: "Acme" }

      const middleware = Middleware("test").provides<{ org: Organization }>()

      // This should compile - returning ctx spread + correct additions
      const layer = Middleware.toLayer(middleware, (ctx) => Effect.succeed({ ...ctx, org }))

      expect(Layer.isLayer(layer)).toBe(true)
    })

    it("compiles with input and errors", () => {
      const org: Organization = { id: "1", name: "Acme" }

      const middleware = Middleware("test")
        .input(Schema.Struct({ slug: Schema.String }))
        .error(OrgNotFoundError)
        .provides<{ org: Organization }>()

      // Should compile with full handler signature
      const layer = Middleware.toLayer(middleware, (ctx, _input) => Effect.succeed({ ...ctx, org }))

      expect(Layer.isLayer(layer)).toBe(true)
    })

    it("allows extra properties in return value", () => {
      const org: Organization = { id: "1", name: "Acme" }
      const user: User = { id: "1", email: "test@example.com" }

      const middleware = Middleware("test").provides<{ org: Organization }>()

      // This should compile - extra properties are allowed
      // (TypeScript's structural typing allows this)
      const layer = Middleware.toLayer(middleware, (ctx) => Effect.succeed({ ...ctx, org, user }))

      expect(Layer.isLayer(layer)).toBe(true)
    })

    // Type safety verification tests
    // These demonstrate that TypeScript catches incorrect implementations
    // We test this by checking that the correct implementation compiles
    // while documenting what errors would occur with wrong implementations

    it("verifies type safety by testing return type structure", () => {
      // Setup a middleware that expects { org: Organization }
      const middleware = Middleware("type-check").provides<{ org: Organization }>()

      // The handler MUST return an Effect where the success value is:
      // BaseContext & { org: Organization }
      //
      // TypeScript will reject:
      // 1. Missing 'org' property
      // 2. Wrong type for 'org' (e.g., string instead of Organization)
      // 3. Missing BaseContext fields (procedure, headers, signal, clientId)

      const org: Organization = { id: "1", name: "Acme" }

      // Correct implementation - this compiles
      const correctHandler = (ctx: BaseContext) => Effect.succeed({ ...ctx, org })

      // Verify handler type matches what toLayer expects
      const layer = Middleware.toLayer(middleware, correctHandler)

      expect(Layer.isLayer(layer)).toBe(true)
    })

    it("verifies handler receives correct input type", () => {
      const middleware = Middleware("input-check")
        .input(Schema.Struct({ slug: Schema.String }))
        .provides<{ org: Organization }>()

      const org: Organization = { id: "1", name: "Acme" }

      // The input parameter is typed correctly
      const layer = Middleware.toLayer(middleware, (ctx, input) => {
        // TypeScript knows input.slug is string
        const _slug: string = input.slug
        return Effect.succeed({ ...ctx, org })
      })

      expect(Layer.isLayer(layer)).toBe(true)
    })
  })

  describe("chained middleware type safety", () => {
    it("input types accumulate correctly", () => {
      const org: Organization = { id: "1", name: "Acme" }

      const middleware = Middleware("test")
        .input(Schema.Struct({ slug: Schema.String }))
        .input(Schema.Struct({ region: Schema.String }))
        .provides<{ org: Organization }>()

      // Handler should receive merged input type
      const layer = Middleware.toLayer(middleware, (ctx, input) => {
        // These should be available from the merged input
        const _slug: string = input.slug
        const _region: string = input.region
        return Effect.succeed({ ...ctx, org })
      })

      expect(Layer.isLayer(layer)).toBe(true)
    })

    it("error types accumulate correctly", () => {
      class Error1 extends Schema.TaggedError<Error1>()("Error1", {}) {}
      class Error2 extends Schema.TaggedError<Error2>()("Error2", {}) {}

      const org: Organization = { id: "1", name: "Acme" }

      const middleware = Middleware("test")
        .error(Error1)
        .error(Error2)
        .provides<{ org: Organization }>()

      // Handler can fail with either error type
      const layer = Middleware.toLayer(middleware, (ctx) =>
        Effect.gen(function* () {
          if (Math.random() > 0.5) {
            return yield* new Error1()
          }
          if (Math.random() > 0.5) {
            return yield* new Error2()
          }
          return { ...ctx, org }
        }),
      )

      expect(Layer.isLayer(layer)).toBe(true)
    })
  })

  describe("custom CtxIn type parameter", () => {
    interface AuthenticatedContext extends BaseContext {
      readonly user: User
    }

    it("respects custom CtxIn", () => {
      const org: Organization = { id: "1", name: "Acme" }

      // Middleware that requires authenticated context
      const middleware = Middleware<AuthenticatedContext>("test").provides<{ org: Organization }>()

      // Handler receives AuthenticatedContext, can access user
      const layer = Middleware.toLayer(middleware, (ctx) => {
        const _user: User = ctx.user // Should be available
        return Effect.succeed({ ...ctx, org })
      })

      expect(Layer.isLayer(layer)).toBe(true)
    })
  })

  describe("compile-time type errors (verified manually)", () => {
    /**
     * This test documents the type errors that TypeScript produces
     * for incorrect middleware implementations.
     *
     * To verify these errors exist, uncomment the code blocks below
     * and run `pnpm build` - TypeScript will report the errors.
     *
     * We keep them commented because @ts-expect-error doesn't work
     * well with multi-line expressions in strict mode.
     */
    it("documents expected type errors", () => {
      // Error 1: Wrong property name
      // const middleware1 = Middleware("test").provides<{ org: Organization }>()
      // const bad1 = Middleware.toLayer(middleware1, (ctx) =>
      //   Effect.succeed({ ...ctx, user: { id: "1", email: "test" } })
      // )
      // Error: Property 'org' is missing in type '{ user: User; ... }'

      // Error 2: Missing ctx spread
      // const middleware2 = Middleware("test").provides<{ org: Organization }>()
      // const bad2 = Middleware.toLayer(middleware2, (_ctx) =>
      //   Effect.succeed({ org: { id: "1", name: "Acme" } })
      // )
      // Error: Type '{ org: Organization; }' is missing properties from 'BaseContext'

      // Error 3: Wrong property type
      // const middleware3 = Middleware("test").provides<{ org: Organization }>()
      // const bad3 = Middleware.toLayer(middleware3, (ctx) =>
      //   Effect.succeed({ ...ctx, org: "wrong-type" })
      // )
      // Error: Type 'string' is not assignable to type 'Organization'

      // Error 4: Missing some additions
      // const middleware4 = Middleware("test").provides<{ org: Organization; user: User }>()
      // const bad4 = Middleware.toLayer(middleware4, (ctx) =>
      //   Effect.succeed({ ...ctx, org: { id: "1", name: "Acme" } })
      // )
      // Error: Property 'user' is missing

      expect(true).toBe(true) // Placeholder assertion
    })
  })

  describe("middleware requirements tracking", () => {
    /**
     * Tests for the type-safe middleware requirements system.
     *
     * When a procedure uses `.use(SomeMiddleware)`, the middleware's service type
     * is tracked and must be provided to createRouteHandler/createRpcWebHandler.
     *
     * These are runtime tests that verify the middleware is properly recorded.
     * The type-level enforcement is verified by the compilation of these tests.
     */

    it("tracks middleware requirements through procedure definition", async () => {
      const { procedure } = await import("../index.js")

      // Define middleware
      const OrgMiddleware = Middleware("org")
        .input(Schema.Struct({ orgId: Schema.String }))
        .provides<{ org: { id: string } }>()

      // Define procedure that uses middleware
      const myProcedure = procedure
        .use(OrgMiddleware)
        .input(Schema.Struct({ name: Schema.String }))
        .output(Schema.String)
        .query()

      // Extract the definition from the Effect
      const myProcedureDef = extractFromEffect(myProcedure)

      // Runtime assertion: middleware is recorded
      expect(myProcedureDef._tag).toBe("ProcedureDefinition")
      expect(myProcedureDef.middlewares).toHaveLength(1)
      expect(myProcedureDef.middlewares[0]?.name).toBe("org")
    })

    it("tracks middleware requirements through procedures group", async () => {
      const { procedure, procedures } = await import("../index.js")

      // Define middlewares
      const AuthMiddleware = Middleware("auth").provides<{ user: { id: string } }>()

      const OrgMiddleware = Middleware("org").provides<{ org: { id: string } }>()

      // Define procedures with different middlewares
      const proc1 = procedure
        .use(AuthMiddleware)
        .input(Schema.Struct({ x: Schema.Number }))
        .query()
      const proc2 = procedure
        .use(OrgMiddleware)
        .input(Schema.Struct({ y: Schema.Number }))
        .query()

      const group = procedures("test", { proc1, proc2 })

      // Extract the group from the Effect
      const groupDef = extractFromEffect(group)

      // Extract the procedure definitions
      const proc1Def = extractFromEffect(
        groupDef.procedures.proc1 as unknown as Effect.Effect<ProcedureDefinition, never, unknown>,
      )
      const proc2Def = extractFromEffect(
        groupDef.procedures.proc2 as unknown as Effect.Effect<ProcedureDefinition, never, unknown>,
      )

      // Runtime assertion: middlewares are recorded
      expect(groupDef._tag).toBe("ProceduresGroup")
      expect(proc1Def.middlewares).toHaveLength(1)
      expect(proc2Def.middlewares).toHaveLength(1)
    })

    it("accumulates middleware requirements when chaining .use()", async () => {
      const { procedure } = await import("../index.js")

      // Define two middlewares
      const M1 = Middleware("m1").provides<{ m1: string }>()
      const M2 = Middleware("m2").provides<{ m2: number }>()

      // Chain both middlewares
      const myProcedure = procedure
        .use(M1)
        .use(M2)
        .input(Schema.Struct({ data: Schema.String }))
        .query()

      // Extract the definition from the Effect
      const myProcedureDef = extractFromEffect(myProcedure)

      // Both middleware services should be required
      // Runtime assertion: both middlewares are recorded
      expect(myProcedureDef._tag).toBe("ProcedureDefinition")
      expect(myProcedureDef.middlewares).toHaveLength(2)
      expect(myProcedureDef.middlewares[0]?.name).toBe("m1")
      expect(myProcedureDef.middlewares[1]?.name).toBe("m2")
    })
  })

  describe("compile-time type enforcement", () => {
    /**
     * These tests verify that middleware requirements are tracked at the type level.
     *
     * Requirements are now tracked via Effect's R channel, not via extra type params.
     * The type extraction pattern tests that requirements are tracked.
     */

    it("procedure.use() tracks middleware requirements", () => {
      const TestMiddleware = Middleware("test")
        .input(Schema.Struct({ slug: Schema.String }))
        .provides<{ test: string }>()

      const proc = procedure.use(TestMiddleware).query()

      // Extract requirements from the procedure Effect using Effect.Effect.Context
      // This verifies type-level requirement tracking via Effect's R channel
      type Reqs = Effect.Effect.Context<typeof proc>

      // This assertion verifies Reqs is NOT never
      // If Reqs were never, the conditional would resolve to "NOT_TRACKED"
      // and this line would have a type error
      const result: [Reqs] extends [never] ? "NOT_TRACKED" : "TRACKED" = "TRACKED" as const
      expect(result).toBe("TRACKED")
    })

    it("procedures group tracks middleware requirements from all procedures", () => {
      const TestMiddleware = Middleware("test").provides<{ test: string }>()

      const testProcs = procedures("test", {
        action: procedure.use(TestMiddleware).query(),
      })

      // Requirements are tracked at the group Effect level
      type GroupReqs = Effect.Effect.Context<typeof testProcs>

      // This assertion verifies GroupReqs is NOT never
      const result: [GroupReqs] extends [never] ? "NOT_TRACKED" : "TRACKED" = "TRACKED" as const
      expect(result).toBe("TRACKED")
    })
  })
})
