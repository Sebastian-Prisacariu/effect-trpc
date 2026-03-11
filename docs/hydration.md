# Hydration (SSR)

Server-fetched data automatically available on client — no explicit state passing.

---

## Overview

1. **Server** prefetches data
2. **Data automatically transfers** to client (via React serialization)
3. **Client** renders with data — no loading state

No manual hydration props needed.

---

## Setup

### 1. Create API (once)

```typescript
// lib/api.ts
import { Client, Transport } from "effect-trpc"
import type { AppRouter } from "./router"

// Server API — for Server Components
export const serverApi = Client.make<AppRouter>()

// Client API — for Client Components  
export const api = Client.unsafeMake<AppRouter>()
```

### 2. Provider in Layout

```tsx
// app/layout.tsx
import { api } from "@/lib/api"
import { Transport } from "effect-trpc"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <api.Provider layer={Transport.http("/api/trpc")}>
          {children}
        </api.Provider>
      </body>
    </html>
  )
}
```

That's it. Hydration is automatic.

---

## Usage

### Server Component (Prefetch)

```tsx
// app/users/page.tsx (Server Component)
import { serverApi } from "@/lib/api"
import { UserList } from "./UserList"

export default async function UsersPage() {
  // Prefetch on server
  await serverApi.user.list.prefetch()
  
  // Render client component — data already available
  return <UserList />
}
```

### Client Component (Use Data)

```tsx
// app/users/UserList.tsx (Client Component)
"use client"
import { api } from "@/lib/api"

export function UserList() {
  // Data from server prefetch — no loading state!
  const query = api.user.list.useQuery()
  
  return (
    <ul>
      {query.data?.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
```

---

## Multiple Prefetches

```tsx
// app/dashboard/page.tsx
import { serverApi } from "@/lib/api"
import { Dashboard } from "./Dashboard"

export default async function DashboardPage() {
  // Prefetch multiple queries in parallel
  await Promise.all([
    serverApi.user.list.prefetch(),
    serverApi.stats.overview.prefetch(),
    serverApi.notifications.list.prefetch(),
  ])
  
  return <Dashboard />
}
```

---

## With Route Params

```tsx
// app/users/[id]/page.tsx
import { serverApi } from "@/lib/api"
import { UserDetail } from "./UserDetail"

export default async function UserPage({ params }: { params: { id: string } }) {
  // Prefetch with params
  await serverApi.user.byId.prefetch({ id: params.id })
  
  return <UserDetail id={params.id} />
}
```

```tsx
// UserDetail.tsx
"use client"

export function UserDetail({ id }: { id: string }) {
  // Same params = uses prefetched data
  const query = api.user.byId.useQuery({ id })
  
  return <div>{query.data?.name}</div>
}
```

---

## Error Handling

Handle errors on the server before rendering:

```tsx
// app/users/page.tsx
import { serverApi } from "@/lib/api"
import { redirect, notFound } from "next/navigation"

export default async function UsersPage() {
  const result = await serverApi.user.list.prefetchResult()
  
  if (result._tag === "Failure") {
    if (result.error._tag === "UnauthorizedError") {
      redirect("/login")
    }
    if (result.error._tag === "NotFoundError") {
      notFound()
    }
    throw result.error
  }
  
  return <UserList />
}
```

---

## Streaming with Suspense

For React 18 streaming SSR:

```tsx
// app/users/page.tsx
import { Suspense } from "react"
import { UserList } from "./UserList"

export default function UsersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <UserListLoader />
    </Suspense>
  )
}

async function UserListLoader() {
  await serverApi.user.list.prefetch()
  return <UserList />
}
```

Multiple streams:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <Suspense fallback={<StatsSkeleton />}>
        <StatsLoader />
      </Suspense>
      
      <Suspense fallback={<UsersSkeleton />}>
        <UsersLoader />
      </Suspense>
    </div>
  )
}
```

---

## How It Works

1. **serverApi.prefetch()** fetches data and stores in registry
2. **Provider** serializes registry state to HTML
3. **Client hydration** reads serialized state
4. **useQuery()** finds data already cached

```
Server                           Client
──────                           ──────
serverApi.prefetch()
    │
    ▼
Registry stores data
    │
    ▼
Provider serializes ─────────►  Provider hydrates
                                    │
                                    ▼
                                useQuery() → data ready
```

---

## Disable Hydration

If needed, opt out per-query:

```typescript
const query = api.user.list.useQuery({
  hydrate: false,  // Always fetch fresh, ignore server data
})
```

Or disable at Provider level:

```tsx
<api.Provider 
  layer={Transport.http("/api/trpc")}
  hydrate={false}
>
```

---

## Summary

| Step | Code | Where |
|------|------|-------|
| Setup Provider | `<api.Provider layer={...}>` | Root layout |
| Prefetch | `await serverApi.user.list.prefetch()` | Server Component |
| Use data | `api.user.list.useQuery()` | Client Component |

No manual state passing. No explicit hydration boundaries. Just works.
