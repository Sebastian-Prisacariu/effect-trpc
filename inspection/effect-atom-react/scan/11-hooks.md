# Hypothesis H11: useAtom/useAtomValue Hooks Implementation

## Summary

Effect Atom React implements a sophisticated hook system built on `useSyncExternalStore` for React 18+ concurrent mode compatibility. The design uses a store registry pattern for efficient subscription management and provides multiple hook variants for different use cases.

## Core Architecture

### AtomStore Interface

```typescript
interface AtomStore<A> {
  readonly subscribe: (f: () => void) => () => void
  readonly snapshot: () => A
  readonly getServerSnapshot: () => A
}
```

This interface maps directly to `useSyncExternalStore`'s required API:
- `subscribe` - Register a callback for value changes
- `snapshot` - Get current client value
- `getServerSnapshot` - Get value during SSR

### Store Registry Pattern

```typescript
const storeRegistry = globalValue(
  "@effect-atom/atom-react/storeRegistry",
  () => new WeakMap<Registry.Registry, WeakMap<Atom.Atom<any>, AtomStore<any>>>()
)
```

**Key insight**: Uses a two-level WeakMap structure:
1. First level: Registry -> Store map
2. Second level: Atom -> AtomStore

This ensures:
- Memory efficiency via WeakMap (automatic GC when Registry/Atom is dereferenced)
- Single store instance per (Registry, Atom) pair
- Global singleton via `globalValue`

### makeStore Factory

```typescript
function makeStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): AtomStore<A> {
  let stores = storeRegistry.get(registry)
  if (stores === undefined) {
    stores = new WeakMap()
    storeRegistry.set(registry, stores)
  }
  const store = stores.get(atom)
  if (store !== undefined) {
    return store  // Return cached store
  }
  const newStore: AtomStore<A> = {
    subscribe(f) {
      return registry.subscribe(atom, f)  // Delegates to registry
    },
    snapshot() {
      return registry.get(atom)  // Delegates to registry
    },
    getServerSnapshot() {
      return Atom.getServerValue(atom, registry)  // SSR-specific
    }
  }
  stores.set(atom, newStore)
  return newStore
}
```

## Hook Implementations

### useStore (Internal)

```typescript
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.getServerSnapshot
  )
}
```

This is the foundational hook - all other hooks build on this.

### useAtomValue

```typescript
export const useAtomValue: {
  <A>(atom: Atom.Atom<A>): A
  <A, B>(atom: Atom.Atom<A>, f: (_: A) => B): B
} = <A>(atom: Atom.Atom<A>, f?: (_: A) => A): A => {
  const registry = React.useContext(RegistryContext)
  if (f) {
    // Derived atom with transformation
    const atomB = React.useMemo(() => Atom.map(atom, f), [atom, f])
    return useStore(registry, atomB)
  }
  return useStore(registry, atom)
}
```

**Features:**
- Gets registry from context
- Optional selector function `f` for derived values
- Uses `useMemo` to cache derived atoms

### useAtom

```typescript
export const useAtom = <R, W, const Mode extends "value" | "promise" | "promiseExit" = never>(
  atom: Atom.Writable<R, W>,
  options?: {
    readonly mode?: ([R] extends [Result.Result<any, any>] ? Mode : "value") | undefined
  }
): readonly [
  value: R,
  write: /* setter type based on Mode */
] => {
  const registry = React.useContext(RegistryContext)
  return [
    useStore(registry, atom),
    setAtom(registry, atom, options)
  ] as const
}
```

**Features:**
- Returns `[value, setter]` tuple (like React's useState)
- Three write modes for Result atoms:
  - `"value"` - Synchronous set
  - `"promise"` - Returns Promise<Success>
  - `"promiseExit"` - Returns Promise<Exit<Success, Failure>>

### useAtomSet

```typescript
export const useAtomSet = <R, W, Mode>(
  atom: Atom.Writable<R, W>,
  options?: { readonly mode?: Mode }
) => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)  // Ensures atom stays mounted
  return setAtom(registry, atom, options)
}
```

**Features:**
- Only returns setter (no value subscription)
- Mounts atom to ensure lifecycle

### useAtomMount

```typescript
export const useAtomMount = <A>(atom: Atom.Atom<A>): void => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)
}

function mountAtom<A>(registry: Registry.Registry, atom: Atom.Atom<A>): void {
  React.useEffect(() => registry.mount(atom), [atom, registry])
}
```

**Purpose:** Keeps an atom "alive" without subscribing to its value.

### useAtomRefresh

```typescript
export const useAtomRefresh = <A>(atom: Atom.Atom<A>): () => void => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)
  return React.useCallback(() => {
    registry.refresh(atom)
  }, [registry, atom])
}
```

**Purpose:** Returns a function to manually trigger atom recomputation.

### useAtomSubscribe

```typescript
export const useAtomSubscribe = <A>(
  atom: Atom.Atom<A>,
  f: (_: A) => void,
  options?: { readonly immediate?: boolean }
): void => {
  const registry = React.useContext(RegistryContext)
  React.useEffect(
    () => registry.subscribe(atom, f, options),
    [registry, atom, f, options?.immediate]
  )
}
```

**Purpose:** Side-effect subscription without causing re-renders.

### useAtomSuspense

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

**Suspense integration:**
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

**Key insight**: Throws a Promise to trigger React Suspense when:
- Result is `Initial` (not yet computed)
- `suspendOnWaiting` is true and result has `waiting: true`

## Subscription Mechanism

### Registry.subscribe Implementation

From `internal/registry.ts`:

```typescript
subscribe<A>(atom: Atom.Atom<A>, f: (_: A) => void, options?: { readonly immediate?: boolean }): () => void {
  const node = this.ensureNode(atom)
  if (options?.immediate) {
    f(node.value())  // Call immediately with current value
  }
  const remove = node.subscribe(function() {
    f(node._value)  // Callback receives current value
  })
  return () => {
    remove()
    if (node.canBeRemoved) {
      this.scheduleNodeRemoval(node)  // Cleanup when no subscribers
    }
  }
}
```

### Node.subscribe

```typescript
class Node<A> {
  listeners: Set<() => void> = new Set()
  
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  
  notify(): void {
    this.listeners.forEach(notifyListener)
  }
}
```

**Pattern:** Simple Set-based pub/sub with cleanup return function.

## Concurrent Mode Compatibility

### useSyncExternalStore

The use of `useSyncExternalStore` is critical for concurrent mode:

1. **Tearing prevention** - Ensures consistent reads during concurrent renders
2. **Server snapshot** - Separate function for SSR hydration
3. **Automatic re-subscription** - React handles subscription lifecycle

### Scheduler Integration

From `RegistryContext.ts`:

```typescript
import * as Scheduler from "scheduler"

export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}

export const RegistryContext = React.createContext<Registry.Registry>(
  Registry.make({
    scheduleTask,
    defaultIdleTTL: 400
  })
)
```

**Key insight**: Uses React's internal scheduler for low-priority updates (atom cleanup, etc.), ensuring these don't block high-priority rendering.

## AtomRef Hooks

For mutable references (not reactive atoms):

```typescript
export const useAtomRef = <A>(ref: AtomRef.ReadonlyRef<A>): A => {
  const [, setValue] = React.useState(ref.value)
  React.useEffect(() => ref.subscribe(setValue), [ref])
  return ref.value
}

export const useAtomRefProp = <A, K extends keyof A>(
  ref: AtomRef.AtomRef<A>,
  prop: K
): AtomRef.AtomRef<A[K]> =>
  React.useMemo(() => ref.prop(prop), [ref, prop])

export const useAtomRefPropValue = <A, K extends keyof A>(
  ref: AtomRef.AtomRef<A>,
  prop: K
): A[K] =>
  useAtomRef(useAtomRefProp(ref, prop))
```

**Note:** AtomRef uses traditional useState + subscribe pattern (not useSyncExternalStore) because refs have simpler semantics.

## Initial Values Hook

```typescript
const initialValuesSet = globalValue(
  "@effect-atom/atom-react/initialValuesSet",
  () => new WeakMap<Registry.Registry, WeakSet<Atom.Atom<any>>>()
)

export const useAtomInitialValues = (
  initialValues: Iterable<readonly [Atom.Atom<any>, any]>
): void => {
  const registry = React.useContext(RegistryContext)
  let set = initialValuesSet.get(registry)
  if (set === undefined) {
    set = new WeakSet()
    initialValuesSet.set(registry, set)
  }
  for (const [atom, value] of initialValues) {
    if (!set.has(atom)) {
      set.add(atom)
      ;(registry as any).ensureNode(atom).setValue(value)
    }
  }
}
```

**Purpose:** Set initial values during hydration (only once per atom per registry).

## Code Patterns to Adopt

### 1. useSyncExternalStore Adapter Pattern

```typescript
interface Store<A> {
  subscribe: (cb: () => void) => () => void
  snapshot: () => A
  getServerSnapshot: () => A
}

function useStore<A>(store: Store<A>): A {
  return useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.getServerSnapshot
  )
}
```

### 2. WeakMap Store Registry

```typescript
const storeCache = globalValue(
  "mypackage/storeCache",
  () => new WeakMap<Registry, WeakMap<Atom, Store>>()
)
```

Ensures:
- Memory efficiency
- Singleton stores per (registry, atom) pair
- No manual cleanup needed

### 3. Mode-Based Setter Types

```typescript
type SetterMode = "value" | "promise" | "promiseExit"

// Conditional return types based on mode
type Setter<R, W, Mode> = 
  Mode extends "promise" ? (w: W) => Promise<Success<R>> :
  Mode extends "promiseExit" ? (w: W) => Promise<Exit<Success<R>, Failure<R>>> :
  (w: W | ((r: R) => W)) => void
```

### 4. Suspense Integration via Promise Throw

```typescript
function useWithSuspense<A, E>(atom: Atom<Result<A, E>>): Success<A, E> {
  const value = useStore(atom)
  if (value._tag === "Initial") {
    throw promiseForAtom(atom)  // React Suspense trigger
  }
  return value
}
```

### 5. React Scheduler Integration

```typescript
import * as Scheduler from "scheduler"

const scheduleTask = (f: () => void) => {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

### 6. Memoized Derived Atoms

```typescript
export const useAtomValue = <A, B>(atom: Atom<A>, selector?: (a: A) => B) => {
  const derivedAtom = useMemo(
    () => selector ? Atom.map(atom, selector) : atom,
    [atom, selector]
  )
  return useStore(derivedAtom)
}
```

## Comparison with effect-trpc Stubs

Our current stubs likely just throw errors. To implement real hooks:

1. **Import from @effect-atom/atom-react** - These hooks are already production-ready
2. **Use Registry context** - Provides the subscription infrastructure
3. **Wrap RPC atoms** - Create atoms that call RPC procedures and use these hooks

## Key Takeaways

1. **Don't reinvent the wheel** - Use `useSyncExternalStore` for React 18+ compatibility
2. **Global store caching** - WeakMap pattern for efficient store management
3. **Registry is the source of truth** - All subscriptions go through the registry
4. **Suspense is first-class** - Promise-throwing pattern for async atoms
5. **Scheduler integration** - Low-priority cleanup tasks via React scheduler
6. **Type-safe modes** - Conditional types for different setter behaviors
