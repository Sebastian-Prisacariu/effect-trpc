# Documentation vs Implementation Analysis

## Executive Summary

**Documentation Accuracy Estimate: ~55-60%**

The documentation is aspirational - it describes the desired API rather than the current implementation. Many documented features either don't exist, work differently than described, or have incomplete implementations.

---

## Features Documented That WORK

### 1. Core Module Structure
- `Procedure.query()`, `Procedure.mutation()`, `Procedure.stream()` - All implemented
- `Router.make()` with nested definitions - Works as documented
- `Client.make()` returns typed proxy with correct structure
- `Transport.http()` and `Transport.mock()` - Both implemented
- `Server.make()` with handlers - Works as documented

### 2. Basic Type System
- Procedure payload/success/error schema extraction - Works
- Router path inference (`Router.Paths<D>`) - Works
- `Router.tagsToInvalidate()` for hierarchical invalidation - Works
- Auto-derived tags from router path (e.g., `@api/users/list`) - Works

### 3. Transport Layer (TRANSPORT-SPEC.md)
- `Transport.Transport` tag - Correctly implemented
- `Transport.http(url)` - Works but batching is NOT implemented
- `Transport.mock<R>(handlers)` - Works with type-safe handlers
- `Transport.loopback(server)` - Implemented for E2E testing
- Request/Response envelope schemas (Success, Failure, StreamChunk, StreamEnd) - All correct

### 4. Server Module
- `Server.make(router, handlers)` - Works
- `Server.toHttpHandler()` - Works
- `Server.toFetchHandler()` - Works
- `Server.toNextApiHandler()` - Works
- Middleware support at server/procedure level - Implemented

### 5. Reactivity System
- `Reactivity.subscribe(tag, callback)` - Works
- `Reactivity.invalidate(tags)` - Works with hierarchical matching
- `pathsToTags()` utility - Works

### 6. Basic React Integration
- `api.Provider` component - Implemented
- `useQuery()` hook - Works (basic version)
- `useMutation()` hook - Works (basic version)
- `useStream()` hook - Implemented but incomplete
- Automatic refetch on invalidation - Works

---

## Features Documented That DON'T WORK

### 1. authentication.md - MOSTLY NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| `Middleware.Tag<Auth>()("Auth", {...})` class syntax | **NOT IMPLEMENTED** - Middleware.Tag() takes 2 args not 3 |
| `Middleware.layerClient()` | **NOT IMPLEMENTED** - doesn't exist |
| `requiredForClient: true` option | **NOT IMPLEMENTED** |
| Provider `headers` prop | **NOT IMPLEMENTED** |
| Per-call headers `runPromise({ headers: {...} })` | **NOT IMPLEMENTED** |
| `Auth.of()` method | **NOT IMPLEMENTED** |

**What Works:** Basic `Middleware.Tag()` and `Middleware.implement()` for server-side middleware only.

### 2. cancellation.md - MOSTLY NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| `query.cancel()` | **NOT IMPLEMENTED** - QueryResult doesn't have cancel method |
| `mutation.cancel()` | **NOT IMPLEMENTED** - MutationResult doesn't have cancel method |
| `runPromise({ signal: controller.signal })` | **NOT IMPLEMENTED** |
| Mutation `mode: "replace" | "queue" | "reject"` | **NOT IMPLEMENTED** |
| Mutation concurrency control | **NOT IMPLEMENTED** |
| Auto-cancel on component unmount | **PARTIAL** - uses mountedRef but not proper fiber cancel |

**What Works:** Basic cleanup on unmount (state updates prevented), but no actual cancellation.

### 3. CLIENT-LIFECYCLE.md - PARTIALLY IMPLEMENTED

| Feature | Status |
|---------|--------|
| `Client.make<AppRouter>()` returning scoped Effect | **NOT IMPLEMENTED** - Returns sync client |
| `Client.unsafeMake<AppRouter>()` | **NOT IMPLEMENTED** - Only `Client.make()` exists |
| `Effect.acquireRelease` semantics | **NOT IMPLEMENTED** |
| `client.registry.clear()` / `client.abortPending()` | **NOT IMPLEMENTED** |

**What Works:** `api.provide(layer)` creates a ManagedRuntime with shutdown method.

### 4. hydration.md - NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| `serverApi.user.list.prefetch()` | **PARTIAL** - prefetch exists but no hydration transfer |
| Automatic hydration from server to client | **NOT IMPLEMENTED** |
| `serverApi.user.list.prefetchResult()` | **NOT IMPLEMENTED** - only `prefetchPromise()` |
| Provider hydration props | **NOT IMPLEMENTED** |
| `hydrate: false` option | **NOT IMPLEMENTED** |

**Reality:** There's no automatic state transfer. `effect-trpc/server` only re-exports modules without React hooks.

### 5. pagination.md - NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| `useInfiniteQuery()` hook | **NOT IMPLEMENTED** |
| `getNextPageParam` / `getPreviousPageParam` | **NOT IMPLEMENTED** |
| `query.fetchNextPage()` | **NOT IMPLEMENTED** |
| `query.hasNextPage` | **NOT IMPLEMENTED** |
| Bidirectional pagination | **NOT IMPLEMENTED** |

**Reality:** No infinite query implementation exists.

### 6. query-options.md - PARTIALLY IMPLEMENTED

| Feature | Status |
|---------|--------|
| `createClient()` with defaults | **NOT IMPLEMENTED** - no createClient function |
| `idleTTL`, `staleTime`, `keepAlive` | **NOT IMPLEMENTED** |
| `refetchOnWindowFocus`, `refetchOnReconnect` | **NOT IMPLEMENTED** |
| `retry.schedule`, `retry.when` | **NOT IMPLEMENTED** |
| `isTransientError` | **IMPLEMENTED** in Transport |
| `refetchInterval` | **IMPLEMENTED** (basic number-based) |
| `enabled` option | **IMPLEMENTED** |

### 7. server-components.md - PARTIALLY IMPLEMENTED

| Feature | Status |
|---------|--------|
| `effect-trpc/server` entry point | **IMPLEMENTED** |
| `createServerClient()` | **NOT IMPLEMENTED** |
| `serverApi.user.list.run` | **NOT IMPLEMENTED** - Client.make returns React-oriented client |
| `serverApi.user.list.runPromise()` | **PARTIAL** - bound client has this |
| `serverApi.user.list.prefetchPromise()` | **NOT IMPLEMENTED** as separate server API |

**Reality:** The `/server` entry point exports modules but doesn't provide a hook-free client factory.

### 8. desired-api.ts - MIXED ACCURACY

| Feature | Status |
|---------|--------|
| `Transport.http()` batching config | **NOT IMPLEMENTED** - batching not functional |
| `Result.match()` | **WORKS** - re-exported from effect-atom |
| `api.provide(Transport.http())` | **WORKS** |
| `api.invalidate(["users"])` | **PARTIAL** - on unbound client warns |
| `Transport.mock<AppRouter>()` | **WORKS** |
| `Router.tagsToInvalidate()` | **WORKS** |

### 9. advanced/imperative-api.md - PARTIALLY IMPLEMENTED

| Feature | Status |
|---------|--------|
| `.run` Effect | **WORKS** on bound client |
| `.runPromise()` | **WORKS** on bound client |
| `.runPromiseExit()` | **NOT IMPLEMENTED** |
| `.prefetch()` | **PARTIAL** - Effect exists but doesn't cache |
| `.prefetchPromise()` | **NOT IMPLEMENTED** |

### 10. advanced/optimistic-atoms.md - NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| `api.user.list.atom` | **NOT IMPLEMENTED** |
| `Atom.optimistic()` usage | **NOT IMPLEMENTED** |
| `Atom.optimisticFn()` integration | **NOT IMPLEMENTED** |

**Reality:** Optimistic updates are documented in Procedure but not connected to Atom integration.

### 11. advanced/suspense.md - NOT IMPLEMENTED

| Feature | Status |
|---------|--------|
| `useSuspenseQuery()` | **NOT IMPLEMENTED** |
| Throwing promise for Suspense | **NOT IMPLEMENTED** |

---

## Examples with Errors

### 1. desired-api.ts - Line 174-181
```typescript
// DOCUMENTED:
Transport.http("/api/trpc", {
  batching: {
    enabled: true,
    window: Duration.millis(10),
    queries: true,
    mutations: false,
  },
})
```
**REALITY:** Batching options are accepted but never used. `sendHttp` ignores them entirely.

### 2. authentication.md - Full Example
```typescript
// DOCUMENTED:
class Auth extends Middleware.Tag<Auth>()("Auth", {
  provides: CurrentUser,
  failure: UnauthorizedError,
  requiredForClient: true,
}) {}
```
**REALITY:** `Middleware.Tag()` signature is `(id: string, provides: Tag) => MiddlewareTag`, not a class factory with config object.

### 3. cancellation.md - Mutation Modes
```typescript
// DOCUMENTED:
const mutation = api.user.create.useMutation({
  mode: "replace",
})
```
**REALITY:** `MutationOptions` interface only has `onSuccess`, `onError`, `onSettled`. No `mode` option.

### 4. hydration.md - Server API
```typescript
// DOCUMENTED:
const serverApi = Client.make<AppRouter>()
await serverApi.user.list.prefetch()
```
**REALITY:** `Client.make()` returns a client with React hooks. There's no separate server client.

### 5. query-options.md - Schedule-based Polling
```typescript
// DOCUMENTED:
refetchInterval: Schedule.spaced(Duration.seconds(10))
```
**REALITY:** `refetchInterval` only accepts `number` (milliseconds), not `Schedule`.

---

## Documentation Accuracy by File

| Document | Accuracy |
|----------|----------|
| README.md | 90% - Accurate but minimal |
| TRANSPORT-SPEC.md | 85% - Mostly accurate, batching doesn't work |
| E2E-TEST-PLAN.md | 75% - Good plan, partially implemented |
| authentication.md | 25% - Major API mismatches |
| cancellation.md | 15% - Almost entirely unimplemented |
| CLIENT-LIFECYCLE.md | 40% - Different API than documented |
| hydration.md | 10% - Not implemented |
| pagination.md | 0% - Not implemented |
| query-options.md | 30% - Some options work |
| server-components.md | 40% - Entry point exists but no server client |
| LSP-IDEAS.md | N/A - Future ideas only |
| desired-api.ts | 60% - Core works, advanced features don't |
| advanced/imperative-api.md | 50% - Basic methods work |
| advanced/optimistic-atoms.md | 0% - Not implemented |
| advanced/suspense.md | 0% - Not implemented |

---

## Priority Documentation Fixes

### Critical (Immediately misleading)

1. **authentication.md** - Complete rewrite needed. Document actual `Middleware.Tag(id, provides)` API.

2. **cancellation.md** - Remove all mutation modes and cancel methods. Document what actually exists (basic unmount cleanup).

3. **hydration.md** - Either remove or mark as "PLANNED" with clear warning.

4. **pagination.md** - Mark as "PLANNED" or remove entirely.

### High Priority

5. **CLIENT-LIFECYCLE.md** - Update to match actual `Client.make()` API (no Scope, returns sync).

6. **query-options.md** - Remove Schedule-based polling, update to match actual `QueryOptions` interface.

7. **server-components.md** - Document that `effect-trpc/server` exists but doesn't have a separate client API yet.

8. **desired-api.ts** - Remove batching config, add comments noting which features are unimplemented.

### Medium Priority

9. **TRANSPORT-SPEC.md** - Note that batching is not implemented.

10. **advanced/imperative-api.md** - Remove `runPromiseExit()` and `prefetchPromise()` references.

### Low Priority (Future features)

11. **advanced/optimistic-atoms.md** - Keep as design doc, mark as unimplemented.

12. **advanced/suspense.md** - Keep as design doc, mark as unimplemented.

---

## Recommendations

### Short Term
1. Add "Status" badges to each doc: IMPLEMENTED, PARTIAL, PLANNED
2. Fix examples in implemented docs to match actual API
3. Move aspirational docs to `docs/design/` folder

### Medium Term
1. Implement missing core features (cancellation, query options)
2. Add proper server client for RSC
3. Implement useInfiniteQuery

### Long Term
1. Implement hydration system
2. Add optimistic update integration with effect-atom
3. Add batching to HTTP transport
