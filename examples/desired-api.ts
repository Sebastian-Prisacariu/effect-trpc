/**
 * effect-trpc — Type-safe RPC with Effect
 * 
 * This example demonstrates the full API surface.
 */

import { Schema, Effect, Layer, Duration } from "effect"
import { Procedure, Router, Client, Transport, Result, Server } from "effect-trpc"

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

// ═══════════════════════════════════════════════════════════════════════════
// 3. PROCEDURES
//
// Procedures define the shape of an RPC call: payload, success, and error types.
// Tags are assigned automatically when procedures are placed in a Router.
// ═══════════════════════════════════════════════════════════════════════════

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
})

const deleteUser = Procedure.mutation({
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
  error: NotFoundError,
  invalidates: ["users"],
})

const listContracts = Procedure.query({
  success: Schema.Array(Contract),
})

const getContract = Procedure.query({
  payload: Schema.Struct({ id: Schema.String }),
  success: Contract,
  error: NotFoundError,
})

const watchUsers = Procedure.stream({
  success: User,
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. ROUTER
//
// Only the root router needs a tag. Nested structures are plain objects.
// Each procedure's tag is derived from the root tag + its path in the tree.
// ═══════════════════════════════════════════════════════════════════════════

const appRouter = Router.make("@api", {
  users: {
    list: listUsers,       // → "@api/users/list"
    get: getUserById,      // → "@api/users/get"
    create: createUser,    // → "@api/users/create"
    delete: deleteUser,    // → "@api/users/delete"
    watch: watchUsers,     // → "@api/users/watch"
  },
  contracts: {
    public: {
      list: listContracts, // → "@api/contracts/public/list"
      get: getContract,    // → "@api/contracts/public/get"
    },
    private: {
      list: listContracts, // → "@api/contracts/private/list"
      get: getContract,    // → "@api/contracts/private/get"
    },
  },
  health: Procedure.query({ success: Schema.String }),
})

type AppRouter = typeof appRouter

// ═══════════════════════════════════════════════════════════════════════════
// 5. SERVER
//
// Handlers mirror the router structure. They receive decoded payloads
// and return Effects. Dependencies are provided via layers.
// ═══════════════════════════════════════════════════════════════════════════

// Example service for handlers to use
class Database extends Effect.Tag("Database")<Database, {
  getAllUsers: () => Effect.Effect<User[]>
  findUser: (id: string) => Effect.Effect<User | null>
}>() {}

const server = Server.make(appRouter, {
  users: {
    list: () => Effect.gen(function* () {
      const db = yield* Database
      return yield* db.getAllUsers()
    }),
    get: ({ id }) => Effect.gen(function* () {
      const db = yield* Database
      const user = yield* db.findUser(id)
      if (!user) return yield* Effect.fail(new NotFoundError({ entity: "User", id }))
      return user
    }),
    create: (input) => Effect.succeed(new User({ ...input, id: `new-${Date.now()}` })),
    delete: ({ id }) => Effect.succeed(undefined as void),
    watch: () => Effect.succeed(new User({ id: "1", name: "Streamed", email: "s@e.com" })),
  },
  contracts: {
    public: {
      list: () => Effect.succeed([]),
      get: ({ id }) => Effect.succeed(new Contract({ id, title: "Public", userId: "1" })),
    },
    private: {
      list: () => Effect.succeed([]),
      get: ({ id }) => Effect.succeed(new Contract({ id, title: "Private", userId: "1" })),
    },
  },
  health: () => Effect.succeed("OK"),
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. CLIENT
// ═══════════════════════════════════════════════════════════════════════════

const api = Client.make(appRouter)

// ═══════════════════════════════════════════════════════════════════════════
// 7. REACT PROVIDER
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
// 8. HOOKS
// ═══════════════════════════════════════════════════════════════════════════

function UserList() {
  const query = api.users.list.useQuery()
  
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
  const query = api.users.get.useQuery({ id })
  
  if (query.isLoading) return <div>Loading...</div>
  if (query.isError) return <div>User not found</div>
  
  return <div>{query.data?.name}</div>
}

function CreateUserForm() {
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
// 9. VANILLA CLIENT (imperative)
// ═══════════════════════════════════════════════════════════════════════════

const vanillaApi = api.provide(Transport.http("/api/trpc"))

// Effect-based
const program = vanillaApi.users.list.run

// Promise-based
async function fetchUsers() {
  const users = await vanillaApi.users.list.runPromise()
  return users
}

// Manual cache invalidation (strict path typing)
api.invalidate(["users"])        // Invalidates all user queries
api.invalidate(["users.list"])   // Invalidates only users.list

// ═══════════════════════════════════════════════════════════════════════════
// 10. SSR / SERVER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

async function UsersPage() {
  await vanillaApi.users.list.prefetch()
  return <UserList />
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. MOCK TRANSPORT
//
// Type-safe mock handlers for testing. Keyed by path (e.g., "users.list").
// ═══════════════════════════════════════════════════════════════════════════

const mockTransport = Transport.mock<AppRouter>({
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

function TestApp() {
  return (
    <api.Provider layer={mockTransport}>
      <UserList />
    </api.Provider>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. HIERARCHICAL INVALIDATION
//
// Invalidating a path invalidates all descendants.
// ═══════════════════════════════════════════════════════════════════════════

// Get all tags that would be invalidated for a path
const tags = Router.tagsToInvalidate(appRouter, "users")
// → ["@api/users", "@api/users/list", "@api/users/get", "@api/users/create", ...]
