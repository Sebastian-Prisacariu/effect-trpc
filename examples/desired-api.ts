/**
 * DESIRED API — What we want to be able to write.
 * 
 * This is the target. We'll build the implementation to make this work.
 */

import { Schema, Effect, Context, Layer, Duration } from "effect"
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
}) {}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROCEDURE DEFINITIONS
// 
// - Procedures define shape only (no tags)
// - Tags auto-derived when placed in Router
// - Mutations require `invalidates` array
// ═══════════════════════════════════════════════════════════════════════════

import { Procedure, Router, Client, Transport, Result } from "effect-trpc"

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
  invalidates: ["users"],
  optimistic: {
    target: "users.list",
    reducer: (users: readonly User[], input: CreateUserInput) => [
      ...users,
      new User({ ...input, id: `temp-${Date.now()}` }),
    ],
  },
})

const deleteUser = Procedure.mutation({
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: NotFoundError,
  invalidates: ["users"],
})

// ─── Contract Procedures ───

const listContracts = Procedure.query({
  success: Schema.Array(Contract),
})

const getContract = Procedure.query({
  payload: Schema.Struct({ id: Schema.String }),
  success: Contract,
  error: NotFoundError,
})

// ─── Stream Procedures ───

const watchUsers = Procedure.stream({
  success: User,
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. ROUTER DEFINITION
// 
// - Only the root router needs a tag
// - Nested structures are plain objects
// - Tags auto-derived from root tag + path
// ═══════════════════════════════════════════════════════════════════════════

const appRouter = Router.make("@api", {
  users: {
    list: listUsers,       // tag: "@api/users/list"
    get: getUserById,      // tag: "@api/users/get"
    create: createUser,    // tag: "@api/users/create"
    delete: deleteUser,    // tag: "@api/users/delete"
    watch: watchUsers,     // tag: "@api/users/watch"
  },
  contracts: {
    public: {
      list: listContracts, // tag: "@api/contracts/public/list"
      get: getContract,    // tag: "@api/contracts/public/get"
    },
    private: {
      list: listContracts, // tag: "@api/contracts/private/list"
      get: getContract,    // tag: "@api/contracts/private/get"
    },
  },
  health: Procedure.query({ success: Schema.String }), // tag: "@api/health"
})

type AppRouter = typeof appRouter

// ═══════════════════════════════════════════════════════════════════════════
// 5. CLIENT CREATION
// ═══════════════════════════════════════════════════════════════════════════

const api = Client.make<AppRouter>()

// ═══════════════════════════════════════════════════════════════════════════
// 6. PROVIDER & TRANSPORT SETUP (React)
// ═══════════════════════════════════════════════════════════════════════════

function App() {
  return (
    <api.Provider layer={Transport.http("/api/trpc", {
      batching: {
        enabled: true,
        window: Duration.millis(10),
        queries: true,
        mutations: false,
      },
    })}>
      <UserList />
    </api.Provider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. USING HOOKS IN COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function UserList() {
  // ─── Query Hook ───
  const query = api.users.list.useQuery()
  
  // Pattern matching on result
  return Result.match(query.result, {
    onInitial: () => <div>Loading...</div>,
    onSuccess: (r) => (
      <ul>
        {r.value.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    ),
    onFailure: () => <div>Error loading users</div>,
  })
}

function UserDetail({ id }: { id: string }) {
  // Query with payload
  const query = api.users.get.useQuery({ id })
  
  if (query.isLoading) return <div>Loading...</div>
  if (query.isError) return <div>User not found</div>
  
  return <div>{query.data?.name}</div>
}

function CreateUserForm() {
  // ─── Mutation Hook ───
  const mutation = api.users.create.useMutation({
    onSuccess: (user) => {
      console.log('Created user:', user.name)
    },
  })
  
  const handleSubmit = (data: { name: string; email: string }) => {
    mutation.mutate(new CreateUserInput(data))
  }
  
  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit({ name: 'Test', email: 'test@example.com' }) }}>
      <button type="submit" disabled={mutation.isLoading}>
        {mutation.isLoading ? 'Creating...' : 'Create User'}
      </button>
    </form>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. IMPERATIVE API (outside React)
// ═══════════════════════════════════════════════════════════════════════════

// Effect-based
const program = Effect.gen(function* () {
  const users = yield* api.users.list.run
  return users
})

// Promise-based
async function fetchUsers() {
  const users = await api.users.list.runPromise()
  return users
}

// Manual invalidation
function invalidateAllUsers() {
  api.invalidate(["users"])
}

function invalidateSpecificQuery() {
  api.invalidate(["users.list"])
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. SSR / SERVER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

// In Server Component
async function UsersPage() {
  // Prefetch on server
  await api.users.list.prefetchPromise()
  
  // Data is now in cache
  return <UserList />  // No loading state - data already available
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. TYPED MOCK TRANSPORT (for testing)
// ═══════════════════════════════════════════════════════════════════════════

const mockTransport = Transport.make<AppRouter>({
  "users.list": () => Effect.succeed([
    new User({ id: "1", name: "Mock User", email: "mock@example.com" }),
  ]),
  "users.get": ({ id }) => 
    id === "not-found"
      ? Effect.fail(new NotFoundError({ entity: "User", id }))
      : Effect.succeed(new User({ id, name: `User ${id}`, email: `${id}@example.com` })),
  "users.create": (input) => 
    Effect.succeed(new User({ id: "new-1", ...input })),
  "users.delete": () => Effect.void,
  "users.watch": () => Effect.succeed(new User({ id: "1", name: "Watched", email: "w@e.com" })),
  "contracts.public.list": () => Effect.succeed([]),
  "contracts.public.get": ({ id }) => 
    Effect.succeed(new Contract({ id, title: "Contract", userId: "1" })),
  "contracts.private.list": () => Effect.succeed([]),
  "contracts.private.get": ({ id }) => 
    Effect.succeed(new Contract({ id, title: "Private Contract", userId: "1" })),
  "health": () => Effect.succeed("OK"),
})

// Use in tests
function TestApp() {
  return (
    <api.Provider layer={mockTransport}>
      <UserList />
    </api.Provider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. PATH → TAG MAPPING (internal, for Reactivity)
// ═══════════════════════════════════════════════════════════════════════════

// User-facing API uses paths:
// api.users.list.useQuery()
// api.invalidate(["users"])

// Internally, paths map to tags for Reactivity:
// "users.list" → "@api/users/list"
// "users" → "@api/users" (and all children)

// The Router handles this mapping:
const tags = Router.tagsToInvalidate(appRouter, "users")
// → ["@api/users", "@api/users/list", "@api/users/get", "@api/users/create", ...]
