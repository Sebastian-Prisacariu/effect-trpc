# Client Module Deep Analysis

**File:** `src/Client/index.ts` (776 lines)  
**Supporting:** `src/Client/react.ts` (457 lines)  
**Date:** 2024

## Architecture Overview

### Dual Client Pattern

The Client module implements a dual-mode API:

```
Client.make(router)
    |
    +-- Unbound Client (React mode)
    |       |-- Provider component
    |       |-- hooks require React context
    |       +-- invalidate() requires global ReactivityService
    |
    +-- BoundClient via .provide(layer)
            |-- ManagedRuntime created
            |-- runPromise() available
            +-- shutdown() for cleanup
```

### Service Architecture

```
Transport.Transport (required)
        |
        v
ClientServiceLive (Layer.effect)
        |
        +-- send(tag, payload, schemas) -> Effect<Success, Error>
        +-- sendStream(tag, payload, schemas) -> Stream<Success, Error>
        +-- invalidate(tags) -> Effect<void> (optional PathReactivity)
```

## API Design Analysis

### Type Inference Flow

```typescript
Router<D extends Definition>
        |
        v
Client<Router<D>> & ClientProxy<D>
        |
        v
ClientProxy<D> = {
  [K in keyof D]: D[K] extends Procedure.Any 
    ? ProcedureClient<D[K]>
    : ClientProxy<D[K]>  // recursive for nested
}
        |
        v
ProcedureClient<P> -> QueryClient | MutationClient | StreamClient
```

### Hook Return Types

| Hook | Return Type | Key Fields |
|------|-------------|------------|
| `useQuery` | `QueryResult<S, E>` | result, data, error, isLoading, refetch |
| `useMutation` | `MutationResult<P, S, E>` | mutate, mutateAsync, reset |
| `useStream` | `StreamResult<S, E>` | data[], latestValue, isConnected, stop |

## Issues Identified

### CRITICAL - Severity: High

#### 1. Unbound Client `invalidate()` Is Broken

**Location:** `src/Client/index.ts:567-573`

```typescript
invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  console.warn("invalidate() on unbound client requires ReactivityService in scope. Use api.provide(layer) first.")
},
```

**Problem:** The unbound client's `invalidate()` only logs a warning and does nothing. This is misleading API - it should either:
- Not exist on unbound client (type-level enforcement)
- Actually work by requiring ReactivityService globally

**Fix:** Remove from unbound Client interface or make it Effect-based requiring PathReactivity.

#### 2. BoundClient `invalidate()` Fire-and-Forget

**Location:** `src/Client/index.ts:584-591`

```typescript
invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* ClientServiceTag
      yield* service.invalidate(tags)
    })
  )  // <-- No await, no error handling!
},
```

**Problems:**
- Returns `void` but runs async - errors are silently swallowed
- No way to know when invalidation completes
- No way to catch invalidation errors

**Fix:** Should return `Promise<void>` with proper error handling.

### HIGH - Severity: High

#### 3. React Types Declared Inline

**Location:** `src/Client/index.ts:499-506`

```typescript
declare namespace React {
  interface FC<P = {}> {
    (props: P): React.ReactElement | null
  }
  type ReactNode = any
  type ReactElement = any
}
```

**Problem:** Inline React type stubs lose type safety. `ReactNode = any` and `ReactElement = any` allow anything.

**Fix:** Use conditional types or proper `@types/react` as dev dependency.

#### 4. Missing Void Payload Handling in MutationClient

**Location:** `src/Client/index.ts:342-357`

```typescript
export interface MutationClient<Payload, Success, Error> {
  readonly run: (payload: Payload) => Effect.Effect<...>
  readonly runPromise: (payload: Payload) => Promise<Success>
}
```

**Problem:** Mutations always require `payload` even when `Payload = void`. Compare to `QueryClient` which handles void:

```typescript
export interface QueryClient<Payload, Success, Error> {
  readonly run: Payload extends void
    ? Effect.Effect<Success, Error, ClientServiceTag>
    : (payload: Payload) => Effect.Effect<...>
}
```

**Fix:** Add conditional type for void payloads in MutationClient.

#### 5. `runPromise` Throws Synchronously on Unbound Client

**Location:** `src/Client/index.ts:636-638`

```typescript
runPromise: runtime
  ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
  : () => { throw new Error("runPromise requires a bound runtime. Use api.provide(layer) first.") },
```

**Problem:** `runPromise` exists at runtime but throws. Users can call it and get a runtime error instead of compile-time error.

**Fix:** Use separate types for unbound vs bound clients to exclude `runPromise` from unbound.

### MEDIUM - Severity: Medium

#### 6. Inconsistent Path/Tag Normalization

**Multiple Locations**

The codebase uses two conventions:
- **Paths:** dot-separated (`users.list`)  
- **Tags:** slash-separated (`@api/users/list`)

Conversion happens in multiple places:
- `Reactivity.normalizePath()` - converts dots to slashes
- `react.ts:286-288` - manual `.replace(/\./g, "/")`
- `Router.tagsToInvalidate()` - uses PathMap

**Problem:** Easy to confuse which format is expected where. Mutation `invalidates` uses dot notation but PathReactivity uses slash notation internally.

**Fix:** Create single source of truth type for Path vs Tag.

#### 7. Stream Implementation Incomplete

**Location:** `src/Client/react.ts:406-456`

```typescript
// Create stream atom using runtime.pull for streams
const streamAtom = useMemo(() => {
  // ...
}, [ctx.atomRuntime, tag, payload])

// Subscribe to stream updates
useEffect(() => {
  // ... simplified - proper implementation would use useAtomValue
```

**Problem:** The stream hook implementation is marked as "simplified" - doesn't actually subscribe to stream values properly.

#### 8. Type Export Gap - Client Types Not Re-exported

**Location:** `src/types.ts`

Missing exports for commonly needed types:
- `Client` - the client interface itself
- `BoundClient` - bound client type
- `ClientProxy` - proxy type
- `ProcedureClient` - single procedure client
- `QueryClient`, `MutationClient`, `StreamClient` - specific clients
- `QueryResult`, `MutationResult`, `StreamResult` - hook results

**Fix:** Add to `types.ts`:
```typescript
export type { 
  Client, 
  BoundClient, 
  ClientProxy,
  QueryClient,
  MutationClient, 
  StreamClient,
  QueryResult,
  MutationResult,
  StreamResult,
} from "./Client/index.js"
```

### LOW - Severity: Low

#### 9. Provider Layer Dependency Not Validated

**Location:** `src/Client/react.ts:86-90`

```typescript
const fullLayer = ClientServiceLive.pipe(
  Layer.provideMerge(Reactivity.layer),
  Layer.provide(layer)
)
```

**Problem:** Uses `@effect/experimental/Reactivity.layer` but expects user's layer to provide `Transport`. No validation that the layer satisfies requirements.

#### 10. ClientServiceTag Exported But Rarely Needed

**Location:** `src/Client/index.ts:90-93`

The `ClientServiceTag` is exported as public API but:
- It's an internal service
- Users shouldn't need to access it directly
- Creates API surface area maintenance burden

**Recommendation:** Mark as `@internal`.

## Missing Type Exports Summary

| Type | Status | Needed For |
|------|--------|------------|
| `Client<R>` | Not exported | Type annotations |
| `BoundClient<R>` | Not exported | Vanilla usage types |
| `ClientProxy<D>` | Not exported | Advanced proxy typing |
| `ProcedureClient<P>` | Not exported | Per-procedure typing |
| `QueryClient<P,S,E>` | Not exported | Query type annotations |
| `MutationClient<P,S,E>` | Not exported | Mutation type annotations |
| `StreamClient<P,S,E>` | Not exported | Stream type annotations |
| `QueryResult<S,E>` | Not exported | Hook return types |
| `MutationResult<P,S,E>` | Not exported | Hook return types |
| `StreamResult<S,E>` | Not exported | Hook return types |
| `QueryOptions` | Not exported | Hook options |
| `MutationOptions<S,E>` | Not exported | Hook options |
| `StreamOptions` | Not exported | Hook options |
| `ProviderProps` | Not exported | Provider customization |
| `ClientService` | Not exported | Testing/mocking |

## Invalidation Mechanism Analysis

### Current Flow

```
Mutation.invalidates: ["users"]
        |
        v (at call time)
ClientService.invalidate(paths)
        |
        v (optional service)
Effect.serviceOption(Reactivity.PathReactivity)
        |
        v (if present)
PathReactivity.invalidate(paths)
        |
        v (normalizes + expands hierarchy)
inner Reactivity.invalidate(unique keys)
```

### Problems with Current Approach

1. **Optional PathReactivity** - If not in scope, invalidation silently does nothing
2. **No confirmation** - Caller doesn't know if invalidation succeeded
3. **Async without awaiting** - BoundClient fires and forgets
4. **Manual path normalization** - Error-prone conversion between formats

### Suggested Improvements

1. Make `PathReactivity` required in Client context (not optional)
2. Return `Effect<void>` or `Promise<void>` from invalidate
3. Add `invalidateSync` for fire-and-forget if needed
4. Create `Path` branded type to enforce format at compile time

## Recommendations

### Immediate (Pre-Release)

1. Fix BoundClient `invalidate()` to return Promise
2. Remove or fix unbound Client `invalidate()`  
3. Add void payload handling to MutationClient
4. Export missing types via `types.ts`

### Short-Term

1. Complete Stream hook implementation
2. Add proper React types via dev dependency
3. Create Path branded type
4. Mark internal services as `@internal`

### Long-Term

1. Consider splitting Client into separate unbound/bound types
2. Add `prefetchQuery` to BoundClient
3. Add batch invalidation with deduplication
4. Consider making invalidation effect-based end-to-end
