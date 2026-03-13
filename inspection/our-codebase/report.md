# effect-trpc Internal Analysis Report

**Date:** March 2026  
**Version Analyzed:** Current main branch  
**Analysis Method:** 15 parallel deep-dive agents

---

## Executive Summary

The effect-trpc library is approximately **65% complete** (up from previous estimate of 40%). The core RPC mechanism works, and React hooks have been implemented. However, critical issues remain:

1. **React hooks use vanilla React** - `@effect-atom/atom-react` is a peer dependency but is never imported
2. **Streams bypass all middleware** - Security issue, auth/rate-limiting don't run
3. **Batching/SSE not implemented** - Config exists but is ignored
4. **No payload size limits** - DoS vulnerability

---

## Severity Classification

### CRITICAL (Security/Breaking)

| Issue | Location | Impact |
|-------|----------|--------|
| Streams bypass middleware | `Server/index.ts:285-337` | Auth bypass on all stream procedures |
| No payload size limits | `Transport/index.ts` | OOM/DoS attack vector |
| @effect-atom/atom-react unused | `Client/react.ts` | Violates project requirements |

### HIGH (Major Functionality)

| Issue | Location | Impact |
|-------|----------|--------|
| SSE not implemented | `Transport/index.ts:361` | Streaming doesn't work over HTTP |
| Batching config ignored | `Transport/index.ts:265-276` | Performance optimization unavailable |
| Stream cancellation broken | `Client/react.ts:432-436` | Memory leaks, zombie streams |
| Test types not checked | `tsconfig.json` | Type errors in tests undetected |
| Custom Reactivity incompatible | `Reactivity/index.ts` | Can't integrate with Effect Atom |

### MEDIUM (Should Fix)

| Issue | Location | Impact |
|-------|----------|--------|
| Stream chunks not encoded | `Server/index.ts:309-323` | Type safety gap |
| Silent encoding fallbacks | `Server/index.ts:252, 260` | Debugging difficulty |
| Missing type exports | `Client/index.ts` | Consumer type errors |
| Circular dependency | `Client/index.ts` ↔ `react.ts` | Bundling issues |
| Duplicate Reactivity instances | `Client/react.ts` | Wasted resources |

### LOW (Polish)

| Issue | Location | Impact |
|-------|----------|--------|
| Per-request allocations | `Middleware/index.ts` | Minor perf impact |
| Missing type guards | Various | API inconsistency |
| Documentation 55-60% accurate | `docs/` | User confusion |

---

## Module Completeness

```
Procedure    [===================  ] 95%  - Solid
Router       [==================   ] 90%  - Good
Middleware   [==================   ] 90%  - Works (not for streams)
Server       [==============       ] 70%  - Streams need middleware
Client       [================     ] 80%  - Missing type exports
Transport    [============         ] 60%  - Batching/SSE missing
React        [==============       ] 70%  - Wrong architecture
Reactivity   [========             ] 40%  - No cache, wrong system

OVERALL      [=============        ] 65%
```

---

## React Integration Analysis

### Current State

The React hooks (`useQuery`, `useMutation`, `useStream`) are **implemented but use vanilla React**:

```typescript
// What's actually implemented:
const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
const [isLoading, setIsLoading] = useState(false)
const mountedRef = useRef(true)

// What SHOULD be used (per CLAUDE.md requirements):
import { useAtom, useAtomValue } from "@effect-atom/atom-react"
const [result, setResult] = useAtom(queryAtom)
```

### Imports Analysis

| Dependency | Listed In | Actually Used |
|------------|-----------|---------------|
| `@effect-atom/atom` | peerDependencies | `Result` type only |
| `@effect-atom/atom-react` | peerDependencies | **NEVER IMPORTED** |
| `react` | peerDependencies | Standard hooks |

---

## Stream Middleware Bypass

### The Problem

`handleStream()` collects middleware but never executes it:

```typescript
// Line 285-337 in Server/index.ts
const { handler, procedure, isStream } = entry  // middlewares NOT destructured
// ... middleware NEVER applied
```

### Security Impact

```typescript
// This LOOKS protected...
const adminRouter = Router.withMiddleware([AuthMiddleware, AdminMiddleware], {
  events: Procedure.stream({ success: AdminEvent }),  // NOT protected!
  list: Procedure.query({ success: Schema.Array(Admin) }),  // Protected
})
```

---

## Configuration That Does Nothing

| Config | Location | Status |
|--------|----------|--------|
| `batching.enabled` | `HttpOptions` | Ignored |
| `batching.maxItems` | `HttpOptions` | Ignored |
| `batching.maxURLLength` | `HttpOptions` | Ignored |
| `staleTime` | `QueryOptions` | Extracted, never used |
| `optimistic` | `MutationOptions` | Stored, never executed |
| `HttpHandlerOptions.path` | Adapters | Prefixed with `_` |

---

## Files Requiring Immediate Attention

### Must Fix Before Any Release

1. **`src/Server/index.ts`** (lines 285-337)
   - Execute middleware for streams
   - Encode stream chunks through schema

2. **`src/Client/react.ts`** (entire file)
   - Either use `@effect-atom/atom-react` OR remove from peer deps
   - Implement proper stream cancellation

3. **`src/Transport/index.ts`** (lines 265-276, 361)
   - Remove batching config OR implement batching
   - Implement SSE OR remove references

4. **`tsconfig.json`**
   - Remove `"exclude": ["test"]` or create `tsconfig.test.json`

---

## Test Coverage Assessment

**Overall: ~60%**

| Area | Coverage | Notes |
|------|----------|-------|
| Reactivity | 95% | Excellent |
| Procedure | 85% | Good |
| Router | 80% | Good |
| Server | 60% | Missing middleware verification |
| Client | 40% | React hooks untested |
| Transport | 50% | Missing loopback tests |

### Critical Test Gaps

- React hook functionality (only tests "throws outside context")
- `Client.run()` / `Client.runPromise()` / `Client.prefetch()`
- Middleware actually executes and provides context
- Stream with middleware

---

## Effect Patterns Compliance

**Grade: A-**

| Pattern | Status |
|---------|--------|
| No async/await | COMPLIANT (boundary only) |
| No try/catch | COMPLIANT (boundary only) |
| No throw | COMPLIANT (guards only) |
| No Schema.decodeUnknownSync | COMPLIANT |
| No JSON.parse | COMPLIANT |
| No @ts-ignore | COMPLIANT |
| Context.Tag services | EXCELLENT |
| Layer composition | EXCELLENT |

---

## Recommendations

### Immediate (This Sprint)

1. **Fix stream middleware bypass** - Security issue
2. **Decide on @effect-atom/atom-react** - Use it OR remove peer dep
3. **Add payload size limits** - DoS protection
4. **Enable test type-checking**

### Short-term (Next 2 Sprints)

5. **Implement SSE OR remove** - Don't ship fake features
6. **Implement batching OR remove config**
7. **Break circular dependency** - Extract shared types
8. **Fix stream cancellation**

### Medium-term

9. **Refactor to use Effect Atom** - Proper reactive state
10. **Add comprehensive React tests**
11. **Rewrite documentation** - Only document working features

---

## Next Phase

This report covers internal analysis. The next phase will:

1. Analyze Effect RPC patterns (streaming, middleware, encoding)
2. Analyze Effect Atom patterns (cache, subscriptions, services)
3. Analyze Effect Atom React patterns (hooks, Provider, Suspense)
4. Analyze tRPC patterns (batching, React Query, links)
5. Create final recommendations with implementation proposals
