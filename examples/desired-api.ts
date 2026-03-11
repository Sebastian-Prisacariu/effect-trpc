/**
 * DESIRED API — What we want to be able to write.
 * 
 * This is the target. We'll build the implementation to make this work.
 */

import { Schema, Effect, Context } from "effect"

// ═══════════════════════════════════════════════════════════════════════════
// 1. SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
  email: Schema.String,
}) {}

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROCEDURE DEFINITIONS (Contracts)
// ═══════════════════════════════════════════════════════════════════════════

import { query, mutation, procedures } from "effect-trpc"

// Define individual procedures
const list = query({
  output: Schema.Array(User),
})

const byId = query({
  input: Schema.Struct({ id: Schema.String }),
  output: User,
})

const create = mutation({
  input: CreateUserInput,
  output: User,
  invalidates: ["user.list"],
})

const deleteUser = mutation({
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Void,
  invalidates: ["user.list", "user.byId"],
})

// Group them
export const UserProcedures = procedures("user", {
  list,
  byId,
  create,
  delete: deleteUser,
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. ROUTER
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "effect-trpc"

export const appRouter = Router.make({
  user: UserProcedures,
  // post: PostProcedures,
})

export type AppRouter = typeof appRouter

// ═══════════════════════════════════════════════════════════════════════════
// 4. SERVER — Interface-First Implementation
// ═══════════════════════════════════════════════════════════════════════════

// 4a. Define service contracts (interfaces only)
interface UserRepositoryService {
  readonly findAll: () => Effect.Effect<User[]>
  readonly findById: (id: string) => Effect.Effect<User, UserNotFoundError>
  readonly create: (input: CreateUserInput) => Effect.Effect<User>
  readonly delete: (id: string) => Effect.Effect<void, UserNotFoundError>
}

class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  UserRepositoryService
>() {}

class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>("UserNotFoundError")({
  id: Schema.String,
}) {}

// 4b. Implement the procedures (using contracts, not implementations)
export const UserProceduresLive = UserProcedures.implement({
  list: () =>
    Effect.gen(function* () {
      const repo = yield* UserRepository
      return yield* repo.findAll()
    }),

  byId: ({ id }) =>
    Effect.gen(function* () {
      const repo = yield* UserRepository
      return yield* repo.findById(id)
    }),

  create: (input) =>
    Effect.gen(function* () {
      const repo = yield* UserRepository
      return yield* repo.create(input)
    }),

  delete: ({ id }) =>
    Effect.gen(function* () {
      const repo = yield* UserRepository
      yield* repo.delete(id)
    }),
})
// Type: Layer<UserProcedures.Service, never, UserRepository>

// 4c. Create the actual repository implementation (Live layer)
// This is where the real I/O happens
export const UserRepositoryLive = Layer.succeed(UserRepository, {
  findAll: () => Effect.succeed([]), // Real: db.query(...)
  findById: (id) => Effect.fail(new UserNotFoundError({ id })), // Real: db.findOne(...)
  create: (input) => Effect.succeed(new User({ id: "1", ...input })),
  delete: (id) => Effect.succeed(undefined),
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. ROUTE HANDLER (Next.js)
// ═══════════════════════════════════════════════════════════════════════════

import { createRouteHandler } from "effect-trpc/server"
import { Layer } from "effect"

// Wire everything together
const FullLive = UserProceduresLive.pipe(
  Layer.provide(UserRepositoryLive)
)

export const { POST } = createRouteHandler({
  router: appRouter,
  handlers: FullLive,
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLIENT (React)
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, Result } from "effect-trpc/client"

export const api = createClient<AppRouter>({
  url: "/api/trpc",
})

// In components:
function UserList() {
  const query = api.user.list.useQuery()

  return Result.match(query.result, {
    onInitial: () => <div>Loading...</div>,
    onWaiting: () => <div>Refreshing...</div>,
    onSuccess: (users) => (
      <ul>
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    ),
    onFailure: (error) => <div>Error: {String(error)}</div>,
  })
}

function CreateUserForm() {
  const mutation = api.user.create.useMutation()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({ name: "New User", email: "new@example.com" })
        // Automatically invalidates user.list based on procedure definition!
      }}
    >
      <button disabled={mutation.isLoading}>
        {mutation.isLoading ? "Creating..." : "Create User"}
      </button>
    </form>
  )
}
