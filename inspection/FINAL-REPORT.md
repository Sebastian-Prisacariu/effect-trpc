# effect-trpc Comprehensive Codebase Review

**Date:** March 2026  
**Analysis Method:** 35 parallel agents  
**Repos Analyzed:** effect-trpc (internal), Effect RPC, Effect Atom, Effect Atom React, tRPC

---

## Executive Summary

This report consolidates findings from a comprehensive multi-day review of the effect-trpc codebase, comparing it against Effect RPC, Effect Atom, Effect Atom React, and vanilla tRPC.

### Current State: ~40% Complete

The effect-trpc library has a solid core RPC mechanism but critical features are either stubs or completely unimplemented:

| Category | Status |
|----------|--------|
| Core RPC (Procedure/Router/Server) | Working |
| Transport (HTTP basic) | Working |
| React Integration | **100% Stubs** |
| Caching | **Not Implemented** |
| Request Batching | **Not Implemented** |
| SSE/WebSocket | **Not Implemented** |
| Stream Middleware | **Bypassed (Security Issue)** |

### Key Recommendation

**Build on Effect Atom, don't recreate it.** Effect Atom provides exactly the reactive state management we need. Our React hooks should wrap Effect Atom React, not implement parallel functionality.

---

## Part 1: Internal Analysis Summary

### Critical Security Issue

**Streams bypass all middleware** in `Server.handleStream()`. Authentication, authorization, and other middleware do NOT run for stream procedures. This must be fixed before any release.

### Major Gaps

1. **React hooks throw errors** - `useQuery`, `useMutation`, `useStream` are stubs
2. **No cache exists** - Reactivity module has invalidation with nothing to invalidate
3. **Batching config ignored** - `Transport.http({batching: {enabled: true}})` does nothing
4. **SSE not implemented** - Has TODO comment, wraps single HTTP request
5. **Test types not checked** - tsconfig excludes test/, 27+ type errors

### What Works Well

- Procedure/Router/Server architecture
- Type utilities (Paths, ProcedureAt, AutoComplete)
- Middleware system (server-side)
- Loopback and Mock transports
- Effect patterns (mostly)

---

## Part 2: External Analysis Findings

### From Effect RPC

| Hypothesis | Finding | Action |
|------------|---------|--------|
| H1: Schema encoding | Uses bidirectional encode/decode, Exit schema | Adopt Exit schema, add client-side encode |
| H2: Stream middleware | Streams converted to Effect BEFORE middleware | Fix our stream handling immediately |
| H3: Batching | Not implemented in Effect RPC | Consider removing or implementing ourselves |
| H4: Error handling | Never silent - layered fallbacks with logging | Replace `orElseSucceed` with proper handling |
| H5: Transports | HTTP, WebSocket, Socket, Worker, Stdio | Add WebSocket, skip SSE for now |

**Key Pattern:** Effect RPC wraps streams in Effects before applying middleware via `streamEffect()`. This ensures middleware runs and context propagates.

### From Effect Atom

| Hypothesis | Finding | Action |
|------------|---------|--------|
| H6: Cache storage | Registry-centric with Node objects | Build on Atom, don't reinvent |
| H7: Subscriptions | Pull-based with push notifications | Use Atom's subscription model |
| H8: Services | Clean Context.Tag pattern | Follow AtomRuntime pattern |
| H9: Invalidation | Built-in refresh, reactivity keys | Leverage existing invalidation |
| H10: Async state | Result<A,E> with waiting flag | Use Result type for query states |

**Key Pattern:** Effect Atom's `Result<A, E>` type perfectly models query states:
- `Initial` - Loading (no previous data)
- `Success` - Data available (can have `waiting: true` for refetch)
- `Failure` - Error (preserves `previousSuccess` for stale-while-revalidate)

### From Effect Atom React

| Hypothesis | Finding | Action |
|------------|---------|--------|
| H11: Hooks | useSyncExternalStore with WeakMap cache | Use their hooks, don't reimplement |
| H12: Provider | RegistryProvider with React scheduler | Wrap their Provider |
| H13: Suspense | useAtomSuspense with promise throwing | Delegate to their Suspense hook |
| H14: Effect lifecycle | Sync-first execution, scope cleanup | Follow their patterns |
| H15: SSR | "use client", HydrationBoundary | Use their SSR infrastructure |

**Key Pattern:** All React hooks should delegate to Effect Atom React. We add tRPC-specific query/mutation atom creation, not new hook implementations.

### From tRPC

| Hypothesis | Finding | Action |
|------------|---------|--------|
| H16: React Query | Proxy-based hook generation | Use proxy pattern for API |
| H17: Batching | DataLoader pattern, setTimeout(0) | Implement if needed |
| H18: Subscriptions | WebSocket + SSE with tracked events | Add WebSocket support |
| H19: Middleware | Rich context (type, path, meta, signal) | Add missing context values |
| H20: Links | Composable transport middleware | Don't adopt - Effect has better composition |

**Key Pattern:** tRPC's proxy-based API (`trpc.users.get.useQuery()`) is excellent UX. We should generate this from router definitions.

---

## Part 3: Recommended Architecture

### Package Structure

```
@effect-trpc/core          - Procedure, Router, Server, Transport
@effect-trpc/client        - Type-safe client with proxy API
@effect-trpc/atom          - Query atoms, mutation atoms (uses @effect-atom/atom)
@effect-trpc/react         - React hooks (wraps @effect-atom/atom-react)
```

### Query State Model

Use Effect Atom's `Result<A, E>`:

```typescript
type QueryResult<A, E> = Result.Result<A, E>
// Initial - loading, no data
// Success - data available, optional waiting flag for refetch
// Failure - error, optional previousSuccess for SWR
```

### React Integration Strategy

```typescript
// Don't do this (our current approach):
export const useQuery = () => {
  throw new Error("requires React")  // Stub!
}

// Do this instead:
import { useAtomSuspense } from "@effect-atom/atom-react"

export const useQuery = <A, E>(queryAtom: Atom<Result<A, E>>) => {
  return useAtomSuspense(queryAtom)
}
```

### Middleware Fix (Critical)

Current (broken):
```typescript
// Server.handleStream() - middleware array is IGNORED
const handler = procedureHandler
// ...run handler without middleware
```

Fixed (from Effect RPC pattern):
```typescript
// Convert stream to Effect, then apply middleware
const handler = applyMiddleware(
  rpc,
  context,
  clientId,
  payload,
  headers,
  isStream
    ? streamEffect(client, request, streamOrEffect)  // Wrap stream first
    : streamOrEffect
)
```

---

## Part 4: Implementation Roadmap

### Phase 1: Security & Correctness (Week 1)

1. **Fix stream middleware bypass** - Adopt Effect RPC's `streamEffect()` pattern
2. **Fix silent error handling** - Replace `orElseSucceed` with logging/propagation
3. **Enable test type-checking** - Remove exclude, fix 27+ errors
4. **Add missing type exports** - ProcedurePayload, ProcedureSuccess, etc.

### Phase 2: Remove Lies (Week 2)

5. **Delete React stubs** - Remove hooks that throw errors
6. **Remove batching config** - Or implement it (see Phase 4)
7. **Update documentation** - Only document working features
8. **Clean up examples** - Fix or remove desired-api.ts (88+ errors)

### Phase 3: Build on Effect Atom (Weeks 3-4)

9. **Create @effect-trpc/atom** - Query/mutation atom factories
10. **Create @effect-trpc/react** - Thin wrapper over atom-react
11. **Implement QueryCache** - Use AtomRegistry as the cache
12. **Implement invalidation** - Leverage Atom's reactivity keys

### Phase 4: Feature Parity (Weeks 5-8)

13. **WebSocket transport** - For subscriptions
14. **Request batching** - DataLoader pattern from tRPC
15. **Middleware context** - Add type, path, meta, signal
16. **SSR support** - Use Atom's HydrationBoundary

### Phase 5: Polish (Weeks 9-12)

17. **DevTools** - Query inspector, cache visualization
18. **Optimistic updates** - Pattern from atom-react
19. **Retry/stale-while-revalidate** - Built into atom
20. **Full tRPC API compatibility** - Links equivalent via Transport

---

## Part 5: Files Changed Summary

### Files Needing Immediate Attention

| File | Issue | Priority |
|------|-------|----------|
| `src/Server/index.ts` | Stream middleware bypass | CRITICAL |
| `src/Client/index.ts` | Stub React hooks | HIGH |
| `src/Transport/index.ts` | Fake batching config | HIGH |
| `src/Reactivity/index.ts` | Invalidation without cache | HIGH |
| `tsconfig.json` | Test exclusion | MEDIUM |
| `docs/*.md` | Fictional documentation | MEDIUM |

### Files That Are Good

| File | Status |
|------|--------|
| `src/Procedure/index.ts` | Solid |
| `src/Router/index.ts` | Good |
| `src/Middleware/index.ts` | Good |
| `src/Result/index.ts` | Fine (just re-export) |

---

## Appendix: All Analysis Files

### Internal Analysis (15 files)
```
/inspection/our-codebase/logs/01-react-stubs.md
/inspection/our-codebase/logs/02-transport-layer.md
/inspection/our-codebase/logs/03-client-api.md
/inspection/our-codebase/logs/04-server-handling.md
/inspection/our-codebase/logs/05-type-utilities.md
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

The effect-trpc library has a solid foundation in its core RPC mechanism, but significant work remains before it's production-ready. The most important findings are:

1. **Critical security fix needed** - Streams bypassing middleware
2. **Don't reinvent Effect Atom** - Build on it instead
3. **Delete stubs, don't ship lies** - Remove fake features
4. **Follow Effect RPC patterns** - They've solved the hard problems

The recommended path forward is to leverage Effect Atom for state management and Effect Atom React for React integration, focusing effect-trpc on the RPC protocol layer and query/mutation atom creation.

Total analysis: 35 detailed reports across 5 codebases.
