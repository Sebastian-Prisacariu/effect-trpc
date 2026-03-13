# H11: Effect Atom React Hook Implementation

## Overview

Effect Atom React implements reactive hooks using **`React.useSyncExternalStore`** - the standard React 18 API for subscribing to external stores. This ensures proper concurrent rendering behavior and SSR compatibility.

## Architecture

```
                   +------------------+
                   | RegistryContext  |
                   | (React.Context)  |
                   +--------+---------+
                            |
                            v
                   +------------------+
                   |   AtomStore<A>   |
                   | - subscribe()    |
                   | - snapshot()     |
                   | - getServerSnap()|
                   +--------+---------+
                            |
                            v
              +----------------------------+
              | React.useSyncExternalStore |
              +----------------------------+
```

## Core Implementation

### AtomStore Interface (Hooks.ts:17-21)

```typescript
interface AtomStore<A> {
  readonly subscribe: (f: () => void) => () => void
  readonly snapshot: () => A
  readonly getServerSnapshot: () => A
}
```

This interface matches exactly what `useSyncExternalStore` expects:
- `subscribe` - returns unsubscribe function
- `snapshot` - returns current value
- `getServerSnapshot` - returns server-side value for SSR

### Store Factory (Hooks.ts:28-51)

```typescript
function makeStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): AtomStore<A> {
  let stores = storeRegistry.get(registry)
  if (stores === undefined) {
    stores = new WeakMap()
    storeRegistry.set(registry, stores)
  }
  const store = stores.get(atom)
  if (store !== undefined) {
    return store
  }
  const newStore: AtomStore<A> = {
    subscribe(f) {
      return registry.subscribe(atom, f)
    },
    snapshot() {
      return registry.get(atom)
    },
    getServerSnapshot() {
      return Atom.getServerValue(atom, registry)
    }
  }
  stores.set(atom, newStore)
  return newStore
}
```

**Key patterns:**
1. **WeakMap caching** - Stores are cached per registry, per atom using nested WeakMaps
2. **Memory-safe** - WeakMaps allow GC when atoms/registries are disposed
3. **Delegation** - All actual logic delegates to Registry methods

### useStore Hook (Hooks.ts:53-57)

```typescript
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(store.subscribe, store.snapshot, store.getServerSnapshot)
}
```

This is the foundation - a simple wrapper around `useSyncExternalStore`.

## Public Hooks API

### useAtomValue (Hooks.ts:87-97)

```typescript
export const useAtomValue: {
  <A>(atom: Atom.Atom<A>): A
  <A, B>(atom: Atom.Atom<A>, f: (_: A) => B): B
} = <A>(atom: Atom.Atom<A>, f?: (_: A) => A): A => {
  const registry = React.useContext(RegistryContext)
  if (f) {
    const atomB = React.useMemo(() => Atom.map(atom, f), [atom, f])
    return useStore(registry, atomB)
  }
  return useStore(registry, atom)
}
```

**Features:**
- Read-only subscription to atom value
- Optional selector function `f` for derived values
- Selector creates derived atom via `Atom.map`

### useAtom (Hooks.ts:187-207)

```typescript
export const useAtom = <R, W, const Mode extends "value" | "promise" | "promiseExit" = never>(
  atom: Atom.Writable<R, W>,
  options?: {
    readonly mode?: ([R] extends [Result.Result<any, any>] ? Mode : "value") | undefined
  }
): readonly [
  value: R,
  write: SetterType  // varies based on Mode
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
- Three setter modes:
  - `"value"` - synchronous set (default)
  - `"promise"` - returns Promise that resolves on success
  - `"promiseExit"` - returns Promise<Exit> for full error handling

### useAtomSet (Hooks.ts:149-169)

Write-only hook - mounts atom and returns setter without subscribing to value.

### useAtomMount (Hooks.ts:140-143)

```typescript
export const useAtomMount = <A>(atom: Atom.Atom<A>): void => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)
}
```

Mounts an atom without subscribing - useful for side effects.

### useAtomRefresh (Hooks.ts:175-181)

```typescript
export const useAtomRefresh = <A>(atom: Atom.Atom<A>): () => void => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)
  return React.useCallback(() => {
    registry.refresh(atom)
  }, [registry, atom])
}
```

Returns a stable refresh function to invalidate/refetch atom data.

### useAtomSuspense (Hooks.ts:257-270)

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
- Works with `Result.Result<A, E>` atoms
- Throws Promise when Initial or (optionally) Waiting
- Throws error on Failure unless `includeFailure: true`

### useAtomSubscribe (Hooks.ts:276-286)

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

Effect-based subscription for imperative side effects.

### AtomRef Hooks (Hooks.ts:292-310)

```typescript
export const useAtomRef = <A>(ref: AtomRef.ReadonlyRef<A>): A => {
  const [, setValue] = React.useState(ref.value)
  React.useEffect(() => ref.subscribe(setValue), [ref])
  return ref.value
}

export const useAtomRefProp = <A, K extends keyof A>(ref: AtomRef.AtomRef<A>, prop: K): AtomRef.AtomRef<A[K]> =>
  React.useMemo(() => ref.prop(prop), [ref, prop])

export const useAtomRefPropValue = <A, K extends keyof A>(ref: AtomRef.AtomRef<A>, prop: K): A[K] =>
  useAtomRef(useAtomRefProp(ref, prop))
```

Hooks for working with AtomRef (mutable reference cells).

## Registry Context (RegistryContext.ts)

### RegistryProvider

```typescript
export const RegistryProvider = (options: {
  readonly children?: React.ReactNode | undefined
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]> | undefined
  readonly scheduleTask?: ((f: () => void) => void) | undefined
  readonly timeoutResolution?: number | undefined
  readonly defaultIdleTTL?: number | undefined
}) => {
  const ref = React.useRef<{
    readonly registry: Registry.Registry
    timeout?: number | undefined
  }>(null)
  // Creates registry once, disposes with delay on unmount
  // ...
}
```

**Key behaviors:**
- Registry created once on first render
- 500ms delayed disposal on unmount (prevents flicker on remount)
- Configurable scheduling via React Scheduler

### Scheduler Integration

```typescript
import * as Scheduler from "scheduler"

export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

Uses React's internal scheduler for low-priority updates.

## Scoped Atoms (ScopedAtom.ts)

```typescript
export const make = <A extends Atom.Atom<any>, Input = never>(
  f: (() => A) | ((input: Input) => A)
): ScopedAtom<A, Input> => {
  const Context = React.createContext<A>(undefined as unknown as A)

  const use = (): A => {
    const atom = React.useContext(Context)
    if (atom === undefined) {
      throw new Error("ScopedAtom used outside of its Provider")
    }
    return atom
  }

  const Provider: React.FC<...> = ({ children, value }) => {
    const atom = React.useRef<A | null>(null)
    if (atom.current === null) {
      atom.current = f(value)
    }
    return React.createElement(Context.Provider, { value: atom.current }, children)
  }

  return { [TypeId]: TypeId, use, Provider, Context }
}
```

**Pattern:** Factory creates scoped atom instances per Provider.

## SSR/Hydration (ReactHydration.ts)

```typescript
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({ children, state }) => {
  const registry = React.useContext(RegistryContext)
  
  // In render phase: hydrate NEW atoms immediately
  // Queue EXISTING atoms for post-render hydration
  const hydrationQueue = React.useMemo(() => {
    // Separate new vs existing atoms
    // Hydrate new atoms in render
    // Return existing atoms for useEffect
  }, [registry, state])

  // Post-render: hydrate existing atoms
  React.useEffect(() => {
    if (hydrationQueue) {
      Hydration.hydrate(registry, hydrationQueue)
    }
  }, [registry, hydrationQueue])
}
```

**Smart hydration:**
- New atoms hydrated immediately (safe)
- Existing atoms queued until after render (avoids transition issues)
- Safe for concurrent React features

## Key Implementation Patterns

### 1. useSyncExternalStore Foundation

All reactive subscriptions go through `useSyncExternalStore`:
- Proper concurrent rendering support
- SSR compatibility via `getServerSnapshot`
- Automatic tearing prevention

### 2. WeakMap Store Caching

```typescript
const storeRegistry = globalValue(
  "@effect-atom/atom-react/storeRegistry",
  () => new WeakMap<Registry.Registry, WeakMap<Atom.Atom<any>, AtomStore<any>>>()
)
```

- Stores are memoized per (registry, atom) pair
- WeakMaps allow garbage collection
- Global value ensures singleton across module reloads

### 3. Suspense via Promise Throwing

```typescript
function atomResultOrSuspend<A, E>(...) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)
  }
  return value
}
```

Standard Suspense pattern - throw Promise when loading.

### 4. Registry as Single Source of Truth

All hooks delegate to Registry:
- `registry.get(atom)` - read
- `registry.set(atom, value)` - write
- `registry.subscribe(atom, callback)` - subscribe
- `registry.mount(atom)` - lifecycle
- `registry.refresh(atom)` - invalidation

## Summary

Effect Atom React provides:
1. **Standard React 18 integration** via `useSyncExternalStore`
2. **Full feature set**: read, write, subscribe, suspend, refresh
3. **SSR-ready** with server snapshots and hydration boundaries
4. **Memory-safe** with WeakMap caching
5. **Concurrent-ready** with proper Suspense support
6. **Scheduler-aware** using React's internal scheduler

The implementation is clean, minimal, and properly delegates all state logic to the Registry while handling React-specific concerns.
