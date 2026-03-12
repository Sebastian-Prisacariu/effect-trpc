/**
 * Tests for invalidation path typing
 * 
 * Two patterns:
 * 1. Procedure.mutation({ invalidates: [...] }) - loose with optional autocomplete
 * 2. api.invalidate([...]) - strict with required valid paths
 */

import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import * as Procedure from "../src/Procedure/index.js"
import * as Router from "../src/Router/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
}) {}

// =============================================================================
// Test Router Setup
// =============================================================================

const listUsers = Procedure.query({ success: Schema.Array(User) })
const getUser = Procedure.query({ 
  payload: Schema.Struct({ id: Schema.String }),
  success: User,
})

const baseRouter = Router.make("@api", {
  users: {
    list: listUsers,
    get: getUser,
  },
  health: Procedure.query({ success: Schema.String }),
})

type Paths = Router.Paths<typeof baseRouter>
// Expected: "users" | "users.list" | "users.get" | "health"

// =============================================================================
// Procedure.mutation invalidates (loose + optional autocomplete)
// =============================================================================

describe("Procedure.mutation invalidates", () => {
  it("accepts known paths", () => {
    const mutation = Procedure.mutation<Paths>({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users"],
    })
    
    expect(mutation.invalidates).toEqual(["users"])
  })
  
  it("accepts multiple known paths", () => {
    const mutation = Procedure.mutation<Paths>({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users", "users.list"],
    })
    
    expect(mutation.invalidates).toEqual(["users", "users.list"])
  })
  
  it("accepts unknown paths (no type error)", () => {
    // This should compile - AutoComplete allows any string
    const mutation = Procedure.mutation<Paths>({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users.create"], // Not in Paths yet, but valid
    })
    
    expect(mutation.invalidates).toEqual(["users.create"])
  })
  
  it("works without Paths generic (any string)", () => {
    // Without generic, any string is accepted
    const mutation = Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["anything", "goes", "here"],
    })
    
    expect(mutation.invalidates).toEqual(["anything", "goes", "here"])
  })
})

// =============================================================================
// api.invalidate (strict)
// =============================================================================

describe("api.invalidate typing", () => {
  // These are type-level tests - they verify the types are correct
  // The actual runtime behavior is tested elsewhere
  
  it("Router.Paths extracts correct paths", () => {
    // Type-level assertion: Paths should be the union of all paths
    type Expected = "users" | "users.list" | "users.get" | "health"
    
    // This will fail to compile if Paths doesn't match Expected
    const assertPaths: Paths = "users.list" as Expected
    const assertExpected: Expected = "users" as Paths
    
    expect(assertPaths).toBe("users.list")
    expect(assertExpected).toBe("users")
  })
  
  it("tagsToInvalidate returns correct tags for path", () => {
    const tags = Router.tagsToInvalidate(baseRouter, "users")
    
    // Should include the path itself and all children
    expect(tags).toContain("@api/users")
    expect(tags).toContain("@api/users/list")
    expect(tags).toContain("@api/users/get")
  })
  
  it("tagsToInvalidate returns only specific path when no children", () => {
    const tags = Router.tagsToInvalidate(baseRouter, "health")
    
    expect(tags).toEqual(["@api/health"])
  })
})

// =============================================================================
// Type-level tests (compile-time only)
// =============================================================================

// These functions exist only to verify types at compile time
// They should never be called at runtime

function _typeTests() {
  // ─── Procedure.mutation with Paths generic ───
  
  // ✓ Known paths autocomplete and are valid
  Procedure.mutation<Paths>({
    success: User,
    invalidates: ["users"],
  })
  
  Procedure.mutation<Paths>({
    success: User,
    invalidates: ["users.list", "users.get"],
  })
  
  // ✓ Unknown paths are also valid (AutoComplete allows any string)
  Procedure.mutation<Paths>({
    success: User,
    invalidates: ["some.future.path"],
  })
  
  // ─── Procedure.mutation without Paths generic ───
  
  // ✓ Any strings are valid
  Procedure.mutation({
    success: User,
    invalidates: ["anything"],
  })
  
  // ─── Router.Paths type extraction ───
  
  // ✓ Paths includes all router paths
  const p1: Paths = "users"
  const p2: Paths = "users.list"
  const p3: Paths = "users.get"
  const p4: Paths = "health"
  
  // Use variables to avoid unused warnings
  void [p1, p2, p3, p4]
}

// Ensure the type test function exists but mark as intentionally unused
void _typeTests
