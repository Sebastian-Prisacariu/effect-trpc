# H7: Subscription Management in Effect Atom

## Overview

Effect Atom implements a sophisticated subscription system based on a **dependency graph** with lazy evaluation and automatic cleanup. The core mechanism uses a `Registry` that manages `Node` objects, each representing a mounted atom with its dependencies and subscribers.

## Subscription API

### Registry-Level Subscription

```typescript
// Registry.ts - Main subscription interface
interface Registry {
  readonly subscribe: <A>(
    atom: Atom.Atom<A>,
    f: (_: A) => void,
    options?: { readonly immediate?: boolean }
  ) => () => void  // Returns unsubscribe function
  
  readonly mount: <A>(atom: Atom.Atom<A>) => () => void
}
```

**Key characteristics:**
- Returns an unsubscribe function for cleanup
- `immediate` option to receive current value immediately
- `mount()` is a convenience wrapper around `subscribe(atom, constVoid, { immediate: true })`

### Context-Level Subscription (Within Atoms)

```typescript
// Atom.ts - Context interface
interface Context {
  subscribe<A>(
    this: Context,
    atom: Atom<A>,
    f: (_: A) => void,
    options?: { readonly immediate?: boolean }
  ): void  // Auto-registers finalizer
  
  mount<A>(this: Context, atom: Atom<A>): void
  addFinalizer(this: Context, f: () => void): void
}
```

**Within atoms, subscriptions are automatically cleaned up** via the Lifetime system.

### AtomRef Subscription Pattern

```typescript
// AtomRef.ts - Simpler observer pattern
interface ReadonlyRef<A> {
  readonly subscribe: (f: (a: A) => void) => () => void
  readonly map: <B>(f: (a: A) => B) => ReadonlyRef<B>
}
```

AtomRef uses a simple listener array pattern, independent of the Registry.

## Change Propagation Mechanism

### Node State Machine

```typescript
const enum NodeFlags {
  alive = 1 << 0,
  initialized = 1 << 1,
  waitingForValue = 1 << 2
}

const enum NodeState {
  uninitialized = NodeFlags.alive | NodeFlags.waitingForValue,
  stale = NodeFlags.alive | NodeFlags.initialized | NodeFlags.waitingForValue,
  valid = NodeFlags.alive | NodeFlags.initialized,
  removed = 0
}
```

### Propagation Flow

1. **Value Change Detection**
   ```typescript
   // Node.setValue()
   if (Equal.equals(this._value, value)) {
     return  // Skip if no change
   }
   this._value = value
   this.invalidateChildren()  // Mark dependents as stale
   ```

2. **Child Invalidation**
   ```typescript
   invalidateChildren(): void {
     const children = this.children
     this.children = []  // Clear current children
     for (let i = 0; i < children.length; i++) {
       children[i].invalidate()
     }
   }
   ```

3. **Lazy Re-evaluation**
   ```typescript
   invalidate(): void {
     if (this.state === NodeState.valid) {
       this.state = NodeState.stale
       this.disposeLifetime()  // Clean up previous execution
     }
     
     if (this.atom.lazy && this.listeners.size === 0 && 
         !childrenAreActive(this.children)) {
       // Skip evaluation if no active subscribers
       this.invalidateChildren()
       this.skipInvalidation = true
     } else {
       this.value()  // Trigger re-evaluation
     }
   }
   ```

4. **Listener Notification**
   ```typescript
   notify(): void {
     this.listeners.forEach(notifyListener)
   }
   ```

### Dependency Tracking

Dependencies are tracked automatically during `atom.read()`:

```typescript
// Lifetime.get()
get<A>(this: Lifetime<any>, atom: Atom.Atom<A>): A {
  const parent = this.node.registry.ensureNode(atom)
  this.node.addParent(parent)  // Track dependency
  return parent.value()
}
```

Parent-child relationships form a DAG (directed acyclic graph):

```typescript
class Node<A> {
  parents: Array<Node<any>> = []      // Nodes this depends on
  children: Array<Node<any>> = []     // Nodes that depend on this
  listeners: Set<() => void> = new Set()  // Direct subscribers
}
```

## Batching System

Batch updates to prevent cascading re-renders:

```typescript
export const enum BatchPhase {
  disabled,
  collect,   // Collecting changes
  commit     // Notifying listeners
}

export function batch(f: () => void): void {
  batchState.phase = BatchPhase.collect
  batchState.depth++
  try {
    f()
    if (batchState.depth === 1) {
      // Rebuild stale nodes
      for (let i = 0; i < batchState.stale.length; i++) {
        batchRebuildNode(batchState.stale[i])
      }
      // Then notify all listeners
      batchState.phase = BatchPhase.commit
      for (const node of batchState.notify) {
        node.notify()
      }
      batchState.notify.clear()
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

## Cleanup Patterns

### Lifetime-Based Disposal

Each atom evaluation creates a `Lifetime` object:

```typescript
interface Lifetime<A> extends Atom.Context {
  isFn: boolean
  readonly node: Node<A>
  finalizers: Array<() => void> | undefined
  disposed: boolean
  readonly dispose: () => void
}
```

Finalizers run in reverse order (LIFO):

```typescript
dispose(this: Lifetime<any>): void {
  this.disposed = true
  if (this.finalizers === undefined) return
  
  const finalizers = this.finalizers
  this.finalizers = undefined
  for (let i = finalizers.length - 1; i >= 0; i--) {
    finalizers[i]()
  }
}
```

### Node Removal

```typescript
class Node<A> {
  remove() {
    this.state = NodeState.removed
    this.listeners.clear()
    
    this.disposeLifetime()  // Run all finalizers
    
    // Propagate removal to orphaned parents
    if (this.previousParents !== undefined) {
      const parents = this.previousParents
      for (let i = 0; i < parents.length; i++) {
        parents[i].removeChild(this)
        if (parents[i].canBeRemoved) {
          this.registry.removeNode(parents[i])
        }
      }
    }
  }
  
  get canBeRemoved(): boolean {
    return !this.atom.keepAlive && 
           this.listeners.size === 0 && 
           this.children.length === 0 &&
           this.state !== 0
  }
}
```

### Registry-Level Cleanup

```typescript
reset(): void {
  this.timeoutBuckets.forEach(([, handle]) => clearTimeout(handle))
  this.timeoutBuckets.clear()
  this.nodeTimeoutBucket.clear()
  this.nodes.forEach((node) => node.remove())
  this.nodes.clear()
}

dispose(): void {
  this.disposed = true
  this.reset()
}
```

## Memory Management

### TTL-Based Garbage Collection

Atoms can specify an idle TTL for automatic cleanup:

```typescript
interface Atom<A> {
  readonly keepAlive: boolean  // Never GC
  readonly idleTTL?: number    // Milliseconds to keep after last subscriber
}

// Registry tracks timeout buckets
readonly timeoutBuckets = new Map<number, readonly [nodes: Set<Node<any>>, handle: number]>()
readonly nodeTimeoutBucket = new Map<Node<any>, number>()
```

The system groups timeouts into buckets for efficiency:

```typescript
setNodeTimeout(node: Node<any>): void {
  const ttl = Math.ceil(idleTTL! / this.timeoutResolution) * this.timeoutResolution
  const timestamp = Date.now() + ttl
  const bucket = timestamp - (timestamp % this.timeoutResolution) + this.timeoutResolution
  
  let entry = this.timeoutBuckets.get(bucket)
  if (entry === undefined) {
    entry = [new Set(), setTimeout(() => this.sweepBucket(bucket), bucket - Date.now())]
    this.timeoutBuckets.set(bucket, entry)
  }
  entry[0].add(node)
}
```

### Family Pattern with WeakRef

For parameterized atoms, uses WeakRef + FinalizationRegistry:

```typescript
export const family = <Arg, T extends object>(f: (arg: Arg) => T): (arg: Arg) => T => {
  const atoms = MutableHashMap.empty<Arg, WeakRef<T>>()
  const registry = new FinalizationRegistry<Arg>((arg) => {
    MutableHashMap.remove(atoms, arg)
  })
  
  return function(arg) {
    const atomEntry = MutableHashMap.get(atoms, arg).pipe(
      Option.flatMapNullable((ref) => ref.deref())
    )
    if (atomEntry._tag === "Some") return atomEntry.value
    
    const newAtom = f(arg)
    MutableHashMap.set(atoms, arg, new WeakRef(newAtom))
    registry.register(newAtom, arg)
    return newAtom
  }
}
```

### Store Caching in React

```typescript
// Hooks.ts - WeakMap caching
const storeRegistry = globalValue(
  "@effect-atom/atom-react/storeRegistry",
  () => new WeakMap<Registry.Registry, WeakMap<Atom.Atom<any>, AtomStore<any>>>()
)
```

## React Integration

### useSyncExternalStore Pattern

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

### Automatic Mount/Unmount

```typescript
function mountAtom<A>(registry: Registry.Registry, atom: Atom.Atom<A>): void {
  React.useEffect(() => registry.mount(atom), [atom, registry])
}
```

### Suspense Integration

```typescript
function atomResultOrSuspend<A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)  // React Suspense
  }
  return value
}
```

## Key Design Patterns

### 1. Pull-Based with Push Notification
- Values computed lazily on demand
- Change notifications push to trigger re-pulls
- Combines efficiency of pull with reactivity of push

### 2. Automatic Dependency Tracking
- No manual dependency declaration
- Dependencies detected during execution
- Re-tracks on every evaluation (handles conditional deps)

### 3. Structural Sharing
- Uses `Equal.equals()` for change detection
- Supports Effect's structural equality

### 4. Hierarchical Cleanup
- Lifetime finalizers for effect cleanup
- Cascading parent removal
- TTL-based idle cleanup

### 5. Batched Updates
- Collects all changes
- Rebuilds dependency graph
- Single notification pass

## Implications for tRPC Integration

1. **Query atoms** can use `Effect.Effect` → `Result.Result<A, E>` pattern
2. **Subscriptions** automatically clean up on unmount
3. **Batching** prevents intermediate renders during multi-query updates
4. **TTL** enables query cache invalidation
5. **Dependency tracking** enables derived queries (e.g., query using result of another)
6. **Suspense support** built into the React layer
