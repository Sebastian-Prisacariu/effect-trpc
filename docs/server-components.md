# Server Components (RSC)

Use effect-trpc in React Server Components.

---

## The Problem

Server Components can't import code that uses React hooks. Our client has `useQuery`, `useMutation`, etc., which would break RSC.

```tsx
// ❌ BREAKS — api imports React hooks
import { api } from "./client"

async function ServerComponent() {
  const users = await api.user.list.runPromise()
}
```

---

## The Solution

Two separate clients:

| Import | Has Hooks | Use In |
|--------|-----------|--------|
| `effect-trpc/server` | ❌ No | Server Components, API routes, middleware |
| `effect-trpc/client` | ✅ Yes | Client Components |

---

## Setup

```typescript
// lib/server-api.ts
import { createServerClient } from "effect-trpc/server"
import type { AppRouter } from "./router"

export const serverApi = createServerClient<AppRouter>({
  url: process.env.API_URL + "/api/trpc",
})

// lib/client-api.ts
"use client"
import { createClient } from "effect-trpc/client"
import type { AppRouter } from "./router"

export const api = createClient<AppRouter>({
  url: "/api/trpc",
  defaults: { ... },
})
```

---

## Server Client Methods

The server client only exposes imperative methods:

```typescript
serverApi.user.list.run              // Effect<User[], Error>
serverApi.user.list.runPromise()     // Promise<User[]>
serverApi.user.list.runPromiseExit() // Promise<Exit<User[], Error>>
serverApi.user.list.prefetch()       // Effect<Result<User[], Error>>
serverApi.user.list.prefetchPromise() // Promise<Result<User[], Error>>
```

No `useQuery`, `useMutation`, `useSuspenseQuery`, etc.

---

## Usage in Server Components

### Basic Fetch

```tsx
// app/users/page.tsx (Server Component)
import { serverApi } from "@/lib/server-api"

export default async function UsersPage() {
  const users = await serverApi.user.list.runPromise()
  
  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

### With Error Handling

```tsx
import { serverApi } from "@/lib/server-api"
import { notFound } from "next/navigation"

export default async function UserPage({ params }: { params: { id: string } }) {
  const result = await serverApi.user.byId.prefetchPromise({ id: params.id })
  
  return Result.match(result, {
    onSuccess: (user) => <UserProfile user={user} />,
    onFailure: (error) => {
      if (error._tag === "NotFoundError") {
        notFound()
      }
      if (error._tag === "UnauthorizedError") {
        redirect("/login")
      }
      throw error  // Let error boundary handle
    },
  })
}
```

### With Effect

```tsx
import { serverApi } from "@/lib/server-api"
import { Effect } from "effect"

export default async function DashboardPage() {
  const program = Effect.gen(function* () {
    const users = yield* serverApi.user.list.run
    const stats = yield* serverApi.stats.overview.run
    return { users, stats }
  })
  
  const data = await Effect.runPromise(program)
  
  return <Dashboard {...data} />
}
```

---

## Hybrid Pattern

Fetch in Server Component, render with Client Component:

```tsx
// app/users/page.tsx (Server Component)
import { serverApi } from "@/lib/server-api"
import { UserListClient } from "./UserListClient"

export default async function UsersPage() {
  // Fetch on server
  const users = await serverApi.user.list.runPromise()
  
  // Pass to client component for interactivity
  return <UserListClient initialUsers={users} />
}
```

```tsx
// app/users/UserListClient.tsx (Client Component)
"use client"
import { api } from "@/lib/client-api"

export function UserListClient({ initialUsers }: { initialUsers: User[] }) {
  // Can use hooks for updates, mutations, etc.
  const mutation = api.user.create.useMutation()
  
  return (
    <div>
      <ul>
        {initialUsers.map(user => <li key={user.id}>{user.name}</li>)}
      </ul>
      <button onClick={() => mutation.mutate({ name: "New", email: "new@example.com" })}>
        Add User
      </button>
    </div>
  )
}
```

---

## Prefetch + Suspense Pattern

Server Component prefetches, Client Component uses Suspense:

```tsx
// app/users/page.tsx (Server Component)
import { serverApi } from "@/lib/server-api"
import { UserListSuspense } from "./UserListSuspense"
import { Suspense } from "react"

export default async function UsersPage() {
  // Prefetch on server (caches for client)
  await serverApi.user.list.prefetchPromise()
  
  return (
    <Suspense fallback={<Loading />}>
      <UserListSuspense />
    </Suspense>
  )
}
```

```tsx
// app/users/UserListSuspense.tsx (Client Component)
"use client"
import { api } from "@/lib/client-api"

export function UserListSuspense() {
  // Data already cached from server prefetch
  const users = api.user.list.useSuspenseQuery()
  
  return <ul>{users.map(...)}</ul>
}
```

---

## API Routes / Route Handlers

Use server client in API routes too:

```typescript
// app/api/sync/route.ts
import { serverApi } from "@/lib/server-api"

export async function POST(request: Request) {
  const body = await request.json()
  
  const user = await serverApi.user.create.runPromise(body)
  
  return Response.json(user)
}
```

---

## Middleware

```typescript
// middleware.ts
import { serverApi } from "@/lib/server-api"

export async function middleware(request: NextRequest) {
  const result = await serverApi.auth.verify.prefetchPromise()
  
  return Result.match(result, {
    onSuccess: () => NextResponse.next(),
    onFailure: () => NextResponse.redirect("/login"),
  })
}
```

---

## Summary

| Context | Client | Example |
|---------|--------|---------|
| Server Component | `serverApi` | `await serverApi.user.list.runPromise()` |
| Client Component | `api` | `api.user.list.useQuery()` |
| API Route | `serverApi` | `await serverApi.user.create.runPromise(data)` |
| Middleware | `serverApi` | `await serverApi.auth.verify.prefetchPromise()` |
