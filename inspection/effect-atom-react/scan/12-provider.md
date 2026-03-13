# H12: Provider Pattern Analysis

## Overview

Effect Atom React uses a real Provider pattern with React Context to deliver the Registry to all hooks. This is **not a stub** - it performs actual initialization and lifecycle management.

## Core Implementation

### RegistryContext.ts

```typescript
// Default context with global registry
export const RegistryContext = React.createContext<Registry.Registry>(
  Registry.make({
    scheduleTask,         // Uses React Scheduler for optimal batching
    defaultIdleTTL: 400   // 400ms idle time-to-live
  })
)
```

Key insight: The default context value is a **real, working registry**. This means hooks work even without an explicit Provider - they just use the global default registry.

### RegistryProvider Component

```typescript
export const RegistryProvider = (options: {
  readonly children?: React.ReactNode | undefined
  readonly initialValues?: Iterable<readonly [Atom.Atom<any>, any]> | undefined
  readonly scheduleTask?: ((f: () => void) => void) | undefined
  readonly timeoutResolution?: number | undefined
  readonly defaultIdleTTL?: number | undefined
}) => {
  // 1. Stable ref to hold registry across renders
  const ref = React.useRef<{
    readonly registry: Registry.Registry
    timeout?: number | undefined
  }>(null)
  
  // 2. Lazy initialization (only on first render)
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
  
  // 3. Lifecycle management with delayed cleanup
  React.useEffect(() => {
    // Clear any pending cleanup from previous mount
    if (ref.current?.timeout !== undefined) {
      clearTimeout(ref.current.timeout)
    }
    return () => {
      // Delay disposal to handle React StrictMode double-mount
      ref.current!.timeout = setTimeout(() => {
        ref.current?.registry.dispose()
        ref.current = null
      }, 500)
    }
  }, [ref])
  
  // 4. Provide registry to children
  return React.createElement(
    RegistryContext.Provider, 
    { value: ref.current.registry }, 
    options?.children
  )
}
```

## Provider Options

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `children` | `ReactNode` | - | Child components |
| `initialValues` | `Iterable<[Atom, any]>` | - | Pre-populate atoms |
| `scheduleTask` | `(f: () => void) => void` | React Scheduler | Task scheduling |
| `timeoutResolution` | `number` | - | Timeout granularity |
| `defaultIdleTTL` | `number` | 400 | Default idle cleanup delay |

## React Scheduler Integration

```typescript
import * as Scheduler from "scheduler"

export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

This integrates with React's internal scheduler for optimal batching and priority handling.

## How Hooks Access Registry

Every hook uses `React.useContext(RegistryContext)`:

```typescript
// From Hooks.ts
export const useAtomValue = <A>(atom: Atom.Atom<A>): A => {
  const registry = React.useContext(RegistryContext)  // <-- Here
  return useStore(registry, atom)
}

export const useAtom = <R, W>(atom: Atom.Writable<R, W>): readonly [R, (v: W) => void] => {
  const registry = React.useContext(RegistryContext)  // <-- Here
  return [
    useStore(registry, atom),
    setAtom(registry, atom)
  ] as const
}
```

## Registry Lifecycle

1. **Creation**: Registry created lazily on first render via `useRef` pattern
2. **Mounting**: Children receive registry through context
3. **Unmounting**: Delayed disposal (500ms) handles React StrictMode
4. **Cleanup**: `registry.dispose()` cleans up all subscriptions

## StrictMode Handling

The 500ms delay is intentional:
- React StrictMode unmounts/remounts components immediately
- Without delay, registry would be disposed then recreated
- Delay allows remount to reuse existing registry

```typescript
// On unmount
ref.current!.timeout = setTimeout(() => {
  ref.current?.registry.dispose()  // Only after 500ms
  ref.current = null
}, 500)

// On remount (within 500ms)
if (ref.current?.timeout !== undefined) {
  clearTimeout(ref.current.timeout)  // Cancel disposal
}
```

## ScopedAtom Pattern

For component-scoped atoms, there's a separate `ScopedAtom` utility:

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

  const Provider: React.FC<{ value: Input }> = ({ children, value }) => {
    const atom = React.useRef<A | null>(null)
    if (atom.current === null) {
      atom.current = f(value)
    }
    return React.createElement(Context.Provider, { value: atom.current }, children)
  }

  return { use, Provider, Context }
}
```

This creates isolated atom scopes - useful for lists where each item needs its own atom instance.

## Comparison with tRPC React

tRPC's `TRPCProvider` from `@trpc/tanstack-react-query`:

```typescript
// From trpc/packages/tanstack-react-query/src/internals/Context.tsx
const TRPCProvider: TRPCProviderType = (props) => {
  const value = useMemo(() => ({
    queryClient: props.queryClient,
    ...
  }), [...]);

  return (
    <TRPCClientContext.Provider value={props.trpcClient}>
      <TRPCContext.Provider value={value}>
        {props.children}
      </TRPCContext.Provider>
    </TRPCClientContext.Provider>
  );
};
```

Key differences:
- tRPC uses nested contexts (client + query)
- No lazy initialization (client passed as prop)
- No lifecycle management (React Query handles that)

## Recommendations for effect-trpc

### 1. Use Atom's RegistryProvider

Since we're using `@effect-atom/atom-react`, we should compose with their Provider:

```typescript
import { RegistryProvider } from "@effect-atom/atom-react"

export const TrpcProvider = (props: {
  children: ReactNode
  client: TrpcClient
  // Optional: registry config
  initialValues?: Iterable<readonly [Atom.Atom<any>, any]>
}) => {
  return (
    <RegistryProvider initialValues={props.initialValues}>
      <TrpcClientContext.Provider value={props.client}>
        {props.children}
      </TrpcClientContext.Provider>
    </RegistryProvider>
  )
}
```

### 2. Create Client Context

```typescript
const TrpcClientContext = React.createContext<TrpcClient | null>(null)

export const useTrpcClient = () => {
  const client = React.useContext(TrpcClientContext)
  if (client === null) {
    throw new Error("useTrpcClient must be used within TrpcProvider")
  }
  return client
}
```

### 3. Optional: Pre-hydration Support

For SSR, accept initial atom values:

```typescript
export const TrpcProvider = (props: {
  children: ReactNode
  client: TrpcClient
  // SSR hydration
  dehydratedState?: Iterable<Hydration.DehydratedAtom>
}) => {
  return (
    <RegistryProvider>
      {props.dehydratedState && (
        <HydrationBoundary state={props.dehydratedState} />
      )}
      <TrpcClientContext.Provider value={props.client}>
        {props.children}
      </TrpcClientContext.Provider>
    </RegistryProvider>
  )
}
```

### 4. Consider Lazy Client Creation

For better ergonomics, allow lazy client creation like Atom does:

```typescript
export const TrpcProvider = (props: {
  children: ReactNode
  // Either provide client or options to create one
  client?: TrpcClient
  createClient?: () => TrpcClient
}) => {
  const clientRef = React.useRef<TrpcClient | null>(props.client ?? null)
  
  if (clientRef.current === null && props.createClient) {
    clientRef.current = props.createClient()
  }
  
  return (
    <RegistryProvider>
      <TrpcClientContext.Provider value={clientRef.current}>
        {props.children}
      </TrpcClientContext.Provider>
    </RegistryProvider>
  )
}
```

## Summary

Effect Atom's Provider pattern is well-designed:
1. **Lazy initialization** via `useRef` pattern
2. **StrictMode compatible** with delayed disposal
3. **Composable** - just wraps React Context
4. **Configurable** - accepts registry options
5. **Works without Provider** - has sensible defaults

Our effect-trpc Provider should:
1. **Wrap** `RegistryProvider` (don't duplicate)
2. **Add** client context layer
3. **Support** SSR hydration via `HydrationBoundary`
4. **Allow** lazy client creation for ergonomics
