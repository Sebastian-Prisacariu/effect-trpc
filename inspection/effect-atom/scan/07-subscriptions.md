# H7: Effect-Atom Subscription Management

## Overview

Effect-atom implements a sophisticated subscription management system built around a **reactive dependency graph** with automatic lifecycle management. The system centers on the `Registry` and its internal `Node` class, providing fine-grained control over subscription lifecycles, cleanup, and memory management.

## Core Architecture

### 1. Registry - The Subscription Coordinator

The `Registry` serves as the central coordinator for all atom subscriptions:

```typescript
interface Registry {
  readonly subscribe: <A>(
    atom: Atom<A>,
    f: (_: A) => void,
    options?: { readonly immediate?: boolean }
  ) => () => void  // Returns unsubscribe function
  
  readonly mount: <A>(atom: Atom<A>) => () => void
  readonly dispose: () => void
  readonly reset: () => void
}
```

**Key Design Decisions:**
- Subscriptions return cleanup functions (unsubscribe callbacks)
- `mount()` is implemented as `subscribe(atom, constVoid, { immediate: true })`
- The registry tracks all nodes in a `Map<Atom | string, Node>`

### 2. Node - The Subscription Unit

Each atom gets a corresponding `Node` in the registry that manages its subscriptions:

```typescript
class Node<A> {
  // Subscription listeners
  listeners: Set<() => void> = new Set()
  
  // Dependency tracking (for automatic cleanup)
  parents: Array<Node<any>> = []
  previousParents: Array<Node<any>> | undefined
  children: Array<Node<any>> = []
  
  // Lifecycle state
  state: NodeState
  lifetime: Lifetime<A> | undefined
  
  // Removal eligibility
  get canBeRemoved(): boolean {
    return !this.atom.keepAlive && 
           this.listeners.size === 0 && 
           this.children.length === 0 &&
           this.state !== 0
  }
}
```

### 3. Subscription Flow

```
subscribe(atom, callback)
    |
    v
ensureNode(atom)  --> Creates Node if needed, removes from timeout bucket if present
    |
    v
node.value()  --> Recomputes if stale (creates Lifetime)
    |
    v
node.subscribe(listener)  --> Add to listeners Set
    |
    v
Returns cleanup function that:
  1. Removes listener from Set
  2. Schedules node removal if canBeRemoved
```

## Subscription Patterns

### Pattern 1: Direct Subscription via Registry

```typescript
// Source: internal/registry.ts:105-119
subscribe<A>(atom: Atom<A>, f: (_: A) => void, options?: { readonly immediate?: boolean }): () => void {
  const node = this.ensureNode(atom)
  if (options?.immediate) {
    f(node.value())  // Immediate notification with current value
  }
  const remove = node.subscribe(function() {
    f(node._value)  // Subsequent notifications
  })
  return () => {
    remove()
    if (node.canBeRemoved) {
      this.scheduleNodeRemoval(node)
    }
  }
}
```

### Pattern 2: Context-Based Subscription (within Atom reads)

```typescript
// Source: internal/registry.ts:643-649
subscribe<A>(this: Lifetime<any>, atom: Atom<A>, f: (_: A) => void, options?: {
  readonly immediate?: boolean
}): void {
  if (this.disposed) {
    throw disposedError(this.node.atom)
  }
  // Automatically adds cleanup to lifetime finalizers
  this.addFinalizer(this.node.registry.subscribe(atom, f, options))
}
```

### Pattern 3: Stream-Based Subscription

```typescript
// Source: internal/registry.ts:666-691
stream<A>(this: Lifetime<any>, atom: Atom<A>, options?: {
  readonly withoutInitialValue?: boolean
  readonly bufferSize?: number
}) {
  return pipe(
    Effect.acquireRelease(
      Queue.bounded<A>(options?.bufferSize ?? 16),
      Queue.shutdown
    ),
    Effect.tap((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          return this.node.registry.subscribe(atom, (_) => {
            Queue.unsafeOffer(queue, _)
          }, { immediate: options?.withoutInitialValue !== true })
        }),
        (cancel) => Effect.sync(cancel)
      )
    ),
    Effect.map((queue) => Stream.fromQueue(queue)),
    Stream.unwrapScoped
  )
}
```

## Cleanup Mechanisms

### 1. Lifetime-Based Cleanup

The `Lifetime` object tracks finalizers for each atom's read cycle:

```typescript
interface Lifetime<A> extends Atom.Context {
  finalizers: Array<() => void> | undefined
  disposed: boolean
  readonly dispose: () => void
}

// Cleanup execution (LIFO order)
dispose(this: Lifetime<any>): void {
  this.disposed = true
  if (this.finalizers === undefined) return
  
  const finalizers = this.finalizers
  this.finalizers = undefined
  // Reverse order cleanup (LIFO)
  for (let i = finalizers.length - 1; i >= 0; i--) {
    finalizers[i]()
  }
}
```

### 2. Parent-Child Dependency Cleanup

When a node is invalidated, its lifetime is disposed and parent relationships are tracked for cleanup:

```typescript
disposeLifetime(): void {
  if (this.lifetime !== undefined) {
    this.lifetime.dispose()
    this.lifetime = undefined
  }

  if (this.parents.length !== 0) {
    this.previousParents = this.parents  // Track for later cleanup
    this.parents = []
  }
}
```

After recomputation, stale parents are cleaned up:

```typescript
// Source: internal/registry.ts:306-316
if (this.previousParents) {
  const parents = this.previousParents
  this.previousParents = undefined
  for (let i = 0; i < parents.length; i++) {
    parents[i].removeChild(this)
    if (parents[i].canBeRemoved) {
      this.registry.scheduleNodeRemoval(parents[i])
    }
  }
}
```

### 3. Node Removal with Cascade

```typescript
remove() {
  this.state = NodeState.removed
  this.listeners.clear()

  if (this.lifetime === undefined) return

  this.disposeLifetime()

  // Cascade cleanup to parents
  if (this.previousParents === undefined) return
  const parents = this.previousParents
  this.previousParents = undefined
  for (let i = 0; i < parents.length; i++) {
    parents[i].removeChild(this)
    if (parents[i].canBeRemoved) {
      this.registry.removeNode(parents[i])  // Recursive removal
    }
  }
}
```

### 4. Idle TTL-Based Cleanup

Atoms with `idleTTL` are placed in timeout buckets for deferred cleanup:

```typescript
// Source: internal/registry.ts:188-215
setNodeTimeout(node: Node<any>): void {
  if (this.nodeTimeoutBucket.has(node)) return

  let idleTTL = node.atom.idleTTL ?? this.defaultIdleTTL!
  // ... TTL calculation
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
  this.nodeTimeoutBucket.set(node, bucket)
}
```

### 5. Registry-Level Cleanup

```typescript
reset(): void {
  // Clear all timeout buckets
  this.timeoutBuckets.forEach(([, handle]) => clearTimeout(handle))
  this.timeoutBuckets.clear()
  this.nodeTimeoutBucket.clear()

  // Remove all nodes
  this.nodes.forEach((node) => node.remove())
  this.nodes.clear()
}

dispose(): void {
  this.disposed = true
  this.reset()
}
```

## Effect Integration for Cleanup

### runCallbackSync - Cancellable Effect Execution

```typescript
// Source: internal/runtime.ts:35-63
export const runCallbackSync = <R, ER = never>(runtime: Runtime.Runtime<R>) => {
  const runFork = Runtime.runFork(runtime)
  return <A, E>(
    effect: Effect.Effect<A, E, R>,
    onExit: (exit: Exit.Exit<A, E | ER>) => void,
    uninterruptible = false
  ): (() => void) | undefined => {
    // Fast path for sync values
    const op = fastPath(effect)
    if (op) {
      onExit(op)
      return undefined  // No cleanup needed
    }
    
    // Async path with fiber
    const scheduler = new SyncScheduler()
    const fiberRuntime = runFork(effect, { scheduler })
    scheduler.flush()
    
    const result = fiberRuntime.unsafePoll()
    if (result) {
      onExit(result)
      return undefined  // Completed synchronously
    }
    
    // Running async - return cancel function
    fiberRuntime.addObserver(onExit)
    function cancel() {
      fiberRuntime.removeObserver(onExit)
      if (!uninterruptible) {
        fiberRuntime.unsafeInterruptAsFork(FiberId.none)
      }
    }
    return cancel
  }
}
```

### Effect-Based Atom Cleanup

```typescript
// Source: Atom.ts:482-525
function makeEffect<A, E>(
  ctx: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  initialValue: Result.Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result.Result<A, E> {
  const previous = ctx.self<Result.Result<A, E>>()

  // Create a scope for this effect
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))
  })
  
  // ... runtime setup
  
  const cancel = runCallbackSync(scopedRuntime)(
    effect,
    function(exit) {
      syncResult = Result.fromExitWithPrevious(exit, previous)
      if (isAsync) {
        ctx.setSelf(syncResult)
      }
    },
    uninterruptible
  )
  
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)  // Add cancel to lifetime finalizers
  }
  
  // ... return result
}
```

## AtomRef Subscription Pattern

The `AtomRef` module provides a simpler, synchronous subscription model:

```typescript
// Source: AtomRef.ts:87-99
subscribe(f: (a: A) => void): () => void {
  this.listeners.push(f)
  this.listenerCount++

  return () => {
    const index = this.listeners.indexOf(f)
    if (index !== -1) {
      // Swap-and-pop for efficient removal
      this.listeners[index] = this.listeners[this.listenerCount - 1]
      this.listeners.pop()
      this.listenerCount--
    }
  }
}
```

### MapRef - Filtered Subscriptions

```typescript
// Source: AtomRef.ts:139-149
subscribe(f: (a: B) => void): () => void {
  let previous = this.transform(this.parent.value)
  return this.parent.subscribe((a) => {
    const next = this.transform(a)
    if (Equal.equals(next, previous)) {
      return  // Skip if unchanged
    }
    previous = next
    f(next)
  })
}
```

## Batching and Notification

### Batch State Management

```typescript
// Source: internal/registry.ts:772-802
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
      // Rebuild all stale nodes
      for (let i = 0; i < batchState.stale.length; i++) {
        batchRebuildNode(batchState.stale[i])
      }
      // Commit phase - notify all
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

### Node Notification

```typescript
// Source: internal/registry.ts:420-426
notify(): void {
  this.listeners.forEach(notifyListener)

  if (batchState.phase === BatchPhase.commit) {
    batchState.notify.delete(this)
  }
}
```

## Key Patterns Summary

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Unsubscribe Return** | Registry.subscribe | Standard cleanup pattern |
| **Lifetime Finalizers** | Lifetime.addFinalizer | Automatic cleanup on recompute |
| **Parent-Child Tracking** | Node.parents/children | Dependency graph cleanup |
| **Idle TTL Buckets** | Registry.timeoutBuckets | Memory-efficient delayed cleanup |
| **Effect Cancellation** | runCallbackSync | Fiber interrupt on cleanup |
| **Scope Management** | makeEffect | Effect scope lifecycle |
| **Batch Deferred Notify** | batchState | Coalesced notifications |

## Design Insights for effect-trpc

1. **Cleanup Hierarchy**: Subscriptions should integrate with Effect's Scope for automatic cleanup
2. **Dependency Tracking**: Automatic parent-child relationships enable cascade cleanup
3. **Lazy Cleanup**: TTL-based cleanup prevents premature resource disposal
4. **Batching**: Deferred notifications during batch operations prevent glitches
5. **Fast Path**: Synchronous values skip fiber overhead
6. **LIFO Finalizers**: Reverse-order cleanup ensures proper resource ordering
