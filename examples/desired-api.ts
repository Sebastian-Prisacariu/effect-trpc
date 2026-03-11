/**
 * DESIRED API — What we want to be able to write.
 * 
 * This is the target. We'll build the implementation to make this work.
 */

import { Schema, Effect, Context, Layer } from "effect"
import { Headers } from "@effect/platform"

// Helper for client-side token storage
declare const getStoredToken: () => Effect.Effect<string>

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
})

// ═══════════════════════════════════════════════════════════════════════════
// 2b. MIDDLEWARE
// 
// Re-exported from Effect RPC — defines what middleware provides/fails with
// ═══════════════════════════════════════════════════════════════════════════

// What the auth middleware provides
class CurrentUser extends Context.Tag("CurrentUser")<
  CurrentUser,
  User
>() {}

// The middleware tag
class Auth extends Middleware.Tag<Auth>()("Auth", {
  provides: CurrentUser,
  failure: UnauthorizedError,
  requiredForClient: true,
}) {}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROCEDURE DEFINITIONS (Contracts)
// 
// Using success/error/payload to match Effect RPC conventions
// ═══════════════════════════════════════════════════════════════════════════

import { Procedure, Router, Middleware } from "effect-trpc"

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
  optimistic: {
    target: "user.list",
    // Immediately apply (before server responds)
    reducer: (users, input) => [...users, { ...input, id: `temp-${Date.now()}` } as User],
    // Optional: merge server response (use if no invalidates, or for surgical updates)
    // reconcile: (users, input, result) => users.map(u => u.id.startsWith("temp") ? result : u),
  },
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
}).middleware(Auth)  // All procedures require auth, can access CurrentUser

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
      const currentUser = yield* CurrentUser  // Available from Auth middleware!
      const repo = yield* UserRepository
      console.log(`User ${currentUser.name} is listing users`)
      return yield* repo.findAll()
    }),

  byId: ({ id }) =>
    Effect.gen(function* () {
      const currentUser = yield* CurrentUser
      const repo = yield* UserRepository
      return yield* repo.findById(id)
    }),

  create: (input) =>
    Effect.gen(function* () {
      const currentUser = yield* CurrentUser
      const repo = yield* UserRepository
      return yield* repo.create(input)
    }),

  delete: ({ id }) =>
    Effect.gen(function* () {
      const currentUser = yield* CurrentUser
      const repo = yield* UserRepository
      yield* repo.delete(id)
    }),
})
// Type: Layer<UserProcedures.Service, never, UserRepository>
// Note: CurrentUser is provided by Auth middleware, not a requirement here

// 5c. Create the actual repository implementation (Live layer)
export const UserRepositoryLive = Layer.succeed(UserRepository, {
  findAll: () => Effect.succeed([]),
  findById: (id) => Effect.fail(new NotFoundError({ entity: "User", id })),
  create: (input) => Effect.succeed(new User({ id: "1", ...input })),
  delete: (_id) => Effect.succeed(undefined),
})

// 5d. Implement the auth middleware
export const AuthLive = Layer.succeed(Auth,
  Auth.of(({ headers }) =>
    Effect.gen(function* () {
      const token = headers.get("authorization")
      if (!token) {
        return yield* Effect.fail(new UnauthorizedError({ message: "No token" }))
      }
      // In reality: verify JWT, lookup user, etc.
      return new User({ id: "123", name: "Authenticated User", email: "auth@example.com" })
    })
  )
)

// 5e. Client-side middleware (adds auth header to requests)
export const AuthClientLive = Middleware.layerClient(Auth, ({ request, rpc }) =>
  Effect.gen(function* () {
    const token = yield* getStoredToken()  // Get from localStorage, etc.
    return {
      ...request,
      headers: Headers.set(request.headers, "authorization", `Bearer ${token}`)
    }
  })
)

// ═══════════════════════════════════════════════════════════════════════════
// 6. ROUTE HANDLER (Next.js)
// ═══════════════════════════════════════════════════════════════════════════

import { createRouteHandler } from "effect-trpc/server"

const FullLive = UserProceduresLive.pipe(
  Layer.provide(UserRepositoryLive),
  Layer.provide(AuthLive),
)

export const { POST } = createRouteHandler({
  router: appRouter,
  handlers: FullLive,
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. CLIENT (React)
// ═══════════════════════════════════════════════════════════════════════════

import { createClient, Result, isTransientError } from "effect-trpc/client"
import { Duration, Schedule } from "effect"

export const api = createClient<AppRouter>({
  url: "/api/trpc",
  defaults: {
    // Cache behavior
    idleTTL: Duration.minutes(5),           // Keep cached 5 min after unmount
    staleTime: Duration.minutes(1),         // Consider fresh for 1 min
    keepAlive: false,                       // Don't keep forever by default
    
    // Revalidation triggers
    refetchOnWindowFocus: true,             // Refetch when tab regains focus
    refetchOnReconnect: true,               // Refetch when back online
    refetchInterval: undefined,             // No polling by default
    
    // Client retry — ONLY for transient/network errors
    retry: {
      schedule: Schedule.exponential(Duration.seconds(1)).pipe(
        Schedule.compose(Schedule.recurs(3))
      ),
      when: isTransientError,  // Don't retry typed business errors
    },
  },
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
        // 1. Optimistic: user.list updates IMMEDIATELY with temp user
        // 2. Mutation runs in background
        // 3. On success: invalidates user.list, refetch replaces temp with real
        // 4. On failure: optimistic update rolls back
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

// ─── Query Options ───

function ActiveUsersDashboard() {
  // Override defaults for this query
  const query = api.user.list.useQuery({
    staleTime: Duration.seconds(30),        // Shorter stale time
    idleTTL: Duration.minutes(10),          // Keep longer in cache
    refetchOnWindowFocus: true,
  })

  return <UserTable users={query.data ?? []} />
}

function RealtimeUserList() {
  // Polling with Duration
  const query = api.user.list.useQuery({
    refetchInterval: Duration.seconds(10),  // Simple polling
  })

  return <UserTable users={query.data ?? []} />
}

function SmartPollingUserList() {
  // Polling with Schedule (advanced control)
  const query = api.user.list.useQuery({
    refetchInterval: Schedule.spaced(Duration.seconds(10)).pipe(
      // Only poll when tab is visible
      Schedule.whileOutput(() => document.visibilityState === "visible")
    ),
  })

  return <UserTable users={query.data ?? []} />
}

function CriticalDataDisplay() {
  // Aggressive retry for critical data
  const query = api.user.list.useQuery({
    keepAlive: true,  // Never garbage collect
    retry: {
      schedule: Schedule.exponential(Duration.millis(500)).pipe(
        Schedule.compose(Schedule.recurs(5))  // 5 retries
      ),
      when: isTransientError,
    },
  })

  return <UserTable users={query.data ?? []} />
}

function UserListWithRefresh() {
  const query = api.user.list.useQuery()
  const refresh = api.user.list.useRefresh()  // Manual refresh hook

  return (
    <div>
      <button onClick={() => refresh()}>Refresh</button>
      {/* Or use query.refresh() directly */}
      <button onClick={() => query.refresh()}>Refresh (alt)</button>
      <UserTable users={query.data ?? []} />
    </div>
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
