# H13: Suspense Integration Analysis

## Summary

Effect Atom React provides **first-class React Suspense integration** through the `useAtomSuspense` hook. The implementation follows the standard Suspense pattern of throwing promises for loading states and re-throwing errors for error boundary integration.

## Key Finding: `useAtomSuspense` Hook

Location: `Hooks.ts:257-270`

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

### Key Options

| Option | Default | Purpose |
|--------|---------|---------|
| `suspendOnWaiting` | `false` | Whether to suspend during refetches (when `result.waiting === true`) |
| `includeFailure` | `false` | If `true`, returns failures instead of throwing them |

## Promise Throwing Pattern

Location: `Hooks.ts:241-251`

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

### Suspension Conditions

1. **`_tag === "Initial"`**: Always suspends when no data exists
2. **`waiting === true`**: Only suspends if `suspendOnWaiting` option is enabled

This allows:
- Initial load: Always shows Suspense fallback
- Refetch: Shows stale data by default (like SWR), optionally suspend

## Promise Factory Pattern

Location: `Hooks.ts:209-239`

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
      setTimeout(dispose, 1000)  // Cleanup delay
      resolve()
      map.delete(atom)
    })
  })
  map.set(atom, promise)
  return promise
}
```

### Promise Caching Strategy

1. **Two separate maps**: One for `suspendOnWaiting=true`, one for `false`
2. **Single promise per atom**: Prevents multiple subscriptions
3. **Cleanup with delay**: `setTimeout(dispose, 1000)` prevents race conditions
4. **Resolution condition**: Resolves when result is no longer Initial (and not waiting, if configured)

## Error Boundary Integration

### Throwing Behavior

Location: `Hooks.ts:266-268`

```typescript
if (result._tag === "Failure" && !options?.includeFailure) {
  throw Cause.squash(result.cause)
}
```

When a Result is `Failure`:
- **Default**: Throws the squashed error for error boundaries to catch
- **`includeFailure: true`**: Returns the `Failure` for manual handling

### `Cause.squash` Transformation

The `Cause` is converted to a plain Error:
- `Fail(error)` -> throws `error`
- `Die(defect)` -> throws `defect`
- `Interrupt` -> throws `InterruptedException`

## Test Evidence

Location: `test/index.test.tsx:115-158`

### Suspense Success Test
```tsx
test("suspense success", () => {
  const atom = Atom.make(Effect.never)  // Never resolves

  function TestComponent() {
    const value = useAtomSuspense(atom).value
    return <div data-testid="value">{value}</div>
  }

  render(
    <Suspense fallback={<div data-testid="loading">Loading...</div>}>
      <TestComponent />
    </Suspense>
  )

  expect(screen.getByTestId("loading")).toBeInTheDocument()
})
```

### Error Boundary Test
```tsx
test("suspense error", () => {
  const atom = Atom.make(Effect.fail(new Error("test")))
  
  function TestComponent() {
    const value = useAtomSuspense(atom).value
    return <div data-testid="value">{value}</div>
  }

  render(
    <ErrorBoundary fallback={<div data-testid="error">Error</div>}>
      <Suspense fallback={<div data-testid="loading">Loading...</div>}>
        <TestComponent />
      </Suspense>
    </ErrorBoundary>
  )

  expect(screen.getByTestId("error")).toBeInTheDocument()
})
```

## Comparison: useAtomValue vs useAtomSuspense

| Aspect | `useAtomValue` | `useAtomSuspense` |
|--------|---------------|------------------|
| Input | Any `Atom<A>` | `Atom<Result<A, E>>` |
| Loading state | Returns `Result.Initial` | Suspends (throws Promise) |
| Error state | Returns `Result.Failure` | Throws error (or returns if `includeFailure`) |
| Success | Returns `Result.Success` | Returns `Result.Success` |
| Recommended for | Manual state handling | Declarative Suspense UI |

## Alternative: Result.builder Pattern

For non-Suspense usage, Effect Atom provides a builder pattern:

```typescript
function Component() {
  const result = useAtomValue(queryAtom)
  
  return Result.builder(result)
    .onWaiting(() => <Spinner />)
    .onError((e) => <Error error={e} />)
    .onSuccess((data) => <DataView data={data} />)
    .render()
}
```

The `render()` method:
- Returns `null` for `Initial`
- Throws for unhandled `Failure`
- Returns handler output for matched states

## Application to Our useQuery

### Recommended Pattern

```typescript
// Primary: Suspense-based API
export function useQuery<A, E>(
  atom: Atom<Result<A, E>>,
  options?: { suspendOnWaiting?: boolean }
): Result.Success<A, E> {
  // Delegate to useAtomSuspense
  return useAtomSuspense(atom, options)
}

// Alternative: Non-suspense API
export function useQueryResult<A, E>(
  atom: Atom<Result<A, E>>
): Result<A, E> {
  return useAtomValue(atom)
}
```

### Key Design Decisions

1. **Default `suspendOnWaiting: false`**: Show stale data during refetch
2. **Use error boundaries**: Let React handle errors declaratively
3. **Provide escape hatch**: `useQueryResult` for manual control

### Usage Example

```tsx
function UserProfile({ userId }: { userId: string }) {
  const userAtom = useMemo(() => createUserQuery(userId), [userId])
  const { value: user } = useQuery(userAtom)
  
  return <div>{user.name}</div>
}

function Page() {
  return (
    <ErrorBoundary fallback={<ErrorPage />}>
      <Suspense fallback={<ProfileSkeleton />}>
        <UserProfile userId="123" />
      </Suspense>
    </ErrorBoundary>
  )
}
```

## Architecture Insights

### Why Promise Caching Matters

React may call components multiple times during concurrent rendering. The promise cache ensures:
1. Same promise is thrown each time (React can track it)
2. Single subscription per atom (no duplicate effects)
3. Proper cleanup after resolution

### The `useSyncExternalStore` Foundation

All hooks build on `useSyncExternalStore`:
```typescript
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(store.subscribe, store.snapshot, store.getServerSnapshot)
}
```

This provides:
- Concurrent mode compatibility
- SSR support via `getServerSnapshot`
- Tearing prevention

## Summary

Effect Atom React's Suspense integration is **production-ready** and follows best practices:

1. **Standard Suspense pattern**: Throw promises for loading, throw errors for failures
2. **Configurable waiting behavior**: `suspendOnWaiting` option for refetch handling
3. **Error boundary compatible**: Errors bubble up to nearest ErrorBoundary
4. **Promise deduplication**: Global cache prevents multiple subscriptions
5. **Clean separation**: `useAtomSuspense` for Suspense, `useAtomValue` for manual control

For our tRPC-Effect library, we should **delegate to useAtomSuspense** and expose the same options, providing a thin wrapper that creates the appropriate query atom.
