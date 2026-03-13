# H15: SSR Support Analysis

## Summary

**Effect Atom React has first-class SSR support** with a complete dehydration/hydration architecture designed for React 18+ streaming and transitions.

## SSR Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER RENDER                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Create Registry                                                  │
│     └── Registry.make({ scheduleTask, initialValues })              │
│                                                                      │
│  2. Render with RegistryProvider                                     │
│     └── Components read atoms via getServerValue()                   │
│                                                                      │
│  3. Dehydrate State                                                  │
│     └── Hydration.dehydrate(registry) → DehydratedAtom[]            │
│         Options:                                                     │
│         - encodeInitialAs: "ignore" | "promise" | "value-only"      │
│                                                                      │
│  4. Serialize to HTML                                                │
│     └── JSON.stringify(dehydratedState)                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT HYDRATE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Parse serialized state                                           │
│     └── JSON.parse(window.__ATOM_STATE__)                           │
│                                                                      │
│  2. Wrap app in HydrationBoundary                                    │
│     └── <HydrationBoundary state={dehydratedState}>                 │
│           <App />                                                    │
│         </HydrationBoundary>                                         │
│                                                                      │
│  3. Hydration timing (transition-aware)                              │
│     ├── New atoms: hydrate immediately in render                    │
│     └── Existing atoms: queue for useEffect (post-commit)           │
│                                                                      │
│  4. useSyncExternalStore with getServerSnapshot                      │
│     └── Provides consistent SSR value during hydration              │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## "use client" Directives

All React files include the `"use client"` directive:

| File | Has "use client" | Purpose |
|------|-----------------|---------|
| `Hooks.ts` | Yes (line 4) | React hooks with useSyncExternalStore |
| `RegistryContext.ts` | Yes (line 4) | React.createContext + Provider |
| `ReactHydration.ts` | Yes (line 4) | HydrationBoundary component |
| `ScopedAtom.ts` | Yes (line 4) | Scoped atom pattern |

This is correct for Next.js App Router - all interactive React features require "use client".

## Key SSR Components

### 1. `useSyncExternalStore` with Server Snapshot

```typescript
// Hooks.ts:38-47
const newStore: AtomStore<A> = {
  subscribe(f) {
    return registry.subscribe(atom, f)
  },
  snapshot() {
    return registry.get(atom)
  },
  getServerSnapshot() {
    return Atom.getServerValue(atom, registry)  // <-- SSR-specific
  }
}

// Hooks.ts:53-57
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(
    store.subscribe, 
    store.snapshot, 
    store.getServerSnapshot  // <-- Used during SSR
  )
}
```

### 2. Server Value Override

```typescript
// Atom.ts:2071-2080
export const withServerValue: {
  <A extends Atom<any>>(read: (get: <A>(atom: Atom<A>) => A) => Type<A>): (self: A) => A
  <A extends Atom<any>>(self: A, read: (get: <A>(atom: Atom<A>) => A) => Type<A>): A
}

// Atom.ts:2089-2090 - Convenience for async atoms
export const withServerValueInitial = <A extends Atom<Result.Result<any, any>>>(self: A): A =>
  withServerValue(self, constant(Result.initial(true)) as any)
```

### 3. HydrationBoundary Component

```typescript
// ReactHydration.ts:22-84
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({
  children,
  state
}) => {
  const registry = React.useContext(RegistryContext)

  // Render-phase hydration for NEW atoms (immediate)
  // Queue hydration for EXISTING atoms (post-commit via useEffect)
  const hydrationQueue = React.useMemo(() => {
    if (state) {
      const nodes = registry.getNodes()
      const newDehydratedAtoms: Array<DehydratedAtomValue> = []
      const existingDehydratedAtoms: Array<DehydratedAtomValue> = []

      for (const dehydratedAtom of dehydratedAtoms) {
        const existingNode = nodes.get(dehydratedAtom.key)
        if (!existingNode) {
          newDehydratedAtoms.push(dehydratedAtom)  // Hydrate now
        } else {
          existingDehydratedAtoms.push(dehydratedAtom)  // Queue for later
        }
      }

      if (newDehydratedAtoms.length > 0) {
        Hydration.hydrate(registry, newDehydratedAtoms)
      }

      return existingDehydratedAtoms.length > 0 ? existingDehydratedAtoms : undefined
    }
    return undefined
  }, [registry, state])

  // Post-commit hydration for existing atoms (transition-safe)
  React.useEffect(() => {
    if (hydrationQueue) {
      Hydration.hydrate(registry, hydrationQueue)
    }
  }, [registry, hydrationQueue])

  return React.createElement(React.Fragment, {}, children)
}
```

### 4. Dehydration with Async Support

```typescript
// Hydration.ts:32-74
export const dehydrate = (
  registry: Registry.Registry,
  options?: {
    readonly encodeInitialAs?: "ignore" | "promise" | "value-only" | undefined
  }
): Array<DehydratedAtom> => {
  // For atoms in Initial state, can create a promise that resolves
  // when the atom moves out of Initial state (streaming support)
  if (encodeInitialResultMode === "promise" && isInitial) {
    resultPromise = new Promise((resolve) => {
      const unsubscribe = registry.subscribe(atom, (newValue) => {
        if (Result.isResult(newValue) && !Result.isInitial(newValue)) {
          resolve(atom[SerializableTypeId].encode(newValue))
          unsubscribe()
        }
      })
    })
  }
}
```

## React 18+ Transition Support

The HydrationBoundary is explicitly designed for React 18 transitions:

```typescript
// ReactHydration.ts:35-42 (comments from source)
// For any Atom values that already exist in the registry, we want to hold back on
// hydrating until _after_ the render phase. The reason for this is that during
// transitions, we don't want the existing Atom values and subscribers to update to
// the new data on the current page, only _after_ the transition is committed.
// If the transition is aborted, we will have hydrated any _new_ Atom values, but
// we throw away the fresh data for any existing ones to avoid unexpectedly
// updating the UI.
```

## DehydratedAtom Structure

```typescript
interface DehydratedAtomValue {
  readonly "~@effect-atom/atom/DehydratedAtom": true
  readonly key: string              // Atom serialization key
  readonly value: unknown           // Encoded atom value
  readonly dehydratedAt: number     // Timestamp
  readonly resultPromise?: Promise<unknown>  // For streaming async results
}
```

## Implications for effect-trpc

### What atom-react provides:
1. Full SSR/hydration architecture
2. `"use client"` directives for App Router
3. `useSyncExternalStore` with `getServerSnapshot` for hydration
4. Transition-aware hydration (React 18+)
5. Streaming support via `resultPromise`

### What effect-trpc needs to do:
1. Make tRPC query atoms serializable (`withSerializable`)
2. Use `withServerValueInitial` for async atoms to avoid hydration mismatch
3. Provide integration guidance for Next.js/Remix

### Recommended Pattern:

```typescript
// Server Component (RSC)
async function Page() {
  const registry = Registry.make()
  // Pre-populate atoms if needed
  const state = Hydration.dehydrate(registry, { encodeInitialAs: "promise" })
  
  return (
    <RegistryProvider>
      <HydrationBoundary state={state}>
        <ClientComponent />
      </HydrationBoundary>
    </RegistryProvider>
  )
}

// tRPC query atom with SSR support
const userQuery = pipe(
  trpc.user.get.atom({ id: "1" }),
  Atom.withSerializable("user-1", Result.encode, Result.decode),
  Atom.withServerValueInitial  // Prevents hydration mismatch
)
```

## Verdict

**atom-react is SSR-ready.** The architecture handles:
- Initial render consistency via `getServerSnapshot`
- State transfer via dehydration/hydration
- React 18 transitions and streaming
- Next.js App Router via `"use client"`

effect-trpc can rely on this infrastructure without implementing custom SSR support.
