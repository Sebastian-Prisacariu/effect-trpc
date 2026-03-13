# H11: Effect Atom React Hook Implementation Analysis

## Overview

Effect Atom React implements React hooks using `useSyncExternalStore` correctly, following React 18+ best practices for external store integration. The implementation is sophisticated, handling SSR, hydration, suspense, and proper cleanup.

## Core Hook Architecture

### AtomStore Interface

```typescript
// Hooks.ts:17-21
interface AtomStore<A> {
  readonly subscribe: (f: () => void) => () => void
  readonly snapshot: () => A
  readonly getServerSnapshot: () => A
}
```

This matches exactly what `useSyncExternalStore` requires:
- `subscribe` - takes callback, returns cleanup function
- `snapshot` - synchronous getter for current value
- `getServerSnapshot` - value for SSR/hydration

### Store Factory with WeakMap Caching

```typescript
// Hooks.ts:23-51
const storeRegistry = globalValue(
  "@effect-atom/atom-react/storeRegistry",
  () => new WeakMap<Registry.Registry, WeakMap<Atom.Atom<any>, AtomStore<any>>>()
)

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

**Key design choices:**
1. **Two-level WeakMap** - Registry -> Atom -> Store (prevents memory leaks)
2. **Store caching** - Same atom always returns same store object (referential stability)
3. **GlobalValue** - Singleton across module reloads (HMR-safe)
4. **Delegates to Registry** - All actual work done by Registry

### Core useStore Hook

```typescript
// Hooks.ts:53-57
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(store.subscribe, store.snapshot, store.getServerSnapshot)
}
```

**Why this works correctly:**
- `useSyncExternalStore` handles concurrent mode, tearing prevention
- Server snapshot enables SSR without hydration mismatches
- Store object stability prevents unnecessary resubscriptions

## Public Hooks

### useAtomValue

```typescript
// Hooks.ts:87-97
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
- Optional selector function for derived values
- `useMemo` ensures derived atom stability
- No mount side effect (read-only)

### useAtom

```typescript
// Hooks.ts:187-207
export const useAtom = <R, W, const Mode extends "value" | "promise" | "promiseExit" = never>(
  atom: Atom.Writable<R, W>,
  options?: { readonly mode?: ... }
): readonly [value: R, write: ...] => {
  const registry = React.useContext(RegistryContext)
  return [
    useStore(registry, atom),
    setAtom(registry, atom, options)
  ] as const
}
```

**Features:**
- Returns `[value, setter]` tuple
- Supports three write modes: `value`, `promise`, `promiseExit`
- Type-safe conditional return types based on mode

### useAtomSet (Write-Only with Mount)

```typescript
// Hooks.ts:149-169
export const useAtomSet = <R, W, Mode extends "value" | "promise" | "promiseExit" = never>(
  atom: Atom.Writable<R, W>,
  options?: { readonly mode?: ... }
): ... => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)  // Side effect: mounts atom
  return setAtom(registry, atom, options)
}
```

**Key difference from useAtom:** Calls `mountAtom` for lifecycle effects.

### useAtomMount

```typescript
// Hooks.ts:99-101, 140-143
function mountAtom<A>(registry: Registry.Registry, atom: Atom.Atom<A>): void {
  React.useEffect(() => registry.mount(atom), [atom, registry])
}

export const useAtomMount = <A>(atom: Atom.Atom<A>): void => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)
}
```

**Purpose:** Triggers atom lifecycle (onMount effects, async initialization).

### useAtomRefresh

```typescript
// Hooks.ts:175-181
export const useAtomRefresh = <A>(atom: Atom.Atom<A>): () => void => {
  const registry = React.useContext(RegistryContext)
  mountAtom(registry, atom)
  return React.useCallback(() => {
    registry.refresh(atom)
  }, [registry, atom])
}
```

**Purpose:** Returns callback to re-run async atoms (like React Query's `refetch`).

## Suspense Integration

### useAtomSuspense

```typescript
// Hooks.ts:257-270
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

### Promise Management for Suspense

```typescript
// Hooks.ts:209-251
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
    return promise  // Reuse existing promise
  }
  promise = new Promise<void>((resolve) => {
    const dispose = registry.subscribe(atom, (result) => {
      if (result._tag === "Initial" || (suspendOnWaiting && result.waiting)) {
        return
      }
      setTimeout(dispose, 1000)  // Cleanup subscription after delay
      resolve()
      map.delete(atom)
    })
  })
  map.set(atom, promise)
  return promise
}

function atomResultOrSuspend<A, E>(...) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)  // Suspend!
  }
  return value
}
```

**Suspense mechanism:**
1. Get current value via `useStore` (useSyncExternalStore)
2. If `Initial` or `waiting` (when configured), throw a Promise
3. Promise resolves when atom settles
4. React re-renders, value is now ready

## AtomRef Hooks (Imperative Refs)

```typescript
// Hooks.ts:292-310
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

**Note:** `useAtomRef` uses `useState` + `useEffect` pattern instead of `useSyncExternalStore`. This is for imperative refs that may not follow store semantics.

## Registry Context

```typescript
// RegistryContext.ts:14-25
export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}

export const RegistryContext = React.createContext<Registry.Registry>(Registry.make({
  scheduleTask,
  defaultIdleTTL: 400
}))
```

**Key features:**
- Uses React's Scheduler for batching (same scheduler React uses internally)
- `LowPriority` allows React to prioritize user interactions
- Default registry created for context (works without provider)

### RegistryProvider

```typescript
// RegistryContext.ts:31-64
export const RegistryProvider = (options: {...}) => {
  const ref = React.useRef<{
    readonly registry: Registry.Registry
    timeout?: number | undefined
  }>(null)
  if (ref.current === null) {
    ref.current = {
      registry: Registry.make({
        scheduleTask: options.scheduleTask ?? scheduleTask,
        initialValues: options.initialValues,
        timeoutResolution: options.timeoutResolution,
        defaultIdleTTL: options.defaultIdleTTL
      })
    }
  }
  React.useEffect(() => {
    if (ref.current?.timeout !== undefined) {
      clearTimeout(ref.current.timeout)
    }
    return () => {
      ref.current!.timeout = setTimeout(() => {
        ref.current?.registry.dispose()
        ref.current = null
      }, 500)
    }
  }, [ref])
  return React.createElement(RegistryContext.Provider, { value: ref.current.registry }, options?.children)
}
```

**Key features:**
1. **Lazy initialization** - Registry created in render (not effect)
2. **Stable reference** - useRef ensures same registry across renders
3. **Delayed cleanup** - 500ms delay prevents rapid mount/unmount issues (Strict Mode)
4. **Timeout clearing** - Re-mount cancels pending disposal

## ScopedAtom (Component-Scoped State)

```typescript
// ScopedAtom.ts:36-66
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

  return { [TypeId]: TypeId, use, Provider: Provider as any, Context }
}
```

**Purpose:** Creates component-scoped atom instances (like React Query's query instances per key).

## HydrationBoundary

```typescript
// ReactHydration.ts:22-84
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({ children, state }) => {
  const registry = React.useContext(RegistryContext)

  // Hydrate during render phase for new atoms
  const hydrationQueue = React.useMemo(() => {
    if (state) {
      const nodes = registry.getNodes()
      const newDehydratedAtoms = []
      const existingDehydratedAtoms = []

      for (const dehydratedAtom of dehydratedAtoms) {
        if (!nodes.get(dehydratedAtom.key)) {
          newDehydratedAtoms.push(dehydratedAtom)  // New: hydrate now
        } else {
          existingDehydratedAtoms.push(dehydratedAtom)  // Existing: queue
        }
      }

      if (newDehydratedAtoms.length > 0) {
        Hydration.hydrate(registry, newDehydratedAtoms)  // Immediate!
      }
      return existingDehydratedAtoms.length > 0 ? existingDehydratedAtoms : undefined
    }
  }, [registry, state])

  // Hydrate existing atoms after render (for transitions)
  React.useEffect(() => {
    if (hydrationQueue) {
      Hydration.hydrate(registry, hydrationQueue)
    }
  }, [registry, hydrationQueue])

  return React.createElement(React.Fragment, {}, children)
}
```

**Clever hydration strategy:**
1. **New atoms** - Hydrated immediately in render (needed before children render)
2. **Existing atoms** - Queued for effect (avoids tearing during transitions)
3. **Transition safety** - If transition aborts, existing atoms keep old values

## Summary: Key Patterns

| Pattern | Implementation | Why |
|---------|---------------|-----|
| External store | `useSyncExternalStore` | Concurrent mode safe, prevents tearing |
| Store stability | WeakMap caching | Prevents resubscription on every render |
| SSR support | `getServerSnapshot` | Hydration without mismatches |
| Suspense | Throw cached Promise | Standard React suspense pattern |
| Scheduler | `scheduler` package | Integrates with React's priority system |
| Cleanup | Delayed disposal (500ms) | Handles Strict Mode double-mount |
| Hydration | Split render/effect | Transition-safe SSR hydration |

## Implications for effect-trpc

1. **Use `useSyncExternalStore`** - It's the correct primitive for external state
2. **Cache store objects** - WeakMap keyed by atom/query prevents memory leaks
3. **Provide `getServerSnapshot`** - Required for SSR
4. **Use React's Scheduler** - For proper priority integration
5. **Delayed cleanup** - Essential for Strict Mode compatibility
6. **Suspense via Promise throwing** - Standard pattern, cache promises per query
7. **Hydration boundary** - Separate new vs existing state for transitions
