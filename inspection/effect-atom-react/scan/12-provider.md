# H12: Provider Pattern Analysis

## Overview

Effect Atom React uses a **Registry-centric Provider pattern** that separates the atom storage (Registry) from React's component tree, with the Provider serving as a bridge between them.

## Key Components

### 1. RegistryContext (Default Context)

```typescript
// RegistryContext.ts:22-25
export const RegistryContext = React.createContext<Registry.Registry>(Registry.make({
  scheduleTask,
  defaultIdleTTL: 400
}))
```

**Key insight**: The context has a **default value** - a pre-created Registry. This means:
- Atoms work without any Provider (using the default global registry)
- Provider is optional, not required
- Multiple Providers create isolated atom scopes

### 2. RegistryProvider Component

```typescript
// RegistryContext.ts:31-64
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

**Registry Initialization Pattern:**

1. **Lazy initialization via useRef**: Registry is created once on first render using `useRef` pattern
2. **Deferred disposal**: 500ms timeout before disposing to handle React Strict Mode / fast remounts
3. **Configurable scheduling**: Uses React's scheduler by default (`Scheduler.unstable_scheduleCallback`)
4. **Initial values support**: Can hydrate atoms with initial values on creation

### 3. scheduleTask Helper

```typescript
// RegistryContext.ts:14-16
export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

Uses React's internal scheduler for low-priority updates, integrating with React's concurrent rendering.

## Registry Initialization Options

From `Registry.make()`:

| Option | Type | Description |
|--------|------|-------------|
| `initialValues` | `Iterable<[Atom, any]>` | Pre-populate atom values |
| `scheduleTask` | `(f: () => void) => void` | Custom scheduler for async updates |
| `timeoutResolution` | `number` | Timer resolution for TTL checks |
| `defaultIdleTTL` | `number` | Default time-to-live for idle atoms (default: 400ms) |

## Hook Integration

All hooks access the registry via context:

```typescript
// Hooks.ts:91
const registry = React.useContext(RegistryContext)
```

This pattern is consistent across all hooks:
- `useAtomValue`
- `useAtom`
- `useAtomSet`
- `useAtomMount`
- `useAtomRefresh`
- `useAtomSuspense`
- `useAtomSubscribe`

## ScopedAtom Pattern (Alternative Provider)

For component-scoped atoms, there's a separate `ScopedAtom` pattern:

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

  const Provider: React.FC<{ readonly children?: React.ReactNode; readonly value: Input }> = ({
    children,
    value
  }) => {
    const atom = React.useRef<A | null>(null)
    if (atom.current === null) {
      atom.current = f(value)
    }
    return React.createElement(Context.Provider, { value: atom.current }, children)
  }

  return {
    [TypeId]: TypeId,
    use,
    Provider: Provider as any,
    Context
  }
}
```

**ScopedAtom vs RegistryProvider:**

| Aspect | RegistryProvider | ScopedAtom |
|--------|------------------|------------|
| Scope | All atoms in subtree | Single atom family |
| Registry | Creates new Registry | Uses existing Registry |
| Input | N/A | Can pass input to atom factory |
| Use case | App-level isolation | Component-level atom instances |

## HydrationBoundary Pattern

For SSR hydration:

```typescript
// ReactHydration.ts:22-84
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({
  children,
  state
}) => {
  const registry = React.useContext(RegistryContext)
  
  const hydrationQueue = React.useMemo(() => {
    // Separate new atoms (hydrate immediately) from existing (queue for later)
    // ...
  }, [registry, state])

  React.useEffect(() => {
    if (hydrationQueue) {
      Hydration.hydrate(registry, hydrationQueue)
    }
  }, [registry, hydrationQueue])

  return React.createElement(React.Fragment, {}, children)
}
```

**Hydration strategy:**
1. New atoms: Hydrate immediately during render (for SSR)
2. Existing atoms: Queue for effect phase (for transitions)

## Effect Integration (Server-side)

The Registry has Effect-native variants:

```typescript
// Registry.ts:83-101
export const layerOptions = (options?: {...}): Layer.Layer<AtomRegistry> =>
  Layer.scoped(
    AtomRegistry,
    Effect.gen(function*() {
      const scope = yield* Effect.scope
      const scheduler = yield* FiberRef.get(FiberRef.currentScheduler)
      const registry = internal.make({
        ...options,
        scheduleTask: options?.scheduleTask ?? ((f) => scheduler.scheduleTask(f, 0))
      })
      yield* Scope.addFinalizer(scope, Effect.sync(() => registry.dispose()))
      return registry
    })
  )
```

This allows the same Registry to be used in Effect programs with proper lifecycle management.

## Summary

### Provider Pattern Key Decisions:

1. **Optional Provider**: Default context value means Provider is optional
2. **Registry isolation**: Each Provider creates an isolated atom namespace
3. **Lazy + deferred**: Registry created lazily, disposed with delay
4. **Scheduler integration**: Uses React's scheduler for concurrent-safe updates
5. **Dual patterns**: RegistryProvider for app-wide, ScopedAtom for component-local
6. **SSR-aware**: HydrationBoundary handles server-side state transfer
7. **Effect-compatible**: Layer-based variant for Effect runtime integration

### For effect-trpc:

The Registry-centric Provider pattern is well-suited for RPC state because:
- Registry handles cleanup automatically via TTL
- Multiple registries can isolate test/story state
- Hydration support enables SSR prefetching
- Effect Layer integration allows server-side setup
