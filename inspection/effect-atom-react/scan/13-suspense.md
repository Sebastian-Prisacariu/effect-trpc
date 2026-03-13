# H13: Suspense Integration Analysis

## Summary

**Effect Atom React has full React Suspense support via `useAtomSuspense`.**

The implementation uses the standard React Suspense pattern of throwing promises to suspend rendering until async data is available.

## Key Implementation

### Location
`packages/atom-react/src/Hooks.ts:217-270`

### Core Suspense Hook: `useAtomSuspense`

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

### Promise Throwing Pattern

The Suspense integration works via `atomResultOrSuspend`:

```typescript
function atomResultOrSuspend<A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)  // <-- Promise throwing!
  }
  return value
}
```

### Promise Caching

Promises are cached in a global map to ensure React Suspense works correctly:

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
      setTimeout(dispose, 1000)  // Cleanup after 1 second
      resolve()
      map.delete(atom)
    })
  })
  map.set(atom, promise)
  return promise
}
```

## Suspense Behavior Matrix

| Result State | `suspendOnWaiting: false` | `suspendOnWaiting: true` |
|--------------|---------------------------|--------------------------|
| `Initial` | **Suspends** | **Suspends** |
| `Initial` (waiting) | **Suspends** | **Suspends** |
| `Success` | Returns value | Returns value |
| `Success` (waiting) | Returns value | **Suspends** |
| `Failure` | Throws error* | Throws error* |
| `Failure` (waiting) | Throws error* | **Suspends** |

*Unless `includeFailure: true`, then returns the Failure result

## Options

### `suspendOnWaiting`
- Default: `false`
- When `true`: Suspends even when there's a previous value but new data is loading
- Use case: Show loading state during refetch instead of stale data

### `includeFailure`
- Default: `false`
- When `false`: Throws errors as exceptions (caught by Error Boundary)
- When `true`: Returns `Failure` result to component for manual handling

## Integration with Result Type

The Suspense hook works specifically with atoms containing `Result<A, E>`:

```typescript
type Result<A, E> = Initial<A, E> | Success<A, E> | Failure<A, E>

interface Initial<A, E> {
  readonly _tag: "Initial"
  readonly waiting: boolean  // Loading state
}

interface Success<A, E> {
  readonly _tag: "Success"
  readonly value: A
  readonly waiting: boolean  // Refetching indicator
  readonly timestamp: number
}

interface Failure<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly previousSuccess: Option<Success<A, E>>  // Stale-while-revalidate
  readonly waiting: boolean
}
```

## Usage Pattern

```tsx
import { useAtomSuspense } from "@effect-atom/atom-react"
import { Suspense, ErrorBoundary } from "react"

// Async atom that fetches data
const userAtom = Atom.async(() => fetchUser())

function UserProfile() {
  // Suspends until data is ready
  const result = useAtomSuspense(userAtom)
  return <div>{result.value.name}</div>
}

function App() {
  return (
    <ErrorBoundary fallback={<Error />}>
      <Suspense fallback={<Loading />}>
        <UserProfile />
      </Suspense>
    </ErrorBoundary>
  )
}
```

## Key Design Decisions

1. **Global Promise Cache**: Uses `WeakMap` for registry-level caching and `Map` for atom-level caching to prevent duplicate promise creation during React's concurrent rendering

2. **Delayed Cleanup**: `setTimeout(dispose, 1000)` ensures subscription is cleaned up after promise resolves, but not immediately (handles edge cases with React re-renders)

3. **Separate Maps**: Maintains separate promise maps for `suspendOnWaiting: true/false` to handle different suspension semantics correctly

4. **Error Throwing**: Non-suspending failures throw via `Cause.squash()` - integrates with React Error Boundaries

5. **Works with useSyncExternalStore**: The underlying `useStore` uses React 18's `useSyncExternalStore` for tear-free concurrent reads

## Implications for effect-trpc

Effect Atom's Suspense support is well-designed and production-ready. For effect-trpc integration:

1. **RPC queries should return `Result<A, E>`** to work with `useAtomSuspense`
2. **The `waiting` flag enables optimistic updates** - show previous data while refetching
3. **Error handling integrates with React patterns** - Error Boundaries + typed errors
4. **Concurrent Mode compatible** - uses proper React 18 primitives

The Suspense implementation is complete and follows React best practices. No additional Suspense work needed in effect-trpc - just ensure RPC atoms produce `Result` values.
