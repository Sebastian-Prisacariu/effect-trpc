# Cancellation & Concurrency

Cancel in-flight requests and control concurrent mutations.

---

## Overview

Cancellation is handled automatically by Effect's fiber system. When a scope closes or fiber is interrupted, pending requests are cancelled and the server is notified.

---

## Automatic Cancellation

### React Component Unmount

Queries are cancelled automatically when component unmounts:

```typescript
function UserList() {
  const query = api.user.list.useQuery()
  
  // ✅ Automatically cancelled when component unmounts
  // No cleanup code needed
}
```

### Query Parameter Changes

When query parameters change, previous request is cancelled:

```typescript
function SearchResults({ query }: { query: string }) {
  const search = api.search.useQuery({ query })
  
  // ✅ When `query` changes, previous search is cancelled
  // New search starts automatically
}
```

### Scope Close

In Effect programs, requests are cancelled when scope closes:

```typescript
const program = Effect.scoped(
  Effect.gen(function* () {
    const api = yield* Client.make<AppRouter>()
    const users = yield* api.user.list.run
    return users
  })
)
// ✅ If interrupted, pending request is cancelled
```

---

## Manual Cancellation

### Mutations

Mutations expose a `cancel()` method:

```typescript
function UploadFile() {
  const upload = api.files.upload.useMutation()
  
  return (
    <div>
      <button onClick={() => upload.mutate({ file })}>
        Upload
      </button>
      
      {upload.isLoading && (
        <button onClick={() => upload.cancel()}>
          Cancel Upload
        </button>
      )}
    </div>
  )
}
```

### Queries

Queries can be cancelled via the query object:

```typescript
function LongRunningQuery() {
  const query = api.reports.generate.useQuery({ id })
  
  return (
    <div>
      {query.isLoading && (
        <button onClick={() => query.cancel()}>
          Cancel
        </button>
      )}
    </div>
  )
}
```

---

## Imperative Cancellation

### Fiber Interruption

Run as fiber and interrupt:

```typescript
import { Fiber } from "effect"

// Start as fiber
const fiber = Effect.runFork(
  api.user.list.run.pipe(Effect.provide(transport))
)

// Later: cancel
await Effect.runPromise(Fiber.interrupt(fiber))
```

### Timeout (Auto-Cancel)

Cancel if takes too long:

```typescript
import { Duration } from "effect"

const users = await api.user.list.run.pipe(
  Effect.timeout(Duration.seconds(10)),  // Cancel after 10s
  Effect.provide(transport),
  Effect.runPromise
)
```

### AbortController (Interop)

For integration with non-Effect code:

```typescript
const controller = new AbortController()

// Start request
const promise = api.user.list.runPromise({ 
  signal: controller.signal 
})

// Later: cancel
controller.abort()

// Promise rejects with AbortError
```

---

## Server-Side Handling

When a request is cancelled, the server receives an Interrupt message. Effect RPC handles this automatically — server-side fibers are interrupted.

```typescript
// Server handler
const UserProceduresLive = UserProcedures.implement({
  generate: ({ id }) =>
    Effect.gen(function* () {
      // Long running operation
      for (let i = 0; i < 100; i++) {
        yield* Effect.sleep(Duration.seconds(1))
        yield* doWork(i)
        // ✅ If client cancels, this fiber is interrupted
        // Effect.sleep and other operations check for interruption
      }
    }),
})
```

---

## Cancellation vs Discard

| Pattern | Request Sent? | Server Notified? | Use Case |
|---------|--------------|------------------|----------|
| Cancel | Yes | Yes (Interrupt) | User cancelled, stop work |
| Discard | Yes | No | Fire-and-forget |

```typescript
// Cancel — server stops work
query.cancel()

// Discard — server continues, we ignore result
mutation.mutate(data, { discard: true })
```

---

## Best Practices

### Debounce Instead of Cancel

For search/typeahead, debounce is often better than manual cancel:

```typescript
function Search() {
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebounce(query, 300)
  
  // Only fires after 300ms of no typing
  const search = api.search.useQuery({ query: debouncedQuery })
}
```

### Race Conditions

Effect handles race conditions automatically. If you start a new request before the previous completes, the old one is cancelled.

```typescript
// ✅ Safe — previous request cancelled
const query = api.user.byId.useQuery({ id: selectedUserId })

// When selectedUserId changes:
// 1. Previous request cancelled
// 2. New request started
// 3. No stale data issues
```

---

---

## Mutation Concurrency

When a mutation fires while another is in progress, use `mode` to control behavior.

### Parallel (Default)

Both run simultaneously:

```typescript
const mutation = api.user.create.useMutation()

// Click button twice quickly
mutation.mutate({ name: "A" })  // Running...
mutation.mutate({ name: "B" })  // Also running...
// Both complete independently
```

### Replace

Cancel previous, start new:

```typescript
const mutation = api.user.create.useMutation({
  mode: "replace",
})

mutation.mutate({ name: "A" })  // Running...
mutation.mutate({ name: "B" })  // A cancelled, B starts
```

Good for: search-as-you-type, only latest matters.

### Queue

Wait for previous to finish:

```typescript
const mutation = api.user.create.useMutation({
  mode: "queue",
})

mutation.mutate({ name: "A" })  // Running...
mutation.mutate({ name: "B" })  // Queued, runs after A completes
```

Good for: ordered operations, optimistic updates.

### Reject

Ignore new calls while one is running:

```typescript
const mutation = api.user.create.useMutation({
  mode: "reject",
})

mutation.mutate({ name: "A" })  // Running...
mutation.mutate({ name: "B" })  // Ignored (no-op)
```

Good for: form submissions, prevent double-submit.

**Or just disable the button:**
```tsx
<button 
  onClick={() => mutation.mutate(data)} 
  disabled={mutation.isLoading}
>
  Submit
</button>
```

---

### Optimistic Updates & Concurrency

With optimistic updates, order matters:

```typescript
// Problem with parallel:
mutation.mutate({ name: "A" })  // Optimistic: list = [..., A]
mutation.mutate({ name: "B" })  // Optimistic: list = [..., A, B]
// If B finishes before A → potential inconsistency

// Solution: use queue mode
const mutation = api.user.create.useMutation({
  mode: "queue",
  optimistic: {
    target: "user.list",
    reducer: (users, input) => [...users, { ...input, id: "temp" }],
  },
})
// Mutations complete in order, optimistic state stays consistent
```

---

### Mode Summary

| Mode | Behavior | Use Case |
|------|----------|----------|
| `parallel` | Run simultaneously (default) | Independent operations |
| `replace` | Cancel previous, run new | Search, typeahead |
| `queue` | FIFO, wait for previous | Optimistic updates, ordered ops |
| `reject` | Ignore while running | Forms, prevent double-submit |

---

## Summary

| Scenario | Cancellation | Code |
|----------|-------------|------|
| Component unmount | Automatic | — |
| Parameter change | Automatic | — |
| User clicks cancel | `mutation.cancel()` / `query.cancel()` | Manual |
| Timeout | `Effect.timeout(duration)` | Manual |
| External control | `AbortController` | Manual |
| Fiber control | `Fiber.interrupt(fiber)` | Manual |
| Concurrent mutations | `mode: "parallel" \| "replace" \| "queue" \| "reject"` | Option |
