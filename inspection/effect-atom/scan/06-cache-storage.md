# H6: Cache Storage Patterns in Effect Atom

## Executive Summary

Effect Atom uses a **Registry-based state storage model** where each Atom's computed value is stored in a **Node** within a central **Registry**. The state storage is lazy, dependency-tracked, and supports automatic cleanup with TTL-based idle disposal.

---

## 1. Core State Storage Architecture

### 1.1 The Registry as State Container

```typescript
// Registry holds all Atom state in a Map<Atom | string, Node>
class RegistryImpl implements Registry.Registry {
  readonly nodes = new Map<Atom.Atom<any> | string, Node<any>>()
  readonly preloadedSerializable = new Map<string, unknown>()
  readonly timeoutBuckets = new Map<number, readonly [nodes: Set<Node<any>>, handle: number]>()
}
```

**Key Insight:** The Registry is the **single source of truth** for all Atom values. Unlike Redux where state is a plain object, Effect Atom's state is stored in Node instances within a Map.

### 1.2 Node as Value Container

Each Atom gets a corresponding Node that holds:

```typescript
class Node<A> {
  // The actual cached value
  _value: A = undefined as any
  
  // State tracking (uninitialized, stale, valid, removed)
  state: NodeState = NodeState.uninitialized
  
  // Lifetime for finalizers and dependency tracking
  lifetime: Lifetime<A> | undefined
  
  // Dependency graph
  parents: Array<Node<any>> = []
  children: Array<Node<any>> = []
  
  // Subscriptions for reactivity
  listeners: Set<() => void> = new Set()
}
```

### 1.3 State Lifecycle (NodeState Enum)

```typescript
const enum NodeFlags {
  alive = 1 << 0,        // Node exists
  initialized = 1 << 1,  // Value has been computed at least once
  waitingForValue = 1 << 2  // Currently computing
}

const enum NodeState {
  uninitialized = alive | waitingForValue,           // 5 - never computed
  stale = alive | initialized | waitingForValue,     // 7 - needs recomputation
  valid = alive | initialized,                        // 3 - cached value is current
  removed = 0                                          // disposed
}
```

---

## 2. State Lifecycle Phases

### 2.1 Creation: Lazy Initialization

```typescript
// Nodes are created on-demand when first accessed
ensureNode<A>(atom: Atom.Atom<A>): Node<A> {
  const key = atomKey(atom)
  let node = this.nodes.get(key)
  if (node === undefined) {
    node = this.createNode(atom)
    this.nodes.set(key, node)
  }
  return node
}
```

**Key Pattern:** Atoms are **NOT** stored until first accessed. This is pull-based/lazy initialization.

### 2.2 Value Computation with Caching

```typescript
value(): A {
  // Only recompute if stale or uninitialized
  if ((this.state & NodeFlags.waitingForValue) !== 0) {
    // Create lifetime context for dependency tracking
    this.lifetime = makeLifetime(this)
    
    // Call the atom's read function
    const value = this.atom.read(this.lifetime)
    
    // Cache the result
    if ((this.state & NodeFlags.waitingForValue) !== 0) {
      this.setValue(value)
    }
  }
  return this._value
}
```

### 2.3 Value Updates with Equality Check

```typescript
setValue(value: A): void {
  // First time - just set it
  if ((this.state & NodeFlags.initialized) === 0) {
    this.state = NodeState.valid
    this._value = value
    this.notify()
    return
  }

  this.state = NodeState.valid
  
  // Skip if value is equal (memoization!)
  if (Equal.equals(this._value, value)) {
    return
  }

  this._value = value
  this.invalidateChildren()  // Cascade invalidation
  this.notify()
}
```

**Memoization:** Uses Effect's `Equal.equals` for structural equality checking - derived atoms only recompute if their dependencies actually changed.

### 2.4 Cleanup: TTL-Based Disposal

```typescript
// Atoms can have an idle TTL
interface Atom<A> {
  readonly keepAlive: boolean     // If true, never auto-dispose
  readonly idleTTL?: number       // Milliseconds before disposal when idle
}

// Registry tracks timeout buckets for efficient cleanup
setNodeTimeout(node: Node<any>): void {
  const ttl = node.atom.idleTTL ?? this.defaultIdleTTL!
  const bucket = calculateBucket(ttl)
  
  // Add to timeout bucket for batch cleanup
  this.timeoutBuckets.get(bucket)[0].add(node)
}
```

**Cleanup Strategy:**
1. When all subscribers/children are gone, node becomes removable
2. If `keepAlive: false` and `idleTTL` is set, schedule for removal
3. Timeout buckets batch removals by time window
4. On removal, call all finalizers (for Effects/Streams)

---

## 3. Memoization Patterns

### 3.1 Atom Family Pattern

```typescript
// WeakRef-based memoization of parameterized atoms
export const family = <Arg, T extends object>(
  f: (arg: Arg) => T
): (arg: Arg) => T => {
  const atoms = MutableHashMap.empty<Arg, WeakRef<T>>()
  const registry = new FinalizationRegistry<Arg>((arg) => {
    MutableHashMap.remove(atoms, arg)  // Auto-cleanup when GC'd
  })
  
  return function(arg) {
    // Check cache first
    const atomEntry = MutableHashMap.get(atoms, arg).pipe(
      Option.flatMapNullable((ref) => ref.deref())
    )
    
    if (atomEntry._tag === "Some") {
      return atomEntry.value  // Cache hit!
    }
    
    // Create new atom and cache it
    const newAtom = f(arg)
    MutableHashMap.set(atoms, arg, new WeakRef(newAtom))
    registry.register(newAtom, arg)
    return newAtom
  }
}
```

**Pattern:** Uses `WeakRef` + `FinalizationRegistry` for automatic GC-based cache cleanup.

### 3.2 Layer MemoMap

```typescript
// Layers are memoized globally
export const defaultMemoMap: Layer.MemoMap = globalValue(
  "@effect-atom/atom/Atom/defaultMemoMap",
  () => Effect.runSync(Layer.makeMemoMap)
)

// RuntimeFactory uses shared memoMap
export const context: (options: {
  readonly memoMap: Layer.MemoMap
}) => RuntimeFactory
```

**Pattern:** Effect Layers are expensive to build - MemoMap ensures each unique Layer is built once.

### 3.3 Debounce Transform

```typescript
export const debounce = (duration: Duration.DurationInput) => 
  <A>(self: Atom<A>): Atom<A> => {
    const millis = Duration.toMillis(duration)
    return transform(self, function(get) {
      let timeout: number | undefined
      let value = get.once(self)
      
      get.subscribe(self, function(val) {
        value = val
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(update, millis)
      })
      return value
    })
  }
```

---

## 4. Result Type for Async State

The `Result<A, E>` type wraps async values with loading state:

```typescript
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>

interface Initial<A, E> {
  readonly _tag: "Initial"
  readonly waiting: boolean  // true = loading in progress
}

interface Success<A, E> {
  readonly _tag: "Success"
  readonly value: A
  readonly timestamp: number  // For staleness comparison
  readonly waiting: boolean   // true = refetching
}

interface Failure<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause<E>
  readonly previousSuccess: Option<Success<A, E>>  // Stale-while-revalidate!
  readonly waiting: boolean
}
```

**Key Features:**
- `timestamp` enables "stale-while-revalidate" comparison
- `previousSuccess` in Failure enables showing stale data on error
- `waiting` flag distinguishes initial load from background refresh

---

## 5. Dependency Tracking (Automatic Cache Invalidation)

### 5.1 Parent-Child Graph

```typescript
// When atom B reads atom A, B becomes A's child
get<A>(this: Lifetime<any>, atom: Atom.Atom<A>): A {
  const parent = this.node.registry.ensureNode(atom)
  this.node.addParent(parent)  // Track dependency
  return parent.value()
}

// When A changes, all children are invalidated
invalidateChildren(): void {
  const children = this.children
  this.children = []
  for (let i = 0; i < children.length; i++) {
    children[i].invalidate()
  }
}
```

### 5.2 Lazy Re-evaluation

```typescript
invalidate(): void {
  if (this.state === NodeState.valid) {
    this.state = NodeState.stale  // Mark as needing recomputation
    this.disposeLifetime()         // Clean up Effects/Streams
  }

  // Only recompute immediately if someone is actively listening
  if (this.atom.lazy && this.listeners.size === 0 && !childrenAreActive(this.children)) {
    this.invalidateChildren()
    this.skipInvalidation = true  // Defer computation
  } else {
    this.value()  // Recompute now
  }
}
```

---

## 6. Batching for Performance

```typescript
export const batchState = {
  phase: BatchPhase.disabled,
  depth: 0,
  stale: [] as Array<Node<any>>,
  notify: new Set<Node<any>>()
}

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
      
      // Notify all listeners (deduped)
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

## 7. Recommendations for effect-trpc Cache Design

### 7.1 Adopt Registry Pattern for Query Cache

```typescript
// effect-trpc should have a QueryRegistry similar to AtomRegistry
interface QueryRegistry {
  readonly nodes: Map<QueryKey, QueryNode<any, any>>
  
  readonly get: <A, E>(key: QueryKey) => Result<A, E>
  readonly set: <A, E>(key: QueryKey, result: Result<A, E>) => void
  readonly invalidate: (key: QueryKey) => void
  readonly subscribe: <A, E>(key: QueryKey, f: (r: Result<A, E>) => void) => () => void
}

// Each query gets a Node
interface QueryNode<A, E> {
  readonly key: QueryKey
  readonly result: Result<A, E>
  readonly subscribers: Set<() => void>
  readonly lastFetched: number
}
```

### 7.2 Use Result Type for Query State

```typescript
// Already similar to TanStack Query's QueryObserverResult
type QueryResult<A, E> = 
  | { _tag: "Loading" }
  | { _tag: "Success"; data: A; fetchedAt: number; isRefetching: boolean }
  | { _tag: "Error"; error: E; staleData?: A }
```

### 7.3 Implement Query Family for Parameterized Queries

```typescript
// Like Atom.family for parameterized queries
const queryFamily = <Input, Output, Error>(
  procedure: TrpcProcedure<Input, Output, Error>
): ((input: Input) => QueryAtom<Output, Error>) => {
  // Use MutableHashMap with WeakRef for automatic cleanup
  const cache = MutableHashMap.empty<Input, WeakRef<QueryAtom<Output, Error>>>()
  // ...
}
```

### 7.4 Add TTL-Based Cache Eviction

```typescript
interface QueryOptions {
  readonly staleTime?: Duration.DurationInput   // When to mark as stale
  readonly gcTime?: Duration.DurationInput      // When to evict from cache
  readonly keepAlive?: boolean                   // Never evict
}
```

### 7.5 Integrate with Effect Atom Directly

Rather than building a parallel cache system, consider:

```typescript
// Option A: Build on top of Atom
const query = <Input, Output, Error>(
  procedure: TrpcProcedure<Input, Output, Error>,
  input: Input
): Atom<Result<Output, Error>> => {
  return Atom.runtime.atom(
    procedure.query(input),
    { initialValue: undefined }
  ).pipe(
    Atom.withReactivity([procedure.key, input])
  )
}

// Option B: Use Atom's Registry for cache storage
const QueryCache = Atom.readable((get) => {
  // Access via get() creates reactive dependencies
  return {
    get: (key: QueryKey) => get(queryAtomFamily(key)),
    invalidate: (key: QueryKey) => get.refresh(queryAtomFamily(key))
  }
})
```

### 7.6 Key Architecture Decisions

| Concern | Effect Atom Approach | Recommendation for effect-trpc |
|---------|---------------------|-------------------------------|
| Storage | Registry + Node Map | QueryRegistry with similar structure |
| Keys | Atom identity or serializable key | Input-based QueryKey (hashable) |
| Equality | `Equal.equals` | Use Effect's `Equal` for cache hits |
| Lifecycle | keepAlive + idleTTL | staleTime + gcTime (TanStack Query semantics) |
| Invalidation | Dependency graph | Manual + Reactivity service integration |
| Batching | Global batch function | Adopt same batching pattern |

---

## 8. Summary

**Effect Atom's Cache Strategy:**
1. **Registry-centric**: Single Map holds all state
2. **Node-based**: Each Atom gets a Node with value, state, dependencies
3. **Lazy computation**: Only compute when accessed
4. **Equality memoization**: Skip updates if value unchanged
5. **Dependency tracking**: Automatic invalidation graph
6. **TTL cleanup**: Idle atoms are garbage collected
7. **Family memoization**: WeakRef-based parameterized atom caching
8. **Batching**: Defer notifications until batch completes

**For effect-trpc:**
- Build a similar Registry for query cache
- Use Result type for async state (already exists)
- Implement family pattern for parameterized queries
- Add TTL-based cache eviction
- Consider building directly on Effect Atom for simpler integration
