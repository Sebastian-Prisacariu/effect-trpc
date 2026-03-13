# Documentation vs Implementation Gaps

## Executive Summary

This analysis compares the documented API against the actual implementation. The codebase has **extensive aspirational documentation** describing a complete tRPC-like library, but the implementation is **significantly incomplete**. Most React features, query options, SSR patterns, and advanced features documented are **not implemented**.

---

## 1. Documented but UNIMPLEMENTED Features

### 1.1 React Hooks (HIGH PRIORITY)

**Documented in:** `docs/query-options.md`, `docs/pagination.md`, `docs/cancellation.md`, `examples/advanced/suspense.md`

| Feature | Documentation Claims | Implementation Status |
|---------|---------------------|----------------------|
| `useQuery()` | Returns `{ result, isLoading, isError, data, error, refetch }` | **STUB** - throws "requires React" |
| `useMutation()` | Returns `{ mutate, mutateAsync, isLoading, data, error, reset }` | **STUB** - throws "requires React" |
| `useStream()` | Returns `{ data, latestValue, isConnected, error, stop, restart }` | **STUB** - throws "requires React" |
| `useSuspenseQuery()` | Returns data directly, suspends while loading | **NOT IMPLEMENTED** |
| `useInfiniteQuery()` | Pagination support with `fetchNextPage`, `hasNextPage` | **NOT IMPLEMENTED** |
| `useRefresh()` | Manual refresh hook | **NOT IMPLEMENTED** |

**Evidence from `src/Client/index.ts:720-748`:**
```typescript
const createUseQuery = ...
  // TODO: Implement with actual React hooks
  return (() => {
    throw new Error("useQuery requires React...")
  }) as any
```

### 1.2 Query Options (HIGH PRIORITY)

**Documented in:** `docs/query-options.md`

| Option | Documentation Claims | Implementation Status |
|--------|---------------------|----------------------|
| `idleTTL` | How long to keep cached data | **NOT IMPLEMENTED** |
| `staleTime` | How long until data is stale | **NOT IMPLEMENTED** |
| `keepAlive` | Never garbage collect | **NOT IMPLEMENTED** |
| `refetchOnWindowFocus` | Refetch when tab regains focus | **NOT IMPLEMENTED** |
| `refetchOnReconnect` | Refetch when network returns | **NOT IMPLEMENTED** |
| `refetchInterval` | Polling at interval | **NOT IMPLEMENTED** |
| `enabled` | Enable/disable query | **NOT IMPLEMENTED** |
| `retry.schedule` | Effect Schedule for retries | **NOT IMPLEMENTED** |
| `retry.when` | Retry predicate | **NOT IMPLEMENTED** |

The `QueryOptions` interface in `src/Client/index.ts:398-403` only defines:
```typescript
export interface QueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly staleTime?: number
}
```
But these are **never used** since hooks are stubs.

### 1.3 SSR/Hydration (HIGH PRIORITY)

**Documented in:** `docs/hydration.md`, `docs/server-components.md`

| Feature | Documentation Claims | Implementation Status |
|---------|---------------------|----------------------|
| `prefetch()` | Prefetch and cache for SSR | **STUB** - just runs query with `Effect.asVoid` |
| `prefetchPromise()` | Promise-based prefetch | **NOT IMPLEMENTED** |
| `prefetchResult()` | Returns Result for error handling | **NOT IMPLEMENTED** |
| `createServerClient()` | Separate server client | **NOT IMPLEMENTED** |
| `Client.unsafeMake()` | Direct client without Effect | **NOT IMPLEMENTED** |
| Provider hydration | Automatic state transfer | **NOT IMPLEMENTED** |
| `hydrate: false` option | Disable hydration | **NOT IMPLEMENTED** |

### 1.4 Provider Component (HIGH PRIORITY)

**Documented in:** `docs/hydration.md`, `examples/desired-api.ts`

The Provider is documented as:
```tsx
<api.Provider layer={Transport.http("/api/trpc")}>
  <App />
</api.Provider>
```

**Actual implementation (`src/Client/index.ts:708-718`):**
```typescript
const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  return ({ layer, children }) => {
    // TODO: Create ManagedRuntime from layer
    // TODO: Provide via React context
    return children as any
  }
}
```
This is a **complete stub** that does nothing.

### 1.5 Cancellation Features (MEDIUM PRIORITY)

**Documented in:** `docs/cancellation.md`

| Feature | Documentation Claims | Implementation Status |
|---------|---------------------|----------------------|
| `query.cancel()` | Cancel in-flight query | **NOT IMPLEMENTED** |
| `mutation.cancel()` | Cancel in-flight mutation | **NOT IMPLEMENTED** |
| Automatic unmount cancellation | Cancel on component unmount | **NOT IMPLEMENTED** |
| Parameter change cancellation | Cancel when params change | **NOT IMPLEMENTED** |
| AbortController support | `runPromise({ signal })` | **NOT IMPLEMENTED** |
| `mode: "replace"` | Cancel previous mutation | **NOT IMPLEMENTED** |
| `mode: "queue"` | Queue mutations | **NOT IMPLEMENTED** |
| `mode: "reject"` | Reject concurrent mutations | **NOT IMPLEMENTED** |

### 1.6 Pagination (MEDIUM PRIORITY)

**Documented in:** `docs/pagination.md`

| Feature | Documentation Claims | Implementation Status |
|---------|---------------------|----------------------|
| `useInfiniteQuery()` | Full infinite scroll support | **NOT IMPLEMENTED** |
| `fetchNextPage()` | Load next page | **NOT IMPLEMENTED** |
| `fetchPreviousPage()` | Bidirectional pagination | **NOT IMPLEMENTED** |
| `hasNextPage` | Check for more pages | **NOT IMPLEMENTED** |
| `getNextPageParam` | Extract cursor | **NOT IMPLEMENTED** |
| Integration with `Atom.pull` | Under the hood implementation | **NOT IMPLEMENTED** |

### 1.7 Optimistic Updates (MEDIUM PRIORITY)

**Documented in:** `examples/advanced/optimistic-atoms.md`, `docs/cancellation.md`

| Feature | Documentation Claims | Implementation Status |
|---------|---------------------|----------------------|
| `optimistic.target` | Query to update | **TYPE EXISTS** but not used at runtime |
| `optimistic.reducer` | Transform function | **TYPE EXISTS** but not used at runtime |
| `optimistic.reconcile` | Merge server response | **TYPE EXISTS** but not used at runtime |
| `api.user.list.atom` | Expose raw query atom | **NOT IMPLEMENTED** |
| Rollback on failure | Automatic rollback | **NOT IMPLEMENTED** |

The `OptimisticConfig` interface exists in `src/Procedure/index.ts:124-139` and mutations store the config, but it's **never used** in the client implementation.

### 1.8 Authentication/Middleware on Client (MEDIUM PRIORITY)

**Documented in:** `docs/authentication.md`

| Feature | Documentation Claims | Implementation Status |
|---------|---------------------|----------------------|
| `Middleware.layerClient()` | Client-side middleware | **NOT IMPLEMENTED** |
| Provider `headers` prop | Static/dynamic headers | **NOT IMPLEMENTED** |
| Per-call headers | `runPromise({ headers })` | **NOT IMPLEMENTED** |
| `requiredForClient: true` | Mark middleware as required | **NOT IMPLEMENTED** |

Server-side middleware is implemented, but there's no client middleware system.

### 1.9 Transport Batching (LOW PRIORITY)

**Documented in:** `examples/desired-api.ts`, `docs/TRANSPORT-SPEC.md`

```typescript
Transport.http("/api/trpc", {
  batching: {
    enabled: true,
    window: Duration.millis(10),
    queries: true,
    mutations: false,
  },
})
```

The `HttpOptions` interface in `src/Transport/index.ts:199-244` includes batching config, but:
- The actual `sendHttp` function **ignores batching options**
- No request batching logic exists
- Each request is sent individually

### 1.10 Stream Transport (LOW PRIORITY)

**Documented in:** `docs/E2E-TEST-PLAN.md`

The `sendHttpStream` function in `src/Transport/index.ts:355-371` has:
```typescript
// TODO: Implement proper SSE/streaming - for now just convert single response
Stream.fromEffect(sendHttp(...))
```
This is **not real streaming** - it wraps a single HTTP request.

---

## 2. Undocumented IMPLEMENTED Features

### 2.1 Loopback Transport

**Implemented in:** `src/Transport/index.ts:552-601`

`Transport.loopback(server)` creates a transport that calls Server.handle() directly without HTTP. This is documented in `docs/E2E-TEST-PLAN.md` but not in the main transport docs.

### 2.2 Middleware Chain Execution

**Implemented in:** `src/Middleware/index.ts:329-365`

The `Middleware.execute()` function and full middleware chain system is implemented but lacks user-facing documentation.

### 2.3 Wrap Middleware

**Implemented in:** `src/Middleware/index.ts:152-157`

`Middleware.implementWrap()` allows middleware that wraps handler execution (like logging). Not documented.

### 2.4 Combined Middleware

**Implemented in:** `src/Middleware/index.ts:267-281`

`Middleware.all()` combines multiple middlewares with concurrency options. Not documented.

### 2.5 Router.withMiddleware

**Implemented in:** `src/Router/index.ts:414-420`

Wraps a definition with middleware. Only briefly mentioned in examples.

### 2.6 Reactivity Service

**Implemented in:** `src/Reactivity/index.ts`

Full subscription-based invalidation system with hierarchical matching. Only documented in JSDoc, not in user-facing docs.

### 2.7 Server.middleware

**Implemented in:** `src/Server/index.ts:454-496`

Add server-level middleware. Not in user docs.

---

## 3. Misleading Documentation Examples

### 3.1 `examples/desired-api.ts` - The Main Example

This file is referenced in the README but **almost none of it works**:

| Line | Code | Status |
|------|------|--------|
| 166 | `const api = Client.make(appRouter)` | Works |
| 174-184 | `<api.Provider layer={...}>` | Provider is a stub |
| 192 | `api.users.list.useQuery()` | Throws error |
| 194-204 | `Result.match(query.result, ...)` | Never reached |
| 217-221 | `api.users.create.useMutation(...)` | Throws error |
| 240 | `api.provide(Transport.http(...))` | Works |
| 243 | `vanillaApi.users.list.run` | Works |
| 247 | `vanillaApi.users.list.runPromise()` | Works |
| 251-252 | `api.invalidate(["users"])` | Console warns, doesn't work |
| 260 | `vanillaApi.users.list.prefetch()` | Stub |
| 270-289 | `Transport.mock<AppRouter>({...})` | Works |
| 306 | `Router.tagsToInvalidate(appRouter, "users")` | Works |

### 3.2 JSDoc @example in `src/index.ts`

```typescript
// In components
const query = api.users.list.useQuery()
```
This throws an error. The example is misleading.

### 3.3 `docs/query-options.md` - All Examples

Every example with `useQuery()` options doesn't work:
```typescript
const query = api.user.list.useQuery({
  staleTime: Duration.minutes(5),
  idleTTL: Duration.minutes(10),
})
```
Options are defined in interfaces but **completely ignored**.

### 3.4 `docs/hydration.md` - Full Pattern

The entire SSR pattern documented is fictional:
```typescript
// Server Component
await serverApi.user.list.prefetch()

// Client Component - data already available!
const query = api.user.list.useQuery()
```
Neither `serverApi` nor the hydration system exists.

### 3.5 `docs/cancellation.md` - Mutation Modes

```typescript
const mutation = api.user.create.useMutation({
  mode: "replace",
})
```
No `mode` option exists in `MutationOptions`.

---

## 4. Configuration Options That Have No Effect

| Option | Where Documented | Effect |
|--------|------------------|--------|
| `QueryOptions.enabled` | `docs/query-options.md` | Defined but ignored |
| `QueryOptions.refetchInterval` | `docs/query-options.md` | Defined but ignored |
| `QueryOptions.staleTime` | `docs/query-options.md` | Defined but ignored |
| `MutationOptions.onSuccess` | Interface in Client | Defined but never called |
| `MutationOptions.onError` | Interface in Client | Defined but never called |
| `MutationOptions.onSettled` | Interface in Client | Defined but never called |
| `HttpOptions.batching.*` | `src/Transport/index.ts` | Completely ignored |
| `Procedure.optimistic.*` | `src/Procedure/index.ts` | Stored but never used |

---

## 5. Outdated Documentation

### 5.1 `docs/TRANSPORT-SPEC.md`

Documents `Transport.fromLayer()` for integration testing:
```typescript
const integrationTransport = Transport.fromLayer(
  UserProceduresLive.pipe(Layer.provide(MockDatabaseLayer))
)
```
**This function does not exist.** There's `Transport.loopback()` which is similar but different.

### 5.2 `docs/CLIENT-LIFECYCLE.md`

Documents `Client.make()` returning `Effect<ApiClient, never, Scope | Transport>`:
```typescript
export const make = <R extends Router>() => Effect.acquireRelease(...)
```
**Actual implementation** returns a plain client object, not an Effect.

### 5.3 `docs/authentication.md`

Documents `Middleware.layerClient()` for client-side auth:
```typescript
const AuthClientLive = Middleware.layerClient(Auth, ...)
```
**This function does not exist.** Only server-side middleware is implemented.

---

## 6. Priority Fixes for Documentation

### CRITICAL (Must Fix)

1. **README.md** - Add prominent disclaimer that React hooks are not implemented
2. **examples/desired-api.ts** - Mark sections that work vs don't work
3. **docs/query-options.md** - Remove or mark as "planned"
4. **docs/hydration.md** - Remove or mark as "planned"
5. **docs/server-components.md** - Remove or mark as "planned"

### HIGH (Should Fix)

6. Document what DOES work:
   - `Client.make(router)` for creating proxy
   - `api.provide(layer)` for vanilla/imperative usage
   - `.run` Effect and `.runPromise()` methods
   - `Transport.mock()` for testing
   - `Transport.loopback()` for E2E testing
   - Server implementation with middleware

7. **docs/TRANSPORT-SPEC.md** - Update to reflect actual API

8. **docs/CLIENT-LIFECYCLE.md** - Rewrite to match implementation

### MEDIUM (Nice to Have)

9. Add documentation for implemented but undocumented features:
   - `Middleware.all()` for combining middlewares
   - `Middleware.implementWrap()` for wrap middleware
   - `Router.withMiddleware()` for group middleware
   - `Reactivity` service

10. Add "Implementation Status" badges to each doc

---

## 7. Summary Statistics

| Category | Count |
|----------|-------|
| Documented features that work | ~15 |
| Documented features that are stubs | ~8 |
| Documented features not implemented | ~35 |
| Implemented features not documented | ~7 |
| Misleading examples | ~20 |
| Outdated docs | ~3 |

**Implementation completeness estimate: 25-30%**

The core RPC mechanism (Procedure, Router, Server, Transport, Middleware) is solid. The React integration, caching, SSR, and DX features are almost entirely unimplemented.
