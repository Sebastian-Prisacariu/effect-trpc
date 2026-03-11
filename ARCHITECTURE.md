# effect-trpc Architecture

## Design Philosophy

**Don't fight Effect RPC and Effect Atom — embrace them.**

Instead of reinventing RPC (like the old version did), we create a thin layer that:
1. Uses `@effect/rpc` for all RPC mechanics
2. Uses `@effect-atom/atom-react` for client state
3. Adds tRPC-like ergonomics on top

## The Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                    Shared (procedures.ts)                       │
│  RpcGroup + Rpc definitions — the single source of truth       │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
┌─────────────────────────┐           ┌─────────────────────────┐
│      Server Layer       │           │      Client Layer       │
│                         │           │                         │
│  RpcGroup.toLayer()     │           │  RpcClient + Atom       │
│  + Next.js handler      │           │  + React hooks          │
└─────────────────────────┘           └─────────────────────────┘
```

## Shared Layer (procedures.ts)

This is where you define your RPC contracts. We use Effect RPC directly:

```typescript
import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

// Define your schemas
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

// Define the RPC group — this is the contract
export class UserRpcs extends RpcGroup.make(
  Rpc.make("list", {
    success: Schema.Array(User),
  }),
  Rpc.make("byId", {
    success: User,
    error: Schema.String,
    payload: { id: Schema.String },
  }),
  Rpc.make("create", {
    success: User,
    payload: { name: Schema.String, email: Schema.String },
    // Custom metadata for cache invalidation
    // We'll add this via a wrapper
  }),
)
```

## Server Layer

Use `RpcGroup.toLayer()` to implement handlers:

```typescript
import { Layer, Effect } from "effect"
import { UserRpcs } from "./procedures"

export const UserRpcsLive = UserRpcs.toLayer(
  Effect.gen(function* () {
    const db = yield* Database
    
    return {
      list: () => db.query("SELECT * FROM users"),
      byId: ({ id }) => db.findById(id),
      create: ({ name, email }) => db.create({ name, email }),
    }
  })
).pipe(Layer.provide(DatabaseLive))
```

Next.js route handler:

```typescript
// app/api/rpc/route.ts
import { createRouteHandler } from "effect-trpc/server"

export const POST = createRouteHandler({
  rpcs: UserRpcs,
  handlers: UserRpcsLive,
})
```

## Client Layer

This is where we add tRPC-like ergonomics using Effect Atom:

```typescript
import { createClient } from "effect-trpc/client"
import { UserRpcs } from "./procedures"

// Create the client — this sets up atoms for each RPC
export const api = createClient(UserRpcs, {
  url: "/api/rpc",
  // Optional: define invalidation rules
  invalidates: {
    create: ["list"],
    update: ["list", "byId"],
    delete: ["list", "byId"],
  },
})
```

In components:

```tsx
function UserList() {
  const query = api.list.useQuery()
  
  // Result.builder pattern from effect-atom
  return Result.match(query.result, {
    onInitial: () => <Skeleton />,
    onWaiting: () => <Spinner />,
    onSuccess: (users) => (
      <ul>
        {users.map(user => <li key={user.id}>{user.name}</li>)}
      </ul>
    ),
    onFailure: (error) => <ErrorDisplay error={error} />,
  })
}
```

## Why This Works

1. **Effect RPC handles the hard stuff** — batching, streaming, serialization
2. **Effect Atom handles reactive state** — caching, derived state, cleanup
3. **We just glue them together** — thin wrapper, not a framework

## Key Types

```typescript
// What createClient returns for a query RPC
interface QueryApi<I, O, E> {
  // The underlying atom (for advanced use)
  atom: Atom.Atom<Result.Result<O, E>>
  
  // React hooks
  useQuery(input?: I): {
    result: Result.Result<O, E>
    refetch: () => void
  }
}

// What createClient returns for a mutation RPC
interface MutationApi<I, O, E> {
  // Execute the mutation
  mutate(input: I): Effect.Effect<O, E>
  
  // React hook
  useMutation(): {
    mutate: (input: I) => void
    mutateAsync: (input: I) => Promise<O>
    result: Result.Result<O, E>
    reset: () => void
  }
}
```

## Cache Invalidation

When a mutation completes, it can invalidate query atoms:

```typescript
const api = createClient(UserRpcs, {
  url: "/api/rpc",
  invalidates: {
    // When 'create' succeeds, refetch 'list'
    create: ["list"],
    // When 'delete' succeeds, refetch 'list' and clear 'byId' cache
    delete: ["list", "byId"],
  },
})
```

This triggers atom rebuilds, which re-run the queries.

## No Proxies

Unlike tRPC, we don't use JS Proxies. Instead:

1. `createClient` returns a typed object derived from the `RpcGroup`
2. Each RPC gets its own property with `useQuery`/`useMutation`
3. TypeScript infers everything from the schema

This is more explicit but also more predictable and debuggable.
