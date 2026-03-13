# effect-trpc Comprehensive Codebase Review

**Date:** March 2026  
**Analysis Method:** 35 parallel agents  
**Repos Analyzed:** effect-trpc, Effect RPC, Effect Atom, Effect Atom React, tRPC

---

## Executive Summary

### Current State: ~65% Complete

The effect-trpc library has made significant progress:

| Category | Status | Notes |
|----------|--------|-------|
| Core RPC | **Working** | Procedure/Router/Server solid |
| Stream Middleware | **FIXED** | Was critical security issue, now works |
| Transport (HTTP) | Partial | SSE stubbed, batching planned |
| React Integration | **Broken** | Type errors, hooks don't work correctly |
| SSR | Stubs | Mostly non-functional |

### Top 3 Findings

1. **Stream middleware now works** - Major security fix from previous reviews
2. **React hooks have critical type errors** - Uses @effect-atom/atom-react but incorrectly
3. **Silent encoding fallbacks** - Error/success encoding failures return raw data

---

## Part 1: Internal Analysis Summary

### Critical Issues

| Issue | Location | Impact |
|-------|----------|--------|
| React hook type errors | `react.ts:53,93,272-335` | Runtime crashes |
| No payload size limits | Transport/Server | DoS vulnerability |
| Silent encoding fallback | `Server/index.ts:279,293` | Leaks internal data |
| useMutation broken | `react.ts:272-335` | Mutations don't work |
| useStream is stub | `react.ts:406-436` | Streaming broken |

### What's Fixed (from previous reviews)

**Middleware runs for streams!** The critical security issue is resolved:
```typescript
// Server/index.ts:360-377
Middleware.execute(middlewares, middlewareRequest, Effect.succeed(stream))
```

### What's Still Broken

- **SSE not implemented** - TODO comment, wraps single HTTP response
- **33% of config options ignored** - optimistic, refetchInterval, staleTime
- **~60% documentation accuracy** - 17 fictional features documented
- **React hook tests ~1%** - 457 lines virtually untested

---

## Part 2: External Analysis Key Findings

### From Effect RPC

| Finding | Our Status | Action |
|---------|------------|--------|
| Never silent fallbacks - uses `orDie` or defect messages | We have `Effect.as(error)` fallback | Fix encoding error handling |
| Middleware runs once for streams (same as us now) | FIXED | None needed |
| No automatic batching | Removed batching config | Keep removed, implement later if needed |
| Exit-based responses with full Cause | Success/Failure envelopes | Consider adopting Exit |
| HTTP, WebSocket, Socket, Worker, Stdio transports | HTTP only | Add WebSocket |

### From Effect Atom

| Finding | Our Status | Action |
|---------|------------|--------|
| Node-based cache with dependency tracking | We delegate correctly | Keep delegating |
| Registry manages subscriptions with TTL | Using Registry | Good |
| AtomRuntime is NOT Context.Tag | We have type errors here | Fix react.ts:53 types |
| withReactivity uses @effect/experimental/Reactivity | We import correctly | Good |
| Result type has `waiting` flag + `previousSuccess` | We use Result | Good |

### From Effect Atom React

| Finding | Our Status | Action |
|---------|------------|--------|
| useSyncExternalStore central | We use useAtomValue | Good |
| Store caching via WeakMap | Not doing this | Add caching |
| Suspense via promise throwing | Not implemented | Add useAtomSuspense |
| runCallbackSync for Effect execution | We use try/catch | Fix react.ts:304 |
| Real SSR with HydrationBoundary | SSR is stubs | Implement properly |

### From tRPC

| Finding | Our Status | Action |
|---------|------------|--------|
| React Query integration via proxy | We use atom-react | Different approach, OK |
| DataLoader batching with setTimeout(0) | Planned | Use this pattern |
| AsyncIterable + tracked() for subscriptions | useStream broken | Fix streaming |
| Rich middleware context (type, path, signal) | We have basics | Add signal support |
| Links pattern | Single Transport | Don't adopt - Effect has better composition |

---

## Part 3: React Integration Type Errors

### The Problem

Our React hooks import @effect-atom/atom-react but have critical type errors:

```typescript
// react.ts:53 - WRONG type parameters
AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
// Should be: AtomRuntime<Services, Error>

// react.ts:93 - Provider doesn't connect properly
const atomRuntime = Atom.runtime(fullLayer)
// atomRuntime created but not integrated with RegistryContext
```

### The Fix (from Effect Atom analysis)

```typescript
// Correct pattern from AtomRpc.ts
const runtimeFactory = options.runtime ?? Atom.runtime
self.runtime = runtimeFactory(self.layer)

// Atoms created WITH the runtime
self.query = self.runtime.atom(...)
```

---

## Part 4: Encoding Error Handling

### Current (Broken)

```typescript
// Server/index.ts:279
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.catchAll(() => Effect.succeed(error)),  // Silent fallback!
  Effect.as(...)
)
```

### Effect RPC Pattern

```typescript
// Uses orDie - encoding failure crashes the fiber
yield* Schema.encode(procedure.errorSchema)(error).pipe(Effect.orDie)

// Or sends defect message with formatted error
yield* sendDefect(TreeFormatter.formatErrorSync(cause))
```

---

## Part 5: Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)

| Task | Priority | Effort |
|------|----------|--------|
| Fix React hook type errors | CRITICAL | 2 days |
| Add payload size limits | CRITICAL | 1 day |
| Fix silent encoding fallbacks | HIGH | 1 day |
| Fix useMutation implementation | HIGH | 1 day |

### Phase 2: React Completion (Weeks 2-3)

| Task | Priority | Effort |
|------|----------|--------|
| Implement useStream properly | HIGH | 2 days |
| Add Suspense support | HIGH | 1 day |
| Fix try/catch violations | MEDIUM | 1 day |
| Add React hook tests | MEDIUM | 3 days |

### Phase 3: Transport (Weeks 4-5)

| Task | Priority | Effort |
|------|----------|--------|
| Implement SSE | HIGH | 3 days |
| Add WebSocket transport | MEDIUM | 4 days |
| Implement batching (DataLoader pattern) | MEDIUM | 3 days |

### Phase 4: Polish (Weeks 6-8)

| Task | Priority | Effort |
|------|----------|--------|
| Implement SSR properly | MEDIUM | 3 days |
| Implement missing config options | MEDIUM | 2 days |
| Update documentation | MEDIUM | 2 days |
| Add schema caching | LOW | 2 days |

---

## Part 6: Module Completeness

```
Procedure    [===================  ] 95%  - Solid
Router       [==================   ] 90%  - Good
Server       [=================    ] 85%  - Middleware fixed!
Middleware   [=================    ] 85%  - Concurrency ignored
Transport    [============         ] 60%  - SSE stubbed
Client       [==============       ] 70%  - invalidate issues
React        [========             ] 40%  - Type errors, broken hooks
Reactivity   [================     ] 80%  - Delegates correctly
SSR          [====                 ] 20%  - Mostly stubs

OVERALL      [=============        ] 65%
```

---

## Appendix: All Analysis Files

### Internal (15 files)
```
/inspection/our-codebase/logs/01-react-integration.md
/inspection/our-codebase/logs/02-transport-layer.md
/inspection/our-codebase/logs/03-client-api.md
/inspection/our-codebase/logs/04-server-handling.md
/inspection/our-codebase/logs/05-type-system.md
/inspection/our-codebase/logs/06-reactivity-system.md
/inspection/our-codebase/logs/07-error-handling.md
/inspection/our-codebase/logs/08-api-consistency.md
/inspection/our-codebase/logs/09-test-coverage.md
/inspection/our-codebase/logs/10-docs-vs-implementation.md
/inspection/our-codebase/logs/11-performance.md
/inspection/our-codebase/logs/12-effect-patterns.md
/inspection/our-codebase/logs/13-module-integration.md
/inspection/our-codebase/logs/14-configuration.md
/inspection/our-codebase/logs/15-edge-cases.md
```

### Effect RPC (5 files)
```
/inspection/effect-rpc/scan/01-schema-encoding.md
/inspection/effect-rpc/scan/02-streaming-middleware.md
/inspection/effect-rpc/scan/03-batching.md
/inspection/effect-rpc/scan/04-error-handling.md
/inspection/effect-rpc/scan/05-transports.md
```

### Effect Atom (5 files)
```
/inspection/effect-atom/scan/06-cache-storage.md
/inspection/effect-atom/scan/07-subscriptions.md
/inspection/effect-atom/scan/08-services.md
/inspection/effect-atom/scan/09-invalidation.md
/inspection/effect-atom/scan/10-async.md
```

### Effect Atom React (5 files)
```
/inspection/effect-atom-react/scan/11-hooks.md
/inspection/effect-atom-react/scan/12-provider.md
/inspection/effect-atom-react/scan/13-suspense.md
/inspection/effect-atom-react/scan/14-effect-lifecycle.md
/inspection/effect-atom-react/scan/15-ssr.md
```

### tRPC (5 files)
```
/inspection/trpc/scan/16-react-query.md
/inspection/trpc/scan/17-batching.md
/inspection/trpc/scan/18-subscriptions.md
/inspection/trpc/scan/19-middleware.md
/inspection/trpc/scan/20-links.md
```

---

## Conclusion

The effect-trpc library has made real progress - the critical stream middleware bypass is fixed. However, the React integration needs significant work due to type errors in the @effect-atom/atom-react integration.

### Key Actions

1. **Fix React type errors** - Critical for any React usage
2. **Fix encoding fallbacks** - Security/correctness issue
3. **Implement SSE** - Core streaming functionality
4. **Fix useMutation/useStream** - Complete React hooks

The external analysis confirms our architectural decisions are sound (delegating to effect-atom, using @effect/experimental/Reactivity). The issues are implementation bugs, not design problems.

**Total Analysis:** 35 detailed reports across 5 codebases.
