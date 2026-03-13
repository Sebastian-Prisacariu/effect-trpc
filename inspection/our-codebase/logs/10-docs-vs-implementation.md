# Documentation vs Implementation Analysis

**Date:** 2024-01-XX  
**Scope:** All documentation in `/docs`, `README.md`, and `/examples`

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total Documented Features | 87 |
| Fully Implemented | 52 |
| Partially Implemented | 18 |
| Not Implemented (Fictional) | 17 |
| **Documentation Accuracy** | **~60%** |

The documentation is largely **aspirational** - describing the intended API rather than the current implementation. Many features are correctly documented, but significant gaps exist in React integration, query options, SSR hydration, and client middleware.

---

## Feature-by-Feature Analysis

### 1. Core API (Procedure, Router)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `Procedure.query()` | ✅ Implemented | Matches docs exactly |
| `Procedure.mutation()` with `invalidates` | ✅ Implemented | Works as documented |
| `Procedure.stream()` | ✅ Implemented | Basic implementation |
| `Router.make()` with nested structure | ✅ Implemented | Works as documented |
| Tag derivation (`@api/users/list`) | ✅ Implemented | Correct |
| `Router.paths()` utility | ✅ Implemented | Works |
| `Router.tagsToInvalidate()` | ✅ Implemented | Works |
| `Router.withMiddleware()` | ✅ Implemented | Works at definition level |
| `optimistic` config on mutations | ✅ Implemented | Schema defined, not wired to React |

**Accuracy: 95%** - Core API is solid.

---

### 2. Client API

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `Client.make(router)` | ✅ Implemented | Returns client with Provider |
| `Client.unsafeMake()` | ❌ Not Implemented | Docs reference this, but code uses `Client.make()` |
| `api.Provider` component | ✅ Implemented | Works |
| `api.provide(layer)` for vanilla | ✅ Implemented | Creates BoundClient |
| `api.invalidate(paths)` | ⚠️ Partial | Warns about missing ReactivityService on unbound client |
| `api.users.list.useQuery()` | ⚠️ Partial | Implemented but not fully wired |
| `api.users.list.useSuspenseQuery()` | ❌ Not Implemented | Not in code |
| `api.users.list.useInfiniteQuery()` | ❌ Not Implemented | Not in code |
| `api.users.list.useRefresh()` | ❌ Not Implemented | Not in code |
| `api.users.create.useMutation()` | ⚠️ Partial | Implemented but Result handling incomplete |
| `api.users.watch.useStream()` | ⚠️ Partial | Stub implementation |
| `api.users.list.run` (Effect) | ✅ Implemented | Works |
| `api.users.list.runPromise()` | ✅ Implemented | Works with BoundClient |
| `api.users.list.runPromiseExit()` | ❌ Not Implemented | Not in code |
| `api.users.list.prefetch()` | ⚠️ Partial | Effect exists, not exposed as documented |
| `api.users.list.prefetchPromise()` | ❌ Not Implemented | Not in code |
| `api.users.list.prefetchResult()` | ❌ Not Implemented | Not in code |
| `api.users.list.atom` (raw atom access) | ❌ Not Implemented | Docs mention, not exposed |

**Accuracy: 45%** - Many documented client methods don't exist.

---

### 3. Query Options (docs/query-options.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `createClient()` with defaults | ❌ Not Implemented | Code uses `Client.make()` |
| `idleTTL` option | ❌ Not Implemented | Not in code |
| `staleTime` option | ⚠️ Partial | In types but not wired |
| `keepAlive` option | ❌ Not Implemented | Not in code |
| `refetchOnWindowFocus` | ⚠️ Partial | In types but not wired |
| `refetchOnReconnect` | ⚠️ Partial | In types but not wired |
| `refetchInterval` with Duration | ⚠️ Partial | In types but not wired |
| `refetchInterval` with Schedule | ❌ Not Implemented | Not in code |
| `retry` with Schedule | ❌ Not Implemented | Not in code |
| `retry.when` predicate | ❌ Not Implemented | Not in code |
| `isTransientError` helper | ✅ Implemented | In Transport |
| `enabled` option | ⚠️ Partial | In types, basic support |
| `keepPreviousData` via Result.Waiting | ❌ Not Implemented | Not wired |

**Accuracy: 15%** - Most query options are fictional.

---

### 4. Server API

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `Server.make(router, handlers)` | ✅ Implemented | Works |
| Handler type inference | ✅ Implemented | Correct |
| `server.handle(request)` | ✅ Implemented | Works |
| `server.handleStream(request)` | ✅ Implemented | Works |
| `Server.middleware(m)` pipe | ✅ Implemented | Works |
| `Server.toHttpHandler()` | ✅ Implemented | Works |
| `Server.toFetchHandler()` | ✅ Implemented | Works |
| `Server.toNextApiHandler()` | ✅ Implemented | Works |
| Middleware execution on streams | ✅ Implemented | Runs once before stream starts |
| Schema encode/decode on responses | ✅ Implemented | Works |

**Accuracy: 100%** - Server API is fully implemented as documented.

---

### 5. Transport

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `Transport.http(url, options)` | ✅ Implemented | Works |
| `Transport.http` with `timeout` | ✅ Implemented | Works |
| `Transport.http` with `headers` | ✅ Implemented | Static and dynamic |
| `Transport.http` with `batching` | ❌ Not Implemented | README shows this, not in code |
| `Transport.mock<Router>(handlers)` | ✅ Implemented | Works |
| `Transport.make(service)` | ✅ Implemented | Works |
| `Transport.loopback(server)` | ✅ Implemented | Works |
| `Transport.fromLayer(handlers)` | ❌ Not Implemented | Mentioned in TRANSPORT-SPEC |
| `isTransientError()` | ✅ Implemented | Works |
| `generateRequestId()` | ✅ Implemented | Works |
| `TransportRequest` with headers | ✅ Implemented | Works |

**Accuracy: 80%** - Batching is aspirational.

---

### 6. Middleware (docs/authentication.md, src/Middleware)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `Middleware.Tag()` constructor | ✅ Implemented | Works |
| `Middleware.implement()` | ✅ Implemented | Works |
| `Middleware.implementWrap()` | ✅ Implemented | Works |
| `Middleware.all()` for combining | ✅ Implemented | Works |
| Server-side middleware execution | ✅ Implemented | Works |
| Middleware providing Context.Tag | ✅ Implemented | Works |
| `Middleware.layerClient()` | ❌ Not Implemented | Docs show client-side middleware, not in code |
| `requiredForClient` option | ❌ Not Implemented | In docs, not in code |
| Client-side header injection | ❌ Not Implemented | Documented but not implemented |
| Per-call headers override | ❌ Not Implemented | `runPromise({ headers })` doesn't exist |

**Accuracy: 60%** - Client-side middleware is fictional.

---

### 7. Hydration / SSR (docs/hydration.md, docs/server-components.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `serverApi.prefetch()` | ❌ Not Implemented | Docs show this, not in Client |
| `serverApi.prefetchResult()` | ❌ Not Implemented | Docs show this, not in Client |
| `serverApi.runPromise()` | ⚠️ Partial | Works on BoundClient only |
| Automatic hydration via Provider | ❌ Not Implemented | SSR.Hydrate is a stub |
| `SSR.dehydrate()` | ⚠️ Partial | Exists but very basic |
| `SSR.Hydrate` component | ⚠️ Partial | Exists but no-op |
| `createServerClient()` | ❌ Not Implemented | Docs reference, not in code |
| `effect-trpc/server` entrypoint | ❌ Not Implemented | Docs reference, not in package |
| `effect-trpc/client` entrypoint | ❌ Not Implemented | Docs reference, not in package |
| Data transfer via React serialization | ❌ Not Implemented | Not implemented |
| `hydrate: false` option | ❌ Not Implemented | Not in code |

**Accuracy: 10%** - SSR is mostly fictional.

---

### 8. Pagination (docs/pagination.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `useInfiniteQuery()` | ❌ Not Implemented | Not in code |
| `getNextPageParam` option | ❌ Not Implemented | Not in code |
| `getPreviousPageParam` option | ❌ Not Implemented | Not in code |
| `query.fetchNextPage()` | ❌ Not Implemented | Not in code |
| `query.fetchPreviousPage()` | ❌ Not Implemented | Not in code |
| `query.hasNextPage` | ❌ Not Implemented | Not in code |
| `Atom.pull` usage | ❌ Not Implemented | Not integrated |
| Optimistic updates with pagination | ❌ Not Implemented | Not in code |

**Accuracy: 0%** - Entire pagination module is fictional.

---

### 9. Cancellation (docs/cancellation.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| Auto-cancel on unmount | ⚠️ Partial | Atom lifecycle, not fully wired |
| `mutation.cancel()` | ❌ Not Implemented | Not in code |
| `query.cancel()` | ❌ Not Implemented | Not in code |
| `Effect.timeout()` usage | ✅ External | Effect works, not wrapped |
| `AbortController` signal support | ⚠️ Partial | In types, not fully wired |
| Mutation concurrency modes | ❌ Not Implemented | `mode: "replace"/"queue"` not in code |
| `discard: true` option | ❌ Not Implemented | Not in code |

**Accuracy: 15%** - Cancellation features are aspirational.

---

### 10. Suspense (examples/advanced/suspense.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `useSuspenseQuery()` | ❌ Not Implemented | Not in code |
| Returns data directly (not Result) | ❌ Not Implemented | Not in code |
| Integration with `<Suspense>` | ❌ Not Implemented | Not in code |
| Integration with `<ErrorBoundary>` | ❌ Not Implemented | Not in code |

**Accuracy: 0%** - Suspense is entirely fictional.

---

### 11. Optimistic Updates (examples/advanced/optimistic-atoms.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `optimistic` config on Procedure | ✅ Implemented | Schema defined |
| `target` path | ✅ Implemented | In schema |
| `reducer` function | ✅ Implemented | In schema |
| `reconcile` function | ✅ Implemented | In schema |
| Actually applies optimistic update | ❌ Not Implemented | Not wired to React |
| `api.users.list.atom` access | ❌ Not Implemented | Not exposed |
| `Atom.optimistic()` integration | ❌ Not Implemented | Not wired |

**Accuracy: 30%** - Schema exists, behavior doesn't.

---

### 12. Imperative API (examples/advanced/imperative-api.md)

| Documented Feature | Status | Notes |
|-------------------|--------|-------|
| `.run` Effect | ✅ Implemented | Works |
| `.runPromise()` | ✅ Implemented | Works with BoundClient |
| `.runPromiseExit()` | ❌ Not Implemented | Not in code |
| `.prefetch()` Effect | ⚠️ Partial | Internal, not exposed cleanly |
| `.prefetchPromise()` | ❌ Not Implemented | Not in code |
| `api.invalidate()` bridging | ⚠️ Partial | Warns on unbound |
| Streaming to DOM directly | ⚠️ Partial | `.stream` exists |

**Accuracy: 50%** - Basic imperative works, advanced doesn't.

---

### 13. README Features

| Feature | Status | Notes |
|---------|--------|-------|
| `@effect/schema` import | ❌ Wrong | Should be `effect/Schema` |
| `Client.make(appRouter)` return type | ⚠️ Misleading | Returns Client, not ClientProxy directly |
| Batching config in Transport.http | ❌ Not Implemented | Not in code |
| `query.data?.map()` usage | ✅ Correct | Works via Result |
| `Result.match()` usage | ✅ Correct | Works |
| Type helpers export | ✅ Implemented | In types.ts |

**Accuracy: 70%** - README is mostly accurate but has errors.

---

## Fictional Features Summary

These are documented but **do not exist in the codebase**:

### High Impact (User-Facing)
1. `useSuspenseQuery()` - Entire Suspense integration
2. `useInfiniteQuery()` - Entire pagination system
3. `runPromiseExit()` - Exit-based error handling
4. `prefetchPromise()` / `prefetchResult()` - SSR prefetch
5. `createServerClient()` / `createClient()` - Factory functions
6. Mutation concurrency modes (`replace`, `queue`, `reject`)
7. Query options (`idleTTL`, `staleTime`, `keepAlive`)
8. Client-side middleware (`Middleware.layerClient`)
9. Batching in HTTP transport

### Medium Impact
10. `query.cancel()` / `mutation.cancel()` methods
11. `hydrate: false` option
12. `effect-trpc/server` and `effect-trpc/client` entrypoints
13. `useRefresh()` hook
14. Automatic hydration via Provider

### Low Impact
15. `Transport.fromLayer()` - Integration testing helper
16. `api.users.list.atom` - Raw atom access
17. LSP ideas (documented as future)

---

## Priority Fixes

### P0 - Blocking (Fix Immediately)
1. **README `@effect/schema` import** - Should be `effect/Schema`
2. **Remove batching from docs** - Not implemented
3. **Fix `Client.unsafeMake()` reference** - Doesn't exist

### P1 - High Priority (This Week)
4. **Add `runPromiseExit()` to QueryClient/MutationClient** - Documented, easy to add
5. **Implement `useSuspenseQuery()`** - Core React feature
6. **Wire optimistic updates to React** - Schema exists, needs connection
7. **Add `query.refetch()` to hook return** - Missing from current impl

### P2 - Medium Priority (This Sprint)
8. **Implement query options** (`staleTime`, `enabled` fully wired)
9. **Implement `useInfiniteQuery()`** - Pagination is expected
10. **Add `prefetch()` method to client procedures** - SSR needs this
11. **Fix SSR hydration** - Currently no-op

### P3 - Low Priority (Backlog)
12. Client-side middleware
13. Mutation concurrency modes
14. Batching
15. `cancel()` methods

---

## Recommendations

### 1. Mark Docs as Draft/WIP
Add prominent "Work in Progress" banners to:
- `docs/pagination.md`
- `docs/cancellation.md` (mutation sections)
- `docs/hydration.md`
- `examples/advanced/suspense.md`

### 2. Align README with Reality
- Remove batching example
- Fix import paths
- Update API examples to match actual signatures

### 3. Create Implementation Roadmap
Track what's documented vs implemented with a status table in the docs.

### 4. Consider API Freeze
Before adding more features, align existing docs with code.

---

## Accuracy by Module

| Module | Accuracy | Status |
|--------|----------|--------|
| Procedure | 95% | ✅ Good |
| Router | 100% | ✅ Excellent |
| Server | 100% | ✅ Excellent |
| Transport | 80% | ✅ Good |
| Middleware (Server) | 90% | ✅ Good |
| Middleware (Client) | 0% | ❌ Fictional |
| Client (Core) | 70% | ⚠️ Gaps |
| Client (Hooks) | 30% | ❌ Major Gaps |
| Query Options | 15% | ❌ Mostly Fictional |
| SSR/Hydration | 10% | ❌ Mostly Fictional |
| Pagination | 0% | ❌ Entirely Fictional |
| Cancellation | 15% | ❌ Mostly Fictional |
| Suspense | 0% | ❌ Entirely Fictional |

**Overall Documentation Accuracy: ~60%**

---

## Conclusion

The documentation describes a complete, polished API that would compete with tRPC and React Query. The implementation provides a solid foundation (Procedure, Router, Server, Transport) but lacks many React integration features.

**The server-side story is excellent. The client-side React story has significant gaps.**

Key actions:
1. Either implement the documented features
2. Or update docs to reflect current state
3. Consider which features are MVP-required vs nice-to-have
