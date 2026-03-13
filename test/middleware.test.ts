/**
 * Middleware Module Tests
 * 
 * Tests for middleware definition, composition, and application.
 */

import { describe, it, expect } from "vitest"
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
// Test Services and Middleware
// =============================================================================

class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}
class AdminRole extends Context.Tag("AdminRole")<AdminRole, { readonly level: number }>() {}

const AuthMiddleware = Middleware.Tag<User, UnauthorizedError>(
  "AuthMiddleware",
  CurrentUser
)

const AdminMiddleware = Middleware.Tag<{ readonly level: number }, ForbiddenError>(
  "AdminMiddleware",
  AdminRole
)

// =============================================================================
// Middleware.Tag Tests
// =============================================================================

describe("Middleware.Tag", () => {
  it("creates a middleware tag", () => {
    expect(AuthMiddleware).toBeDefined()
    expect(Middleware.isMiddlewareTag(AuthMiddleware)).toBe(true)
  })

  it("has provides property", () => {
    expect(AuthMiddleware.provides).toBe(CurrentUser)
  })
})

// =============================================================================
// Middleware.implement Tests
// =============================================================================

describe("Middleware.implement", () => {
  it("creates a Layer from implementation", () => {
    const AuthLive = Middleware.implement(AuthMiddleware, (request) =>
      Effect.gen(function* () {
        const token = request.headers.get("authorization")
        if (!token) {
          return yield* Effect.fail(new UnauthorizedError({ message: "No token" }))
        }
        return new User({ id: "1", name: "Test", email: "test@example.com" })
      })
    )

    expect(AuthLive).toBeDefined()
    expect(Layer.isLayer(AuthLive)).toBe(true)
  })
})

// =============================================================================
// Middleware.all Tests
// =============================================================================

describe("Middleware.all", () => {
  it("combines multiple middlewares", () => {
    const combined = Middleware.all(AuthMiddleware, AdminMiddleware)
    
    expect(Middleware.isCombinedMiddleware(combined)).toBe(true)
    expect(combined.tags).toHaveLength(2)
    expect(combined.concurrency).toBe("sequential")
  })

  it("supports concurrency option", () => {
    const concurrent = Middleware.all(AuthMiddleware, AdminMiddleware, {
      concurrency: "unbounded"
    })
    
    expect(concurrent.concurrency).toBe("unbounded")
  })

  it("supports numeric concurrency", () => {
    const limited = Middleware.all(AuthMiddleware, AdminMiddleware, {
      concurrency: 2
    })
    
    expect(limited.concurrency).toBe(2)
  })
})

// =============================================================================
// Procedure.middleware Tests
// =============================================================================

describe("Procedure.middleware", () => {
  it("adds middleware to a procedure", () => {
    const proc = Procedure.query({ success: User })
    const withAuth = proc.middleware(AuthMiddleware)
    
    expect(withAuth.middlewares).toContain(AuthMiddleware)
  })

  it("chains multiple middleware calls", () => {
    const proc = Procedure.query({ success: User })
      .middleware(AuthMiddleware)
      .middleware(AdminMiddleware)
    
    expect(proc.middlewares).toHaveLength(2)
  })

  it("does not mutate original procedure", () => {
    const original = Procedure.query({ success: User })
    const withAuth = original.middleware(AuthMiddleware)
    
    expect(original.middlewares).toHaveLength(0)
    expect(withAuth.middlewares).toHaveLength(1)
  })
})

// =============================================================================
// Router.withMiddleware Tests
// =============================================================================

describe("Router.withMiddleware", () => {
  it("wraps a definition with middleware", () => {
    const wrapped = Router.withMiddleware([AuthMiddleware], {
      list: Procedure.query({ success: Schema.Array(User) }),
      get: Procedure.query({ 
        payload: Schema.Struct({ id: Schema.String }),
        success: User 
      }),
    })
    
    expect(wrapped.middlewares).toContain(AuthMiddleware)
    expect(wrapped.definition.list).toBeDefined()
    expect(wrapped.definition.get).toBeDefined()
  })

  it("supports multiple middlewares", () => {
    const wrapped = Router.withMiddleware([AuthMiddleware, AdminMiddleware], {
      delete: Procedure.mutation({ 
        payload: Schema.Struct({ id: Schema.String }),
        success: Schema.Boolean,
        invalidates: ["users"]
      }),
    })
    
    expect(wrapped.middlewares).toHaveLength(2)
  })
})

// =============================================================================
// Server.middleware Tests
// =============================================================================

describe("Server.middleware", () => {
  const appRouter = Router.make("@test", {
    users: {
      list: Procedure.query({ success: Schema.Array(User) }),
    },
  })

  const handlers = {
    users: {
      list: () => Effect.succeed([]),
    },
  }

  it("adds middleware to server", () => {
    const server = Server.make(appRouter, handlers)
    const withAuth = Server.middleware(AuthMiddleware)(server)
    
    expect(withAuth.middlewares).toContain(AuthMiddleware)
  })

  it("chains with pipe", () => {
    const server = Server.make(appRouter, handlers).pipe(
      Server.middleware(AuthMiddleware),
      Server.middleware(AdminMiddleware),
    )
    
    expect(server.middlewares).toHaveLength(2)
  })
})

// =============================================================================
// Middleware Execution Order Tests
// =============================================================================

describe("Middleware execution order", () => {
  class Service1 extends Context.Tag("Service1")<Service1, string>() {}
  class Service2 extends Context.Tag("Service2")<Service2, string>() {}
  
  const Middleware1 = Middleware.Tag<string, never>("Middleware1", Service1)
  const Middleware2 = Middleware.Tag<string, never>("Middleware2", Service2)

  it("server middleware is added to server.middlewares", () => {
    const router = Router.make("@test", {
      action: Procedure.query({ success: Schema.String }),
    })
    
    const handlers = {
      action: () => Effect.succeed("result"),
    }
    
    const server = Server.make(router, handlers).pipe(
      Server.middleware(Middleware1),
      Server.middleware(Middleware2)
    )
    
    // Server has both middlewares in order
    expect(server.middlewares).toContain(Middleware1)
    expect(server.middlewares).toContain(Middleware2)
    expect(server.middlewares).toHaveLength(2)
    // First added should be first in array
    expect(server.middlewares[0]).toBe(Middleware1)
    expect(server.middlewares[1]).toBe(Middleware2)
  })

  it("procedure middleware is added to procedure.middlewares", () => {
    const proc = Procedure.query({ success: Schema.String })
      .middleware(Middleware1)
      .middleware(Middleware2)
    
    expect(proc.middlewares).toHaveLength(2)
    expect(proc.middlewares[0]).toBe(Middleware1)
    expect(proc.middlewares[1]).toBe(Middleware2)
  })

  it("group middleware is stored in DefinitionWithMiddleware", () => {
    const wrapped = Router.withMiddleware([Middleware1, Middleware2], {
      action: Procedure.query({ success: Schema.String }),
    })
    
    expect(wrapped.middlewares).toHaveLength(2)
    expect(wrapped.middlewares[0]).toBe(Middleware1)
    expect(wrapped.middlewares[1]).toBe(Middleware2)
  })
})

// =============================================================================
// Guard Function Tests
// =============================================================================

describe("Middleware guards", () => {
  it("isMiddlewareTag identifies middleware tags", () => {
    expect(Middleware.isMiddlewareTag(AuthMiddleware)).toBe(true)
    expect(Middleware.isMiddlewareTag({})).toBe(false)
    expect(Middleware.isMiddlewareTag(null)).toBe(false)
  })

  it("isCombinedMiddleware identifies combined middleware", () => {
    const combined = Middleware.all(AuthMiddleware, AdminMiddleware)
    
    expect(Middleware.isCombinedMiddleware(combined)).toBe(true)
    expect(Middleware.isCombinedMiddleware(AuthMiddleware)).toBe(false)
  })

  it("isApplicable identifies any applicable middleware", () => {
    const combined = Middleware.all(AuthMiddleware, AdminMiddleware)
    
    expect(Middleware.isApplicable(AuthMiddleware)).toBe(true)
    expect(Middleware.isApplicable(combined)).toBe(true)
    expect(Middleware.isApplicable({})).toBe(false)
  })
})
