/**
 * E2E Test Fixtures
 * 
 * Schemas, errors, procedures, router, and handlers for testing.
 */

import { Context, Effect, Layer, Schema, Stream } from "effect"
import * as Procedure from "../../src/Procedure/index.js"
import * as Router from "../../src/Router/index.js"
import * as Server from "../../src/Server/index.js"
import * as Middleware from "../../src/Middleware/index.js"

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

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>("UnauthorizedError")(
  "UnauthorizedError",
  {
    message: Schema.String,
  }
) {}

// =============================================================================
// Middleware
// =============================================================================

/**
 * CurrentUser service - provided by AuthMiddleware
 */
export class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

/**
 * AuthMiddleware - validates authorization header and provides CurrentUser
 */
export const AuthMiddleware = Middleware.Tag<User, UnauthorizedError>(
  "AuthMiddleware",
  CurrentUser
)

/**
 * Implementation that checks for "Bearer valid-token" header
 */
export const AuthMiddlewareLive = Middleware.implement(AuthMiddleware, (request) =>
  Effect.gen(function* () {
    const token = request.headers.get("authorization")
    if (token !== "Bearer valid-token") {
      return yield* Effect.fail(new UnauthorizedError({ message: "Invalid or missing token" }))
    }
    // Return a mock user
    return new User({ id: "auth-user", name: "Authenticated User", email: "auth@example.com" })
  })
)

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

export class StreamError extends Schema.TaggedError<StreamError>("StreamError")(
  "StreamError",
  { message: Schema.String }
) {}

export const failingStream = Procedure.stream({
  success: Schema.Number,
  error: StreamError,
})

export const health = Procedure.query({
  success: Schema.String,
})

/**
 * Protected procedure - requires AuthMiddleware
 */
export const getMe = Procedure.query({
  success: User,
}).middleware(AuthMiddleware)

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
    me: getMe,  // Protected by AuthMiddleware
  },
  health,
  failingStream,
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
    
    me: () => Effect.gen(function* () {
      // CurrentUser is provided by AuthMiddleware
      const currentUser = yield* CurrentUser
      return currentUser
    }),
  },
  
  health: () => Effect.succeed("OK"),
  
  failingStream: () => Stream.make(
    // Emit 2 values then fail
    Effect.succeed(1),
    Effect.succeed(2),
    Effect.fail(new StreamError({ message: "Stream failed mid-way" }))
  ),
}

// =============================================================================
// Test Server
// =============================================================================

export const testServer = Server.make(testRouter, testHandlers)

export type TestServer = typeof testServer
