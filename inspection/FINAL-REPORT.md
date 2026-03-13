# effect-trpc Comprehensive Codebase Review

**Date:** March 2026  
**Analysis Method:** 35 parallel agents  
**Repos Analyzed:** effect-trpc (internal), Effect RPC, Effect Atom, Effect Atom React, tRPC

---

## Executive Summary

This report consolidates findings from a comprehensive review of the effect-trpc codebase, comparing it against Effect RPC, Effect Atom, Effect Atom React, and vanilla tRPC.

### Current State: ~65% Complete

The effect-trpc library has progressed from the previous review. React hooks now exist (though using vanilla React). However, critical issues remain:

| Category | Status | Notes |
|----------|--------|-------|
| Core RPC | Working | Procedure/Router/Server solid |
| Transport (HTTP) | Partial | Batching/SSE not implemented |
| React Integration | **Wrong Architecture** | Uses vanilla React, not @effect-atom/atom-react |
| Stream Middleware | **BYPASSED** | Security issue |
| Caching | **Not Implemented** | Reactivity without cache |

### Top Recommendation

**Properly integrate with Effect Atom.** The codebase lists `@effect-atom/atom-react` as a peer dependency but never imports it. All React hooks use manual `useState` instead of atom-based reactivity.

---

## Part 1: Internal Analysis Summary

### Critical Security Issue

**Streams bypass all middleware** (`Server/index.ts:285-337`). Authentication, authorization, rate limiting - all bypassed for stream procedures.

```typescript
// Current code - middlewares destructured but NEVER used
const { handler, procedure, isStream } = entry  // WHERE IS middlewares?
```

### Major Findings

| Issue | Severity | Location |
|-------|----------|----------|
| Streams bypass middleware | CRITICAL | `Server/index.ts:285-337` |
| @effect-atom/atom-react unused | CRITICAL | `Client/react.ts` - never imported |
| No payload size limits | HIGH | DoS vulnerability |
| Batching config ignored | HIGH | `Transport/index.ts:265-276` |
| SSE not implemented | HIGH | `Transport/index.ts:361` |
| Stream cancellation broken | HIGH | `Client/react.ts:432-436` |
| Silent encoding fallbacks | MEDIUM | `Server/index.ts:252, 260` |
| Custom Reactivity incompatible | MEDIUM | Doesn't use `@effect/experimental/Reactivity` |

### What Works Well

- Core RPC mechanism (Procedure, Router, Server)
- Type utilities (Paths, ProcedureAt, AutoComplete)
- Effect patterns compliance (A- grade)
- API consistency (8.2/10)
- Module architecture (clean DAG except Client circular dep)

---

## Part 2: External Analysis Key Findings

### From Effect RPC

| Finding | Implication |
|---------|-------------|
| Uses Exit-based response model | We should adopt `Exit<Success, Error>` instead of `Success | Failure` |
| Never uses silent fallbacks | Replace our `orElseSucceed` with proper error propagation |
| Streams wrapped in Effects before middleware | **Fix for our stream middleware bypass** |
| No batching implementation | Batching is optional - can remove or implement ourselves |
| HTTP, WebSocket, Worker, Stdio transports | Add WebSocket for subscriptions |

**Critical Pattern for Stream Fix:**
```typescript
// Effect RPC wraps stream in Effect BEFORE middleware
const handler = applyMiddleware(
  rpc, context, clientId, payload, headers,
  isStream ? streamEffect(stream) : effect  // Stream converted to Effect
)
```

### From Effect Atom

| Finding | Implication |
|---------|-------------|
| Registry-based storage with Nodes | This IS the cache - don't create separate one |
| `Result<A, E>` type for async state | Use instead of manual loading/error states |
| Uses `@effect/experimental/Reactivity` | Don't create custom Reactivity service |
| Built-in invalidation via `reactivityKeys` | Leverage for mutation→query invalidation |
| IdleTTL with bucket-based disposal | Use for automatic cache cleanup |

### From Effect Atom React

| Finding | Implication |
|---------|-------------|
| `useSyncExternalStore` foundation | Replace our `useState` with this |
| WeakMap caching for stores | Adopt for memory safety |
| HydrationBoundary for SSR | Use for server-side rendering |
| Suspense via promise throwing | Implement `useQuerySuspense` |
| `runCallbackSync` execution model | Use instead of `runPromise` |

### From tRPC

| Finding | Implication |
|---------|-------------|
| DataLoader pattern for batching | Implement with `setTimeout(dispatch)` |
| Middleware has full context (type, path, meta, signal) | Add these to our middleware |
| Tracked events for subscription reconnection | Consider for stream resumption |
| Options-based API pattern | Aligns well with Effect's functional style |
| Link architecture | Don't adopt - Effect has better composition |

---

## Part 3: Recommended Architecture

### React Integration Strategy

**Current (Wrong):**
```typescript
// Client/react.ts - uses vanilla React
const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
const [isLoading, setIsLoading] = useState(false)
```

**Recommended:**
```typescript
// Use @effect-atom/atom-react properly
import { useAtomSuspense, useAtomValue } from "@effect-atom/atom-react"
import { Atom, Result } from "@effect-atom/atom"

export const useQuery = <A, E>(queryAtom: Atom.Atom<Result.Result<A, E>>) => {
  return useAtomSuspense(queryAtom)
}
```

### Stream Middleware Fix

**Current (Broken):**
```typescript
// handleStream() ignores middlewares completely
const { handler, procedure, isStream } = entry
```

**Recommended (from Effect RPC):**
```typescript
const handleStream = (request) => {
  const middlewareGate = middlewares.length > 0
    ? Middleware.execute(middlewares, toMiddlewareRequest(request), Effect.void)
    : Effect.void
  
  return Stream.unwrap(
    Effect.gen(function* () {
      yield* middlewareGate  // Auth runs HERE
      const payload = yield* Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
      return makeStream(payload)
    })
  )
}
```

### Reactivity Integration

**Current (Wrong):**
```typescript
// Custom Reactivity service incompatible with Effect Atom
export class Reactivity extends Context.Tag("Reactivity")<Reactivity, ReactivityService>() {}
```

**Recommended:**
```typescript
// Use @effect/experimental/Reactivity
import { Reactivity } from "@effect/experimental"

// Then use Atom.withReactivity() for query atoms
const queryAtom = Atom.of(Result.initial<User, Error>()).pipe(
  Atom.withReactivity(["users", "list"])
)
```

---

## Part 4: Implementation Roadmap

### Phase 1: Security & Critical Fixes (Week 1)

| Task | Priority | Effort |
|------|----------|--------|
| Fix stream middleware bypass | CRITICAL | 2 days |
| Add payload size limits | HIGH | 1 day |
| Replace silent encoding fallbacks | HIGH | 1 day |
| Enable test type-checking | MEDIUM | 0.5 days |

### Phase 2: React Architecture (Weeks 2-3)

| Task | Priority | Effort |
|------|----------|--------|
| Decide: use @effect-atom/atom-react OR remove peer dep | CRITICAL | Decision |
| If using: refactor hooks to use `useAtomSuspense` | HIGH | 3 days |
| Implement proper stream cancellation | HIGH | 2 days |
| Add Suspense support | MEDIUM | 2 days |
| Break circular dependency in Client | MEDIUM | 1 day |

### Phase 3: Transport & Batching (Weeks 4-5)

| Task | Priority | Effort |
|------|----------|--------|
| Remove batching config OR implement batching | HIGH | 3 days |
| Implement SSE OR remove references | MEDIUM | 3 days |
| Add WebSocket transport for subscriptions | MEDIUM | 4 days |

### Phase 4: Middleware Enhancement (Week 6)

| Task | Priority | Effort |
|------|----------|--------|
| Add procedure type to middleware context | MEDIUM | 1 day |
| Add procedure path to middleware context | MEDIUM | 1 day |
| Add AbortSignal support | MEDIUM | 2 days |

### Phase 5: Polish & SSR (Weeks 7-8)

| Task | Priority | Effort |
|------|----------|--------|
| SSR with HydrationBoundary | MEDIUM | 3 days |
| DevTools (query inspector) | LOW | 3 days |
| Documentation rewrite | MEDIUM | 3 days |

---

## Part 5: Decision Points

### Decision 1: @effect-atom/atom-react

**Options:**
1. **Use it** - Refactor all hooks to use `useAtomSuspense`, `useAtomValue`, etc.
2. **Remove it** - Delete from peer deps, document that hooks are vanilla React

**Recommendation:** Use it. It provides:
- Proper reactive subscriptions
- Suspense support
- SSR hydration
- Memory-safe caching

### Decision 2: Batching

**Options:**
1. **Remove config** - Delete `HttpOptions.batching` since Effect RPC doesn't have it either
2. **Implement it** - Use tRPC's DataLoader pattern with `setTimeout(dispatch)`

**Recommendation:** Remove for MVP, implement later if needed.

### Decision 3: Custom Reactivity

**Options:**
1. **Keep custom** - Continue maintaining parallel system
2. **Use @effect/experimental/Reactivity** - What Effect Atom uses

**Recommendation:** Use `@effect/experimental/Reactivity` for compatibility with Effect ecosystem.

---

## Appendix: All Analysis Files

### Internal Analysis (15 files)
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

### Effect RPC Analysis (5 files)
```
/inspection/effect-rpc/scan/01-schema-encoding.md
/inspection/effect-rpc/scan/02-streaming-middleware.md
/inspection/effect-rpc/scan/03-batching.md
/inspection/effect-rpc/scan/04-error-handling.md
/inspection/effect-rpc/scan/05-transports.md
```

### Effect Atom Analysis (5 files)
```
/inspection/effect-atom/scan/06-cache-storage.md
/inspection/effect-atom/scan/07-subscriptions.md
/inspection/effect-atom/scan/08-services.md
/inspection/effect-atom/scan/09-invalidation.md
/inspection/effect-atom/scan/10-async.md
```

### Effect Atom React Analysis (5 files)
```
/inspection/effect-atom-react/scan/11-hooks.md
/inspection/effect-atom-react/scan/12-provider.md
/inspection/effect-atom-react/scan/13-suspense.md
/inspection/effect-atom-react/scan/14-effect-lifecycle.md
/inspection/effect-atom-react/scan/15-ssr.md
```

### tRPC Analysis (5 files)
```
/inspection/trpc/scan/16-react-query.md
/inspection/trpc/scan/17-batching.md
/inspection/trpc/scan/18-subscriptions.md
/inspection/trpc/scan/19-middleware.md
/inspection/trpc/scan/20-links.md
```

---

## Conclusion

The effect-trpc library has a solid foundation (~65% complete) but has architectural issues that need resolution:

1. **Critical: Fix stream middleware bypass** - Security issue
2. **Critical: Actually use @effect-atom/atom-react** - Listed as peer dep but never imported
3. **High: Implement or remove batching/SSE** - Don't ship fake features
4. **Medium: Adopt @effect/experimental/Reactivity** - For ecosystem compatibility

The recommended path forward is to properly integrate with Effect Atom rather than maintaining parallel implementations. This will provide reactive state management, SSR support, and Suspense integration with minimal effort.

**Total Analysis:** 35 detailed reports across 5 codebases.
