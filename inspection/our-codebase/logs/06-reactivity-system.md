# Reactivity System Analysis

**Date:** 2024-01-XX  
**Module:** `/src/Reactivity/index.ts` + React Integration

---

## Executive Summary

The Reactivity module wraps `@effect/experimental/Reactivity` with hierarchical path semantics. The **cache itself is NOT in this module** - it's delegated entirely to `@effect-atom/atom` via the Registry. The Reactivity module only handles invalidation signaling.

---

## Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │           effect-trpc/Reactivity             │
                    │    (Path-based invalidation wrapper)         │
                    │                                              │
                    │  ┌─────────────────────────────────────────┐ │
                    │  │  PathReactivity Service                 │ │
                    │  │  - register(path) → Scoped              │ │
                    │  │  - invalidate(paths)                    │ │
                    │  │  - Hierarchical: "users" → "users/*"    │ │
                    │  └───────────────┬─────────────────────────┘ │
                    └──────────────────│──────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │       @effect/experimental/Reactivity        │
                    │                                              │
                    │  - handlers: Map<key, Set<() => void>>       │
                    │  - invalidate(keys) → calls all handlers     │
                    │  - register(keys, handler) → adds listener   │
                    │  - NO cache storage - just pub/sub           │
                    └──────────────────────────────────────────────┘
                                       │
                    ┌──────────────────▼──────────────────────────┐
                    │       @effect-atom/atom Registry             │
                    │            (ACTUAL CACHE)                    │
                    │                                              │
                    │  - nodes: Map<Atom | string, Node<any>>      │
                    │  - Node contains computed value              │
                    │  - Subscription-based invalidation           │
                    │  - TTL-based cleanup                         │
                    │  - Dependency tracking                       │
                    └──────────────────────────────────────────────┘
```

---

## Cache Storage Status

### Where Cache Actually Lives

| Component | Cache Role | Storage |
|-----------|-----------|---------|
| `effect-trpc/Reactivity` | Invalidation paths only | `HashSet<string>` (registered paths) |
| `@effect/experimental/Reactivity` | Pub/sub handlers | `Map<key, Set<handler>>` |
| `@effect-atom/atom/Registry` | **ACTUAL CACHE** | `Map<Atom, Node>` with computed values |

### Registry Node Structure (from effect-atom)

```typescript
// From inspection/external-repos/effect-atom/packages/atom/src/internal/registry.ts
class Node<A> {
  state: NodeState  // uninitialized | stale | valid | removed
  _value: A         // Cached computed value
  parents: Node[]   // Dependencies
  children: Node[]  // Dependents
  listeners: Set<() => void>  // Subscribers
  lifetime: Lifetime | undefined  // Finalizers, disposal
}

class RegistryImpl {
  nodes = new Map<Atom<any> | string, Node<any>>()  // THE CACHE
  timeoutBuckets = new Map<number, [Set<Node>, handle]>()  // TTL cleanup
}
```

---

## PathReactivity Service Analysis

### Implementation Details

```typescript
// /src/Reactivity/index.ts

// State tracking
const registeredPathsRef = yield* Ref.make(HashSet.empty<string>())  // Path registry

// Reference-counted registration
const pathRegistry = yield* RcMap.make({
  lookup: (path) => Effect.acquireRelease(
    Ref.update(registeredPathsRef, HashSet.add(path)),  // Add on first use
    () => Ref.update(registeredPathsRef, HashSet.remove(path))  // Remove on last release
  )
})
```

### Path Hierarchy Semantics

```typescript
// shouldInvalidate(registeredPath, invalidationPath)
shouldInvalidate("users/list", "users")     // true (child)
shouldInvalidate("users", "users")          // true (exact match)
shouldInvalidate("posts/list", "users")     // false (different tree)
shouldInvalidate("users", "users/list")     // false (parent != child)
```

---

## Effect Atom Integration

### In React Provider (react.ts:80-111)

```typescript
export const createProvider = (router) => {
  return function TrpcProvider({ layer, children }) {
    const contextValue = useMemo(() => {
      const fullLayer = ClientServiceLive.pipe(
        Layer.provideMerge(Reactivity.layer),  // Add Reactivity
        Layer.provide(layer)
      )
      const atomRuntime = Atom.runtime(fullLayer)  // Creates atom context
      return { atomRuntime, rootTag: router.tag }
    }, [layer])
    
    return (
      <RegistryProvider>  // From @effect-atom/atom-react
        <TrpcContext.Provider value={contextValue}>
          {children}
        </TrpcContext.Provider>
      </RegistryProvider>
    )
  }
}
```

### In useQuery Hook (react.ts:149-226)

```typescript
const createUseQuery = (tag, procedure) => {
  // Compute reactivity keys from tag
  const tagParts = tag.split("/").slice(1)  // "@api/users/list" → ["users", "list"]
  const reactivityKeys = tagParts.reduce((acc, part, i) => {
    const key = i === 0 ? part : `${acc[i-1]}/${part}`
    return [...acc, key]  // ["users", "users/list"]
  }, [])
  
  return function useQuery(payload, options) {
    const queryAtom = useMemo(() => {
      let atom = ctx.atomRuntime.atom(queryEffect)
      
      // Register for reactivity
      if (reactivityKeys.length > 0) {
        atom = ctx.atomRuntime.factory.withReactivity(reactivityKeys)(atom)
      }
      return atom
    }, [ctx.atomRuntime, tag])
    
    useAtomMount(queryAtom)  // Keep alive
    const refetch = useAtomRefresh(queryAtom)
    const result = useAtomValue(queryAtom)
    // ...
  }
}
```

### In useMutation Hook (react.ts:255-366)

```typescript
const createUseMutation = (tag, procedure) => {
  const invalidatePaths = procedure.invalidates
  
  return function useMutation(options) {
    const mutationFn = useMemo(() => {
      return ctx.atomRuntime.fn<Payload>()(
        (payload, _get) => Effect.gen(function* () {
          const result = yield* service.send(tag, payload, ...)
          
          // Invalidate on success
          if (invalidatePaths.length > 0) {
            const keys = invalidatePaths.map(path => path.replace(/\./g, "/"))
            yield* Reactivity.invalidate(keys)  // Uses @effect/experimental
          }
          return result
        }),
        { reactivityKeys: invalidatePaths.length > 0 ? invalidatePaths : undefined }
      )
    }, [ctx.atomRuntime, tag])
    // ...
  }
}
```

---

## Invalidation Flow

```
Mutation succeeds
       │
       ▼
Reactivity.invalidate(["users"])    ← effect-trpc
       │
       ▼
PathReactivity.invalidate()
  - Get all registered paths
  - Filter: shouldInvalidate(registered, "users")
  - Expand: ["users", "users/list", "users/get"]
       │
       ▼
inner.invalidate(expandedPaths)     ← @effect/experimental/Reactivity
       │
       ▼
For each key in handlers Map:
  - Call all registered handler functions
       │
       ▼
Handler from withReactivity():      ← @effect-atom
  get.addFinalizer(reactivity.unsafeRegister(keys, () => {
    get.refresh(atom)               ← Triggers atom re-computation
  }))
       │
       ▼
Registry marks Node as stale
  - Node.invalidate()
  - Notifies children (dependent atoms)
  - Triggers recomputation on next read
```

---

## Issues Found

### Critical Issues

| # | Issue | Severity | Location | Description |
|---|-------|----------|----------|-------------|
| 1 | **No effect-trpc cache storage** | High | `/src/Reactivity/` | Effect-trpc has NO cache - completely dependent on @effect-atom |
| 2 | **Tight coupling to effect-atom internals** | High | `react.ts:184-189` | Uses `ctx.atomRuntime.factory.withReactivity` which is internal API |
| 3 | **Async mutation invalidation race** | Medium | `react.ts:284-289` | Invalidation happens inside mutation effect, not after settlement |

### Design Issues

| # | Issue | Severity | Location | Description |
|---|-------|----------|----------|-------------|
| 4 | **Dual invalidation systems** | Medium | `Client/index.ts:186-192` + `react.ts:284-289` | Both ClientService.invalidate and direct Reactivity.invalidate |
| 5 | **Path normalization inconsistency** | Medium | Multiple | Dot-to-slash conversion in multiple places |
| 6 | **No cache key deduplication** | Low | N/A | Same query with same payload creates new atom each time |

### Missing Features

| # | Issue | Severity | Description |
|---|-------|----------|-------------|
| 7 | **No stale-while-revalidate** | Medium | No way to show stale data while refetching |
| 8 | **No cache persistence** | Low | Cache lost on page refresh |
| 9 | **No optimistic update support** | Medium | OptimisticConfig defined but not implemented |
| 10 | **No cache time/staleness control** | Low | No `staleTime`, `cacheTime` options |

---

## Detailed Issue Analysis

### Issue 1: No effect-trpc Cache Storage

**Current State:**
- PathReactivity only tracks registered paths in a `HashSet<string>`
- RcMap provides reference-counted path registration (for cleanup)
- Actual values are stored in @effect-atom's Registry

**Impact:**
- Complete dependency on @effect-atom for caching
- Cannot use effect-trpc without React/effect-atom
- No vanilla JS cache option

**Recommendation:**
Consider whether this is intentional design or if effect-trpc should have its own cache layer for non-React use cases.

### Issue 2: Tight Coupling to Effect-Atom Internals

```typescript
// react.ts:184-189
if (reactivityKeys.length > 0) {
  atom = ctx.atomRuntime.factory.withReactivity(reactivityKeys)(atom)
}
```

**Risk:** `factory.withReactivity` is not documented as public API. Breaking changes in effect-atom could break effect-trpc.

### Issue 3: Async Mutation Race Condition

```typescript
// react.ts:284-289 - Inside the mutation effect
if (invalidatePaths.length > 0) {
  yield* Reactivity.invalidate(keys)  // Happens BEFORE mutation completes
}
return result
```

The invalidation happens as part of the mutation effect, not after it settles. If the mutation fails after invalidation started, queries may refetch with old data.

### Issue 4: Dual Invalidation Systems

**System 1:** `ClientService.invalidate` (Client/index.ts:186-192)
```typescript
invalidate: (paths) =>
  Effect.gen(function* () {
    const pathReactivity = yield* Effect.serviceOption(Reactivity.PathReactivity)
    if (pathReactivity._tag === "Some") {
      yield* pathReactivity.value.invalidate(paths)
    }
  })
```

**System 2:** Direct `Reactivity.invalidate` (react.ts:289)
```typescript
yield* Reactivity.invalidate(keys)  // Uses @effect/experimental directly
```

These are different! System 1 goes through PathReactivity (hierarchical), System 2 goes directly to inner Reactivity.

---

## @effect/experimental/Reactivity Internals

```typescript
// inspection/external-repos/effect/packages/experimental/src/Reactivity.ts:29-55

export const make = Effect.sync(() => {
  const handlers = new Map<number | string, Set<() => void>>()  // Key → handlers

  const unsafeInvalidate = (keys) => {
    if (Array.isArray(keys)) {
      for (const key of keys) {
        const set = handlers.get(stringOrHash(key))
        if (set) for (const run of set) run()  // Call all handlers
      }
    }
    // ... record handling
  }

  const unsafeRegister = (keys, handler) => {
    // Add handler to each key's Set
    // Return cleanup function
  }

  const query = (keys, effect) => {
    // Creates Mailbox, runs effect, registers invalidation handler
    // Handler re-runs effect on invalidation
  }

  return { mutation, query, stream, unsafeInvalidate, invalidate, unsafeRegister }
})
```

**Key Insight:** @effect/experimental/Reactivity is a simple pub/sub system:
- `handlers` Map stores invalidation callbacks per key
- `invalidate(keys)` calls all handlers for those keys
- `register(keys, handler)` subscribes to invalidation events
- **No caching** - just event signaling

---

## Recommendations

### Short-term Fixes

1. **Unify invalidation path:** Use PathReactivity consistently
2. **Fix race condition:** Invalidate after mutation settles, not inside effect
3. **Document dependency:** Clearly state effect-atom is required for caching

### Medium-term Improvements

1. **Add cache layer for vanilla use:**
   ```typescript
   // src/Cache/index.ts
   export interface CacheService {
     get: (key: string) => Effect.Effect<Option<unknown>>
     set: (key: string, value: unknown, ttl?: number) => Effect.Effect<void>
     invalidate: (keys: string[]) => Effect.Effect<void>
   }
   ```

2. **Implement stale-while-revalidate:**
   - Return cached data immediately
   - Refetch in background
   - Update when fresh data arrives

3. **Implement optimistic updates:**
   - Use the existing `OptimisticConfig` definition
   - Apply optimistic value immediately
   - Reconcile on mutation success/failure

### Long-term Architecture

Consider whether effect-trpc should:
- Be a thin wrapper around effect-atom (current approach)
- Have its own cache layer with effect-atom as optional React binding
- Support multiple cache backends (memory, IndexedDB, etc.)

---

## Code Quality Notes

**Strengths:**
- Clean hierarchical path invalidation logic
- Good use of RcMap for reference-counted resources
- Proper scoped resource management

**Weaknesses:**
- Heavy reliance on undocumented effect-atom internals
- Inconsistent path normalization
- Mixed use of direct imports vs service access

---

## Summary

The Reactivity module is a **thin invalidation wrapper** that:
1. Wraps @effect/experimental/Reactivity with path hierarchy
2. Depends entirely on @effect-atom for actual caching
3. Has some integration issues that need addressing

**Cache Status:** No cache in effect-trpc - all caching via @effect-atom Registry.
