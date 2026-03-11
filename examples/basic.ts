/**
 * Basic example showing the interface-first pattern with effect-trpc.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import { procedure, procedures, Router } from "../src/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// 1. SCHEMAS — Define your data shapes
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.Date,
})

type User = typeof UserSchema.Type

const CreateUserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
})

type CreateUser = typeof CreateUserSchema.Type

const IdSchema = Schema.Struct({
  id: Schema.String,
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. PROCEDURES — Define the contracts (what, not how)
// ─────────────────────────────────────────────────────────────────────────────

export const UserProcedures = procedures("user", {
  // Queries — read-only, cacheable
  list: procedure
    .output(Schema.Array(UserSchema))
    .meta({ description: "List all users" })
    .query(),

  byId: procedure
    .input(IdSchema)
    .output(UserSchema)
    .meta({ description: "Get user by ID" })
    .query(),

  byEmail: procedure
    .input(Schema.Struct({ email: Schema.String }))
    .output(UserSchema)
    .query(),

  // Mutations — write operations, may invalidate cache
  create: procedure
    .input(CreateUserSchema)
    .output(UserSchema)
    .invalidates(["user.list"]) // Auto-invalidate list when creating
    .meta({ description: "Create a new user" })
    .mutation(),

  update: procedure
    .input(Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      email: Schema.optional(Schema.String),
    }))
    .output(UserSchema)
    .invalidates(["user.list", "user.byId"])
    .mutation(),

  delete: procedure
    .input(IdSchema)
    .output(Schema.Void)
    .invalidates(["user.list", "user.byId"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. ROUTER — Compose procedures into a router
// ─────────────────────────────────────────────────────────────────────────────

export const appRouter = Router.make({
  user: UserProcedures,
  // Add more: post: PostProcedures, etc.
})

// Export type for client
export type AppRouter = typeof appRouter

// ─────────────────────────────────────────────────────────────────────────────
// 4. SERVICES — Define infrastructure contracts (also interface-first!)
// ─────────────────────────────────────────────────────────────────────────────

// Database service contract
interface DatabaseService {
  readonly query: <T>(sql: string, params?: unknown[]) => Effect.Effect<T[], Error>
  readonly queryOne: <T>(sql: string, params?: unknown[]) => Effect.Effect<T, Error>
  readonly insert: <T>(table: string, data: unknown) => Effect.Effect<T, Error>
  readonly update: <T>(table: string, id: string, data: unknown) => Effect.Effect<T, Error>
  readonly delete: (table: string, id: string) => Effect.Effect<void, Error>
}

class Database extends Context.Tag("Database")<Database, DatabaseService>() {}

// ─────────────────────────────────────────────────────────────────────────────
// 5. IMPLEMENTATIONS — The "how" (Live Layer)
// ─────────────────────────────────────────────────────────────────────────────

// User procedures implementation — depends on Database
export const UserProceduresLive = UserProcedures.implement({
  list: () =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.query<User>("SELECT * FROM users")
    }),

  byId: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.queryOne<User>("SELECT * FROM users WHERE id = ?", [id])
    }),

  byEmail: ({ email }) =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.queryOne<User>("SELECT * FROM users WHERE email = ?", [email])
    }),

  create: (input) =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.insert<User>("users", {
        ...input,
        id: crypto.randomUUID(),
        createdAt: new Date(),
      })
    }),

  update: ({ id, ...data }) =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.update<User>("users", id, data)
    }),

  delete: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.delete("users", id)
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. TEST IMPLEMENTATION — In-memory for testing
// ─────────────────────────────────────────────────────────────────────────────

const makeUserProceduresTest = () => {
  const users = new Map<string, User>()

  // Seed some test data
  const testUser: User = {
    id: "1",
    name: "Test User",
    email: "test@example.com",
    createdAt: new Date(),
  }
  users.set(testUser.id, testUser)

  return UserProcedures.implementTest({
    list: () => Effect.succeed([...users.values()]),

    byId: ({ id }) =>
      Effect.sync(() => users.get(id)).pipe(
        Effect.flatMap((user) =>
          user
            ? Effect.succeed(user)
            : Effect.fail(new Error(`User not found: ${id}`))
        )
      ),

    byEmail: ({ email }) =>
      Effect.sync(() => [...users.values()].find((u) => u.email === email)).pipe(
        Effect.flatMap((user) =>
          user
            ? Effect.succeed(user)
            : Effect.fail(new Error(`User not found: ${email}`))
        )
      ),

    create: (input) =>
      Effect.sync(() => {
        const user: User = {
          ...input,
          id: crypto.randomUUID(),
          createdAt: new Date(),
        }
        users.set(user.id, user)
        return user
      }),

    update: ({ id, ...data }) =>
      Effect.sync(() => {
        const existing = users.get(id)
        if (!existing) throw new Error(`User not found: ${id}`)
        const updated = { ...existing, ...data }
        users.set(id, updated)
        return updated
      }),

    delete: ({ id }) =>
      Effect.sync(() => {
        users.delete(id)
      }),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. USAGE
// ─────────────────────────────────────────────────────────────────────────────

// In your app, wire it all together:
// 
// const LiveLayer = Layer.mergeAll(
//   UserProceduresLive,
//   DatabaseLive,  // Your real database implementation
// )
// 
// export const { GET, POST } = createRouteHandler({
//   router: appRouter,
//   handlers: LiveLayer,
// })

// For testing:
//
// const TestLayer = makeUserProceduresTest()
// 
// const testProgram = Effect.gen(function* () {
//   const service = yield* UserProcedures.tag
//   const users = yield* service.handlers.list()
//   console.log(users)
// }).pipe(Effect.provide(TestLayer))
