/**
 * Router Module Tests
 * 
 * Tests for composing procedures into routers, nesting, and path resolution.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema, Context } from "effect"

import { Procedure, Router } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class Contract extends Schema.Class<Contract>("Contract")({
  id: Schema.String,
  title: Schema.String,
}) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String }
) {}

// =============================================================================
// Test Services (for requirement tracking)
// =============================================================================

class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  {
    readonly findAll: () => Effect.Effect<User[]>
    readonly findById: (id: string) => Effect.Effect<User, NotFoundError>
  }
>() {}

class ContractRepository extends Context.Tag("ContractRepository")<
  ContractRepository,
  {
    readonly findAll: () => Effect.Effect<Contract[]>
  }
>() {}

// =============================================================================
// Router.make Tests
// =============================================================================

describe("Router.make", () => {
  it("creates a router from procedure definitions", () => {
    const router = Router.make({
      list: Procedure.query({ success: Schema.Array(User) }),
      byId: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
        error: NotFoundError,
      }),
    })

    expect(router._tag).toBe("Router")
    expect(router.definition.list).toBeDefined()
    expect(router.definition.byId).toBeDefined()
  })

  it("creates a router from procedure families", () => {
    const userProcedures = Procedure.family("user", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const router = Router.make({
      user: userProcedures,
    })

    expect(router._tag).toBe("Router")
  })

  it("supports nested routers", () => {
    const publicContracts = Procedure.family("public", {
      list: Procedure.query({ success: Schema.Array(Contract) }),
    })

    const privateContracts = Procedure.family("private", {
      list: Procedure.query({ success: Schema.Array(Contract) }),
    })

    const contractsRouter = Router.make({
      public: publicContracts,
      private: privateContracts,
    })

    const appRouter = Router.make({
      contracts: contractsRouter,
    })

    expect(appRouter.definition.contracts).toBeDefined()
  })
})

// =============================================================================
// Router.paths Tests
// =============================================================================

describe("Router.paths", () => {
  it("returns all procedure paths in flat router", () => {
    const router = Router.make({
      list: Procedure.query({ success: Schema.Array(User) }),
      byId: Procedure.query({ success: User }),
      create: Procedure.mutation({ success: User, invalidates: [] }),
    })

    const paths = Router.paths(router)

    expect(paths).toContain("list")
    expect(paths).toContain("byId")
    expect(paths).toContain("create")
    expect(paths).toHaveLength(3)
  })

  it("returns dotted paths for nested routers", () => {
    const userProcedures = Procedure.family("user", {
      list: Procedure.query({ success: Schema.Array(User) }),
      byId: Procedure.query({ success: User }),
    })

    const router = Router.make({
      user: userProcedures,
    })

    const paths = Router.paths(router)

    expect(paths).toContain("user.list")
    expect(paths).toContain("user.byId")
  })

  it("returns deeply nested paths", () => {
    const publicContracts = Procedure.family("public", {
      list: Procedure.query({ success: Schema.Array(Contract) }),
      get: Procedure.query({ success: Contract }),
    })

    const contractsRouter = Router.make({
      public: publicContracts,
    })

    const router = Router.make({
      contracts: contractsRouter,
    })

    const paths = Router.paths(router)

    expect(paths).toContain("contracts.public.list")
    expect(paths).toContain("contracts.public.get")
  })
})

// =============================================================================
// Router.get Tests
// =============================================================================

describe("Router.get", () => {
  it("retrieves procedure by path", () => {
    const listQuery = Procedure.query({ success: Schema.Array(User) })

    const router = Router.make({
      list: listQuery,
    })

    const procedure = Router.get(router, "list")

    expect(procedure).toBe(listQuery)
  })

  it("retrieves nested procedure by dotted path", () => {
    const userProcedures = Procedure.family("user", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const router = Router.make({
      user: userProcedures,
    })

    const procedure = Router.get(router, "user.list")

    expect(procedure?._tag).toBe("Query")
  })

  it("returns undefined for non-existent path", () => {
    const router = Router.make({
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const procedure = Router.get(router, "nonexistent")

    expect(procedure).toBeUndefined()
  })
})

// =============================================================================
// Router.merge Tests
// =============================================================================

describe("Router.merge", () => {
  it("merges multiple routers", () => {
    const userRouter = Router.make({
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const contractRouter = Router.make({
      list: Procedure.query({ success: Schema.Array(Contract) }),
    })

    // Note: this would overwrite 'list' - maybe we need namespacing
    const merged = Router.merge(userRouter, contractRouter)

    expect(merged._tag).toBe("Router")
  })
})

// =============================================================================
// Type Inference Tests
// =============================================================================

describe("Router type inference", () => {
  it("infers correct type for flat definition", () => {
    const router = Router.make({
      list: Procedure.query({ success: Schema.Array(User) }),
      byId: Procedure.query({
        payload: Schema.Struct({ id: Schema.String }),
        success: User,
      }),
    })

    type Def = typeof router.definition
    
    expectTypeOf<Def>().toHaveProperty("list")
    expectTypeOf<Def>().toHaveProperty("byId")
  })

  it("flattens families in type", () => {
    const userProcedures = Procedure.family("user", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const router = Router.make({
      user: userProcedures,
    })

    // The flattened type should have user.list accessible
    type Flattened = typeof router.flattened
    
    expectTypeOf<Flattened>().toHaveProperty("user")
  })
})

// =============================================================================
// Requirement Tracking Tests
// =============================================================================

describe("Router requirements", () => {
  it("tracks service requirements from handlers", () => {
    const router = Router.make({
      list: Procedure.query({
        success: Schema.Array(User),
        handler: () =>
          Effect.flatMap(UserRepository, (repo) => repo.findAll()),
      }),
    })

    // The router should have UserRepository as a requirement
    type Requirements = Router.RequirementsOf<typeof router>
    expectTypeOf<Requirements>().toMatchTypeOf<UserRepository>()
  })

  it("combines requirements from multiple procedures", () => {
    const router = Router.make({
      users: Procedure.query({
        success: Schema.Array(User),
        handler: () =>
          Effect.flatMap(UserRepository, (repo) => repo.findAll()),
      }),
      contracts: Procedure.query({
        success: Schema.Array(Contract),
        handler: () =>
          Effect.flatMap(ContractRepository, (repo) => repo.findAll()),
      }),
    })

    type Requirements = Router.RequirementsOf<typeof router>
    expectTypeOf<Requirements>().toMatchTypeOf<UserRepository | ContractRepository>()
  })
})
