# H9: Effect Atom Invalidation Patterns

## Summary

Effect Atom provides **built-in invalidation mechanisms** at multiple levels, but leaves advanced patterns like tag-based cache invalidation to the `@effect/experimental/Reactivity` service integration. The invalidation model is graph-based, propagating stale state through atom dependencies.

## Invalidation Mechanisms

### 1. Node-Level Invalidation (Core)

The internal `Node` class manages invalidation state:

```typescript
// internal/registry.ts
const enum NodeState {
  uninitialized = NodeFlags.alive | NodeFlags.waitingForValue,
  stale = NodeFlags.alive | NodeFlags.initialized | NodeFlags.waitingForValue,
  valid = NodeFlags.alive | NodeFlags.initialized,
  removed = 0
}

invalidate(): void {
  if (this.state === NodeState.valid) {
    this.state = NodeState.stale
    this.disposeLifetime()  // Clean up previous computation
  }
  // Batch or immediate recomputation
  if (batchState.phase === BatchPhase.collect) {
    batchState.stale.push(this)
  } else if (this.atom.lazy && this.listeners.size === 0) {
    this.invalidateChildren()
    this.skipInvalidation = true
  } else {
    this.value()  // Immediate recompute
  }
}

invalidateChildren(): void {
  const children = this.children
  this.children = []
  for (let i = 0; i < children.length; i++) {
    children[i].invalidate()
  }
}
```

**Key Insight**: Invalidation propagates DOWN through dependent atoms (children), not up. Parents are source atoms; children depend on parents.

### 2. Registry.refresh() - Public API

```typescript
// Registry interface
readonly refresh: <A>(atom: Atom.Atom<A>) => void

// Implementation
refresh = <A>(atom: Atom.Atom<A>): void => {
  if (atom.refresh !== undefined) {
    atom.refresh(this.refresh)  // Custom refresh handler
  } else {
    this.invalidateAtom(atom)   // Default: simple invalidation
  }
}
```

Atoms can define custom `refresh` behavior:

```typescript
export const readable = <A>(
  read: (get: Context) => A,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void
): Atom<A>
```

### 3. Context Methods for Invalidation

```typescript
interface Context {
  refresh<A>(this: Context, atom: Atom<A>): void     // Refresh any atom
  refreshSelf(this: Context): void                   // Refresh current atom
}

// Implementation
refresh<A>(this: Lifetime<any>, atom: Atom<A>): void {
  this.node.registry.refresh(atom)
}

refreshSelf(this: Lifetime<any>): void {
  this.node.invalidate()
}
```

### 4. Effect-Level API

```typescript
// Atom.ts
export const refresh = <A>(self: Atom<A>): Effect.Effect<void, never, AtomRegistry> =>
  Effect.map(AtomRegistry, (_) => _.refresh(self))
```

## Stale State Handling

### Result Type with `waiting` Flag

```typescript
// Result.ts
interface Success<A, E> {
  readonly _tag: "Success"
  readonly value: A
  readonly waiting: boolean  // Indicates background refresh
  readonly timestamp: number
}

// Helpers
const waiting = <R extends Result<any, any>>(self: R): R => {
  // Marks result as pending background refresh
}
```

The `waiting` flag enables optimistic UI updates - showing stale data while fresh data loads.

### Previous Value Preservation

```typescript
interface Failure<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly previousSuccess: Option.Option<Success<A, E>>  // Stale data fallback
}
```

## Automatic Refresh Patterns

### 1. Window Focus Refresh

```typescript
// Atom.ts
export const windowFocusSignal: Atom<number> = readable((get) => {
  let count = 0
  function update() {
    if (document.visibilityState === "visible") {
      get.setSelf(++count)
    }
  }
  window.addEventListener("visibilitychange", update)
  get.addFinalizer(() => window.removeEventListener("visibilitychange", update))
  return count
})

export const refreshOnWindowFocus: <A extends Atom<any>>(self: A) => A = 
  makeRefreshOnSignal(windowFocusSignal)

// Generic signal-based refresh factory
export const makeRefreshOnSignal = <_>(signal: Atom<_>) => 
  <A extends Atom<any>>(self: A): A =>
    transform(self, (get) => {
      get.once(signal)
      get.subscribe(signal, (_) => get.refresh(self))
      get.subscribe(self, (value) => get.setSelf(value))
      return get.once(self)
    })
```

### 2. Idle TTL / Time-based Invalidation

```typescript
// Registry options
interface RegistryOptions {
  readonly defaultIdleTTL?: number  // Default TTL for all atoms
}

// Per-atom TTL
export const setIdleTTL: {
  (duration: Duration.DurationInput): <A extends Atom<any>>(self: A) => A
}

// Internal bucket-based timeout system
setNodeTimeout(node: Node<any>): void {
  const ttl = Math.ceil(idleTTL! / this.timeoutResolution) * this.timeoutResolution
  const timestamp = Date.now() + ttl
  const bucket = timestamp - (timestamp % this.timeoutResolution) + this.timeoutResolution
  // Nodes are grouped into time buckets for efficient sweeping
}
```

**Note**: TTL removes the atom node, not just marks it stale. On next access, atom re-initializes.

## Reactivity Service Integration

Effect Atom integrates with `@effect/experimental/Reactivity` for key-based invalidation:

### Usage in AtomRuntime

```typescript
// Atom.ts
factory.withReactivity = (keys) => <A extends Atom<any>>(atom: A): A =>
  transform(atom, (get) => {
    const reactivity = Result.getOrThrow(get(reactivityAtom))
    get.addFinalizer(reactivity.unsafeRegister(keys, () => {
      get.refresh(atom)
    }))
    get.subscribe(atom, (value) => get.setSelf(value))
    return get.once(atom)
  })
```

### In Mutation Functions (AtomRpc)

```typescript
// AtomRpc.ts
const effect = client(tag, payload, { headers } as any)
const finalEffect = reactivityKeys 
  ? Reactivity.mutation(effect, reactivityKeys)  // Invalidates keys on success
  : effect
```

### Mutation Pattern

```typescript
// For mutations that should invalidate related queries
runtime.fn(
  (arg, get) => Effect.gen(function*() {
    const result = yield* someApiCall(arg)
    return result
  }),
  { reactivityKeys: ['users', 'user-list'] }
)
```

## What's NOT Built-in

1. **Tag-based Cache Keys**: No native `['users', userId]` query key system
2. **Automatic Refetch on Interval**: No `refetchInterval` option (can be built with signals)
3. **Stale-While-Revalidate**: Manual via `waiting` flag, not automatic
4. **Dependent Query Invalidation**: Must be handled via Reactivity keys
5. **Conditional Invalidation**: No built-in predicate-based invalidation

## Comparison to TanStack Query-style Invalidation

| Feature | Effect Atom | TanStack Query |
|---------|-------------|----------------|
| Query Keys | Atom identity / Reactivity keys | Hierarchical array keys |
| `invalidateQueries` | `registry.refresh(atom)` | `queryClient.invalidateQueries(['key'])` |
| Stale Time | Via `idleTTL` (removes, not stales) | `staleTime` (marks stale) |
| Garbage Collection | `idleTTL` + `keepAlive: false` | `gcTime` |
| Refetch on Focus | `refreshOnWindowFocus` | `refetchOnWindowFocus` |
| Refetch on Reconnect | Build with signal | `refetchOnReconnect` |
| Refetch Interval | Build with signal | `refetchInterval` |
| Optimistic Updates | `optimistic()` combinator | `onMutate` + rollback |
| Mutation Invalidation | Reactivity keys | `onSuccess` + `invalidateQueries` |

## Batching

```typescript
// Batch multiple mutations to minimize re-renders
export const batch: (f: () => void) => void = internalRegistry.batch

batch(() => {
  registry.set(atomA, valueA)
  registry.set(atomB, valueB)
  // All changes propagate together
})
```

## Comparison to Our Needs

For effect-trpc, we need:

1. **Mutation-based Invalidation**: Effect Atom + Reactivity provides this via `reactivityKeys`
2. **Query Key Patterns**: Would need custom abstraction on top of atom families
3. **Stale-While-Revalidate**: Result's `waiting` + `previousSuccess` enables this
4. **Background Refetch**: Can build using `refreshOnWindowFocus` pattern

### Recommended Integration Pattern

```typescript
// Pseudo-code for effect-trpc integration
const trpcQuery = <TInput, TOutput>(
  procedure: Procedure<TInput, TOutput>,
  options?: { reactivityKeys?: unknown[] }
) => {
  return runtime.atom((get) => 
    pipe(
      procedure.query(input),
      options?.reactivityKeys 
        ? Reactivity.query(options.reactivityKeys)
        : identity
    )
  )
}

const trpcMutation = <TInput, TOutput>(
  procedure: Procedure<TInput, TOutput>,
  options?: { reactivityKeys?: unknown[] }
) => {
  return runtime.fn(
    (input: TInput) => procedure.mutate(input),
    { reactivityKeys: options?.reactivityKeys }
  )
}
```

## Key Findings

1. **Invalidation is Pull-based**: Nodes marked stale; recomputation happens on next access (or immediately if subscribed)
2. **Graph Propagation**: Changes flow through dependency graph automatically
3. **Reactivity Service**: Key-based invalidation delegated to `@effect/experimental/Reactivity`
4. **No Query Cache**: Atoms ARE the cache - identity-based, not key-based
5. **Flexible Primitives**: Lower-level than TanStack Query, more composable
