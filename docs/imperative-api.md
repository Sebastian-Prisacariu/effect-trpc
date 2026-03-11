# Imperative API (Non-React)

Call queries and mutations outside of React components.

---

## Overview

The imperative API runs **independently** of React state. It doesn't update the shared AtomRegistry, so React components won't re-render.

To bridge imperative code back to React, use `api.invalidate()`.

---

## Query Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.run` | `Effect<Data, Error>` | Raw Effect for composition |
| `.runPromise()` | `Promise<Data>` | Async/await, throws on error |
| `.runPromiseExit()` | `Promise<Exit<Data, Error>>` | Never throws, returns Exit |
| `.prefetch()` | `Effect<Result<Data, Error>>` | Cache + return Result |
| `.prefetchPromise()` | `Promise<Result<Data, Error>>` | Cache + return Result |

### Examples

```typescript
// Effect composition
const program = Effect.gen(function* () {
  const users = yield* api.user.list.run
  const user = yield* api.user.byId.run({ id: "123" })
  return { users, user }
})

// Async/await (throws on error)
try {
  const users = await api.user.list.runPromise()
} catch (error) {
  console.error("Failed:", error)
}

// Exit handling (never throws)
const exit = await api.user.list.runPromiseExit()

Exit.match(exit, {
  onSuccess: (users) => console.log("Got users:", users),
  onFailure: (cause) => {
    if (Cause.isFailure(cause)) {
      const error = cause.error
      if (error._tag === "NotFoundError") {
        console.log("Not found:", error.id)
      }
    }
  },
})

// Prefetch with error handling
const result = await api.user.list.prefetchPromise()

Result.match(result, {
  onSuccess: (users) => {
    // Data cached for useSuspenseQuery
  },
  onFailure: (error) => {
    if (error._tag === "UnauthorizedError") {
      redirect("/login")
    }
  },
})
```

---

## Mutation Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `.run(input)` | `Effect<Data, Error>` | Raw Effect for composition |
| `.runPromise(input)` | `Promise<Data>` | Async/await, throws on error |
| `.runPromiseExit(input)` | `Promise<Exit<Data, Error>>` | Never throws, returns Exit |

### Examples

```typescript
// Effect composition
const program = Effect.gen(function* () {
  const user = yield* api.user.create.run({ name: "Alice", email: "alice@example.com" })
  yield* api.user.update.run({ id: user.id, name: "Alice Smith" })
  return user
})

// Async/await
const newUser = await api.user.create.runPromise({ 
  name: "Bob", 
  email: "bob@example.com" 
})

// Exit handling
const exit = await api.user.create.runPromiseExit({ name: "Charlie", email: "c@example.com" })

Exit.match(exit, {
  onSuccess: (user) => console.log("Created:", user),
  onFailure: (cause) => {
    if (Cause.isFailure(cause) && cause.error._tag === "ValidationError") {
      console.log("Validation failed:", cause.error.message)
    }
  },
})
```

---

## Bridging to React

Imperative calls don't update React state. Use `api.invalidate()` to tell React to refetch:

```typescript
// Imperative code (doesn't update React)
await api.user.create.runPromise({ name: "New User", email: "new@example.com" })

// Tell React to refetch user queries
api.invalidate(["user.list"])
```

### Invalidation Patterns

```typescript
// Invalidate specific query
api.invalidate(["user.list"])

// Invalidate all user queries
api.invalidate(["user"])

// Invalidate multiple
api.invalidate(["user.list", "stats.overview"])
```

### When to Invalidate

**DO invalidate when:**
- Imperative mutation should reflect in React UI
- External data source changed
- Background sync completed

**DON'T invalidate when:**
- Updating DOM directly (bypassing React)
- Fire-and-forget operations
- Data not displayed in React

---

## Use Cases

### Route Loader (Next.js / React Router)

```typescript
// loader.ts
export async function loader({ params }) {
  const result = await api.user.byId.prefetchPromise({ id: params.id })
  
  return Result.match(result, {
    onSuccess: () => ({ ok: true }),
    onFailure: (error) => {
      if (error._tag === "NotFoundError") {
        throw new Response("Not Found", { status: 404 })
      }
      throw error
    },
  })
}

// component.tsx — data already cached
function UserPage() {
  const user = api.user.byId.useSuspenseQuery({ id: params.id })
  return <UserProfile user={user} />
}
```

### Event Handlers (Non-React DOM)

```typescript
// Vanilla JS event handler
document.getElementById("sync-btn").addEventListener("click", async () => {
  const users = await fetchFromExternalApi()
  
  for (const user of users) {
    await api.user.create.runPromise(user)
  }
  
  // Update React UI
  api.invalidate(["user.list"])
})
```

### Background Sync

```typescript
// Background job (runs outside React)
async function backgroundSync() {
  const externalData = await fetchExternalData()
  
  await api.data.sync.runPromise(externalData)
  
  // Don't invalidate — React doesn't need to know
}
```

### Streaming to DOM Directly

```typescript
// Stream updates DOM without React
const stream = api.events.watch.stream()

for await (const event of stream) {
  // Update DOM directly, bypass React
  document.getElementById("event-log").innerHTML += `<p>${event.message}</p>`
}
```

### Tests

```typescript
// test.ts
import { api } from "./client"

test("create user", async () => {
  const user = await api.user.create.runPromise({
    name: "Test User",
    email: "test@example.com",
  })
  
  expect(user.id).toBeDefined()
  expect(user.name).toBe("Test User")
})

test("handles not found", async () => {
  const exit = await api.user.byId.runPromiseExit({ id: "nonexistent" })
  
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) {
    expect(Cause.failureOption(exit.cause)).toMatchObject({
      _tag: "NotFoundError",
    })
  }
})
```

---

## Summary

| Use Case | Method | Invalidate? |
|----------|--------|-------------|
| Effect composition | `.run` | Optional |
| Async/await | `.runPromise()` | Optional |
| Error handling | `.runPromiseExit()` | Optional |
| Route loader | `.prefetchPromise()` | No |
| Update React from outside | Any + `api.invalidate()` | Yes |
| Background sync | `.runPromise()` | Usually no |
| Tests | `.runPromise()` / `.runPromiseExit()` | No |
