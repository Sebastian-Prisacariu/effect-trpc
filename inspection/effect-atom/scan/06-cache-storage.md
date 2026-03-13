# H6: Cache Storage - Effect Atom State Storage Architecture

## Overview

Effect Atom uses a **Registry-based storage model** where all atom values are stored in a centralized `Registry` that manages node lifecycle, dependency tracking, and value caching. Unlike simple cache systems, atoms store reactive state with built-in change detection and propagation.

## Storage Architecture

### 1. Registry - The Central Store

```
Registry (RegistryImpl)
    |
    +-- nodes: Map<Atom | string, Node>  -- Main value storage
    |
    +-- preloadedSerializable: Map<string, unknown>  -- SSR hydration
    |
    +-- timeoutBuckets: Map<number, [Set<Node>, handle]>  -- TTL management
    |
    +-- nodeTimeoutBucket: Map<Node, number>  -- Node -> bucket mapping
```

**Location:** `internal/registry.ts:40-67`

```typescript
class RegistryImpl implements Registry.Registry {
  readonly nodes = new Map<Atom.Atom<any> | string, Node<any>>()
  readonly preloadedSerializable = new Map<string, unknown>()
  readonly timeoutBuckets = new Map<number, readonly [nodes: Set<Node<any>>, handle: number]>()
  readonly nodeTimeoutBucket = new Map<Node<any>, number>()
}
```

### 2. Node - The Value Container

Each atom's value is stored in a `Node` that tracks:

**Location:** `internal/registry.ts:275-320`

```typescript
class Node<A> {
  state: NodeState = NodeState.uninitialized
  lifetime: Lifetime<A> | undefined    // Manages subscriptions/finalizers
  writeContext: WriteContextImpl<A>
  
  parents: Array<Node<any>> = []       // Dependencies (other atoms)
  previousParents: Array<Node<any>> | undefined
  children: Array<Node<any>> = []      // Dependents (atoms that read this)
  listeners: Set<() => void> = new Set()
  
  _value: A = undefined as any         // THE ACTUAL CACHED VALUE
}
```

### 3. Node State Machine

```
NodeState.uninitialized (alive | waitingForValue)
         |
         v  [first read]
NodeState.valid (alive | initialized)
         |
         v  [invalidate()]
NodeState.stale (alive | initialized | waitingForValue)
         |
         v  [value()]
NodeState.valid
         |
         v  [remove()]
NodeState.removed (0)
```

**Location:** `internal/registry.ts:262-273`

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

## Value Access Pattern

### Lazy Evaluation with Caching

**Location:** `internal/registry.ts:298-320`

```typescript
value(): A {
  if ((this.state & NodeFlags.waitingForValue) !== 0) {
    // Only compute if needed
    this.lifetime = makeLifetime(this)
    const value = this.atom.read(this.lifetime)
    
    if ((this.state & NodeFlags.waitingForValue) !== 0) {
      this.setValue(value)  // Cache the result
    }
    
    // Clean up stale parent dependencies
    if (this.previousParents) {
      // ... remove old dependencies
    }
  }
  
  return this._value  // Return cached value
}
```

### Change Detection with Equality

**Location:** `internal/registry.ts:329-362`

```typescript
setValue(value: A): void {
  // First initialization
  if ((this.state & NodeFlags.initialized) === 0) {
    this.state = NodeState.valid
    this._value = value
    this.notify()  // or batch
    return
  }

  this.state = NodeState.valid
  
  // EQUALITY CHECK - skip if unchanged
  if (Equal.equals(this._value, value)) {
    return
  }

  this._value = value
  this.invalidateChildren()  // Propagate to dependents
  
  if (this.listeners.size > 0) {
    this.notify()  // or batch
  }
}
```

## Memoization Patterns

### 1. Atom Family - WeakRef Memoization

**Location:** `Atom.ts:1324-1359`

```typescript
export const family = <Arg, T extends object>(
  f: (arg: Arg) => T
): (arg: Arg) => T => {
  const atoms = MutableHashMap.empty<Arg, WeakRef<T>>()
  const registry = new FinalizationRegistry<Arg>((arg) => {
    MutableHashMap.remove(atoms, arg)
  })
  
  return function(arg) {
    const atomEntry = MutableHashMap.get(atoms, arg).pipe(
      Option.flatMapNullable((ref) => ref.deref())
    )

    if (atomEntry._tag === "Some") {
      return atomEntry.value  // Return cached atom
    }
    
    const newAtom = f(arg)
    MutableHashMap.set(atoms, arg, new WeakRef(newAtom))
    registry.register(newAtom, arg)  // Auto-cleanup when GC'd
    return newAtom
  }
}
```

### 2. Layer MemoMap - Runtime Caching

**Location:** `Atom.ts:712-715`

```typescript
export const defaultMemoMap: Layer.MemoMap = globalValue(
  "@effect-atom/atom/Atom/defaultMemoMap",
  () => Effect.runSync(Layer.makeMemoMap)
)
```

Used to cache Effect runtime builds across atoms.

### 3. IdleTTL - Automatic Disposal

**Location:** `internal/registry.ts:188-230`

```typescript
setNodeTimeout(node: Node<any>): void {
  let idleTTL = node.atom.idleTTL ?? this.defaultIdleTTL!
  const ttl = Math.ceil(idleTTL / this.timeoutResolution) * this.timeoutResolution
  const timestamp = Date.now() + ttl
  const bucket = timestamp - (timestamp % this.timeoutResolution) + this.timeoutResolution

  let entry = this.timeoutBuckets.get(bucket)
  if (entry === undefined) {
    entry = [
      new Set<Node<any>>(),
      setTimeout(() => this.sweepBucket(bucket), bucket - Date.now())
    ]
    this.timeoutBuckets.set(bucket, entry)
  }
  entry[0].add(node)
}
```

## Result Type - Async Value States

**Location:** `Result.ts:25-26, 112-175`

```typescript
export type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>

// Initial - no value yet, optionally waiting
interface Initial<A, E> {
  readonly _tag: "Initial"
  readonly waiting: boolean
}

// Success - has value, optionally still refreshing
interface Success<A, E> {
  readonly _tag: "Success"
  readonly value: A
  readonly waiting: boolean
  readonly timestamp: number
}

// Failure - error occurred, can preserve previous success
interface Failure<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly previousSuccess: Option.Option<Success<A, E>>
  readonly waiting: boolean
}
```

## AtomRef - Direct Mutable State

**Location:** `AtomRef.ts:63-122`

```typescript
class AtomRefImpl<A> implements AtomRef<A> {
  constructor(public value: A) {}  // Direct mutable storage
  
  listeners: Array<(a: A) => void> = []
  listenerCount = 0

  set(value: A) {
    if (Equal.equals(value, this.value)) {
      return this  // Skip if unchanged
    }
    this.value = value
    this.notify(value)  // Synchronous notification
    return this
  }
}
```

## Batching - Deferred Notifications

**Location:** `internal/registry.ts:760-802`

```typescript
export const batchState = globalValue("@effect-atom/atom/Registry/batchState", () => ({
  phase: BatchPhase.disabled,
  depth: 0,
  stale: [] as Array<Node<any>>,
  notify: new Set<Node<any>>()
}))

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
      // Commit phase - notify listeners
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

## Storage Lifecycle

```
1. CREATION
   Atom defined (no storage yet - atoms are lazy by default)

2. FIRST ACCESS
   registry.get(atom) -> registry.ensureNode(atom)
     -> new Node(registry, atom)
     -> nodes.set(atom, node)
     
3. VALUE COMPUTATION
   node.value()
     -> atom.read(lifetime)
     -> node.setValue(result)
     -> node._value = result  // STORED
     
4. DEPENDENCY TRACKING
   During read, lifetime.get(otherAtom)
     -> node.addParent(parentNode)
     -> parentNode.children.push(node)
     
5. INVALIDATION
   parentNode.setValue(newValue)
     -> parentNode.invalidateChildren()
     -> childNode.invalidate()
     -> childNode.state = NodeState.stale
     
6. RE-COMPUTATION (lazy)
   childNode.value()
     -> (if stale) atom.read(lifetime)
     -> node.setValue(newResult)
     
7. DISPOSAL
   - Manual: registry.dispose()
   - Auto: keepAlive=false + no listeners + no children
   - TTL: idleTTL timeout + sweepBucket()
```

## Key Insights for tRPC-Effect

### What Effect Atom Provides

1. **Centralized Storage**: All values in one Registry
2. **Lazy Evaluation**: Values computed on first access
3. **Change Detection**: `Equal.equals` prevents unnecessary updates
4. **Dependency Graph**: Automatic parent/child tracking
5. **Lifecycle Management**: TTL-based disposal, finalizers
6. **Batching**: Deferred notifications for multiple updates
7. **Result Type**: First-class async state with history

### What We Need for tRPC

Our `Reactivity` service has invalidation without storage. Options:

1. **Use Effect Atom directly**: Atoms store RPC results
2. **Add storage to Reactivity**: Simple cache Map with TTL
3. **Hybrid**: Reactivity for invalidation, atoms for storage

### Storage vs Invalidation Separation

Effect Atom tightly couples:
- Storage (Node._value)
- Invalidation (Node.invalidate -> Node.state = stale)
- Re-computation (Node.value with waitingForValue)

Our Reactivity only does invalidation. We could:
- Add a simple cache layer to `@effect/experimental/Reactivity`
- Use atoms as the "storage + computation" layer
- Keep Reactivity just for "what changed" signals

### Recommended Approach

```typescript
// Use atoms for storage/caching of RPC results
const userAtom = runtime.atom(
  rpc.getUser({ id: 1 })  // Effect RPC call
)

// Use Reactivity for cross-cutting invalidation
const createUser = rpc.createUser.pipe(
  Effect.tap(() => Reactivity.invalidate([UserKey]))
)

// Atom automatically re-fetches when invalidated
const wrappedAtom = Atom.withReactivity([UserKey])(userAtom)
```

This gives us:
- Effect Atom's storage and lifecycle
- Reactivity's invalidation signals
- Clean separation of concerns
