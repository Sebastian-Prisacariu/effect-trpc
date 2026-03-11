# Suspense Support

Use React Suspense for cleaner loading states.

---

## Overview

`useSuspenseQuery` returns data directly (not wrapped in Result). It:
- **Suspends** while loading (throws Promise → caught by `<Suspense>`)
- **Throws** on error (caught by `<ErrorBoundary>`)

For intelligent error handling, use `prefetch()` in your loader.

---

## Basic Usage

```tsx
import { Suspense } from "react"
import { ErrorBoundary } from "react-error-boundary"

function UserList() {
  // Returns User[] directly, not Result<User[], Error>
  const users = api.user.list.useSuspenseQuery()
  
  return (
    <ul>
      {users.map(user => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}

function App() {
  return (
    <ErrorBoundary fallback={<ErrorPage />}>
      <Suspense fallback={<Loading />}>
        <UserList />
      </Suspense>
    </ErrorBoundary>
  )
}
```

---

## Prefetch + Suspense (Recommended)

Handle errors in your loader, before the component renders:

```tsx
// loader.ts
export async function loader() {
  const result = await api.user.list.prefetchPromise()
  
  return Result.match(result, {
    onSuccess: () => ({ ok: true }),
    onFailure: (error) => {
      // Handle typed errors
      if (error._tag === "UnauthorizedError") {
        return redirect("/login")
      }
      if (error._tag === "NotFoundError") {
        throw new Response("Not Found", { status: 404 })
      }
      // Unknown error — let ErrorBoundary handle
      throw error
    },
  })
}

// component.tsx
function UserList() {
  // Safe! Errors were handled in loader
  const users = api.user.list.useSuspenseQuery()
  return <ul>{users.map(...)}</ul>
}
```

---

## The Mental Model

```
┌─────────────────────────────────────────────────────────┐
│  1. Loader / Route Action                               │
│     └─ prefetchPromise() → Result                       │
│     └─ Handle errors (redirect, throw, etc.)            │
│     └─ Data cached for component                        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  2. Component                                           │
│     └─ useSuspenseQuery() → Data                        │
│     └─ Assumes errors handled, just renders             │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  3. ErrorBoundary (fallback)                            │
│     └─ Catches any unhandled errors                     │
│     └─ Shows generic error UI                           │
└─────────────────────────────────────────────────────────┘
```

---

## With Query Options

```tsx
const users = api.user.list.useSuspenseQuery({
  staleTime: Duration.minutes(5),
  refetchOnWindowFocus: false,
})
```

All query options work with `useSuspenseQuery`.

---

## Multiple Queries

Suspense queries can be parallelized:

```tsx
function Dashboard() {
  // These fetch in parallel
  const users = api.user.list.useSuspenseQuery()
  const stats = api.stats.overview.useSuspenseQuery()
  
  return (
    <div>
      <UserTable users={users} />
      <StatsCard stats={stats} />
    </div>
  )
}

// Single Suspense boundary for both
<Suspense fallback={<DashboardSkeleton />}>
  <Dashboard />
</Suspense>
```

---

## Nested Suspense Boundaries

For progressive loading:

```tsx
function App() {
  return (
    <Suspense fallback={<HeaderSkeleton />}>
      <Header />
      
      <Suspense fallback={<MainSkeleton />}>
        <MainContent />
        
        <Suspense fallback={<SidebarSkeleton />}>
          <Sidebar />
        </Suspense>
      </Suspense>
    </Suspense>
  )
}
```

---

## Comparison

| Hook | Returns | Loading | Error |
|------|---------|---------|-------|
| `useQuery()` | `{ result: Result, refresh }` | `Result.Initial` / `Result.Waiting` | `Result.Failure` |
| `useSuspenseQuery()` | `Data` | Suspends (throws Promise) | Throws Error |

### When to Use Which

**Use `useQuery()` when:**
- You want to handle loading/error states inline
- You need access to `result.isLoading`, `result.isError`, etc.
- You're not using Suspense architecture

**Use `useSuspenseQuery()` when:**
- You're using React Suspense for loading states
- You prefer cleaner component code (just render data)
- You're using loaders/actions for error handling (Next.js App Router, React Router, etc.)

---

## Next.js App Router Example

```tsx
// app/users/page.tsx
import { api } from "@/lib/api"
import { Suspense } from "react"

// Server Component (loader)
async function UsersLoader() {
  const result = await api.user.list.prefetchPromise()
  
  return Result.match(result, {
    onSuccess: () => <UserList />,
    onFailure: (error) => {
      if (error._tag === "UnauthorizedError") {
        redirect("/login")
      }
      throw error
    },
  })
}

// Client Component
"use client"
function UserList() {
  const users = api.user.list.useSuspenseQuery()
  return <ul>{users.map(...)}</ul>
}

// Page
export default function UsersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <UsersLoader />
    </Suspense>
  )
}
```

---

## React Router Example

```tsx
// routes.tsx
import { createBrowserRouter } from "react-router-dom"

const router = createBrowserRouter([
  {
    path: "/users",
    loader: async () => {
      const result = await api.user.list.prefetchPromise()
      
      return Result.match(result, {
        onSuccess: () => null,
        onFailure: (error) => {
          if (error._tag === "UnauthorizedError") {
            return redirect("/login")
          }
          throw new Response("Error", { status: 500 })
        },
      })
    },
    element: (
      <Suspense fallback={<Loading />}>
        <UserList />
      </Suspense>
    ),
  },
])

// UserList.tsx
function UserList() {
  const users = api.user.list.useSuspenseQuery()
  return <ul>{users.map(...)}</ul>
}
```
