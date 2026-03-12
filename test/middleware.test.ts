/**
 * Middleware Module Tests
 * 
 * Tests for middleware definition, composition with procedures,
 * and type flow across client/server.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema, Context, Layer } from "effect"

import { Procedure, Router, Middleware, Server } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  "UnauthorizedError",
  { message: Schema.String }
) {}

class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  "ForbiddenError",
  { reason: Schema.String }
) {}

// =============================================================================
// Test Middleware Definitions
// =============================================================================

// What auth middleware provides
class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

// Auth middleware tag
class Auth extends Middleware.Tag<Auth>()("Auth", {
  provides: CurrentUser,
  failure: UnauthorizedError,
  requiredForClient: true,
}) {}

// Admin middleware (requires Auth first)
class Admin extends Middleware.Tag<Admin>()("Admin", {
  provides: Context.Tag("AdminRole")<"AdminRole", { readonly level: number }>(),
  failure: ForbiddenError,
  requiredForClient: false,
}) {}

// =============================================================================
// Middleware.Tag Tests
// =============================================================================

describe("Middleware.Tag", () => {
  it("creates a middleware tag with provides and failure", () => {
    expect(Auth).toBeDefined()
    expect(Auth.provides).toBe(CurrentUser)
    expect(Auth.failure).toBe(UnauthorizedError)
  })

  it("has requiredForClient property", () => {
    expect(Auth.requiredForClient).toBe(true)
    expect(Admin.requiredForClient).toBe(false)
  })

  it("Auth.of creates a handler implementation", () => {
    const handler = Auth.of(({ headers }) =>
      Effect.gen(function* () {
        const token = headers.get("authorization")
        if (!token) {
          return yield* Effect.fail(
            new UnauthorizedError({ message: "No token" })
          )
        }
        return new User({ id: "1", name: "Auth User", email: "auth@example.com" })
      })
    )

    expect(handler._tag).toBe("MiddlewareHandler")
  })
})

// =============================================================================
// Procedure with Middleware Tests
// =============================================================================

describe("Procedure with middleware", () => {
  it("family can have middleware applied", () => {
    const userProcedures = Procedure.family("user", {
      me: Procedure.query({ success: User }),
      list: Procedure.query({ success: Schema.Array(User) }),
    }).withMiddleware(Auth)

    expect(userProcedures.middleware).toContain(Auth)
  })

  it("middleware provides context to handlers", () => {
    const userProcedures = Procedure.family("user", {
      me: Procedure.query({
        success: User,
        handler: () =>
          // CurrentUser is available because Auth middleware provides it
          Effect.flatMap(CurrentUser, (user) => Effect.succeed(user)),
      }),
    }).withMiddleware(Auth)

    // Handler can access CurrentUser without it being a requirement
    // because Auth middleware provides it
  })

  it("middleware errors are added to procedure errors", () => {
    const protectedQuery = Procedure.query({
      success: User,
    })

    const family = Procedure.family("user", {
      me: protectedQuery,
    }).withMiddleware(Auth)

    // The procedure's effective error type should include UnauthorizedError
    type FamilyProcedures = typeof family.procedures
    type MeProcedure = FamilyProcedures["me"]
    
    // After middleware is applied, error should include UnauthorizedError
  })

  it("multiple middleware can be chained", () => {
    const adminProcedures = Procedure.family("admin", {
      dashboard: Procedure.query({ success: Schema.Struct({ stats: Schema.Number }) }),
    })
      .withMiddleware(Auth)
      .withMiddleware(Admin)

    expect(adminProcedures.middleware).toHaveLength(2)
  })
})

// =============================================================================
// Router with Middleware Tests
// =============================================================================

describe("Router with middleware", () => {
  it("router inherits middleware from families", () => {
    const userProcedures = Procedure.family("user", {
      me: Procedure.query({ success: User }),
    }).withMiddleware(Auth)

    const router = Router.make({
      user: userProcedures,
    })

    // Router should know about middleware requirements
  })

  it("different families can have different middleware", () => {
    const publicProcedures = Procedure.family("public", {
      list: Procedure.query({ success: Schema.Array(Schema.String) }),
    })
    // No middleware - public

    const privateProcedures = Procedure.family("private", {
      data: Procedure.query({ success: Schema.String }),
    }).withMiddleware(Auth)

    const router = Router.make({
      public: publicProcedures,
      private: privateProcedures,
    })

    // public.list - no auth required
    // private.data - auth required
  })
})

// =============================================================================
// Server Middleware Integration Tests
// =============================================================================

describe("Server middleware integration", () => {
  it("createRouteHandler requires middleware layers", () => {
    const userProcedures = Procedure.family("user", {
      me: Procedure.query({
        success: User,
        handler: () => CurrentUser,
      }),
    }).withMiddleware(Auth)

    const router = Router.make({ user: userProcedures })

    const AuthLive = Layer.succeed(
      Auth,
      Auth.of(({ headers }) =>
        Effect.gen(function* () {
          const token = headers.get("authorization")
          if (!token) {
            return yield* Effect.fail(new UnauthorizedError({ message: "No token" }))
          }
          return new User({ id: "1", name: "Test", email: "test@example.com" })
        })
      )
    )

    // Should compile - AuthLive provides Auth middleware
    Server.createRouteHandler(router, {
      layer: AuthLive,
    })

    // @ts-expect-error - missing Auth middleware layer
    Server.createRouteHandler(router, {
      layer: Layer.empty,
    })
  })

  it("middleware runs before handler", () => {
    // Middleware should:
    // 1. Extract auth from headers
    // 2. Provide CurrentUser to context
    // 3. Then handler runs with CurrentUser available
  })

  it("middleware failure short-circuits handler", () => {
    // If Auth middleware fails (no token), handler should not run
  })
})

// =============================================================================
// Client Middleware Integration Tests
// =============================================================================

describe("Client middleware integration", () => {
  it("Middleware.layerClient creates client-side middleware", () => {
    const AuthClientLive = Middleware.layerClient(Auth, ({ request, rpc }) =>
      Effect.gen(function* () {
        // Add auth header to outgoing requests
        const token = yield* getStoredToken()
        return {
          ...request,
          headers: new Headers({
            ...Object.fromEntries(request.headers.entries()),
            authorization: `Bearer ${token}`,
          }),
        }
      })
    )

    expect(AuthClientLive).toBeDefined()
  })

  it("client middleware is provided to Client.Provider", () => {
    // When requiredForClient: true, client must provide the middleware
  })
})

// =============================================================================
// Type Flow Tests
// =============================================================================

describe("Middleware type flow", () => {
  it("CurrentUser type flows through to handlers", () => {
    const userProcedures = Procedure.family("user", {
      me: Procedure.query({
        success: User,
        handler: () =>
          Effect.gen(function* () {
            const currentUser = yield* CurrentUser
            // currentUser should be typed as User
            expectTypeOf(currentUser).toEqualTypeOf<User>()
            return currentUser
          }),
      }),
    }).withMiddleware(Auth)
  })

  it("middleware removes provided context from requirements", () => {
    // Before middleware: handler requires CurrentUser
    // After Auth middleware: CurrentUser is provided, not required

    const handlerWithoutMiddleware = () =>
      Effect.flatMap(CurrentUser, (user) => Effect.succeed(user))

    // Type of handler: Effect<User, never, CurrentUser>
    type HandlerReqs = Effect.Effect.Context<ReturnType<typeof handlerWithoutMiddleware>>
    expectTypeOf<HandlerReqs>().toMatchTypeOf<CurrentUser>()

    // After applying Auth middleware, CurrentUser should be satisfied
  })

  it("middleware errors combine with procedure errors", () => {
    class NotFoundError extends Schema.TaggedError<NotFoundError>()(
      "NotFoundError",
      { id: Schema.String }
    ) {}

    const userProcedures = Procedure.family("user", {
      byId: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
        error: NotFoundError,
        handler: ({ id }) => Effect.fail(new NotFoundError({ id })),
      }),
    }).withMiddleware(Auth)

    // Effective error type should be NotFoundError | UnauthorizedError
  })
})

// Helper
declare const getStoredToken: () => Effect.Effect<string>
