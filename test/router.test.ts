/**
 * Router Module Tests
 * 
 * Tests for composing procedures into routers with auto-derived tags.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Schema } from "effect"

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
// Router.make Tests
// =============================================================================

describe("Router.make", () => {
  it("creates a router with a tag", () => {
    const router = Router.make("@api", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    expect(router.tag).toBe("@api")
  })

  it("accepts nested plain objects", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
      },
    })

    expect(router.procedures).toHaveLength(2)
  })

  it("supports deeply nested structures", () => {
    const router = Router.make("@api", {
      contracts: {
        public: {
          list: Procedure.query({ success: Schema.Array(Contract) }),
        },
        private: {
          list: Procedure.query({ success: Schema.Array(Contract) }),
        },
      },
    })

    expect(router.procedures).toHaveLength(2)
  })

  it("derives tags from root tag and path", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
      },
      health: Procedure.query({ success: Schema.String }),
    })

    // Check derived tags
    expect(Router.tagOf(router, "users.list")).toBe("@api/users/list")
    expect(Router.tagOf(router, "health")).toBe("@api/health")
  })

  it("creates Effect RPC router internally", () => {
    const router = Router.make("@api", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    expect(router.rpcRouter).toBeDefined()
  })
})

// =============================================================================
// Path Mapping Tests
// =============================================================================

describe("Path mapping", () => {
  it("maps paths to tags", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
      },
    })

    expect(router.pathMap.pathToTag.get("users.list")).toBe("@api/users/list")
    expect(router.pathMap.pathToTag.get("users.get")).toBe("@api/users/get")
  })

  it("maps tags to paths", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
      },
    })

    expect(router.pathMap.tagToPath.get("@api/users/list")).toBe("users.list")
  })

  it("includes namespace paths for hierarchical invalidation", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
      },
    })

    // The "users" path should also be mapped for hierarchical invalidation
    expect(router.pathMap.pathToTag.get("users")).toBe("@api/users")
  })
})

// =============================================================================
// Router.paths Tests
// =============================================================================

describe("Router.paths", () => {
  it("returns all procedure paths", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
      },
      health: Procedure.query({ success: Schema.String }),
    })

    const paths = Router.paths(router)

    expect(paths).toContain("users.list")
    expect(paths).toContain("users.get")
    expect(paths).toContain("health")
    expect(paths).toHaveLength(3)
  })
})

// =============================================================================
// Router.get Tests
// =============================================================================

describe("Router.get", () => {
  it("retrieves procedure by path", () => {
    const router = Router.make("@api", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const procedure = Router.get(router, "list")

    expect(procedure).toBeDefined()
    expect(procedure?.procedure._tag).toBe("Query")
  })

  it("retrieves nested procedure by dotted path", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
      },
    })

    const procedure = Router.get(router, "users.list")

    expect(procedure).toBeDefined()
    expect(procedure?.tag).toBe("@api/users/list")
  })

  it("returns undefined for non-existent path", () => {
    const router = Router.make("@api", {
      list: Procedure.query({ success: Schema.Array(User) }),
    })

    const procedure = Router.get(router, "nonexistent")

    expect(procedure).toBeUndefined()
  })
})

// =============================================================================
// Hierarchical Invalidation Tests
// =============================================================================

describe("Hierarchical invalidation", () => {
  it("getChildPaths returns all paths under a prefix", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
        create: Procedure.mutation({ success: User, invalidates: [] }),
      },
      health: Procedure.query({ success: Schema.String }),
    })

    const childPaths = router.pathMap.getChildPaths("users")

    expect(childPaths).toContain("users")
    expect(childPaths).toContain("users.list")
    expect(childPaths).toContain("users.get")
    expect(childPaths).toContain("users.create")
    expect(childPaths).not.toContain("health")
  })

  it("tagsToInvalidate returns all tags under a path", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
      },
    })

    const tags = Router.tagsToInvalidate(router, "users")

    expect(tags).toContain("@api/users")
    expect(tags).toContain("@api/users/list")
    expect(tags).toContain("@api/users/get")
  })

  it("tagsToInvalidate for leaf path returns only that tag", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
      },
    })

    const tags = Router.tagsToInvalidate(router, "users.list")

    expect(tags).toEqual(["@api/users/list"])
  })
})

// =============================================================================
// Type Inference Tests
// =============================================================================

describe("Router type inference", () => {
  it("Paths extracts all valid paths", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        get: Procedure.query({ success: User }),
      },
      health: Procedure.query({ success: Schema.String }),
    })

    type AllPaths = Router.Paths<typeof router.definition>
    
    // These should be valid paths
    const validPaths: AllPaths[] = ["users.list", "users.get", "health"]
    expect(validPaths).toHaveLength(3)
  })

  it("ProcedureAt extracts procedure type at path", () => {
    const definition = {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
      },
    }

    type ListProcedure = Router.ProcedureAt<typeof definition, "users.list">
    
    // Should be a Query
    expectTypeOf<ListProcedure>().toMatchTypeOf<Procedure.Query<any, any, any>>()
  })
})

// =============================================================================
// Mixed Procedure Types Tests
// =============================================================================

describe("Mixed procedure types", () => {
  it("router can contain queries, mutations, and streams", () => {
    const router = Router.make("@api", {
      users: {
        list: Procedure.query({ success: Schema.Array(User) }),
        create: Procedure.mutation({
          payload: Schema.Struct({ name: Schema.String }),
          success: User,
          invalidates: ["users"],
        }),
        watch: Procedure.stream({ success: User }),
      },
    })

    expect(router.procedures).toHaveLength(3)

    const list = Router.get(router, "users.list")
    const create = Router.get(router, "users.create")
    const watch = Router.get(router, "users.watch")

    expect(list?.procedure._tag).toBe("Query")
    expect(create?.procedure._tag).toBe("Mutation")
    expect(watch?.procedure._tag).toBe("Stream")
  })
})
