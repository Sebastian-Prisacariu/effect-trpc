/**
 * DESIRED API — What we want to be able to write.
 * 
 * This is the target. We'll build the implementation to make this work.
 */

import { Schema, Effect, Context, Layer } from "effect"

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

class Contract extends Schema.Class<Contract>("Contract")({
  id: Schema.String,
  title: Schema.String,
  userId: Schema.String,
}) {}

// ═══════════════════════════════════════════════════════════════════════════
// 2. ERRORS
// ═══════════════════════════════════════════════════════════════════════════

class NotFoundError extends Schema.TaggedError<NotFoundError>("NotFoundError")({
  entity: Schema.String,
  id: Schema.String,
}) {}

class ValidationError extends Schema.TaggedError<ValidationError>("ValidationError")({
  field: Schema.String,
  message: Schema.String,
}) {}

class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>("UnauthorizedError")({
  message: Schema.String,
}) {}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROCEDURE DEFINITIONS (Contracts)
// 
// Using success/error/payload to match Effect RPC conventions
// ═══════════════════════════════════════════════════════════════════════════

import { Procedure, Router } from "effect-trpc"

// ─── User Procedures ───

const listUsers = Procedure.query({
  success: Schema.Array(User),
})

const getUserById = Procedure.query({
  payload: Schema.Struct({ id: Schema.String }),
  success: User,
  error: NotFoundError,
})

const createUser = Procedure.mutation({
  payload: CreateUserInput,
  success: User,
  error: ValidationError,
  invalidates: ["user.list"],
})

const deleteUser = Procedure.mutation({
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: NotFoundError,
  invalidates: ["user.list", "user.byId"],
})

// Stream procedure — returns a stream of values (SSE)
const watchUsers = Procedure.stream({
  success: User,  // Each chunk is a User
  error: UnauthorizedError,
})

export const UserProcedures = Procedure.family("user", {
  list: listUsers,
  byId: getUserById,
  create: createUser,
  delete: deleteUser,
  watch: watchUsers,
})

// ─── Contract Procedures (nested example) ───

const listPublicContracts = Procedure.query({
  success: Schema.Array(Contract),
})

const getPublicContract = Procedure.query({
  payload: Schema.Struct({ id: Schema.String }),
  success: Contract,
  error: NotFoundError,
})

const PublicContractProcedures = Procedure.family("public", {
  list: listPublicContracts,
  get: getPublicContract,
})

const listPrivateContracts = Procedure.query({
  payload: Schema.Struct({ userId: Schema.String }),
  success: Schema.Array(Contract),
  error: UnauthorizedError,
})

const PrivateContractProcedures = Procedure.family("private", {
  list: listPrivateContracts,
})

// Nested router for contracts
const ContractsRouter = Router.make({
  public: PublicContractProcedures,
  private: PrivateContractProcedures,
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. ROUTER (with nesting)
// ═══════════════════════════════════════════════════════════════════════════

export const appRouter = Router.make({
  user: UserProcedures,
  contracts: ContractsRouter,  // Nested router!
})

export type AppRouter = typeof appRouter

// ═══════════════════════════════════════════════════════════════════════════
// 5. SERVER — Interface-First Implementation
// ═══════════════════════════════════════════════════════════════════════════

// 5a. Define service contracts (interfaces only)
interface UserRepositoryService {
  readonly findAll: () => Effect.Effect<User[]>
  readonly findById: (id: string) => Effect.Effect<User, NotFoundError>
  readonly create: (input: CreateUserInput) => Effect.Effect<User, ValidationError>
  readonly delete: (id: string) => Effect.Effect<void, NotFoundError>
}

class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  UserRepositoryService
>() {}

// 5b. Implement the procedures (using contracts, not implementations)
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

// 5c. Create the actual repository implementation (Live layer)
export const UserRepositoryLive = Layer.succeed(UserRepository, {
  findAll: () => Effect.succeed([]),
  findById: (id) => Effect.fail(new NotFoundError({ entity: "User", id })),
  create: (input) => Effect.succeed(new User({ id: "1", ...input })),
  delete: (_id) => Effect.succeed(undefined),
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. ROUTE HANDLER (Next.js)
// ═══════════════════════════════════════════════════════════════════════════

import { createRouteHandler } from "effect-trpc/server"

const FullLive = UserProceduresLive.pipe(
  Layer.provide(UserRepositoryLive)
)

export const { POST } = createRouteHandler({
  router: appRouter,
  handlers: FullLive,
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. CLIENT (React)
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, Result } from "effect-trpc/client"

export const api = createClient<AppRouter>({
  url: "/api/trpc",
})

// Provider wraps your app
export function ApiProvider({ children }: { children: React.ReactNode }) {
  return <api.Provider>{children}</api.Provider>
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. USAGE IN COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

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

function UserDetail({ id }: { id: string }) {
  const query = api.user.byId.useQuery({ id })

  return Result.match(query.result, {
    onInitial: () => <div>Loading...</div>,
    onWaiting: () => <div>Loading user...</div>,
    onSuccess: (user) => (
      <div>
        <h2>{user.name}</h2>
        <p>{user.email}</p>
      </div>
    ),
    onFailure: (error) => {
      // Typed error handling!
      if (error._tag === "NotFoundError") {
        return <div>User {error.id} not found</div>
      }
      return <div>Error: {String(error)}</div>
    },
  })
}

function CreateUserForm() {
  const mutation = api.user.create.useMutation()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({ name: "New User", email: "new@example.com" })
        // Automatically invalidates user.list!
      }}
    >
      <button disabled={mutation.isLoading}>
        {mutation.isLoading ? "Creating..." : "Create User"}
      </button>
      
      {mutation.isError && mutation.error._tag === "ValidationError" && (
        <div className="error">
          {mutation.error.field}: {mutation.error.message}
        </div>
      )}
    </form>
  )
}

// ─── Stream Usage ───

function UserActivityFeed() {
  // Stream returns chunks over time (SSE)
  const stream = api.user.watch.useStream()

  return (
    <div>
      <h3>Live Activity</h3>
      {stream.chunks.map((user, i) => (
        <div key={i}>User updated: {user.name}</div>
      ))}
      {stream.isConnected && <span>🟢 Connected</span>}
      {stream.error && <span>Error: {String(stream.error)}</span>}
    </div>
  )
}

// ─── Nested Router Usage ───

function PublicContractList() {
  // Deeply nested: api.contracts.public.list
  const query = api.contracts.public.list.useQuery()

  return Result.match(query.result, {
    onInitial: () => <div>Loading contracts...</div>,
    onWaiting: () => <div>Refreshing...</div>,
    onSuccess: (contracts) => (
      <ul>
        {contracts.map((c) => (
          <li key={c.id}>{c.title}</li>
        ))}
      </ul>
    ),
    onFailure: (error) => <div>Error: {String(error)}</div>,
  })
}

function ContractDetail({ id }: { id: string }) {
  // api.contracts.public.get
  const query = api.contracts.public.get.useQuery({ id })
  // ...
}
