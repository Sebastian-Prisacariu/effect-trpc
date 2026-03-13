# H9: Invalidation Patterns in Effect Atom

## Summary

Effect Atom has **built-in invalidation** at two levels:
1. **Node-level invalidation** - Internal graph mechanism for derived atoms
2. **Reactivity service** - External key-based invalidation using `@effect/experimental/Reactivity`

This is significantly more sophisticated than manual invalidation patterns.

---

## 1. Node-Level Invalidation (Internal Graph)

### Core Mechanism

Located in `packages/atom/src/internal/registry.ts`:

```typescript
// Node states
const enum NodeState {
  uninitialized = NodeFlags.alive | NodeFlags.waitingForValue,
  stale = NodeFlags.alive | NodeFlags.initialized | NodeFlags.waitingForValue,  // <-- STALE STATE
  valid = NodeFlags.alive | NodeFlags.initialized,
  removed = 0
}

// Invalidation propagates through the dependency graph
invalidate(): void {
  if (this.state === NodeState.valid) {
    this.state = NodeState.stale   // Mark as stale
    this.disposeLifetime()         // Clean up subscriptions
  }

  // Either queue for batch processing or immediately rebuild
  if (batchState.phase === BatchPhase.collect) {
    batchState.stale.push(this)
  } else if (this.atom.lazy && this.listeners.size === 0 && !childrenAreActive(this.children)) {
    this.invalidateChildren()      // Lazy: just propagate down
    this.skipInvalidation = true
  } else {
    this.value()                   // Eager: recompute immediately
  }
}

invalidateChildren(): void {
  const children = this.children
  this.children = []
  for (let i = 0; i < children.length; i++) {
    children[i].invalidate()       // Recursive invalidation
  }
}
```

### Key Insight: Parent-Child Tracking

Atoms track their dependencies (parents) and dependents (children):

```typescript
class Node<A> {
  parents: Array<Node<any>> = []     // Atoms I depend on
  children: Array<Node<any>> = []    // Atoms that depend on me
  
  // When I read another atom, establish parent-child relationship
  addParent(parent: Node<any>): void {
    this.parents.push(parent)
    if (parent.children.indexOf(this) === -1) {
      parent.children.push(this)
    }
  }
}
```

### Lazy vs Eager Invalidation

```typescript
// Lazy atoms: defer recomputation until read
if (this.atom.lazy && this.listeners.size === 0 && !childrenAreActive(this.children)) {
  this.invalidateChildren()
  this.skipInvalidation = true
}
// Eager atoms: recompute immediately on invalidation
else {
  this.value()  // Recompute now
}
```

---

## 2. Registry-Level Refresh

The registry provides explicit refresh APIs:

```typescript
// Registry.ts interface
readonly refresh: <A>(atom: Atom.Atom<A>) => void

// Implementation
refresh = <A>(atom: Atom.Atom<A>): void => {
  if (atom.refresh !== undefined) {
    atom.refresh(this.refresh)      // Custom refresh logic
  } else {
    this.invalidateAtom(atom)       // Default: invalidate the node
  }
}

invalidateAtom = <A>(atom: Atom.Atom<A>): void => {
  this.ensureNode(atom).invalidate()
}
```

### Usage: Effect.Effect API

```typescript
// Atom.ts - Effect API for refresh
export const refresh = <A>(self: Atom<A>): Effect.Effect<void, never, AtomRegistry> =>
  Effect.map(AtomRegistry, (_) => _.refresh(self))
```

---

## 3. Reactivity Keys System (External Invalidation)

### The `@effect/experimental/Reactivity` Service

Effect Atom integrates with a dedicated Reactivity service for **key-based invalidation**:

```typescript
// AtomRpc.ts - Mutation triggers invalidation
Effect.fnUntraced(function*({ headers, payload, reactivityKeys }) {
  const client = yield* self
  const effect = client(tag, payload, { headers } as any)
  return yield* reactivityKeys
    ? Reactivity.mutation(effect, reactivityKeys)  // Invalidates keys after mutation
    : effect
})
```

### Query Subscription to Reactivity Keys

```typescript
// Queries can subscribe to reactivity keys
queryFamily(
  new QueryKey({
    tag,
    payload: Data.struct(payload),
    reactivityKeys: options?.reactivityKeys
      ? wrapReactivityKeys(options.reactivityKeys)
      : undefined,
  })
)

// Factory wraps atoms with reactivity subscription
return reactivityKeys
  ? self.runtime.factory.withReactivity(reactivityKeys)(atom)
  : atom
```

### `withReactivity` Implementation

```typescript
// Atom.ts
factory.withReactivity =
  (keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>) =>
  <A extends Atom<any>>(atom: A): A =>
    transform(atom, (get) => {
      const reactivity = Result.getOrThrow(get(reactivityAtom))
      
      // Register for invalidation when keys change
      get.addFinalizer(reactivity.unsafeRegister(keys, () => {
        get.refresh(atom)  // <-- This is the callback!
      }))
      
      get.subscribe(atom, (value) => get.setSelf(value))
      return get.once(atom)
    }) as any as A
```

### How Reactivity Works

1. **Mutation**: `Reactivity.mutation(effect, keys)` - runs effect, then invalidates keys
2. **Invalidation**: `Reactivity.invalidate(keys)` - directly invalidates keys (for streams)
3. **Subscription**: `withReactivity(keys)` - atom refreshes when those keys are invalidated

### Key Wrapping for Structural Equality

```typescript
// internal/data.ts
export const wrapReactivityKeys = (
  keys: ReadonlyArray<unknown> | ReadonlyRecord<string, ReadonlyArray<unknown>>
) => {
  if (Array.isArray(keys)) {
    return Data.array(keys)  // Structural equality for array keys
  }
  const obj: Record<string, ReadonlyArray<unknown>> = Object.create(Data.Structural.prototype)
  for (const key in keys) {
    obj[key] = Data.array(val)
  }
  return obj
}
```

---

## 4. Signal-Based Refresh

Effect Atom provides signal-based refresh patterns:

```typescript
// Custom signal-based refresh
export const makeRefreshOnSignal = <_>(signal: Atom<_>) => 
  <A extends Atom<any>>(self: A): WithoutSerializable<A> =>
    transform(self, (get) => {
      get.once(signal)
      get.subscribe(signal, (_) => get.refresh(self))  // Refresh on signal change
      get.subscribe(self, (value) => get.setSelf(value))
      return get.once(self)
    }) as any

// Built-in: refresh on window focus
export const refreshOnWindowFocus = makeRefreshOnSignal(windowFocusSignal)
```

---

## 5. Batching System

Invalidations are batched to prevent cascade recomputation:

```typescript
// batchState tracks stale nodes during batch
export const batchState = globalValue("@effect-atom/atom/Registry/batchState", () => ({
  phase: BatchPhase.disabled,
  depth: 0,
  stale: [] as Array<Node<any>>,  // Nodes to rebuild
  notify: new Set<Node<any>>()    // Nodes to notify listeners
}))

export function batch(f: () => void): void {
  batchState.phase = BatchPhase.collect
  batchState.depth++
  try {
    f()
    if (batchState.depth === 1) {
      // Rebuild all stale nodes
      for (let i = 0; i < batchState.stale.length; i++) {
        batchRebuildNode(batchState.stale[i])
      }
      // Then notify all listeners
      batchState.phase = BatchPhase.commit
      for (const node of batchState.notify) {
        node.notify()
      }
    }
  } finally {
    batchState.depth--
    if (batchState.depth === 0) {
      batchState.phase = BatchPhase.disabled
      batchState.stale = []
    }
  }
}
```

---

## 6. Context Methods for Invalidation

Within atom read functions, the context provides:

```typescript
interface Context {
  // Refresh another atom (triggers its refresh logic)
  refresh<A>(atom: Atom<A>): void
  
  // Refresh self (invalidate this atom)
  refreshSelf(): void
}

// Implementation
refresh<A>(this: Lifetime<any>, atom: Atom<A>): void {
  this.node.registry.refresh(atom)
}

refreshSelf(this: Lifetime<any>): void {
  this.node.invalidate()
}
```

### Custom Refresh Functions

Atoms can define custom refresh behavior:

```typescript
export const readable = <A>(
  read: (get: Context) => A,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void  // Custom refresh
): Atom<A>

// Example: derived atom refreshes its source
export const writable = <R, W>(
  read: (get: Context) => R,
  write: (ctx: WriteContext<R>, value: W) => void,
  refresh?: (f: <A>(atom: Atom<A>) => void) => void
): Writable<R, W>

// Usage
const derived = Atom.writable(
  (get) => get(base),
  () => {},
  (refresh) => refresh(base)  // When derived is refreshed, refresh base instead
)
```

---

## 7. Test Evidence

From `Atom.test.ts`:

```typescript
describe("Reactivity", () => {
  it("rebuilds on mutation", async () => {
    const r = Registry.make()
    let rebuilds = 0
    
    // Atom subscribes to "counter" reactivity key
    const atom = Atom.make(() => rebuilds++).pipe(
      Atom.withReactivity(["counter"]),
      Atom.keepAlive
    )
    
    // Mutation invalidates "counter" key
    const fn = counterRuntime.fn(
      Effect.fn(function*() {}),
      { reactivityKeys: ["counter"] }
    )
    
    assert.strictEqual(r.get(atom), 0)
    r.set(fn, void 0)               // Mutation runs
    assert.strictEqual(r.get(atom), 1)  // Atom was rebuilt!
    r.set(fn, void 0)
    r.set(fn, void 0)
    assert.strictEqual(r.get(atom), 3)  // Each mutation triggers rebuild
  })
})

// Signal-based refresh
test(`refreshOnSignal`, async () => {
  const signal = Atom.make(0)
  const refreshOnSignal = Atom.makeRefreshOnSignal(signal)
  const atom = Atom.make(() => rebuilds++).pipe(refreshOnSignal)
  
  r.mount(atom)
  assert.strictEqual(rebuilds, 1)
  
  r.set(signal, 1)              // Update signal
  assert.strictEqual(rebuilds, 2)  // Atom was rebuilt!
})
```

---

## Comparison: Effect Atom vs TanStack Query

| Feature | Effect Atom | TanStack Query |
|---------|-------------|----------------|
| **Automatic dependency tracking** | Yes (graph-based) | No (manual keys) |
| **Reactive keys** | Yes (`withReactivity`) | Yes (`queryKey`) |
| **Mutation invalidation** | `Reactivity.mutation` | `invalidateQueries` |
| **Stale state** | `NodeState.stale` | `isStale` flag |
| **Batching** | Built-in `batch()` | None built-in |
| **Lazy recomputation** | Yes (lazy atoms) | No |
| **Signal-based refresh** | `makeRefreshOnSignal` | Manual |
| **Custom refresh logic** | `refresh` param | None |

---

## Implications for tRPC-Effect

### 1. We Should Use `Reactivity` Service
The `@effect/experimental/Reactivity` service is the idiomatic way to handle invalidation:
- Mutations trigger `Reactivity.mutation(effect, keys)`
- Queries subscribe via `withReactivity(keys)`

### 2. Key Patterns
Reactivity keys can be:
- Simple arrays: `["users"]`
- Structured: `{ users: [userId] }` for granular invalidation

### 3. No Custom Invalidation Needed
Effect Atom already has:
- Graph-based automatic invalidation
- Key-based external invalidation
- Batching for performance
- Lazy/eager modes

### 4. Integration Pattern
```typescript
// Query atom with reactivity
const usersAtom = trpc.users.list({
  reactivityKeys: ["users"]  // Subscribes to "users" key
})

// Mutation triggers invalidation
const createUser = trpc.users.create({
  reactivityKeys: ["users"]  // Invalidates "users" after success
})
```

---

## Key Files

| File | Purpose |
|------|---------|
| `internal/registry.ts` | Node-level invalidation, batching |
| `Atom.ts` | `withReactivity`, `refresh`, signals |
| `AtomRpc.ts` | `Reactivity.mutation` integration |
| `internal/data.ts` | Key wrapping for structural equality |
