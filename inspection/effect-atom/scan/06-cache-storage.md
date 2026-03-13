# H6: Effect Atom Cache Architecture

## Overview

Effect Atom uses a **dependency-tracking node graph** architecture for caching values. This is fundamentally different from traditional key-value caches - it's a reactive computation graph where nodes automatically recompute when their dependencies change.

## Storage Mechanism

### Primary Storage: Registry + Node Map

```typescript
// internal/registry.ts
class RegistryImpl implements Registry.Registry {
  readonly nodes = new Map<Atom.Atom<any> | string, Node<any>>()
  readonly preloadedSerializable = new Map<string, unknown>()
  readonly timeoutBuckets = new Map<number, readonly [nodes: Set<Node<any>>, handle: number]>()
  readonly nodeTimeoutBucket = new Map<Node<any>, number>()
}
```

**Key insight**: Atoms are stored in a Map keyed by either:
1. **The atom instance itself** (reference equality)
2. **A string key** for serializable atoms

### Node Structure

Each cached value is wrapped in a `Node`:

```typescript
class Node<A> {
  state: NodeState = NodeState.uninitialized
  lifetime: Lifetime<A> | undefined
  writeContext: WriteContextImpl<A>
  
  // Dependency graph
  parents: Array<Node<any>> = []
  previousParents: Array<Node<any>> | undefined
  children: Array<Node<any>> = []
  
  // Subscriptions
  listeners: Set<() => void> = new Set()
  
  // Cached value
  _value: A = undefined as any
}

const enum NodeState {
  uninitialized = 5,  // alive | waitingForValue
  stale = 7,          // alive | initialized | waitingForValue
  valid = 3,          // alive | initialized
  removed = 0
}
```

## Cache Patterns

### 1. Lazy Evaluation with Memoization

Values are computed lazily and cached until invalidated:

```typescript
value(): A {
  if ((this.state & NodeFlags.waitingForValue) !== 0) {
    this.lifetime = makeLifetime(this)
    const value = this.atom.read(this.lifetime)  // Execute atom's read function
    if ((this.state & NodeFlags.waitingForValue) !== 0) {
      this.setValue(value)
    }
    // ... cleanup previous parents
  }
  return this._value
}
```

### 2. Dependency Tracking (Push-Pull)

When an atom reads another atom, a parent-child relationship is established:

```typescript
// In Lifetime.get():
get<A>(this: Lifetime<any>, atom: Atom.Atom<A>): A {
  const parent = this.node.registry.ensureNode(atom)
  this.node.addParent(parent)  // Track dependency
  return parent.value()
}
```

This enables automatic invalidation propagation.

### 3. Invalidation Cascade

When a node is invalidated, its children are notified:

```typescript
invalidate(): void {
  if (this.state === NodeState.valid) {
    this.state = NodeState.stale
    this.disposeLifetime()
  }

  if (batchState.phase === BatchPhase.collect) {
    batchState.stale.push(this)
  } else if (this.atom.lazy && this.listeners.size === 0 && !childrenAreActive(this.children)) {
    this.invalidateChildren()
    this.skipInvalidation = true  // Lazy: don't recompute until needed
  } else {
    this.value()  // Eager: recompute immediately
  }
}

invalidateChildren(): void {
  const children = this.children
  this.children = []
  for (let i = 0; i < children.length; i++) {
    children[i].invalidate()
  }
}
```

### 4. Batched Updates

Multiple mutations are batched to avoid redundant recomputations:

```typescript
const batchState = globalValue("@effect-atom/atom/Registry/batchState", () => ({
  phase: BatchPhase.disabled,
  depth: 0,
  stale: [] as Array<Node<any>>,
  notify: new Set<Node<any>>()
}))

function batch(f: () => void): void {
  batchState.phase = BatchPhase.collect
  batchState.depth++
  try {
    f()
    if (batchState.depth === 1) {
      // Rebuild stale nodes
      for (let i = 0; i < batchState.stale.length; i++) {
        batchRebuildNode(batchState.stale[i])
      }
      // Then notify listeners
      batchState.phase = BatchPhase.commit
      for (const node of batchState.notify) {
        node.notify()
      }
    }
  } finally {
    batchState.depth--
  }
}
```

### 5. TTL-Based Eviction

Nodes can have idle TTL for automatic cleanup:

```typescript
setNodeTimeout(node: Node<any>): void {
  let idleTTL = node.atom.idleTTL ?? this.defaultIdleTTL!
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

### 6. Result Wrapper for Async Values

Async values are wrapped in `Result<A, E>`:

```typescript
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>

interface Success<A, E = never> {
  readonly _tag: "Success"
  readonly value: A
  readonly timestamp: number  // For cache freshness
  readonly waiting: boolean   // Indicates background refresh
}

interface Failure<A, E = never> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly previousSuccess: Option.Option<Success<A, E>>  // Stale-while-revalidate
}
```

**Key features**:
- `timestamp`: Tracks when the value was cached
- `waiting`: Indicates background refresh in progress
- `previousSuccess`: Enables stale-while-revalidate pattern

## Family Pattern (Parameterized Atoms)

For query caching with parameters, Effect Atom uses the `family` pattern:

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
    registry.register(newAtom, arg)
    return newAtom
  }
}
```

Uses `MutableHashMap` for structural equality and `WeakRef` + `FinalizationRegistry` for automatic cleanup.

## Serialization/Hydration (SSR Support)

```typescript
// Hydration.ts
interface DehydratedAtomValue {
  readonly key: string
  readonly value: unknown
  readonly dehydratedAt: number
  readonly resultPromise?: Promise<unknown>  // For streaming
}

export const dehydrate = (registry: Registry.Registry): Array<DehydratedAtom> => {
  const arr = Arr.empty<DehydratedAtomValue>()
  registry.getNodes().forEach((node, key) => {
    if (!Atom.isSerializable(node.atom)) return
    const atom = node.atom
    const encodedValue = atom[Atom.SerializableTypeId].encode(node.value())
    arr.push({ key, value: encodedValue, dehydratedAt: now })
  })
  return arr
}

export const hydrate = (registry: Registry.Registry, state: Iterable<DehydratedAtom>): void => {
  for (const datom of state) {
    registry.setSerializable(datom.key, datom.value)
  }
}
```

## Comparison with Traditional Query Caches

| Aspect | Effect Atom | TanStack Query | SWR |
|--------|------------|----------------|-----|
| **Storage** | Dependency graph | Key-value map | Key-value map |
| **Keys** | Atom identity or string | String/array | String |
| **Invalidation** | Automatic via dependencies | Manual or query key | Manual |
| **Batching** | Built-in | Manual via `queryClient` | None |
| **TTL** | Per-atom `idleTTL` | `staleTime`/`cacheTime` | None |
| **Stale-While-Revalidate** | `waiting` + `previousSuccess` | `isPreviousData` | Built-in |
| **Type Safety** | Full Effect types | Generic | Generic |

## Key Architectural Decisions

1. **Identity-Based Caching**: Atoms are cached by reference, not by key. This eliminates key collision issues but requires careful atom instantiation.

2. **Reactive Graph Model**: Dependencies are tracked automatically, eliminating manual invalidation patterns.

3. **Result as Cache Value**: The `Result<A, E>` wrapper encapsulates all async states, making cache state explicit.

4. **Lifetime Management**: Resources (subscriptions, effects) are tied to node lifetime and automatically cleaned up.

5. **Layer-Based Context**: Runtime services (via `AtomRuntime`) use Effect's Layer system for dependency injection.

## Implications for effect-trpc

1. **Query caching** could use the family pattern for parameterized queries
2. **Automatic invalidation** via Reactivity integration
3. **SSR hydration** is first-class with the Hydration module
4. **Stale-while-revalidate** is built into the Result type
5. **Batching** enables efficient mutation handling
