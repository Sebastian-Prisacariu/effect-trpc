# H15: SSR Support in Effect Atom React

## Summary

Effect Atom React has **comprehensive SSR support** with a well-designed hydration system. All client-side files use the `"use client"` directive, making them compatible with React Server Components and Next.js App Router.

## Key SSR Capabilities

### 1. "use client" Directive

All React-specific files include the `"use client"` directive at the top:

```typescript
// Hooks.ts, RegistryContext.ts, ScopedAtom.ts, ReactHydration.ts
"use client"
```

This ensures proper bundler splitting and RSC compatibility.

### 2. Server Snapshot Support

The `useStore` function leverages React 18's `useSyncExternalStore` with proper server snapshot handling:

```typescript
// Hooks.ts:53-56
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.getServerSnapshot  // <-- SSR support
  )
}
```

The `getServerSnapshot` delegates to `Atom.getServerValue()` which respects server-specific atom configurations.

### 3. Server Value Override

Atoms can define different values for server rendering:

```typescript
// Atom.ts:2071-2081
export const withServerValue: {
  <A extends Atom<any>>(read: (get: <A>(atom: Atom<A>) => A) => Type<A>): (self: A) => A
  <A extends Atom<any>>(self: A, read: (get: <A>(atom: Atom<A>) => A) => Type<A>): A
}

// Atom.ts:2089-2090 - Convenience for Result atoms
export const withServerValueInitial = <A extends Atom<Result.Result<any, any>>>(self: A): A =>
  withServerValue(self, constant(Result.initial(true)) as any)
```

This allows Effect-based atoms (which run async operations) to render as `Initial` during SSR, avoiding waterfall requests.

### 4. Hydration System

#### Dehydration (Server → Client)

```typescript
// Hydration.ts:32-74
export const dehydrate = (
  registry: Registry.Registry,
  options?: {
    readonly encodeInitialAs?: "ignore" | "promise" | "value-only" | undefined
  }
): Array<DehydratedAtom>
```

The `encodeInitialAs: "promise"` option enables **streaming hydration** - atoms still resolving on the server can complete and stream their results to the client.

#### Hydration (Client)

```typescript
// ReactHydration.ts:22-84
export const HydrationBoundary: React.FC<HydrationBoundaryProps> = ({
  children,
  state
}) => {
  // Hydrates new atoms during render (safe for SSR)
  // Queues existing atoms for useEffect (safe for transitions)
}
```

The HydrationBoundary component:
1. **Separates new vs existing atoms** - New atoms hydrate immediately during render; existing atoms queue for `useEffect`
2. **Supports React transitions** - Existing atoms don't update until transition commits (prevents UI flicker)
3. **Handles streaming data** - Promise-based dehydrated atoms resolve and update after hydration

### 5. Streaming SSR Support

```typescript
// Test showing streaming pattern
const dehydratedState = Hydration.dehydrate(registry, {
  encodeInitialAs: "promise"  // Creates promises for pending atoms
})

// Client receives Initial state, then promise resolves with data
```

The `resultPromise` field on `DehydratedAtomValue` enables server-to-client streaming:
- Server sends `Initial` state immediately
- Server resolves promise when data ready
- Client receives resolved value and updates

## Server Component Compatibility

### Works Well

1. **Client boundary is clear** - All hooks are `"use client"`
2. **Data fetching on server** - Use `withServerValueInitial` to skip client-side fetch on initial render
3. **Hydration component** - `HydrationBoundary` works in client components

### Pattern for effect-trpc

For a tRPC query atom:

```typescript
// Create query atom that defers to Initial during SSR
const userQuery = trpc.user.byId.query({ id: 1 }).pipe(
  Atom.withServerValueInitial  // Returns Initial during SSR
)

// Or provide server-fetched data
const userQuery = trpc.user.byId.query({ id: 1 }).pipe(
  Atom.withServerValue(() => {
    // Called during SSR to get the value
    return Result.success(prefetchedUser)
  })
)
```

## What effect-trpc Needs for SSR

### 1. Mark Client Modules

All React hooks must include `"use client"` directive:

```typescript
// packages/effect-trpc-react/src/hooks.ts
"use client"

export const useQuery = ...
```

### 2. Server Value Support for Query Atoms

Query atoms should support server-side initial values:

```typescript
// Option A: Defer to Initial (skip server fetch)
const query = trpc.user.get.query({ id }).pipe(
  Atom.withServerValueInitial
)

// Option B: Prefetch and hydrate
const query = trpc.user.get.query({ id }).pipe(
  Atom.withServerValue((get) => {
    // Access prefetched data from a parent atom
    return get(prefetchedDataAtom)
  })
)
```

### 3. Hydration Integration

The tRPC client should integrate with Atom's hydration system:

```typescript
// Server: Dehydrate query results
const dehydratedQueries = Hydration.dehydrate(registry, {
  encodeInitialAs: "promise"  // Enable streaming
})

// Client: Hydrate in HydrationBoundary
<HydrationBoundary state={dehydratedQueries}>
  <App />
</HydrationBoundary>
```

### 4. useSyncExternalStore Pattern

The hooks already use this pattern, which is SSR-compatible:

```typescript
// From Hooks.ts - this pattern is correct
React.useSyncExternalStore(
  store.subscribe,
  store.snapshot,
  store.getServerSnapshot  // Critical for SSR
)
```

## Recommended Implementation

1. **All client code uses `"use client"`** - Already planned based on Atom React
2. **Query atoms auto-serialize** - Use `Atom.serializable()` with Schema for query results
3. **Streaming support** - Use `encodeInitialAs: "promise"` for pending queries
4. **Prefetch support** - Enable `trpc.prefetch()` that populates registry before render

## File References

| File | SSR Feature |
|------|-------------|
| `Hooks.ts:45-47` | `getServerSnapshot` for `useSyncExternalStore` |
| `ReactHydration.ts:22-84` | `HydrationBoundary` component |
| `Atom.ts:2071-2105` | `withServerValue`, `withServerValueInitial`, `getServerValue` |
| `Hydration.ts:32-113` | `dehydrate`, `hydrate` with streaming support |
| `RegistryContext.ts:22-25` | Default registry with scheduler |
