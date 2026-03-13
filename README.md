# effect-trpc

End-to-end typesafe APIs with **Effect**.

Built on [Effect RPC](https://github.com/Effect-TS/effect/tree/main/packages/rpc) patterns + [Effect Atom](https://github.com/Effect-TS/effect-atom) for reactive state.

## Features

- ✅ **Type-safe procedures** — Query, Mutation, Stream
- ✅ **Router composition** — Nested routes with path-based types
- ✅ **Middleware** — Authentication, authorization, logging
- ✅ **Transports** — HTTP, Loopback (testing)
- ✅ **Reactivity** — Path-based cache invalidation
- ✅ **React hooks** — Built on @effect-atom/atom-react
- ✅ **SSR support** — Dehydration/hydration utilities

## Installation

```bash
npm install effect-trpc effect @effect/schema
```

## Quick Start

### 1. Define your router

```typescript
import { Procedure, Router } from "effect-trpc"
import { Schema } from "effect"

// Define schemas
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
  email: Schema.String,
}) {}

// Define router
const appRouter = Router.make("@api", {
  users: {
    list: Procedure.query({ success: Schema.Array(User) }),
    get: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
    }),
    create: Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users"], // Auto-invalidate queries
    }),
  },
  health: Procedure.query({ success: Schema.String }),
})

export type AppRouter = typeof appRouter
```

### 2. Create server handlers

```typescript
import { Server } from "effect-trpc"
import { Effect } from "effect"

const handlers = {
  users: {
    list: () => Effect.succeed(users),
    get: ({ id }) => Effect.succeed(users.find(u => u.id === id)),
    create: (input) => Effect.succeed(createUser(input)),
  },
  health: () => Effect.succeed("OK"),
}

const server = Server.make(appRouter, handlers)

// For Next.js App Router
export const POST = Server.toFetchHandler(server, AppLive)
```

### 3. Use in React

```tsx
import { Client, Transport } from "effect-trpc"

const api = Client.make(appRouter)

function App() {
  return (
    <api.Provider layer={Transport.http("/api")}>
      <UserList />
    </api.Provider>
  )
}

function UserList() {
  const { data, isLoading, refetch } = api.users.list.useQuery()
  
  if (isLoading) return <div>Loading...</div>
  
  return (
    <ul>
      {data?.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

### 4. Vanilla JS (no React)

```typescript
import { Client, Transport, Effect } from "effect-trpc"

// Create bound client with transport
const api = Client.make(appRouter).provide(Transport.http("/api"))

// Run queries
const users = await api.users.list.runPromise()
const user = await api.users.get.runPromise({ id: "1" })

// Run mutations (auto-invalidates "users" queries)
const newUser = await api.users.create.runPromise({
  name: "Alice",
  email: "alice@example.com",
})
```

## Middleware

```typescript
import { Middleware, Server } from "effect-trpc"
import { Context, Effect } from "effect"

// Define what middleware provides
class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}

// Define middleware tag
class AuthMiddleware extends Middleware.Tag<AuthMiddleware>()("AuthMiddleware", {
  provides: CurrentUser,
  failure: UnauthorizedError,
}) {}

// Implement middleware
const AuthMiddlewareLive = Middleware.implement(AuthMiddleware, (request) =>
  Effect.gen(function* () {
    const token = request.headers.get("authorization")
    if (!token) return yield* Effect.fail(new UnauthorizedError({}))
    return yield* verifyToken(token)
  })
)

// Apply to server
const secureServer = server.pipe(Server.middleware(AuthMiddleware))
```

## Path-Based Invalidation

```typescript
// Mutation with invalidation
const createUser = Procedure.mutation({
  payload: CreateUserInput,
  success: User,
  invalidates: ["users"], // Invalidates users.list, users.get, etc.
})

// Hierarchical: invalidating "users" invalidates all descendants
// - users/list
// - users/get
// - users/permissions/edit
```

## API Reference

### Modules

| Module | Description |
|--------|-------------|
| `Procedure` | Define queries, mutations, streams |
| `Router` | Compose procedures into a router |
| `Server` | Handle requests, apply middleware |
| `Client` | Type-safe client with React hooks |
| `Transport` | HTTP, Loopback, Mock transports |
| `Middleware` | Cross-cutting concerns |
| `Reactivity` | Cache invalidation |
| `SSR` | Server-side rendering utilities |

### Type Helpers

```typescript
import type { 
  InferProcedurePayload,
  InferProcedureSuccess,
  InferProcedureError,
  InferRouterPaths,
  InferRouterProcedure,
} from "effect-trpc"

type Paths = InferRouterPaths<AppRouter>
// "users.list" | "users.get" | "users.create" | "health"

type UserPayload = InferProcedurePayload<typeof appRouter.users.get>
// { id: string }
```

## Status

- ✅ Core RPC (Procedure, Router, Server)
- ✅ HTTP Transport
- ✅ Middleware
- ✅ Path-based Reactivity
- ✅ React Integration
- ✅ SSR utilities
- 🚧 WebSocket Transport (planned)
- 🚧 Request Batching (planned)

## License

MIT
