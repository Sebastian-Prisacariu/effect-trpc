# effect-trpc Internal Analysis Report

**Date:** March 2026  
**Analysis Method:** 15 parallel deep-dive agents

---

## Executive Summary

The effect-trpc library is approximately **65% complete**. Major progress: **middleware now runs for streams** (was a critical security issue). However, new issues emerged in the React integration.

### Key Changes from Previous Reviews

| Issue | Previous | Current |
|-------|----------|---------|
| Stream middleware bypass | CRITICAL (broken) | **FIXED** |
| @effect-atom/atom-react usage | Not imported | Imported but **broken** |
| SSE/Streaming | Stubbed | Still stubbed |
| Batching | Config ignored | Config removed (planned) |

---

## Severity Classification

### CRITICAL

| Issue | Location | Impact |
|-------|----------|--------|
| React hook type errors | `react.ts:53,93,272-335` | Runtime crashes |
| No payload size limits | Transport/Server | DoS vulnerability |
| Silent encoding fallback | `Server/index.ts:279,293` | Leaks internal data |

### HIGH

| Issue | Location | Impact |
|-------|----------|--------|
| SSE not implemented | `Transport/index.ts:330` | Streaming broken over HTTP |
| `useMutation` broken | `react.ts:272-335` | Mutations don't work |
| `useStream` is stub | `react.ts:406-436` | Streaming hooks broken |
| ~60% docs accuracy | `docs/` | User confusion |

### MEDIUM

| Issue | Location | Impact |
|-------|----------|--------|
| Circular dependency | `Client/index.ts` ↔ `react.ts` | Bundling issues |
| 33% config ignored | Various | Advertised features fail |
| Test coverage ~60% | `test/` | Regressions possible |
| 11 throw statements | Client modules | Effect pattern violation |

---

## React Integration Analysis

### What Changed

The codebase now imports and attempts to use `@effect-atom/atom-react`:

```typescript
// src/Client/react.ts
import { Atom, Registry, Result } from "@effect-atom/atom"
import { useAtomValue, useAtomSuspense, useAtomRefresh } from "@effect-atom/atom-react"
```

### Critical Type Errors

1. **Wrong AtomRuntime type parameters** (line 53)
   - Uses `Tags` instead of `Services` generic
   
2. **Provider doesn't connect properly** (line 83-109)
   - Creates `atomRuntime` but doesn't integrate with `RegistryContext`

3. **useMutation broken** (lines 272-335)
   - Uses `registry.set` incorrectly
   - Doesn't await mutation results

4. **useStream is stub** (lines 406-436)
   - Comment admits "This is simplified"
   - State never updates from stream

---

## Server Middleware (FIXED!)

The critical security issue is now resolved. Middleware runs for streams:

```typescript
// Server/index.ts:360-377
Middleware.execute(
  middlewares,
  middlewareRequest,
  Effect.succeed(stream)
)
```

Middleware executes **once** before stream starts. Auth/rate-limiting now work.

---

## Module Completeness

```
Procedure    [===================  ] 95%  - Solid
Router       [==================   ] 90%  - Good
Server       [=================    ] 85%  - Middleware fixed!
Middleware   [=================    ] 85%  - Concurrency ignored
Transport    [============         ] 60%  - SSE stubbed
Client       [==============       ] 70%  - invalidate broken
React        [========             ] 40%  - Type errors, broken hooks
Reactivity   [================     ] 80%  - Properly delegates
SSR          [====                 ] 20%  - Mostly stubs

OVERALL      [=============        ] 65%
```

---

## Documentation Accuracy

**~60% accurate**

### Fictional Features (17 total)
- `useSuspenseQuery()`
- `useInfiniteQuery()` 
- `runPromiseExit()`
- `prefetchPromise()` / `prefetchResult()`
- Mutation concurrency modes
- HTTP batching
- Most query caching options

### Implemented as Documented
- Server API
- Router API
- Core Procedure definitions
- Basic Transport

---

## Performance Findings

### Schema Caching: NONE

Schemas compile on every request. Major optimization opportunity.

### Per-Request Allocations: 15-25 objects

Many avoidable with caching:
- MiddlewareRequest per request
- Headers wrapper with closures
- Generator per Effect.gen call

---

## Recommendations

### Immediate (Week 1)

1. **Fix React hook type errors** - Critical runtime failures
2. **Add payload size limits** - Security
3. **Fix silent encoding fallbacks** - Return proper errors

### Short-term (Weeks 2-3)

4. **Fix useMutation implementation**
5. **Implement useStream properly**
6. **Break circular dependency** - Extract to `service.ts`
7. **Add schema caching**

### Medium-term (Weeks 4-6)

8. **Implement SSE**
9. **Add reconnection logic**
10. **Implement missing config options**
11. **Add React hook tests**
12. **Update documentation** - Remove fictional features

---

## Next Phase

Analyze external repos:
1. Effect RPC - encoding, streaming, transports
2. Effect Atom - caching, subscriptions
3. Effect Atom React - hooks, Provider, Suspense
4. tRPC - batching, React Query, middleware
