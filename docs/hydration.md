# Hydration (SSR)

Transfer server-fetched data to client without re-fetching.

---

## Overview

With SSR (Server-Side Rendering):
1. **Server** fetches data and renders HTML
2. **Server** serializes atom state
3. **Client** receives HTML + serialized state
4. **Client** hydrates React with existing data (no re-fetch)

Built on Effect Atom's `Hydration` module.

---

## Next.js App Router

### Server Component (Fetch + Dehydrate)

```tsx
// app/users/page.tsx (Server Component)
import { serverApi } from "@/lib/server-api"
import { Hydration } from "@effect-atom/atom"
import { HydrationBoundary } from "effect-trpc/client"

export default async function UsersPage() {
  // Fetch on server
  const users = await serverApi.user.list.runPromise()
  
  // Get dehydrated state from server api's registry
  const dehydratedState = Hydration.dehydrate(serverApi.registry)
  
  return (
    <HydrationBoundary state={dehydratedState}>
      <UserListClient />
    </HydrationBoundary>
  )
}
```

### Client Component (Hydrate + Render)

```tsx
// app/users/UserListClient.tsx
"use client"
import { api } from "@/lib/client-api"

export function UserListClient() {
  // Data already available from hydration — no loading state!
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

## HydrationBoundary

The `HydrationBoundary` component:
1. Receives serialized state from server
2. Hydrates the client registry on mount
3. Children immediately have access to data

```tsx
import { HydrationBoundary } from "effect-trpc/client"

<HydrationBoundary state={dehydratedState}>
  {/* All queries inside have access to hydrated data */}
  <App />
</HydrationBoundary>
```

---

## Prefetch Multiple Queries

```tsx
// Server Component
export default async function DashboardPage() {
  // Prefetch multiple queries
  await Promise.all([
    serverApi.user.list.prefetchPromise(),
    serverApi.stats.overview.prefetchPromise(),
    serverApi.notifications.list.prefetchPromise(),
  ])
  
  const dehydratedState = Hydration.dehydrate(serverApi.registry)
  
  return (
    <HydrationBoundary state={dehydratedState}>
      <Dashboard />
    </HydrationBoundary>
  )
}
```

---

## With Route Params

```tsx
// app/users/[id]/page.tsx
export default async function UserPage({ params }: { params: { id: string } }) {
  // Prefetch with params
  await serverApi.user.byId.prefetchPromise({ id: params.id })
  
  const dehydratedState = Hydration.dehydrate(serverApi.registry)
  
  return (
    <HydrationBoundary state={dehydratedState}>
      <UserDetail id={params.id} />
    </HydrationBoundary>
  )
}

// Client Component
function UserDetail({ id }: { id: string }) {
  // Same params — uses hydrated data
  const query = api.user.byId.useQuery({ id })
  // No loading state on initial render!
}
```

---

## How It Works

### Dehydrate (Server)

```typescript
import { Hydration } from "@effect-atom/atom"

// Serialize all atom values in registry
const dehydratedState = Hydration.dehydrate(registry, {
  encodeInitialAs: "ignore",  // Skip atoms still loading
})

// Returns array of { key, value, dehydratedAt }
```

### Hydrate (Client)

```typescript
import { Hydration } from "@effect-atom/atom"

// Restore atom values from serialized state
Hydration.hydrate(registry, dehydratedState)

// Atoms now have values without fetching
```

---

## Provider Integration

The client Provider handles hydration:

```tsx
// Conceptual implementation
function HydrationBoundary({ state, children }) {
  const registry = useAtomRegistry()
  
  // Hydrate on mount (before children render)
  useLayoutEffect(() => {
    if (state) {
      Hydration.hydrate(registry, state)
    }
  }, [])
  
  return children
}
```

---

## Stale Data Handling

Hydrated data might be stale by the time client renders. Options:

### 1. Refetch After Hydration

```typescript
const query = api.user.list.useQuery({
  refetchOnMount: true,  // Refetch even if hydrated
})
```

### 2. Stale Time

```typescript
const query = api.user.list.useQuery({
  staleTime: Duration.minutes(1),  // Consider fresh for 1 min
})
// If dehydrated < 1 min ago, don't refetch
```

### 3. Always Trust Server

```typescript
const query = api.user.list.useQuery({
  refetchOnMount: false,  // Trust hydrated data
})
```

---

## Streaming SSR

For React 18 streaming with Suspense:

```tsx
// Server Component
export default async function Page() {
  // Start fetching (don't await)
  const usersPromise = serverApi.user.list.runPromise()
  
  return (
    <Suspense fallback={<Loading />}>
      <UsersLoader promise={usersPromise} />
    </Suspense>
  )
}

// Server Component that awaits
async function UsersLoader({ promise }) {
  const users = await promise
  const state = Hydration.dehydrate(serverApi.registry)
  
  return (
    <HydrationBoundary state={state}>
      <UserListClient />
    </HydrationBoundary>
  )
}
```

---

## Error Handling

If server fetch fails, handle before hydration:

```tsx
export default async function UsersPage() {
  const result = await serverApi.user.list.prefetchPromise()
  
  return Result.match(result, {
    onSuccess: () => {
      const state = Hydration.dehydrate(serverApi.registry)
      return (
        <HydrationBoundary state={state}>
          <UserListClient />
        </HydrationBoundary>
      )
    },
    onFailure: (error) => {
      if (error._tag === "UnauthorizedError") {
        redirect("/login")
      }
      return <ErrorPage error={error} />
    },
  })
}
```

---

## Summary

| Step | Where | What |
|------|-------|------|
| Fetch | Server | `serverApi.user.list.runPromise()` |
| Dehydrate | Server | `Hydration.dehydrate(registry)` |
| Transfer | HTML | `<script>__HYDRATION_STATE__=...</script>` |
| Hydrate | Client | `<HydrationBoundary state={...}>` |
| Render | Client | `useQuery()` returns data immediately |
