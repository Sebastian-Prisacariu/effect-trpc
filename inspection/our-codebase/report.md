# effect-trpc Internal Analysis Report

**Date:** March 2026  
**Version Analyzed:** Current main branch  
**Analysis Method:** 15 parallel deep-dive agents

---

## Executive Summary

The effect-trpc library is approximately **40% complete**. The core RPC mechanism (Procedure, Router, Server, Transport) works well and follows Effect patterns. However, major features advertised in documentation are either stubs or completely unimplemented:

- **React integration:** 100% stubs (all hooks throw errors)
- **Caching:** 0% implemented (invalidation exists but no cache)
- **Request batching:** 0% implemented (config accepted but ignored)
- **SSE streaming:** ~10% (wraps single HTTP, not real streaming)
- **Stream middleware:** Completely bypassed (security issue)

The documentation describes a library ~70% fictional. Users following the docs will encounter runtime errors for most React-related features.

---

## Severity Classification

### CRITICAL (Security/Breaking)

| Issue | Location | Impact |
|-------|----------|--------|
| Streams bypass middleware | `Server/index.ts:handleStream()` | Auth bypass on all stream procedures |
| React hooks throw at runtime | `Client/index.ts:useQuery/useMutation/useStream` | App crash on hook call |
| No payload size limits | `Transport/index.ts` | OOM attack vector |

### HIGH (Major Functionality)

| Issue | Location | Impact |
|-------|----------|--------|
| SSE not implemented | `Transport/index.ts:sendHttpStream` | Streaming doesn't work over HTTP |
| Batching config ignored | `Transport/index.ts` | Performance optimization unavailable |
| No cache exists | `Reactivity/index.ts` | Invalidation invalidates nothing |
| Test types not checked | `tsconfig.json` | 27+ type errors in CI |
| `invalidate()` does nothing | `Client/index.ts` | Manual cache control broken |

### MEDIUM (Should Fix)

| Issue | Location | Impact |
|-------|----------|--------|
| Stream chunks not schema-encoded | `Server/index.ts` | Type safety gap |
| Silent error encoding fallback | `Server/index.ts` | Debugging difficulty |
| Missing type exports | `src/index.ts` | Consumer type errors |
| `throw` statements in Effect code | `Client/index.ts` | Pattern violation |

### LOW (Polish)

| Issue | Location | Impact |
|-------|----------|--------|
| Missing `isRouter`/`isClient` guards | Various | API inconsistency |
| Duplicated `shouldInvalidate` logic | `Reactivity/index.ts` | Code smell |
| Middleware after decode | `Server/index.ts` | Suboptimal error order |

---

## Architecture Assessment

### Strengths

1. **Clean module DAG** - No circular dependencies, proper layering
2. **Type utilities** - `Paths<R>`, `ProcedureAt<R, P>`, `AutoComplete<R>` are excellent
3. **Effect idioms** - Proper use of services, contexts, layers
4. **Middleware pattern** - Composable, type-safe, wrapping pattern
5. **Loopback transport** - Great for testing
6. **Schema handling** - Consistent use of `Schema.decodeUnknown`

### Weaknesses

1. **Stub-heavy React layer** - Listed as peer dep, completely unused
2. **Disconnected reactivity** - Cache invalidation without cache
3. **Feature flags without features** - Batching config, SSE config accepted but ignored
4. **Dual client architecture** - Bound vs unbound clients is confusing

---

## Module Completeness

```
Procedure    [===================  ] 95%  - Core works, minor issues
Router       [==================   ] 90%  - Works well
Middleware   [==================   ] 90%  - Server-side solid
Server       [=================    ] 85%  - Streams need work
Client       [===============      ] 75%  - Core works, hooks broken
Transport    [============         ] 60%  - HTTP works, batching/SSE don't
Reactivity   [==========           ] 50%  - Invalidation only
React        [=                    ]  5%  - All stubs
Cache        [                     ]  0%  - Does not exist
Batching     [                     ]  0%  - Not implemented

OVERALL      [========             ] 40%
```

---

## Comparison: Docs vs Reality

| Feature | Documented | Reality |
|---------|------------|---------|
| `api.users.get.query()` | Yes | Works |
| `api.users.create.mutate()` | Yes | Works |
| `api.posts.subscribe.stream()` | Yes | Partially works |
| `useQuery()` hook | Yes | Throws error |
| `useMutation()` hook | Yes | Throws error |
| `useStream()` hook | Yes | Throws error |
| `<api.Provider>` | Yes | Returns children only |
| Request batching | Yes | Config ignored |
| SSE transport | Yes | Not implemented |
| Query caching | Implied | No cache exists |
| Cache invalidation | Yes | No cache to invalidate |
| Optimistic updates | Implied | Not implemented |

**Documentation accuracy: ~25-30%**

---

## Files Requiring Immediate Attention

### Must Fix Before Any Release

1. **`src/Client/index.ts`** (lines 620-720)
   - Remove or implement React hooks
   - Either use `@effect-atom/atom-react` or remove peer dep

2. **`src/Server/index.ts`** (line 380-420)
   - `handleStream()` must run middleware array
   - Stream chunks must be schema-encoded

3. **`src/Transport/index.ts`** (lines 450-500)
   - Remove batching config OR implement batching
   - Remove SSE references OR implement SSE

4. **`tsconfig.json`**
   - Remove `"exclude": ["test/"]` or fix test types

### Should Fix Soon

5. **`src/Reactivity/index.ts`**
   - Either implement cache or remove invalidation facade

6. **`src/index.ts`**
   - Export missing types used by tests

7. **Documentation**
   - Rewrite to reflect actual capabilities

---

## Recommendations

### Immediate (This Sprint)

1. **Fix streaming middleware bypass** - Security issue
2. **Delete or implement React hooks** - Don't ship throwing stubs
3. **Enable test type-checking** - Fix the 27+ errors

### Short-term (Next 2 Sprints)

4. **Implement actual SSE** - Core streaming functionality
5. **Implement request batching** - Or remove config
6. **Build cache layer** - Before reactivity makes sense

### Medium-term

7. **React integration using @effect-atom/atom-react** - As peer deps suggest
8. **Optimistic updates** - Common React pattern
9. **DevTools** - Query inspection, cache visualization

### Long-term

10. **Feature parity with tRPC** - Subscriptions, links, etc.
11. **Feature parity with Effect RPC** - Schema integration

---

## Next Phase

This report covers internal analysis. The next phase will:

1. Clone and analyze Effect RPC, Effect Atom, Effect Atom React, Effect Reactivity
2. Clone and analyze vanilla tRPC
3. Identify features and patterns we should adopt
4. Create final recommendations with specific implementation proposals

---

## Appendix: All Analysis Logs

| Log | Focus Area |
|-----|------------|
| `logs/01-react-stubs.md` | React hook implementation status |
| `logs/02-transport-layer.md` | HTTP, batching, SSE analysis |
| `logs/03-client-api.md` | Client API design and exports |
| `logs/04-server-handling.md` | Request/stream handling |
| `logs/05-type-utilities.md` | Type system and exports |
| `logs/06-reactivity-system.md` | Cache and invalidation |
| `logs/07-error-handling.md` | Error encoding and propagation |
| `logs/08-api-consistency.md` | API surface consistency |
| `logs/09-test-coverage.md` | Test completeness |
| `logs/10-docs-vs-implementation.md` | Documentation accuracy |
| `logs/11-performance.md` | Performance analysis |
| `logs/12-effect-patterns.md` | Effect idiom compliance |
| `logs/13-module-integration.md` | Module architecture |
| `logs/14-configuration.md` | Config handling |
| `logs/15-edge-cases.md` | Edge case handling |
