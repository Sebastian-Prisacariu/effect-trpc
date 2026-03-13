# H15: SSR Support Analysis

## Summary

**Yes, effect-atom-react has real SSR patterns.** The implementation includes:
- `"use client"` directives on all client components
- `useSyncExternalStore` with `getServerSnapshot` 
- `HydrationBoundary` for state transfer
- `withServerValue`/`withServerValueInitial` for SSR-safe atoms

## "use client" Directives

All React files have the `"use client"` directive:

| File | Has Directive |
|------|---------------|
| `Hooks.ts` | `"use client"` (line 4) |
| `ReactHydration.ts` | `"use client"` (line 4) |
| `RegistryContext.ts` | `"use client"` (line 4) |
| `ScopedAtom.ts` | `"use client"` (line 4) |

This is the correct pattern for RSC compatibility - mark client components explicitly.

## SSR Mechanisms

### 1. useSyncExternalStore with Server Snapshot

```typescript
// Hooks.ts:17-21
interface AtomStore<A> {
  readonly subscribe: (f: () => void) => () => void
  readonly snapshot: () => A
  readonly getServerSnapshot: () => A  // SSR-specific
}

// Hooks.ts:45-47
const newStore: AtomStore<A> = {
  // ...
  getServerSnapshot() {
    return Atom.getServerValue(atom, registry)
  }
}

// Hooks.ts:56
return React.useSyncExternalStore(
  store.subscribe, 
  store.snapshot, 
  store.getServerSnapshot  // Third argument for SSR
)
```

React's `useSyncExternalStore` uses `getServerSnapshot` during SSR to avoid hydration mismatches.

### 2. Server Value Override

```typescript
// Atom.ts:2063-2080
export const ServerValueTypeId = "~effect-atom/atom/Atom/ServerValue" as const

export const withServerValue: {
  <A extends Atom<any>>(
    read: (get: <A>(atom: Atom<A>) => A) => Type<A>
  ): (self: A) => A
} = dual(2, (self, read) =>
  Object.assign(Object.create(Object.getPrototypeOf(self)), {
    ...self,
    [ServerValueTypeId]: read
  })
)

// Convenience for effect atoms - return Initial state on server
export const withServerValueInitial = <A extends Atom<Result.Result<any, any>>>(
  self: A
): A => withServerValue(self, constant(Result.initial(true)) as any)
```

This allows atoms to return different values during SSR vs client rendering.

### 3. HydrationBoundary Component

```typescript
// ReactHydration.ts:22-84
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({
  children,
  state
}) => {
  const registry = React.useContext(RegistryContext)

  // useMemo runs during render phase for SSR hydration
  const hydrationQueue = React.useMemo(() => {
    if (state) {
      const dehydratedAtoms = Array.from(state)
      const nodes = registry.getNodes()

      const newDehydratedAtoms = []
      const existingDehydratedAtoms = []

      for (const dehydratedAtom of dehydratedAtoms) {
        const existingNode = nodes.get(dehydratedAtom.key)
        if (!existingNode) {
          // New atom - hydrate immediately (safe in render)
          newDehydratedAtoms.push(dehydratedAtom)
        } else {
          // Existing atom - queue for later (after transition)
          existingDehydratedAtoms.push(dehydratedAtom)
        }
      }

      if (newDehydratedAtoms.length > 0) {
        Hydration.hydrate(registry, newDehydratedAtoms)
      }

      return existingDehydratedAtoms.length > 0 
        ? existingDehydratedAtoms 
        : undefined
    }
    return undefined
  }, [registry, state])

  // Hydrate existing atoms after render
  React.useEffect(() => {
    if (hydrationQueue) {
      Hydration.hydrate(registry, hydrationQueue)
    }
  }, [registry, hydrationQueue])

  return React.createElement(React.Fragment, {}, children)
}
```

Key design decisions:
1. **Two-phase hydration**: New atoms hydrate immediately in render; existing atoms hydrate in useEffect
2. **Transition safety**: Prevents UI flashing during React transitions
3. **TanStack Query inspiration**: Similar to `@tanstack/react-query`'s `HydrationBoundary`

### 4. Dehydration API (Server-side)

```typescript
// Hydration.ts:32-74
export const dehydrate = (
  registry: Registry.Registry,
  options?: {
    readonly encodeInitialAs?: "ignore" | "promise" | "value-only"
  }
): Array<DehydratedAtom> => {
  const arr = []
  const now = Date.now()
  
  registry.getNodes().forEach((node, key) => {
    if (!Atom.isSerializable(node.atom)) return
    
    const value = node.value()
    const isInitial = Result.isResult(value) && Result.isInitial(value)
    
    // Skip Initial states by default
    if (encodeInitialResultMode === "ignore" && isInitial) return
    
    const encodedValue = atom[Atom.SerializableTypeId].encode(value)

    // Streaming: promise resolves when atom settles
    let resultPromise
    if (encodeInitialResultMode === "promise" && isInitial) {
      resultPromise = new Promise((resolve) => {
        const unsubscribe = registry.subscribe(atom, (newValue) => {
          if (!Result.isInitial(newValue)) {
            resolve(atom[SerializableTypeId].encode(newValue))
            unsubscribe()
          }
        })
      })
    }

    arr.push({
      "~@effect-atom/atom/DehydratedAtom": true,
      key,
      value: encodedValue,
      dehydratedAt: now,
      resultPromise
    })
  })
  return arr
}
```

The `encodeInitialAs: "promise"` option enables **streaming SSR** - the promise resolves when async data arrives.

## SSR Test Coverage

The tests demonstrate real SSR patterns:

```typescript
// Basic SSR rendering
it("should run atom's during SSR by default", () => {
  const ssrHtml = renderToString(<App />)
  expect(ssrHtml).toContain("0")
})

// Skipping effects on server
it("should not execute Atom effects during SSR when using withServerSnapshot", () => {
  const userDataAtom = Atom.make(Effect.sync(() => mockFetchData())).pipe(
    Atom.withServerValueInitial
  )
  
  const ssrHtml = renderToString(<App />)
  
  expect(mockFetchData).not.toHaveBeenCalled()  // No effect on server
  expect(ssrHtml).toContain("Initial")
  
  render(<App />)
  expect(mockFetchData).toHaveBeenCalled()  // Effect runs on client
})

// Hydration streaming
test("hydration streaming", async () => {
  const dehydratedState = Hydration.dehydrate(registry, {
    encodeInitialAs: "promise"
  })
  // Promise resolves when async data arrives
})
```

## SSR Flow

```
Server                              Client
------                              ------
1. Create Registry                  
2. Render components                
   - Atoms with withServerValueInitial
     return Result.Initial
   - Regular atoms execute normally
3. dehydrate(registry)              
   - Serialize atom values
   - Create promises for pending
4. Send HTML + serialized state     

                                    5. Receive HTML
                                    6. Create fresh Registry
                                    7. <HydrationBoundary state={...}>
                                       - New atoms: hydrate in render
                                       - Existing: queue for useEffect
                                    8. React hydrates DOM
                                    9. useEffect hydrates existing atoms
                                    10. Atoms with effects start running
```

## Verdict

**Real SSR support: Yes**

| Capability | Status |
|------------|--------|
| Server rendering | Yes - `renderToString` works |
| Hydration | Yes - `HydrationBoundary` |
| Streaming SSR | Yes - `encodeInitialAs: "promise"` |
| RSC compatible | Yes - `"use client"` directives |
| Skip effects on server | Yes - `withServerValueInitial` |
| useSyncExternalStore | Yes - proper server snapshot |

The implementation is production-ready and follows React 18+ best practices.
