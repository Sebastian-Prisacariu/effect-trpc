# H12: Provider Pattern Analysis

## Overview

Effect Atom React uses a **Registry-based Provider pattern**, not atoms for context. The `RegistryProvider` creates and manages a `Registry` instance that serves as the central coordination point for all atoms.

## Provider Architecture

```
                    ┌─────────────────────────────────┐
                    │         RegistryProvider        │
                    │  ┌───────────────────────────┐  │
                    │  │   Registry (singleton)    │  │
                    │  │  - atom nodes map         │  │
                    │  │  - subscription system    │  │
                    │  │  - scheduler integration  │  │
                    │  └───────────────────────────┘  │
                    └─────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │    React.createContext()      │
                    │    RegistryContext            │
                    └───────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
     ┌──────────┐            ┌──────────┐            ┌──────────┐
     │useAtom() │            │useAtom   │            │useAtom   │
     │          │            │Value()   │            │Set()     │
     └──────────┘            └──────────┘            └──────────┘
```

## Key Files

### RegistryContext.ts (64 lines)

**Default Registry Creation:**
```typescript
export const RegistryContext = React.createContext<Registry.Registry>(
  Registry.make({
    scheduleTask,
    defaultIdleTTL: 400
  })
)
```

The context has a **default value** - a pre-created registry. This means hooks work without an explicit provider (unlike traditional React patterns).

**RegistryProvider Component:**
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
  // ...
}
```

**Key Design Choices:**

1. **Lazy initialization via useRef** - Registry is created once on first render
2. **Deferred disposal** - Registry cleanup is delayed by 500ms to survive React StrictMode double-mounts
3. **Scheduler integration** - Uses React's `scheduler` package for priority-aware task scheduling

**Scheduler Integration:**
```typescript
import * as Scheduler from "scheduler"

export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

This integrates atom effects with React's concurrent rendering scheduler.

## Registry Initialization Options

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `initialValues` | `Iterable<[Atom, any]>` | - | Pre-populate atoms |
| `scheduleTask` | `(f: () => void) => void` | React scheduler | Task scheduling |
| `timeoutResolution` | `number` | - | Timeout granularity |
| `defaultIdleTTL` | `number` | 400ms | Idle cleanup delay |

## How Hooks Access Registry

All hooks use `React.useContext(RegistryContext)`:

```typescript
// From Hooks.ts
export const useAtomValue = <A>(atom: Atom.Atom<A>): A => {
  const registry = React.useContext(RegistryContext)
  return useStore(registry, atom)
}

export const useAtom = <R, W>(atom: Atom.Writable<R, W>) => {
  const registry = React.useContext(RegistryContext)
  return [
    useStore(registry, atom),
    setAtom(registry, atom)
  ] as const
}
```

## Store Integration Pattern

```typescript
interface AtomStore<A> {
  readonly subscribe: (f: () => void) => () => void
  readonly snapshot: () => A
  readonly getServerSnapshot: () => A
}

function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(
    store.subscribe, 
    store.snapshot, 
    store.getServerSnapshot
  )
}
```

Uses `useSyncExternalStore` for:
- Concurrent mode compatibility
- SSR support via `getServerSnapshot`
- Automatic subscription management

## ScopedAtom Pattern

For component-scoped atoms (similar to local state):

```typescript
export interface ScopedAtom<A extends Atom.Atom<any>, Input = never> {
  use(): A
  Provider: React.FC<{ children?: React.ReactNode; value?: Input }>
  Context: React.Context<A>
}

export const make = <A extends Atom.Atom<any>, Input = never>(
  f: (() => A) | ((input: Input) => A)
): ScopedAtom<A, Input> => {
  const Context = React.createContext<A>(undefined as unknown as A)
  
  const Provider: React.FC<...> = ({ children, value }) => {
    const atom = React.useRef<A | null>(null)
    if (atom.current === null) {
      atom.current = f(value)
    }
    return React.createElement(Context.Provider, { value: atom.current }, children)
  }
  // ...
}
```

This allows creating atoms that are scoped to a subtree, not global.

## HydrationBoundary for SSR

```typescript
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({
  children,
  state
}) => {
  const registry = React.useContext(RegistryContext)
  
  // useMemo runs during render phase for SSR hydration
  const hydrationQueue = React.useMemo(() => {
    if (state) {
      const nodes = registry.getNodes()
      // Separate new vs existing atoms
      // Hydrate new atoms immediately
      // Queue existing atoms for post-render
    }
  }, [registry, state])
  
  // Effect hydrates existing atoms after commit
  React.useEffect(() => {
    if (hydrationQueue) {
      Hydration.hydrate(registry, hydrationQueue)
    }
  }, [registry, hydrationQueue])
}
```

Smart hydration that:
- Hydrates new atoms during render (for SSR)
- Defers existing atom updates to avoid transition issues

## Comparison: atom-react vs effect-trpc

| Aspect | atom-react | effect-trpc |
|--------|-----------|-------------|
| Context value | Registry (mutable) | TRPCClient (immutable) |
| Default context | Yes (pre-created) | No |
| Scheduler | React scheduler | None |
| SSR support | HydrationBoundary | Not implemented |
| Scoped state | ScopedAtom | Not implemented |

## Key Insights for effect-trpc

1. **Registry as context value is correct** - atom-react does the same, not atoms
2. **Default context value** - Allows hooks to work without explicit provider
3. **Scheduler integration** - Could integrate with Effect's scheduler
4. **Deferred disposal** - Handles React StrictMode gracefully
5. **ScopedAtom pattern** - Could be useful for per-component clients
6. **HydrationBoundary** - SSR pattern to adopt for data fetching

## Provider Usage Example

```tsx
// Basic usage
<RegistryProvider>
  <App />
</RegistryProvider>

// With initial values
<RegistryProvider 
  initialValues={[[countAtom, 10], [userAtom, currentUser]]}
  defaultIdleTTL={1000}
>
  <App />
</RegistryProvider>

// Works without provider (uses default registry)
function Component() {
  const [count, setCount] = useAtom(countAtom) // Works!
}
```

## Summary

The Provider pattern in atom-react:
- Uses **Registry** (mutable coordination point), not atoms, as context value
- Provides **sensible defaults** allowing hooks to work without explicit provider
- Integrates with **React's scheduler** for priority-aware updates
- Handles **React StrictMode** with deferred disposal
- Supports **SSR** via HydrationBoundary with smart render/effect timing
- Offers **ScopedAtom** for component-local atom instances

This validates that effect-trpc's approach of providing TRPCClient via context is appropriate. The key enhancement would be adding scheduler integration and SSR support.
