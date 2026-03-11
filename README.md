# effect-trpc

tRPC-style ergonomics built on **Effect RPC** + **Effect Atom**.

No proxies. No magic. Just Effect.

## Why?

- **Effect RPC** handles batching, streaming, serialization
- **Effect Atom** handles reactive state, caching, invalidation
- **We just glue them together** — thin wrapper, not a framework

## Quick Start

### 1. Define Procedures (Shared)

```typescript
// procedures.ts
import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

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
  }),
) {}
```

### 2. Implement Handlers (Server)

```typescript
// server.ts
import { Effect, Layer } from "effect"
import { UserRpcs } from "./procedures"

export const UserRpcsLive = UserRpcs.toLayer(
  Effect.gen(function* () {
    const db = yield* Database
    
    return {
      list: () => db.query("SELECT * FROM users"),
      byId: ({ id }) => db.findById(id),
      create: (input) => db.create(input),
    }
  })
).pipe(Layer.provide(DatabaseLive))
```

### 3. Create Route Handler (Next.js)

```typescript
// app/api/rpc/route.ts
import { createRouteHandler } from "effect-trpc/server"
import { UserRpcs } from "./procedures"
import { UserRpcsLive } from "./server"

export const POST = createRouteHandler({
  rpcs: UserRpcs,
  handlers: UserRpcsLive,
})
```

### 4. Use in React

```typescript
// client.ts
import { createClient } from "effect-trpc/client"
import { UserRpcs } from "./procedures"

export const api = createClient(UserRpcs, {
  url: "/api/rpc",
  invalidates: {
    create: ["list"],  // Auto-refetch list after create
  },
})
```

```tsx
// components/UserList.tsx
import { api, Result } from "./client"

function UserList() {
  const query = api.list.useQuery()
  
  return Result.match(query.result, {
    onInitial: () => <Skeleton />,
    onWaiting: () => <Spinner />,
    onSuccess: (users) => (
      <ul>
        {users.map(user => <li key={user.id}>{user.name}</li>)}
      </ul>
    ),
    onFailure: (error) => <Error error={error} />,
  })
}

function CreateUser() {
  const mutation = api.create.useMutation()
  
  return (
    <form onSubmit={() => mutation.mutate({ name: "New", email: "new@example.com" })}>
      <button disabled={mutation.isLoading}>
        {mutation.isLoading ? "Creating..." : "Create"}
      </button>
    </form>
  )
}
```

## Key Features

### Type-Safe End-to-End

Schemas are shared between server and client. TypeScript knows everything.

### Result Pattern

Effect Atom's `Result` type handles all states:

```tsx
Result.match(query.result, {
  onInitial: () => /* not yet started */,
  onWaiting: () => /* loading */,
  onSuccess: (data) => /* got data */,
  onFailure: (error) => /* handle error */,
})
```

### Tagged Errors

Handle specific error types:

```tsx
if (Result.isFailure(query.result)) {
  const error = query.result.cause
  
  if (error instanceof NotFoundError) {
    return <NotFound id={error.entityId} />
  }
  
  return <GenericError error={error} />
}
```

### Auto Invalidation

Mutations can invalidate queries:

```typescript
const api = createClient(UserRpcs, {
  url: "/api/rpc",
  invalidates: {
    create: ["list"],
    update: ["list", "byId"],
    delete: ["list", "byId"],
  },
})
```

When `create` succeeds, `list` automatically refetches.

## Installation

```bash
pnpm add effect-trpc @effect/rpc @effect-atom/atom-react effect
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## License

MIT
