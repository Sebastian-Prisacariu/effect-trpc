# effect-trpc

tRPC-style ergonomics for Effect-based applications, powered by Effect RPC and Effect Atom.

## Features

- 🎯 **tRPC-like API** — Familiar procedure builder pattern
- ⚡ **Effect RPC** — Type-safe RPC under the hood
- 🔄 **Effect Atom** — Reactive client-side caching
- 🎭 **Interface-First** — Define contracts, implement later
- 🧹 **Auto Invalidation** — Declare what mutations invalidate

## Quick Start

### 1. Define Procedures (Contracts Only)

```typescript
import { procedure, procedures } from 'effect-trpc'
import * as Schema from 'effect/Schema'

// Define your schemas
const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

const CreateUserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
})

// Define procedures — just contracts, no implementation
export const UserProcedures = procedures('user', {
  list: procedure
    .output(Schema.Array(UserSchema))
    .query(),
    
  byId: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(UserSchema)
    .query(),
    
  create: procedure
    .input(CreateUserSchema)
    .output(UserSchema)
    .invalidates(['user.list'])  // Auto cache invalidation
    .mutation(),
    
  delete: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(Schema.Void)
    .invalidates(['user.list', 'user.byId'])
    .mutation(),
})
```

### 2. Create Router

```typescript
import { Router } from 'effect-trpc'

export const appRouter = Router.make({
  user: UserProcedures,
  post: PostProcedures,
})

// Export type for client
export type AppRouter = typeof appRouter
```

### 3. Implement Handlers (Live Layer)

```typescript
import { Layer, Effect } from 'effect'

// Implementation is a Layer
export const UserProceduresLive = UserProcedures.implement({
  list: () => 
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.query('SELECT * FROM users')
    }),
    
  byId: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.queryOne('SELECT * FROM users WHERE id = ?', [id])
    }),
    
  create: (input) =>
    Effect.gen(function* () {
      const db = yield* Database
      return yield* db.insert('users', input)
    }),
    
  delete: ({ id }) =>
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.delete('users', id)
    }),
})
```

### 4. Create Route Handler (Next.js)

```typescript
// app/api/trpc/[...trpc]/route.ts
import { createRouteHandler } from 'effect-trpc/next'

export const { GET, POST } = createRouteHandler({
  router: appRouter,
  handlers: Layer.mergeAll(
    UserProceduresLive,
    PostProceduresLive,
  ),
})
```

### 5. Use on Client (React)

```typescript
import { createClient } from 'effect-trpc/react'
import type { AppRouter } from './server'

const trpc = createClient<AppRouter>({
  url: '/api/trpc',
})

// In component
function UserList() {
  const users = trpc.user.list.useQuery()
  const createUser = trpc.user.create.useMutation()
  
  // Mutations auto-invalidate based on procedure definition
  const handleCreate = () => {
    createUser.mutate({ name: 'New User', email: 'new@example.com' })
    // user.list automatically refetches!
  }
  
  return (
    <div>
      {users.data?.map(user => <div key={user.id}>{user.name}</div>)}
      <button onClick={handleCreate}>Add User</button>
    </div>
  )
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Procedures                               │
│  (Contracts: input/output schemas, invalidation rules)          │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
      │ Live Layer  │  │ Test Layer  │  │ Mock Layer  │
      │ (Postgres)  │  │ (In-Memory) │  │ (Fixtures)  │
      └─────────────┘  └─────────────┘  └─────────────┘
              │
              ▼
      ┌─────────────────────────────────────────────────┐
      │              Effect RPC Server                   │
      │  (HTTP handler, batching, streaming)            │
      └─────────────────────────────────────────────────┘
              │
              ▼
      ┌─────────────────────────────────────────────────┐
      │              Effect RPC Client                   │
      │  (Type-safe calls, automatic batching)          │
      └─────────────────────────────────────────────────┘
              │
              ▼
      ┌─────────────────────────────────────────────────┐
      │              Effect Atom Cache                   │
      │  (Reactive state, auto-invalidation)            │
      └─────────────────────────────────────────────────┘
              │
              ▼
      ┌─────────────────────────────────────────────────┐
      │              React Hooks                         │
      │  (useQuery, useMutation, useSubscription)       │
      └─────────────────────────────────────────────────┘
```

## Why Effect RPC + Effect Atom?

- **Effect RPC**: Battle-tested, type-safe RPC with batching and streaming
- **Effect Atom**: Reactive state management that integrates perfectly with Effect
- **No reinventing**: We compose existing Effect ecosystem, not replace it

## License

MIT
