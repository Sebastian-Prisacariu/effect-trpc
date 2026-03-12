/**
 * E2E Test Fixtures
 * 
 * Schemas, errors, procedures, router, and handlers for testing.
 */

import { Context, Effect, Layer, Schema, Stream } from "effect"
import * as Procedure from "../../src/Procedure/index.js"
import * as Router from "../../src/Router/index.js"
import * as Server from "../../src/Server/index.js"

// =============================================================================
// Schemas
// =============================================================================

export class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

export class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
  email: Schema.String,
}) {}

// =============================================================================
// Errors
// =============================================================================

export class NotFoundError extends Schema.TaggedError<NotFoundError>("NotFoundError")(
  "NotFoundError",
  {
    entity: Schema.String,
    id: Schema.String,
  }
) {}

export class ValidationError extends Schema.TaggedError<ValidationError>("ValidationError")(
  "ValidationError", 
  {
    field: Schema.String,
    message: Schema.String,
  }
) {}

// =============================================================================
// Procedures
// =============================================================================

export const listUsers = Procedure.query({
  success: Schema.Array(User),
})

export const getUser = Procedure.query({
  payload: Schema.Struct({ id: Schema.String }),
  success: User,
  error: NotFoundError,
})

export const createUser = Procedure.mutation({
  payload: CreateUserInput,
  success: User,
  error: ValidationError,
  invalidates: ["users"],
})

export const deleteUser = Procedure.mutation({
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: NotFoundError,
  invalidates: ["users"],
})

export const watchUsers = Procedure.stream({
  success: User,
})

export const health = Procedure.query({
  success: Schema.String,
})

// =============================================================================
// Router
// =============================================================================

export const testRouter = Router.make("@test", {
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
    delete: deleteUser,
    watch: watchUsers,
  },
  health,
})

export type TestRouter = typeof testRouter

// =============================================================================
// Test Database Service
// =============================================================================

export class TestDatabase extends Context.Tag("TestDatabase")<
  TestDatabase,
  {
    readonly users: Map<string, User>
    readonly getAllUsers: () => Effect.Effect<User[]>
    readonly findUser: (id: string) => Effect.Effect<User | null>
    readonly createUser: (input: CreateUserInput) => Effect.Effect<User>
    readonly deleteUser: (id: string) => Effect.Effect<boolean>
    readonly reset: () => Effect.Effect<void>
  }
>() {}

export const TestDatabaseLive = Layer.sync(TestDatabase, () => {
  const users = new Map<string, User>([
    ["1", new User({ id: "1", name: "Alice", email: "alice@example.com" })],
    ["2", new User({ id: "2", name: "Bob", email: "bob@example.com" })],
  ])
  
  return {
    users,
    getAllUsers: () => Effect.succeed([...users.values()]),
    findUser: (id) => Effect.succeed(users.get(id) ?? null),
    createUser: (input) => Effect.sync(() => {
      const user = new User({ 
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, 
        name: input.name, 
        email: input.email 
      })
      users.set(user.id, user)
      return user
    }),
    deleteUser: (id) => Effect.sync(() => users.delete(id)),
    reset: () => Effect.sync(() => {
      users.clear()
      users.set("1", new User({ id: "1", name: "Alice", email: "alice@example.com" }))
      users.set("2", new User({ id: "2", name: "Bob", email: "bob@example.com" }))
    }),
  }
})

// =============================================================================
// Handlers
// =============================================================================

export const testHandlers: Server.Handlers<Router.DefinitionOf<TestRouter>, TestDatabase> = {
  users: {
    list: () => Effect.gen(function* () {
      const db = yield* TestDatabase
      return yield* db.getAllUsers()
    }),
    
    get: ({ id }) => Effect.gen(function* () {
      const db = yield* TestDatabase
      const user = yield* db.findUser(id)
      if (!user) {
        return yield* Effect.fail(new NotFoundError({ entity: "User", id }))
      }
      return user
    }),
    
    create: (input) => Effect.gen(function* () {
      const db = yield* TestDatabase
      // Validate
      if (!input.name || input.name.length < 2) {
        return yield* Effect.fail(new ValidationError({ 
          field: "name", 
          message: "Name must be at least 2 characters" 
        }))
      }
      return yield* db.createUser(input)
    }),
    
    delete: ({ id }) => Effect.gen(function* () {
      const db = yield* TestDatabase
      const user = yield* db.findUser(id)
      if (!user) {
        return yield* Effect.fail(new NotFoundError({ entity: "User", id }))
      }
      yield* db.deleteUser(id)
      return undefined as void
    }),
    
    watch: () => Stream.fromEffect(
      Effect.gen(function* () {
        const db = yield* TestDatabase
        const users = yield* db.getAllUsers()
        return users[0] // Just return first user for simplicity
      })
    ),
  },
  
  health: () => Effect.succeed("OK"),
}

// =============================================================================
// Test Server
// =============================================================================

export const testServer = Server.make(testRouter, testHandlers)

export type TestServer = typeof testServer
