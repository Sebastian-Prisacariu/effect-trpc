# Reactivity System - Cache Invalidation Analysis

**Date:** 2026-03-13
**Module:** `src/Reactivity/index.ts`
**Related:** `src/Client/index.ts`, `src/Router/index.ts`

## Executive Summary

The Reactivity module provides a **pub/sub system for cache invalidation** with hierarchical tag matching. While the core invalidation logic is well-designed and tested, **there is NO actual caching**. The system can notify subscribers when data should be invalidated, but there's nothing being cached to invalidate.

**Critical Finding:** This is a cache invalidation system without a cache.

---

## 1. Service Implementation Analysis

### 1.1 Core Structure

```typescript
// src/Reactivity/index.ts:130-211

export const make = (): ReactivityService => {
  // Map of tag -> Set of callbacks
  const subscriptions = new Map<string, Set<InvalidationCallback>>()
  
  // Generate unique subscription IDs (for debugging)
  let nextId = 0
  const callbackIds = new WeakMap<InvalidationCallback, number>()
  
  // ... methods
}
```

**Assessment:**
- Uses standard JavaScript `Map` and `Set` for storage
- No Effect-based state management (no `Ref`, `HashMap`)
- The `callbackIds` WeakMap is declared but only used for debugging (assigning IDs)
- Simple, synchronous implementation

### 1.2 Subscribe Method

```typescript
// src/Reactivity/index.ts:138-160

const subscribe = (tag: string, callback: InvalidationCallback): (() => void) => {
  let callbacks = subscriptions.get(tag)
  if (!callbacks) {
    callbacks = new Set()
    subscriptions.set(tag, callbacks)
  }
  
  callbackIds.set(callback, nextId++)
  callbacks.add(callback)
  
  // Return unsubscribe function
  return () => {
    const set = subscriptions.get(tag)
    if (set) {
      set.delete(callback)
      if (set.size === 0) {
        subscriptions.delete(tag)  // Cleanup empty sets
      }
    }
  }
}
```

**Assessment:**
- **Correct:** Properly returns unsubscribe function
- **Correct:** Cleans up empty Sets when last callback unsubscribes
- **Correct:** Uses Set to prevent duplicate callbacks
- **Issue:** No protection against calling unsubscribe twice (harmless but wasteful)

### 1.3 Invalidate Method

```typescript
// src/Reactivity/index.ts:162-200

const invalidate = (tags: ReadonlyArray<string>): void => {
  const callbacksToInvoke = new Set<InvalidationCallback>()
  
  for (const tag of tags) {
    for (const [subscribedTag, callbacks] of subscriptions) {
      // Exact match
      if (subscribedTag === tag) {
        for (const cb of callbacks) callbacksToInvoke.add(cb)
      }
      // Hierarchical: parent invalidates children
      else if (subscribedTag.startsWith(tag + "/")) {
        for (const cb of callbacks) callbacksToInvoke.add(cb)
      }
      // Reverse hierarchical: child invalidates parent listeners
      else if (tag.startsWith(subscribedTag + "/")) {
        for (const cb of callbacks) callbacksToInvoke.add(cb)
      }
    }
  }
  
  // Invoke all unique callbacks
  for (const callback of callbacksToInvoke) {
    try {
      callback()
    } catch (error) {
      console.error("[Reactivity] Callback error:", error)
    }
  }
}
```

**Assessment:**
- **Correct:** Uses Set to deduplicate callbacks (each callback called once max)
- **Correct:** Error handling prevents one callback from breaking others
- **Good:** O(n*m) complexity where n=invalidation tags, m=subscribed tags
- **Issue:** Callbacks are invoked synchronously in the main thread

---

## 2. Hierarchical Invalidation Correctness

### 2.1 Tag Format

Tags follow a path-based format: `@rootTag/segment1/segment2/...`

Examples:
- `@api/users` - namespace
- `@api/users/list` - specific procedure
- `@api/users/get` - another procedure

### 2.2 Invalidation Rules

| Invalidate | Subscribed To | Result | Reason |
|------------|---------------|--------|--------|
| `@api/users/list` | `@api/users/list` | **INVALIDATED** | Exact match |
| `@api/users` | `@api/users/list` | **INVALIDATED** | Parent invalidates children |
| `@api/users/list` | `@api/users` | **INVALIDATED** | Child notifies parent |
| `@api/users/list` | `@api/posts/list` | No effect | Different branches |
| `@api/users/list` | `@api/user` | No effect | Not same hierarchy |

### 2.3 Test Coverage

The hierarchical logic is well-tested:

```typescript
// test/reactivity.test.ts:112-139

it("supports hierarchical invalidation (parent invalidates children)", () => {
  service.subscribe("@api/users/list", listCallback)
  service.subscribe("@api/users/get", getCallback)
  service.invalidate(["@api/users"])
  expect(listCallback).toHaveBeenCalledTimes(1)
  expect(getCallback).toHaveBeenCalledTimes(1)
})

it("supports reverse hierarchical (child invalidates parent listener)", () => {
  service.subscribe("@api/users", usersCallback)
  service.invalidate(["@api/users/list"])
  expect(usersCallback).toHaveBeenCalledTimes(1)
})
```

**Verdict:** Hierarchical invalidation is **CORRECT**.

---

## 3. Memory Management Assessment

### 3.1 Subscription Cleanup

**Good:**
- Unsubscribe function removes callback from Set
- Empty Sets are deleted from Map (line 155-156)
- No lingering references after unsubscribe

**Potential Issues:**

1. **No lifecycle management with Effect Scope:**
   ```typescript
   // Current: manual unsubscribe
   const unsub = reactivity.subscribe(tag, callback)
   // Must remember to call unsub()
   
   // Better: Effect.acquireRelease pattern
   Effect.acquireRelease(
     Effect.sync(() => reactivity.subscribe(tag, callback)),
     (unsub) => Effect.sync(unsub)
   )
   ```

2. **Closure retention:**
   - If callbacks capture large objects, they persist until unsubscribe
   - No timeout/TTL mechanism

3. **WeakMap for callbackIds is good:**
   - Doesn't prevent garbage collection of callbacks
   - But `nextId` counter grows unbounded (minor)

### 3.2 Memory Leak Scenarios

| Scenario | Leak? | Reason |
|----------|-------|--------|
| Subscribe without unsubscribe | YES | Callback retained forever |
| Component unmounts without cleanup | YES | React hooks not implemented |
| Multiple subscriptions, one unsubscribe | NO | Other subscriptions unaffected |
| Runtime shutdown | DEPENDS | No cleanup hook exists |

---

## 4. Utility Functions

### 4.1 pathsToTags

```typescript
// src/Reactivity/index.ts:279-283

export const pathsToTags = (
  rootTag: string,
  paths: ReadonlyArray<string>
): ReadonlyArray<string> =>
  paths.map((path) => `${rootTag}/${path.replace(/\./g, "/")}`)
```

**Assessment:**
- Converts dot-notation (`users.list`) to slash-notation (`@api/users/list`)
- Simple string manipulation
- **Correct** implementation

### 4.2 shouldInvalidate

```typescript
// src/Reactivity/index.ts:291-305

export const shouldInvalidate = (
  subscribedTag: string,
  invalidatedTag: string
): boolean => {
  if (subscribedTag === invalidatedTag) return true
  if (subscribedTag.startsWith(invalidatedTag + "/")) return true
  if (invalidatedTag.startsWith(subscribedTag + "/")) return true
  return false
}
```

**Assessment:**
- Exported utility for external use
- Same logic as internal `invalidate` method
- **Note:** This function exists separately but the `invalidate` method doesn't use it (code duplication)

---

## 5. Integration with Client

### 5.1 ClientService Integration

```typescript
// src/Client/index.ts:186-192

invalidate: (tags) =>
  Effect.gen(function* () {
    const reactivity = yield* Effect.serviceOption(Reactivity.Reactivity)
    if (reactivity._tag === "Some") {
      reactivity.value.invalidate(tags)
    }
  }),
```

**Critical Issue:** Reactivity is an **optional** service. If not provided, invalidation silently does nothing.

### 5.2 Mutation Auto-Invalidation

```typescript
// src/Client/index.ts:644-665

if (Procedure.isMutation(procedure)) {
  const mutation = procedure as Procedure.Mutation<any, any, any, any>
  const invalidatePaths = mutation.invalidates
  
  const rootTag = tag.split("/")[0]
  
  const createMutationEffect = (payload: unknown) =>
    Effect.gen(function* () {
      const service = yield* ClientServiceTag
      const result = yield* service.send(tag, payload, successSchema, errorSchema)
      
      if (invalidatePaths.length > 0) {
        const tags = Reactivity.pathsToTags(rootTag, invalidatePaths)
        yield* service.invalidate(tags)
      }
      
      return result
    })
}
```

**Assessment:**
- Mutations automatically invalidate after success
- Uses `pathsToTags` to convert procedure paths to tags
- **Issue:** Invalidation happens even if nothing is subscribed

### 5.3 BoundClient Invalidation

```typescript
// src/Client/index.ts:583-590

invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* ClientServiceTag
      yield* service.invalidate(tags)
    })
  )
},
```

**Issue:** Uses `runPromise` but doesn't await it - invalidation is fire-and-forget.

### 5.4 Unbound Client Warning

```typescript
// src/Client/index.ts:566-572

invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  console.warn("invalidate() on unbound client requires ReactivityService in scope...")
},
```

**Issue:** This method does nothing except warn - the tags are computed but not used.

---

## 6. Race Conditions Analysis

### 6.1 Potential Race Conditions

1. **Concurrent invalidation + unsubscribe:**
   ```
   Thread 1: invalidate(["@api/users"])
     - Collects callbacks into Set
     - About to invoke callback
   Thread 2: unsubscribe() called
     - Removes callback from subscriptions Map
   Thread 1: Invokes callback anyway (captured in Set)
   ```
   **Impact:** LOW - callback invoked once after unsubscribe (harmless)

2. **Concurrent subscriptions:**
   ```
   Thread 1: subscribe("@api/users", cb1)
     - Creates new Set for tag
   Thread 2: subscribe("@api/users", cb2)
     - Gets existing Set
   Both modify same Set concurrently
   ```
   **Impact:** LOW in JavaScript (single-threaded), but could be issue with web workers

3. **Mutation racing with subscription:**
   - Query subscribes
   - Mutation starts
   - Query unsubscribes
   - Mutation completes, invalidates
   - Nothing to invalidate
   **Impact:** Data may be stale (no cache to invalidate anyway)

### 6.2 Thread Safety

JavaScript is single-threaded, so most race conditions don't apply. However:
- Effect fibers could interleave
- The synchronous `invalidate` call blocks the fiber

---

## 7. What's Actually Missing: THE CACHE

### 7.1 Current State

The system has:
- Subscription management
- Hierarchical tag matching
- Invalidation callbacks

The system **does NOT have**:
- Any actual cache
- Stored query results
- Stale data detection
- Background refetching

### 7.2 How It Should Work

```
┌─────────────────────────────────────────────────────────────┐
│                    DESIRED ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  useQuery("@api/users/list")                                │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    │
│  │   Atom      │───>│   Cache     │───>│  Reactivity  │    │
│  │  (React)    │    │  (Storage)  │    │  (Pub/Sub)   │    │
│  └─────────────┘    └─────────────┘    └──────────────┘    │
│       │                   │                   │             │
│       │                   │                   │             │
│       ▼                   ▼                   ▼             │
│  Re-renders when     Stores query      Triggers refetch    │
│  atom changes        results           on invalidation     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 Current Reality

```
┌─────────────────────────────────────────────────────────────┐
│                    CURRENT ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  useQuery("@api/users/list")  -->  throws Error!            │
│                                                              │
│  Reactivity exists but nothing subscribes to it             │
│  No cache exists                                             │
│  No atoms exist                                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Integration with @effect-atom/atom

### 8.1 Dependency Status

```json
// package.json
{
  "peerDependencies": {
    "@effect-atom/atom": "^0.5.0",
    "@effect-atom/atom-react": "^0.5.0"
  }
}
```

**Status:** Declared but **NOT USED**.

### 8.2 Current Usage

```typescript
// src/Result/index.ts - ONLY place @effect-atom is imported
export * from "@effect-atom/atom/Result"
```

This only re-exports the `Result` type for the `QueryResult` interface. No actual atom functionality is used.

### 8.3 What Should Exist

```typescript
// Hypothetical implementation
import { Atom } from "@effect-atom/atom"

const createQueryAtom = <S, E>(
  tag: string,
  fetcher: () => Effect.Effect<S, E>,
  reactivity: ReactivityService
): Atom<Result<S, E>> => {
  const atom = Atom.of(Result.initial<S, E>())
  
  // Subscribe to invalidation
  reactivity.subscribe(tag, () => {
    // Refetch and update atom
    runFork(
      fetcher().pipe(
        Effect.map(Result.success),
        Effect.catchAll((e) => Effect.succeed(Result.failure(e))),
        Effect.flatMap((result) => atom.set(result))
      )
    )
  })
  
  return atom
}
```

**This does not exist.**

---

## 9. Summary of Issues

### Critical Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| No actual cache | **CRITICAL** | Invalidation has nothing to invalidate |
| No @effect-atom integration | **CRITICAL** | No reactive state for React |
| React hooks throw errors | **CRITICAL** | React integration non-functional |
| Optional Reactivity service | HIGH | Invalidation silently fails if not provided |

### Design Issues

| Issue | Severity | Impact |
|-------|----------|--------|
| No Effect.acquireRelease for subscriptions | MEDIUM | Manual cleanup required |
| Synchronous callbacks | MEDIUM | Blocks fiber during invalidation |
| Fire-and-forget invalidation in BoundClient | MEDIUM | Errors swallowed |
| Duplicated shouldInvalidate logic | LOW | Code maintainability |

### Testing Gaps

| Gap | Priority |
|-----|----------|
| No integration tests with actual caching | HIGH |
| No tests for concurrent subscribe/invalidate | MEDIUM |
| No tests for memory cleanup | MEDIUM |

---

## 10. Files Analyzed

| File | Lines | Purpose |
|------|-------|---------|
| `src/Reactivity/index.ts` | 305 | Core reactivity service |
| `test/reactivity.test.ts` | 288 | Unit tests |
| `src/Client/index.ts` | 760 | Client integration |
| `src/Router/index.ts` | 420 | tagsToInvalidate utility |
| `src/Result/index.ts` | 10 | Only @effect-atom usage |

---

## 11. Recommendations

### Immediate (P0)

1. **Implement actual caching with @effect-atom:**
   - Create query atoms that store results
   - Subscribe atoms to Reactivity for invalidation
   - Integrate with React hooks

2. **Make Reactivity a required service:**
   - Remove `Effect.serviceOption` pattern
   - Provide ReactivityLive in ClientServiceLive layer

### Short-term (P1)

3. **Add Effect.acquireRelease for subscriptions:**
   ```typescript
   export const subscribeScoped = (tag: string, callback: InvalidationCallback) =>
     Effect.acquireRelease(
       subscribe(tag, callback),
       (unsub) => Effect.sync(unsub)
     )
   ```

4. **Make invalidation async-safe:**
   - Consider Effect.forkDaemon for callbacks
   - Or use Effect.forEach with concurrency control

### Long-term (P2)

5. **Add stale-while-revalidate support**
6. **Add cache TTL/expiration**
7. **Add optimistic update rollback on failure**

---

## Conclusion

The Reactivity module is a **well-designed pub/sub system** with correct hierarchical invalidation logic. However, it exists in isolation - there's no cache to invalidate and no integration with @effect-atom for reactive state management.

**The module is architecturally sound but operationally useless without a caching layer.**
