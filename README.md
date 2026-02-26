# effect-trpc

tRPC-style ergonomics for Effect-based applications.

[![npm version](https://badge.fury.io/js/effect-trpc.svg)](https://www.npmjs.com/package/effect-trpc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [!CAUTION]
> **🚧 EXPERIMENTAL — NOT FOR PRODUCTION USE 🚧**
>
> This library is in active development and the API **will change without notice**.
> It is published for early feedback and experimentation only.
>
> - Breaking changes may occur in any release
> - Some features are incomplete or untested in production
> - Documentation may be outdated or incomplete
>
> **Do not use in production applications.**

## Overview

`effect-trpc` brings tRPC-style developer experience to Effect applications by wrapping `@effect/rpc` with:

- A familiar **builder API** for defining procedures
- Type-safe **React hooks** for queries, mutations, and streaming
- **Next.js integration** with App Router support
- **Middleware system** for authentication, rate limiting, and more
- **Rich error types** with `isRetryable` and `httpStatus`

## Why effect-trpc?

- **Full Effect integration** - Your handlers return `Effect`, errors are typed, services are composable
- **tRPC ergonomics** - Familiar `.input().output().query()` builder pattern
- **Type safety** - End-to-end types from server to client with no code generation
- **Streaming first** - Native support for streams and AI chat completions
- **Effect-first API** - `mutate()` returns Effect, `mutateAsync()` for Promise escape hatch

## Installation

```bash
pnpm add effect-trpc effect @effect/rpc @effect/platform @effect/schema
```

## Quick Start

### 1. Define Procedures

```typescript
// src/server/procedures/user.ts
import { procedures, procedure } from 'effect-trpc'
import * as Schema from 'effect/Schema'
import * as Effect from 'effect/Effect'

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

// Define procedures
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
    .invalidates(['user.list'])  // Automatic cache invalidation
    .mutation(),
})

// Implement handlers
export const UserProceduresLive = UserProcedures.toLayer({
  list: () => 
    Effect.succeed([
      { id: '1', name: 'Alice', email: 'alice@example.com' }
    ]),
    
  byId: ({ id }) => 
    Effect.succeed({ id, name: 'Test User', email: 'test@example.com' }),
    
  create: ({ name, email }) =>
    Effect.succeed({ id: crypto.randomUUID(), name, email }),
})
```

### 2. Create Router

```typescript
// src/server/router.ts
import { Router } from 'effect-trpc'
import { UserProcedures, UserProceduresLive } from './procedures/user'
import { PostProcedures, PostProceduresLive } from './procedures/post'

export const appRouter = Router.make({
  user: UserProcedures,
  post: PostProcedures,
})

// Export type for client
export type AppRouter = typeof appRouter
```

### 3. Create Next.js Handler

```typescript
// src/app/api/trpc/[...trpc]/route.ts
import { createRouteHandler } from 'effect-trpc/next'
import * as Layer from 'effect/Layer'
import { appRouter } from '~/server/router'
import { UserProceduresLive } from '~/server/procedures/user'
import { PostProceduresLive } from '~/server/procedures/post'

const handler = createRouteHandler({
  router: appRouter,
  handlers: Layer.mergeAll(
    UserProceduresLive,
    PostProceduresLive,
  ),
})

export { handler as GET, handler as POST }
```

### 4. Create React Client

```typescript
// src/lib/trpc.ts
import { createTRPCReact } from 'effect-trpc/react'
import type { AppRouter } from '~/server/router'

export const api = createTRPCReact<AppRouter>({
  url: '/api/trpc',
})
```

### 5. Add Provider

```typescript
// src/app/providers.tsx
'use client'

import { api } from '~/lib/trpc'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <api.Provider>
      {children}
    </api.Provider>
  )
}
```

### 6. Use in Components

```typescript
// src/components/UserList.tsx
'use client'

import { api } from '~/lib/trpc'
import { Result } from 'effect-trpc/react'

export function UserList() {
  const query = api.user.list.useQuery()

  // Option 1: tRPC-style destructuring
  const { data, isLoading, error } = query
  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  return <ul>{data?.map(user => <li key={user.id}>{user.name}</li>)}</ul>

  // Option 2: Result.builder pattern (recommended for complex UI)
  return Result.builder(query.result)
    .onInitial(() => <Skeleton />)
    .onWaiting(() => <Spinner />)
    .onSuccess((users) => (
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    ))
    .onErrorTag('NotFoundError', () => <NotFound />)
    .onErrorTag('UnauthorizedError', () => <LoginPrompt />)
    .onError((error) => <ErrorDisplay error={error} />)
    .render()
}
```

## Procedure Types

### Query

For data fetching. Cached by default.

```typescript
const UserProcedures = procedures('user', {
  list: procedure
    .output(Schema.Array(UserSchema))
    .query(),
    
  byId: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(UserSchema)
    .query(),
})

// Client usage
const users = api.user.list.useQuery()
const user = api.user.byId.useQuery({ id: '123' })
```

### Mutation

For data modifications. Not cached.

```typescript
const UserProcedures = procedures('user', {
  create: procedure
    .input(CreateUserSchema)
    .output(UserSchema)
    .invalidates(['user.list'])
    .mutation(),
    
  delete: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .mutation(),
})

// Client usage
const createUser = api.user.create.useMutation()

// Effect-first (preferred)
const handleCreate = Effect.gen(function* () {
  const user = yield* createUser.mutate({ name: 'Alice', email: 'alice@example.com' })
  console.log('Created:', user)
})

// Promise escape hatch (returns Exit, never throws)
const handleCreateAsync = async () => {
  const result = await createUser.mutateAsync({ name: 'Alice', email: 'alice@example.com' })
  
  if (Exit.isSuccess(result)) {
    console.log('Created:', result.value)
  } else {
    console.log('Failed:', Cause.squash(result.cause))
  }
}
```

### Optimistic Updates

Update the UI immediately before the server responds, with automatic rollback on error:

```typescript
const createUser = api.user.create.useMutation({
  // Called before mutation - return previous data for rollback
  onMutate: async (newUser, ctx) => {
    // Cancel any in-flight queries to prevent race conditions
    ctx.cancelQueries('user.list')

    // Snapshot current data
    const previousUsers = ctx.getQueryData<User[]>('user.list')

    // Optimistically update the cache
    if (previousUsers) {
      ctx.setQueryData('user.list', undefined, [
        ...previousUsers,
        { id: 'temp-' + Date.now(), ...newUser }
      ])
    }

    // Return context for rollback
    return { previousData: previousUsers }
  },

  // Rollback on error
  onError: (error, input, context) => {
    if (context?.previousData) {
      // Note: need to access ctx from useMutation's scope
      // or use onSettled to always refetch
    }
  },

  // Always refetch after mutation settles
  onSettled: () => {
    // Queries will be invalidated automatically via `invalidates`
  },

  // Declarative invalidation
  invalidates: ['user.list'],
})
```

The `OptimisticUpdateContext` provides:
- `getQueryData<T>(path, input?)` - Get cached data for a query
- `setQueryData<T>(path, input, data)` - Set cached data optimistically  
- `cancelQueries(path)` - Cancel in-flight queries to prevent race conditions

### Stream

For server-sent events and real-time data over HTTP.

```typescript
const NotificationProcedures = procedures('notifications', {
  watch: procedure
    .input(Schema.Struct({ userId: Schema.String }))
    .output(NotificationSchema)  // Schema for each streamed item
    .stream(),
})

// Server implementation returns a Stream
const NotificationProceduresLive = NotificationProcedures.toLayer({
  watch: ({ userId }) =>
    Stream.fromEffect(Database).pipe(
      Stream.flatMap(db => db.notifications.subscribe(userId))
    ),
})

// Client usage
const notifications = api.notifications.watch.useStream({ userId: '123' })

// notifications.data is the latest streamed value
// notifications.isStreaming indicates if stream is active
```

### Subscription (WebSocket)

For real-time bidirectional communication over WebSocket. Unlike streams (HTTP SSE), subscriptions support:
- Multiple subscriptions over a single connection
- Bidirectional communication (client can send data after subscribing)
- Automatic reconnection
- Authentication

```typescript
// Define subscription procedure
const ChatProcedures = procedures('chat', {
  room: procedure
    .input(Schema.Struct({ roomId: Schema.String }))
    .output(ChatMessageSchema)  // Schema for each message
    .subscription(),
})

// Server implementation
const ChatProceduresLive = ChatProcedures.toLayer({
  room: ({ roomId }) => ({
    // Called when client subscribes
    onSubscribe: (context) =>
      Effect.gen(function* () {
        const messages = yield* MessageStream.forRoom(roomId)
        return messages  // Return a Stream
      }),
    
    // Optional: handle data sent by client
    onClientMessage: (data, context) =>
      Effect.gen(function* () {
        // Process data from client (e.g., typing indicators)
      }),
  }),
})
```

#### Server Setup (Node.js)

```typescript
import { createHandler, createWebSocketHandler } from 'effect-trpc/node'
import { WebSocketServer } from 'ws'
import * as http from 'node:http'

// Create HTTP handler for queries/mutations
const httpHandler = createHandler({
  router: appRouter,
  handlers: AppHandlersLive,
})

// Create WebSocket handler for subscriptions
const wsHandler = createWebSocketHandler({
  router: appRouter,
  auth: {
    authenticate: (token) =>
      Effect.gen(function* () {
        const user = yield* verifyJwt(token)
        return { userId: user.id }
      }),
  },
})

// HTTP server
const server = http.createServer(async (req, res) => {
  const request = await nodeToWebRequest(req)
  const response = await httpHandler.fetch(request)
  await webToNodeResponse(response, res)
})

// WebSocket server
const wss = new WebSocketServer({ server })
wss.on('connection', (ws) => {
  Effect.runFork(wsHandler.handleConnection(ws))
})

server.listen(3000)

// Cleanup
process.on('SIGINT', async () => {
  await wsHandler.dispose()
  await httpHandler.dispose()
  server.close()
})
```

#### Server Setup (Bun)

```typescript
import { createFetchHandler, createWebSocketHandler } from 'effect-trpc/bun'

const httpHandler = createFetchHandler({
  router: appRouter,
  handlers: AppHandlersLive,
})

const wsHandler = createWebSocketHandler({
  router: appRouter,
  auth: {
    authenticate: (token) =>
      Effect.gen(function* () {
        const user = yield* verifyJwt(token)
        return { userId: user.id }
      }),
  },
})

Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url)
    
    // Upgrade WebSocket connections
    if (url.pathname === '/ws') {
      if (server.upgrade(req, { data: { authenticated: false } })) {
        return  // Upgrade successful
      }
      return new Response('Upgrade failed', { status: 500 })
    }
    
    // Handle HTTP requests
    return httpHandler.fetch(req)
  },
  websocket: wsHandler.websocket,
})

// Cleanup
process.on('SIGINT', async () => {
  await wsHandler.dispose()
  await httpHandler.dispose()
})
```

#### Client Usage (React)

```typescript
// src/lib/trpc.ts
import { createTRPCReact, WebSocketProvider } from 'effect-trpc/react'
import type { AppRouter } from '~/server/router'

export const api = createTRPCReact<AppRouter>({
  url: '/api/trpc',
  wsUrl: 'ws://localhost:3000/ws',
})
```

```tsx
// src/app/providers.tsx
'use client'

import { api, WebSocketProvider } from '~/lib/trpc'
import * as Effect from 'effect/Effect'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <api.Provider>
      <WebSocketProvider 
        config={{
          url: "ws://localhost:3000/ws",
          getToken: Effect.succeed(getAuthToken()),
        }}
      >
        {children}
      </WebSocketProvider>
    </api.Provider>
  )
}
```

```tsx
// src/components/ChatRoom.tsx
'use client'

import { api } from '~/lib/trpc'

export function ChatRoom({ roomId }: { roomId: string }) {
  const subscription = api.chat.room.useSubscription(
    { roomId },
    {
      onData: (message) => {
        console.log('New message:', message)
      },
      onError: (error) => {
        console.error('Subscription error:', error)
      },
    }
  )

  return (
    <div>
      <div>Status: {subscription.state._tag}</div>
      <div>Latest: {subscription.data?.content}</div>
      <button onClick={() => subscription.unsubscribe()}>
        Leave Room
      </button>
    </div>
  )
}
```

#### Subscription States

```typescript
subscription.state._tag     // 'Idle' | 'Subscribing' | 'Active' | 'Error' | 'Complete' | 'Unsubscribed'
subscription.connectionState._tag // 'Disconnected' | 'Connecting' | 'Authenticating' | 'Ready' | 'Reconnecting' | 'Error'
subscription.data           // Latest received data
subscription.error          // Error if state is 'Error'
subscription.resubscribe()  // Start/restart subscription
subscription.unsubscribe()  // Stop subscription
```

### Chat

For AI completions with `@effect/ai` compatibility.

```typescript
const AIProcedures = procedures('ai', {
  complete: procedure
    .input(Schema.Struct({ 
      messages: Schema.Array(MessageSchema) 
    }))
    .output(ChatPartSchema)  // Schema for each streamed part
    .chat(),
})

// Client usage
const chat = api.ai.complete.useChat({
  onPart: (part) => console.log('Received part:', part),
  onFinish: (fullText) => console.log('Complete:', fullText),
})

// Send a message
chat.send({ messages: [{ role: 'user', content: 'Hello!' }] })

// Access state
chat.text       // Accumulated text
chat.parts      // Array of all parts
chat.isStreaming // Whether currently streaming
```

## Middleware

Add cross-cutting concerns like authentication, logging, and rate limiting.

### Creating Middleware

```typescript
import { Middleware } from 'effect-trpc'
import type { BaseContext, AuthenticatedContext } from 'effect-trpc'

const authMiddleware = Middleware.make<BaseContext, AuthenticatedContext<User>, AuthError, never>(
  'auth',
  (ctx, next) =>
    Effect.gen(function* () {
      const token = ctx.headers.get('authorization')
      if (!token) {
        return yield* Effect.fail(new AuthError({
          procedure: ctx.procedure,
          reason: 'No authorization header',
        }))
      }

      const user = yield* verifyToken(token.replace('Bearer ', ''))
      
      // Call next with enhanced context
      return yield* next({ ...ctx, user })
    })
)
```

### Applying to Procedures

```typescript
const UserProcedures = procedures('user', {
  // Public endpoint
  byId: procedure
    .input(IdSchema)
    .output(UserSchema)
    .query(),

  // Protected endpoint
  update: procedure
    .use(authMiddleware)
    .input(UpdateUserSchema)
    .output(UserSchema)
    .mutation(),

  // Multiple middleware (executed in order)
  delete: procedure
    .use(authMiddleware)
    .use(requirePermission('user:delete'))
    .input(IdSchema)
    .mutation(),
})
```

### Built-in Middleware

```typescript
import {
  loggingMiddleware,    // Logs request/response
  timingMiddleware,     // Adds timing info to context
  rateLimitMiddleware,  // Rate limiting
  authMiddleware,       // Token verification
  requirePermission,    // Permission checking
} from 'effect-trpc'

// Rate limiting
const rateLimit = rateLimitMiddleware({
  maxRequests: 100,
  windowMs: 60_000,  // 1 minute
  keyFn: (ctx) => ctx.headers.get('x-forwarded-for') ?? 'anonymous',
})
```

### Middleware Context

```typescript
interface BaseContext {
  procedure: string      // Full procedure path, e.g., "user.create"
  headers: Headers       // Standard web Headers
  signal: AbortSignal    // Aborted on Effect fiber interruption
  clientId: number       // Unique client ID from @effect/rpc
}

// Middleware can extend the context
interface AuthenticatedContext<TUser> extends BaseContext {
  user: TUser
}
```

## Error Handling

effect-trpc provides rich error types with metadata for proper HTTP responses and retry logic.

### Built-in Errors

```typescript
import {
  InputValidationError,   // 400 - Invalid input
  OutputValidationError,  // 500 - Server returned invalid data
  NotFoundError,          // 404 - Resource not found
  UnauthorizedError,      // 401 - Authentication required
  ForbiddenError,         // 403 - Access denied
  RateLimitedError,       // 429 - Rate limit exceeded (retryable)
  TimeoutError,           // 504 - Request timed out (retryable)
  InternalError,          // 500 - Unexpected error
  NetworkError,           // Client-side network error (retryable)
} from 'effect-trpc'
```

### Using in Handlers

```typescript
const UserProceduresLive = UserProcedures.toLayer({
  byId: ({ id }) =>
    Effect.gen(function* () {
      const user = yield* db.users.findUnique({ where: { id } })
      
      if (!user) {
        return yield* Effect.fail(new NotFoundError({
          procedure: 'user.byId',
          resource: 'User',
          resourceId: id,
        }))
      }
      
      return user
    }),
})
```

### Handling on Client

Use the `Result.builder` pattern for type-safe error handling by tag:

```typescript
const query = api.user.byId.useQuery({ id: '123' })

// The builder pattern lets you handle errors by their _tag
return Result.builder(query.result)
  .onInitial(() => <Skeleton />)
  .onWaiting(() => <Spinner />)
  .onSuccess((user) => <UserProfile user={user} />)
  .onErrorTag('NotFoundError', (err) => <NotFound resource={err.resource} />)
  .onErrorTag('ForbiddenError', () => <AccessDenied />)
  .onErrorTag('RateLimitError', (err) => (
    <RetryButton 
      onClick={() => query.refetch()} 
      retryAfter={err.retryAfterMs} 
    />
  ))
  .onError((error) => <GenericError error={error} />)
  .render()
```

Or use `Result.match` for simpler cases:

```typescript
return Result.match(query.result, {
  onInitial: () => <Skeleton />,
  onSuccess: (user) => <UserProfile user={user.value} />,
  onFailure: (failure) => <ErrorDisplay error={failure.cause} />,
})
```

## Cache Invalidation

### Declarative (on Procedure Definition)

Define invalidation rules on your procedures:

```typescript
// Server: src/server/procedures/user.ts
const UserProcedures = procedures('user', {
  create: procedure
    .input(CreateUserSchema)
    .invalidates(['user.list'])        // Invalidate specific queries
    .invalidatesTags(['users'])        // Or by tag
    .mutation(),
})
```

To use declarative invalidation on the client, extract metadata from your router:

```typescript
// Server: src/server/router.ts
import { Router, extractMetadata } from 'effect-trpc'

export const appRouter = Router.make({
  user: UserProcedures,
  post: PostProcedures,
})

// Export metadata for client
export const routerMetadata = extractMetadata(appRouter)
```

```typescript
// Client: src/lib/trpc.ts
import { createTRPCReact } from 'effect-trpc/react'
import type { AppRouter } from '~/server/router'
import { routerMetadata } from '~/server/router'

export const api = createTRPCReact<AppRouter>({
  metadata: routerMetadata,  // Enables declarative invalidation
})
```

Now when `user.create` succeeds, `user.list` queries are automatically invalidated!

### Manual (on Client)

```typescript
// Invalidate specific query
api.user.list.invalidate()
api.user.byId.invalidate({ id: '123' })

// Invalidate all queries in a namespace
api.user.invalidateAll()

// Invalidate everything
api.invalidateAll()
```

### At Mutation Time

```typescript
// Override or add to declarative invalidations
await createUser.mutateAsync(
  { name: 'Alice' },
  { invalidates: ['user.list', 'stats.userCount'] }
)
```

## React Hooks

### useQuery

```typescript
const query = api.user.list.useQuery()
const query = api.user.byId.useQuery({ id: '123' })

// tRPC-style properties:
query.data         // The data (when successful)
query.error        // The error (when failed)
query.isLoading    // Loading (initial or refetching)
query.isSuccess    // Has data
query.isError      // Has error
query.isRefetching // Has data and refetching
query.refetch()    // Manually refetch

// effect-atom Result (for builder pattern):
query.result       // Result.Result<A, E> from @effect-atom/atom

// Use the Result builder for complex UI:
Result.builder(query.result)
  .onInitial(() => <Skeleton />)
  .onWaiting(() => <Spinner />)
  .onSuccess((data) => <Display data={data} />)
  .onError((e) => <Error error={e} />)
  .render()
```

### useMutation

```typescript
const mutation = api.user.create.useMutation()

// tRPC-style properties:
mutation.data       // Last successful result
mutation.error      // Last error
mutation.isPending  // Currently executing
mutation.isSuccess  // Last call succeeded
mutation.isError    // Last call failed
mutation.isIdle     // Never been called
mutation.reset()    // Reset state

// effect-atom Result (for builder pattern):
mutation.result     // Result.Result<A, E> from @effect-atom/atom

// Effect-first (returns Effect)
const effect = mutation.mutate({ name: 'Alice' })
yield* effect

// Promise (returns Promise)
await mutation.mutateAsync({ name: 'Alice' })

// Use the Result builder for mutation UI:
Result.builder(mutation.result)
  .onInitial(() => <Button>Create User</Button>)
  .onWaiting(() => <Button disabled>Creating...</Button>)
  .onSuccess((user) => <Success>Created {user.name}!</Success>)
  .onError((e) => <Error>{e.message}</Error>)
  .render()
```

### useStream

```typescript
const stream = api.notifications.watch.useStream({ userId: '123' })

stream.data         // Latest streamed value
stream.isStreaming  // Whether stream is active
stream.error        // Error if stream failed
```

### useChat

```typescript
const chat = api.ai.complete.useChat({
  onPart: (part) => { /* handle each part */ },
  onFinish: (text) => { /* handle completion */ },
})

chat.send({ messages: [...] })  // Send a message
chat.text                        // Accumulated response text
chat.parts                       // All received parts
chat.isStreaming                 // Whether currently streaming
```

### useUtils

```typescript
const utils = api.useUtils()

// Invalidate specific paths
utils.invalidate('user.list')
utils.invalidate('user.byId', { id: '123' })

// Invalidate all paths
utils.invalidateAll()
```

## Subpath Exports

### `effect-trpc`

Core functionality - procedures, router, errors, middleware:

```typescript
import {
  procedures,
  procedure,
  Router,
  Client,
  Middleware,
  // Errors
  NotFoundError,
  UnauthorizedError,
  // etc.
} from 'effect-trpc'
```

### `effect-trpc/react`

React hooks and provider:

```typescript
import {
  createTRPCReact,
  Result,           // effect-atom's Result namespace (for builder pattern)
  QueryResult,      // Type for query hook return
  MutationResult,   // Type for mutation hook return
  // Individual hooks (for custom setups)
  useQuery,
  useMutation,
  useStream,
  useChat,
  useUtils,
} from 'effect-trpc/react'
```

#### Result Builder Pattern

The `Result` namespace (re-exported from `@effect-atom/atom`) provides a powerful builder API for handling async state in React:

```typescript
import { Result } from 'effect-trpc/react'

// All hooks expose a `result` property with the raw effect-atom Result
const query = api.user.list.useQuery()

// Build your UI by handling each state
return Result.builder(query.result)
  .onInitial(() => <Skeleton />)           // No data yet
  .onWaiting(() => <Spinner />)            // Loading (initial or refetch)
  .onSuccess((data) => <List data={data} />) // Has data
  .onErrorTag('NotFoundError', () => <NotFound />) // Specific error
  .onErrorTag('UnauthorizedError', () => <Login />) // Another specific error
  .onError((e) => <GenericError error={e} />) // Catch-all error
  .render() // Returns JSX or null
```

Builder methods:
- `.onInitial(fn)` - Handle initial state (no data yet)
- `.onWaiting(fn)` - Handle loading/waiting state
- `.onSuccess(fn)` - Handle success with data
- `.onFailure(fn)` - Handle any failure (receives Cause)
- `.onError(fn)` - Handle error (receives the error value)
- `.onErrorTag(tag, fn)` - Handle specific tagged error (type-safe!)
- `.onDefect(fn)` - Handle unexpected defects
- `.orElse(fn)` - Provide fallback for unhandled states
- `.orNull()` - Return null for unhandled states
- `.render()` - Finalize and return the result

### `effect-trpc/next`

Next.js App Router integration:

```typescript
import { createRouteHandler } from 'effect-trpc/next'

// SSR/RSC helpers are planned for v2.
// In the meantime, call your Effect services directly in Server Components:
//
// export default async function UsersPage() {
//   const users = await Effect.runPromise(
//     UserService.list().pipe(Effect.provide(UserServiceLive))
//   )
//   return <UserList users={users} />
// }
```

## Type Inference

```typescript
import type { InferInput, InferOutput, InferError } from 'effect-trpc'

type CreateUserInput = InferInput<typeof UserProcedures['create']>
type CreateUserOutput = InferOutput<typeof UserProcedures['create']>
type CreateUserError = InferError<typeof UserProcedures['create']>
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build

# Run example app
cd examples/nextjs-app && bun dev
```

## Roadmap

### Implemented
- [x] Procedure builder API (query, mutation, stream, chat, subscription)
- [x] Middleware system with context enhancement
- [x] React hooks (`useQuery`, `useMutation`, `useStream`, `useChat`, `useSubscription`)
- [x] Next.js App Router integration
- [x] Node.js and Bun server adapters
- [x] WebSocket subscriptions with authentication
- [x] Automatic reconnection with exponential backoff
- [x] Rich error types with `isRetryable`, `httpStatus`
- [x] Declarative cache invalidation (server-defined)
- [x] Optimistic updates with rollback
- [x] Result builder pattern (via effect-atom)

### Planned
- [ ] SSR/RSC helpers (prefetch, dehydrate, HydrationBoundary)
- [ ] Automatic cache invalidation (Convex-style reactivity)
- [ ] Custom procedure type extensions
- [ ] Vue and Solid adapters

## License

MIT
