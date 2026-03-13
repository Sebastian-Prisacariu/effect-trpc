# H13: Suspense Integration

## Overview

Effect Atom React implements React Suspense through the `useAtomSuspense` hook, using the standard promise-throwing pattern. The implementation is tightly integrated with the `Result` type system.

## Core Implementation

### The `useAtomSuspense` Hook

**Location:** `packages/atom-react/src/Hooks.ts:257-270`

```typescript
export const useAtomSuspense = <A, E, const IncludeFailure extends boolean = false>(
  atom: Atom.Atom<Result.Result<A, E>>,
  options?: {
    readonly suspendOnWaiting?: boolean | undefined
    readonly includeFailure?: IncludeFailure | undefined
  }
): Result.Success<A, E> | (IncludeFailure extends true ? Result.Failure<A, E> : never) => {
  const registry = React.useContext(RegistryContext)
  const result = atomResultOrSuspend(registry, atom, options?.suspendOnWaiting ?? false)
  if (result._tag === "Failure" && !options?.includeFailure) {
    throw Cause.squash(result.cause)
  }
  return result as any
}
```

### Promise Throwing Logic

**Location:** `packages/atom-react/src/Hooks.ts:241-251`

```typescript
function atomResultOrSuspend<A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)
  }
  return value
}
```

### Promise Creation and Caching

**Location:** `packages/atom-react/src/Hooks.ts:209-239`

```typescript
const atomPromiseMap = globalValue(
  "@effect-atom/atom-react/atomPromiseMap",
  () => ({
    suspendOnWaiting: new Map<Atom.Atom<any>, Promise<void>>(),
    default: new Map<Atom.Atom<any>, Promise<void>>()
  })
)

function atomToPromise<A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const map = suspendOnWaiting ? atomPromiseMap.suspendOnWaiting : atomPromiseMap.default
  let promise = map.get(atom)
  if (promise !== undefined) {
    return promise
  }
  promise = new Promise<void>((resolve) => {
    const dispose = registry.subscribe(atom, (result) => {
      if (result._tag === "Initial" || (suspendOnWaiting && result.waiting)) {
        return
      }
      setTimeout(dispose, 1000)  // Delayed cleanup
      resolve()
      map.delete(atom)
    })
  })
  map.set(atom, promise)
  return promise
}
```

## Suspension Conditions

The hook suspends under two scenarios:

### 1. Initial State (`_tag === "Initial"`)
When the async atom has never resolved, the component suspends until data arrives.

### 2. Waiting State (Optional)
When `suspendOnWaiting: true` is set and `result.waiting === true`, the component suspends during refetches.

```typescript
// Default: Only suspend on initial load
useAtomSuspense(atom)

// Option: Also suspend during refetches
useAtomSuspense(atom, { suspendOnWaiting: true })
```

## The Result Type States

**Location:** `packages/atom/src/Result.ts`

```typescript
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>

// All states have a `waiting` flag
interface Result.Proto<A, E> {
  readonly waiting: boolean
}

interface Initial<A, E> {
  readonly _tag: "Initial"
  readonly waiting: boolean
}

interface Success<A, E> {
  readonly _tag: "Success"
  readonly value: A
  readonly waiting: boolean
  readonly timestamp: number
}

interface Failure<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly waiting: boolean
  readonly previousSuccess: Option.Option<Success<A, E>>
}
```

## Error Handling

### Default Behavior
Failures throw errors (caught by Error Boundaries):

```typescript
if (result._tag === "Failure" && !options?.includeFailure) {
  throw Cause.squash(result.cause)
}
```

### Optional: Include Failures
With `includeFailure: true`, failures are returned instead of thrown:

```typescript
const result = useAtomSuspense(atom, { includeFailure: true })
// result can be Success or Failure
```

## Promise Caching Strategy

### Dual Cache System
Two separate caches for different suspension modes:
- `atomPromiseMap.default` - For standard suspension (Initial only)
- `atomPromiseMap.suspendOnWaiting` - For waiting-aware suspension

### Cache Lifecycle
1. **Creation:** Promise created when atom first suspends
2. **Resolution:** Promise resolves when result transitions to non-suspending state
3. **Cleanup:** Promise removed from cache on resolution
4. **Delayed Disposal:** Subscription cleaned up after 1 second delay (prevents race conditions)

## Integration with useSyncExternalStore

**Location:** `packages/atom-react/src/Hooks.ts:53-57`

```typescript
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(store.subscribe, store.snapshot, store.getServerSnapshot)
}
```

The Suspense integration builds on top of `useSyncExternalStore`:
1. `useStore` provides the current value reactively
2. `atomResultOrSuspend` checks if suspension is needed
3. If suspending, throws a cached promise
4. React's Suspense catches the promise and re-renders when it resolves

## SSR Considerations

The `getServerSnapshot` function handles server-side rendering:

```typescript
const newStore: AtomStore<A> = {
  // ...
  getServerSnapshot() {
    return Atom.getServerValue(atom, registry)
  }
}
```

During SSR, atoms may have server-provided values that prevent suspension.

## Key Design Decisions

### 1. Result-Typed Atoms Only
`useAtomSuspense` only works with `Atom<Result<A, E>>`. Regular atoms cannot suspend.

### 2. Waiting Flag Architecture
The `waiting` flag on Result types enables "stale-while-revalidate" patterns:
- `Success { value: A, waiting: true }` - Has data, but refreshing
- Default: Show stale data while refreshing
- With `suspendOnWaiting`: Suspend during refresh

### 3. Previous Value Preservation
`Failure` type preserves `previousSuccess`, enabling graceful degradation.

### 4. Cause-Based Errors
Uses Effect's `Cause` type for rich error information, squashed when thrown.

## Usage Patterns

### Basic Suspense

```tsx
function UserProfile() {
  const result = useAtomSuspense(userAtom)
  // result is guaranteed to be Success here
  return <div>{result.value.name}</div>
}
```

### With Error Handling in Component

```tsx
function UserProfile() {
  const result = useAtomSuspense(userAtom, { includeFailure: true })
  if (result._tag === "Failure") {
    return <ErrorDisplay cause={result.cause} />
  }
  return <div>{result.value.name}</div>
}
```

### Suspend on Refetch

```tsx
function LiveData() {
  const result = useAtomSuspense(liveDataAtom, { suspendOnWaiting: true })
  // Suspends both on initial load AND during refetches
  return <div>{result.value}</div>
}
```

## Comparison with Other Libraries

| Feature | Effect Atom | React Query | Jotai |
|---------|-------------|-------------|-------|
| Promise throwing | Yes | Yes | Yes |
| Waiting flag | Built-in | `isFetching` | Via async atoms |
| Previous value in error | Yes | Yes | Manual |
| Effect Cause errors | Yes | No | No |
| Typed suspension | Yes | Partial | Partial |

## Summary

Effect Atom React's Suspense integration is:
- **Type-safe:** Only `Result`-typed atoms can suspend
- **Configurable:** Choose between initial-only or waiting-inclusive suspension
- **Optimized:** Promise caching prevents duplicate subscriptions
- **Effect-native:** Uses `Cause` for structured error handling
- **SSR-aware:** Supports server-side snapshots
