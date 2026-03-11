# Client Lifecycle

Resource management for the API client using Effect's Scope.

---

## Overview

```typescript
// Client.make — Effect with lifecycle (Scope)
Client.make<AppRouter>()
// ^^ Effect<ApiClient, never, Scope | Transport.Transport>

// Client.unsafeMake — direct, no lifecycle (React Provider handles it)
Client.unsafeMake<AppRouter>()
// ^^ ApiClient
```

---

## Client.make

Returns an Effect that:
- **Acquires** resources (registry, connections)
- **Releases** on scope close (cleanup, abort pending)

```typescript
// Internal implementation
export const make = <R extends Router>() =>
  Effect.acquireRelease(
    // Acquire
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.make()
      const transport = yield* Transport.Transport
      
      return buildClient(registry, transport)
    }),
    // Release
    (client) => Effect.sync(() => {
      client.registry.clear()
      client.abortPending()
    })
  )
```

---

## Usage Patterns

### One-shot Script

```typescript
const script = Effect.scoped(
  Effect.gen(function* () {
    const api = yield* Client.make<AppRouter>()
    
    const users = yield* api.user.list.run
    console.log("Users:", users)
  })
).pipe(
  Effect.provide(Transport.http("/api/trpc"))
)

Effect.runPromise(script)
// ✅ Client cleaned up after script completes
```

### Long-running Server

```typescript
const server = Effect.gen(function* () {
  const api = yield* Client.make<AppRouter>()
  
  // Polling loop
  while (true) {
    const users = yield* api.user.list.run
    yield* processUsers(users)
    yield* Effect.sleep(Duration.seconds(30))
  }
})

const program = Effect.scoped(server).pipe(
  Effect.provide(Transport.http("/api/trpc"))
)

// Run with interrupt handling
const fiber = Effect.runFork(program)

process.on("SIGTERM", () => {
  Effect.runPromise(Fiber.interrupt(fiber))
  // ✅ Client.shutdown() called automatically
})
```

### As a Layer (Service Pattern)

```typescript
// Define as a service
class ApiClient extends Context.Tag("ApiClient")<
  ApiClient,
  Awaited<ReturnType<typeof Client.make<AppRouter>>>
>() {}

// Layer that manages lifecycle
const ApiClientLive = Layer.scoped(
  ApiClient,
  Client.make<AppRouter>()
).pipe(
  Layer.provide(Transport.http("/api/trpc"))
)

// Use in app
const app = Effect.gen(function* () {
  const api = yield* ApiClient
  return yield* api.user.list.run
})

Effect.runPromise(
  app.pipe(Effect.provide(ApiClientLive))
)
// ✅ Cleanup when Layer is released
```

### Explicit acquireUseRelease

```typescript
Effect.acquireUseRelease(
  Client.make<AppRouter>(),
  (api) => Effect.gen(function* () {
    const users = yield* api.user.list.run
    return users
  }),
  (api) => Effect.log("Client released")
).pipe(
  Effect.provide(Transport.http("/api/trpc"))
)
```

---

## What Gets Cleaned Up

On release:
- **Abort pending requests** — in-flight fetches cancelled
- **Clear atom registry** — cached data freed
- **Close subscriptions** — SSE/stream connections closed
- **Release connection pools** — if any

---

## Client.unsafeMake

For React, where Provider handles lifecycle:

```typescript
const api = Client.unsafeMake<AppRouter>()

// Provider manages mount/unmount
<api.Provider layer={Transport.http("/api/trpc")}>
  <App />
</api.Provider>
// ✅ Cleanup on unmount
```

---

## Comparison

| Method | Type | Lifecycle | Use Case |
|--------|------|-----------|----------|
| `Client.make` | `Effect<ApiClient, never, Scope \| Transport>` | Effect Scope | Server, scripts, workers |
| `Client.unsafeMake` | `ApiClient` | Provider | React apps |

---

## Type Signature

```typescript
// Client.make
declare const make: <R extends Router>() => Effect.Effect<
  ApiClient<R>,
  never,
  Scope | Transport.Transport
>

// Client.unsafeMake
declare const unsafeMake: <R extends Router>() => ApiClient<R>
```
