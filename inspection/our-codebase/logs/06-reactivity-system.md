# Reactivity System Analysis

## Overview

The `Reactivity` module (`src/Reactivity/index.ts`) is a **pub/sub invalidation coordinator** — it provides **NO actual cache**. It only notifies subscribers when tags are invalidated, triggering refetches.

## What the Module Actually Provides

### Core API

```typescript
interface ReactivityService {
  subscribe(tag: string, callback: () => void): () => void  // Returns unsubscribe
  invalidate(tags: ReadonlyArray<string>): void             // Triggers callbacks
  getSubscribedTags(): ReadonlyArray<string>                // Debug helper
}
```

### Implementation Details

1. **Subscription Storage**: Uses `Map<string, Set<InvalidationCallback>>`
2. **Hierarchical Invalidation**: Supports parent/child tag relationships
   - Invalidating `@api/users` triggers `@api/users/list` (child)
   - Invalidating `@api/users/list` triggers `@api/users` (parent)
3. **Callback Deduplication**: Uses `Set<InvalidationCallback>` to avoid duplicate invocations

### Utilities

```typescript
// Convert procedure paths to tags
pathsToTags("@api", ["users", "users.list"])
// → ["@api/users", "@api/users/list"]

// Check if tag should be invalidated
shouldInvalidate("@api/users/list", "@api/users")  // true
```

## Cache Analysis: NO CACHE EXISTS

| Component | Has Cache? | Notes |
|-----------|------------|-------|
| `Reactivity` module | **NO** | Pure pub/sub |
| React hooks (`useQuery`) | **NO** | Re-fetches every call |
| `ClientService` | **NO** | Direct pass-through |
| Transport layer | **NO** | HTTP/WebSocket direct |

### Where Data "Lives"

Data only exists in React component state:
```typescript
// src/Client/react.ts:151
const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
```

Each `useQuery` hook:
1. Fetches on mount
2. Stores result in local `useState`
3. Re-fetches when invalidated (via Reactivity subscription)

**There is no shared cache between components.**

## Comparison with @effect/experimental/Reactivity

### Effect's Official Reactivity

```typescript
interface Service {
  // Wraps effect, invalidates keys after completion
  mutation<A, E, R>(keys, effect): Effect<A, E, R>
  
  // Creates reactive stream that re-executes on invalidation
  query<A, E, R>(keys, effect): Effect<Mailbox<A, E>, never, R | Scope>
  
  // Converts query to Stream
  stream<A, E, R>(keys, effect): Stream<A, E, R>
  
  invalidate(keys): Effect<void>
  unsafeInvalidate(keys): void
  unsafeRegister(keys, handler): () => void
}
```

**Key Differences:**

| Feature | Our Reactivity | @effect/experimental/Reactivity |
|---------|----------------|--------------------------------|
| Effect integration | Minimal (wrappers only) | Deep (Effect-native) |
| Query pattern | None | `query()` returns Mailbox |
| Mutation wrapping | Manual | `mutation()` auto-invalidates |
| Stream support | None | `stream()` built-in |
| Key types | Strings only | Any (hashed) + Records |
| Scope awareness | No | Yes |

### What We're Missing

1. **`query()`**: Effect-based reactive query that automatically re-executes
2. **`mutation()`**: Wraps effect and auto-invalidates after success
3. **Hash-based keys**: Support for any hashable value, not just strings
4. **Record keys**: `{ users: [1, 2, 3] }` syntax for fine-grained invalidation

## Integration Analysis

### With React Hooks

**In `src/Client/react.ts`:**

```typescript
// Provider creates separate Reactivity instance
const [contextValue] = useState<ClientContextValue>(() => ({
  runtime: ManagedRuntime.make(fullLayer),
  reactivity: Reactivity.make(),  // Separate instance!
  rootTag: router.tag,
}))

// useQuery subscribes to tag
useEffect(() => {
  const unsubscribe = ctx.reactivity.subscribe(tag, () => {
    fetchData()  // Re-fetch on invalidation
  })
  return unsubscribe
}, [tag, ctx.reactivity, fetchData])

// useMutation invalidates after success
if (invalidatePaths.length > 0) {
  const tags = Reactivity.pathsToTags(ctx.rootTag, invalidatePaths)
  ctx.reactivity.invalidate(tags)
}
```

### With Effect Atom

**Currently: NO INTEGRATION**

Our code imports `@effect-atom/atom/Result` for the Result type only:
```typescript
import * as Result from "@effect-atom/atom/Result"
```

Effect Atom uses `@effect/experimental/Reactivity`:
```typescript
// From effect-atom's Atom.ts
import * as Reactivity from "@effect/experimental/Reactivity"

factory.withReactivity = (keys: ReadonlyArray<unknown>) => 
  <A extends Atom<any>>(atom: A): A => { ... }
```

**The two Reactivity systems are incompatible.**

## Issues

### CRITICAL

1. **Duplicate Reactivity Systems** - Severity: **CRITICAL**
   - We define our own `Reactivity` service
   - Effect Atom uses `@effect/experimental/Reactivity`
   - Two incompatible invalidation systems
   - Atoms won't respond to our invalidations

2. **No Shared Cache** - Severity: **CRITICAL**
   - Each `useQuery` is independent
   - Duplicate requests for same data
   - No request deduplication
   - Memory waste, network waste

### HIGH

3. **No Stale-While-Revalidate** - Severity: **HIGH**
   - Options exist (`staleTime` in QueryOptions)
   - But no implementation — always re-fetches
   - Causes unnecessary loading states

4. **Provider Creates Separate Reactivity** - Severity: **HIGH**
   - `react.ts:89`: `const reactivity = Reactivity.make()`
   - `react.ts:84-86`: Also provides `Reactivity.ReactivityLive` to Layer
   - Two separate instances! Layer's instance unused.

### MEDIUM

5. **String-Only Keys** - Severity: **MEDIUM**
   - Can't invalidate by ID: `{ users: [userId] }`
   - Must invalidate entire tag: `["@api/users"]`
   - Less granular than Effect's Reactivity

6. **No Optimistic Updates** - Severity: **MEDIUM**
   - Mutations wait for server response
   - No way to update UI optimistically
   - Worse UX for slow networks

7. **Console.error in Production** - Severity: **MEDIUM**
   - Line 197: `console.error("[Reactivity] Callback error:", error)`
   - Should use proper error channel

### LOW

8. **Unused Effect Imports** - Severity: **LOW**
   - Lines 34-38: Import `Ref`, `HashMap`, `HashSet`, `Option`
   - None are used in implementation

9. **Debug-Only API Exposed** - Severity: **LOW**
   - `getSubscribedTags()` is debug-only but in public API

## Architecture Recommendation

### Option A: Use @effect/experimental/Reactivity

Replace our `Reactivity` with Effect's official one:
```typescript
import * as Reactivity from "@effect/experimental/Reactivity"

// Mutations auto-invalidate
const createUser = Reactivity.mutation(
  ["users"],
  Effect.gen(function* () { ... })
)

// Queries auto-refresh
const users = Reactivity.stream(
  ["users"],
  Effect.gen(function* () { ... })
)
```

**Pros:**
- Compatible with Effect Atom
- Better primitives (`query`, `mutation`, `stream`)
- Maintained by Effect team

**Cons:**
- API change for users
- Need to rework React integration

### Option B: Add Real Cache Layer

Keep our Reactivity but add cache:
```typescript
interface QueryCache {
  get<A>(key: string): Option<CacheEntry<A>>
  set<A>(key: string, value: A, ttl?: Duration): void
  invalidate(tags: ReadonlyArray<string>): void
}
```

**Pros:**
- Deduplication
- Stale-while-revalidate
- Better performance

**Cons:**
- Still incompatible with Effect Atom
- Maintenance burden

### Recommendation

**Use Option A** — adopt `@effect/experimental/Reactivity`:
1. Compatibility with Effect ecosystem
2. Better primitives
3. Less code to maintain
4. Future-proof (Effect team maintains it)

## Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Cache | **MISSING** | No cache exists anywhere |
| Invalidation | Working | Pub/sub pattern functional |
| Effect Atom | **INCOMPATIBLE** | Different Reactivity systems |
| React Integration | Partial | Works but no cache benefits |
| Performance | Poor | Every query re-fetches |

The current Reactivity module is a minimal pub/sub system. For a production-ready library, we need:
1. Real cache with TTL/stale-while-revalidate
2. Compatibility with Effect Atom's Reactivity
3. Request deduplication
4. Optimistic updates
