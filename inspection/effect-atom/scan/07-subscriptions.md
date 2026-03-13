# H7: Subscription Management in Effect Atom

## Executive Summary

Effect Atom provides a sophisticated subscription management system built on a **dependency graph with automatic cleanup**. Unlike manual `useState` management, it uses a centralized `Registry` that tracks observer relationships, automatically disposes subscriptions when atoms are no longer needed, and provides batching for efficient updates.

## Core Architecture

### 1. The Registry Pattern

```typescript
// Registry.ts - Central subscription coordinator
interface Registry {
  readonly subscribe: <A>(
    atom: Atom<A>, 
    f: (_: A) => void, 
    options?: { readonly immediate?: boolean }
  ) => () => void  // Returns cleanup function
  readonly mount: <A>(atom: Atom<A>) => () => void
  readonly dispose: () => void
}
```

The Registry acts as the single source of truth for:
- All atom instances (stored as `Node<A>`)
- Observer relationships (parent-child dependencies)
- Subscription cleanup

### 2. Node-Based Dependency Graph

Each atom is backed by a `Node<A>` that tracks:

```typescript
// internal/registry.ts:275-291
class Node<A> {
  parents: Array<Node<any>> = []      // Atoms this depends on
  previousParents: Array<Node<any>> | undefined
  children: Array<Node<any>> = []     // Atoms that depend on this
  listeners: Set<() => void> = new Set()  // External subscribers
  lifetime: Lifetime<A> | undefined   // Scoped resource management
  
  get canBeRemoved(): boolean {
    return !this.atom.keepAlive && 
           this.listeners.size === 0 && 
           this.children.length === 0
  }
}
```

### 3. Subscription Flow

```
Component subscribes to Atom
       |
       v
Registry.subscribe(atom, callback)
       |
       v
Node.ensureNode(atom) - creates or retrieves node
       |
       v
Node.value() - evaluates atom.read(ctx)
       |
       v
ctx.get(dependency) - adds parent relationship
       |
       v
Returns cleanup function
```

## Subscription Lifecycle

### Phase 1: Subscribe

```typescript
// internal/registry.ts:105-119
subscribe<A>(atom: Atom<A>, f: (_: A) => void, options?): () => void {
  const node = this.ensureNode(atom)
  if (options?.immediate) {
    f(node.value())  // Immediately invoke with current value
  }
  const remove = node.subscribe(function() {
    f(node._value)
  })
  return () => {
    remove()
    if (node.canBeRemoved) {
      this.scheduleNodeRemoval(node)  // Automatic cleanup!
    }
  }
}
```

### Phase 2: Notify on Change

```typescript
// internal/registry.ts:420-426
notify(): void {
  this.listeners.forEach(notifyListener)
  
  if (batchState.phase === BatchPhase.commit) {
    batchState.notify.delete(this)
  }
}
```

### Phase 3: Cleanup

```typescript
// internal/registry.ts:440-462
remove() {
  this.state = NodeState.removed
  this.listeners.clear()  // Remove all subscriptions
  
  if (this.lifetime !== undefined) {
    this.disposeLifetime()  // Call all registered finalizers
  }
  
  // Cascade cleanup to parents
  if (this.previousParents !== undefined) {
    for (const parent of this.previousParents) {
      parent.removeChild(this)
      if (parent.canBeRemoved) {
        this.registry.removeNode(parent)
      }
    }
  }
}
```

## Lifetime-Based Cleanup

Effect Atom uses a `Lifetime` context that provides:

```typescript
// internal/registry.ts:495-501
interface Lifetime<A> extends Atom.Context {
  readonly node: Node<A>
  finalizers: Array<() => void> | undefined
  disposed: boolean
  readonly dispose: () => void
}
```

### Adding Finalizers

```typescript
// Atom.ts - Context interface
interface Context {
  addFinalizer(this: Context, f: () => void): void
  subscribe<A>(this: Context, atom: Atom<A>, f: (_: A) => void): void
  mount<A>(this: Context, atom: Atom<A>): void
}
```

### Example Usage

```typescript
// Atom.ts:1746-1758 - Window focus subscription
export const windowFocusSignal: Atom<number> = readable((get) => {
  let count = 0
  function update() {
    if (document.visibilityState === "visible") {
      get.setSelf(++count)
    }
  }
  window.addEventListener("visibilitychange", update)
  get.addFinalizer(() => {
    window.removeEventListener("visibilitychange", update)  // Automatic cleanup!
  })
  return count
})
```

## React Integration: useSyncExternalStore

Effect Atom leverages React 18's `useSyncExternalStore` for subscriptions:

```typescript
// Hooks.ts:28-56
interface AtomStore<A> {
  readonly subscribe: (f: () => void) => () => void
  readonly snapshot: () => A
  readonly getServerSnapshot: () => A
}

function makeStore<A>(registry: Registry, atom: Atom<A>): AtomStore<A> {
  return {
    subscribe(f) {
      return registry.subscribe(atom, f)  // Returns cleanup automatically
    },
    snapshot() {
      return registry.get(atom)
    },
    getServerSnapshot() {
      return Atom.getServerValue(atom, registry)
    }
  }
}

function useStore<A>(registry: Registry, atom: Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(
    store.subscribe, 
    store.snapshot, 
    store.getServerSnapshot
  )
}
```

### Benefits over useState

| Manual useState | Effect Atom |
|-----------------|-------------|
| Manual useEffect for subscription | Automatic via useSyncExternalStore |
| Manual cleanup in useEffect return | Automatic via Registry |
| Re-renders on every state change | Batched notifications |
| No SSR support | getServerSnapshot support |
| No concurrent mode safety | useSyncExternalStore is concurrent-safe |

## Automatic Disposal Strategies

### Strategy 1: Listener Count Tracking

```typescript
// internal/registry.ts:294-296
get canBeRemoved(): boolean {
  return !this.atom.keepAlive && 
         this.listeners.size === 0 && 
         this.children.length === 0
}
```

### Strategy 2: Idle TTL (Time To Live)

```typescript
// Atom.ts:157-171
export const setIdleTTL: {
  (duration: DurationInput): <A extends Atom<any>>(self: A) => A
} = dual(2, (self, durationInput) => {
  const duration = Duration.decode(durationInput)
  return {
    ...self,
    keepAlive: !Duration.isFinite(duration),
    idleTTL: Duration.isFinite(duration) ? Duration.toMillis(duration) : undefined
  }
})
```

### Strategy 3: Keep Alive

```typescript
// Atom.ts:1413-1417
export const keepAlive = <A extends Atom<any>>(self: A): A =>
  Object.assign(Object.create(Object.getPrototypeOf(self)), {
    ...self,
    keepAlive: true  // Never auto-dispose
  })
```

## Batching for Performance

Effect Atom batches updates to prevent cascading re-renders:

```typescript
// internal/registry.ts:780-802
export function batch(f: () => void): void {
  batchState.phase = BatchPhase.collect
  batchState.depth++
  try {
    f()
    if (batchState.depth === 1) {
      // Rebuild stale nodes
      for (const node of batchState.stale) {
        batchRebuildNode(node)
      }
      // Then notify all listeners once
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

## Effect Integration

### Stream Subscriptions

```typescript
// internal/registry.ts:666-691
stream<A>(this: Lifetime<any>, atom: Atom<A>, options?) {
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
        (cancel) => Effect.sync(cancel)  // Cleanup in Effect's scope
      )
    ),
    Effect.map((queue) => Stream.fromQueue(queue)),
    Stream.unwrapScoped
  )
}
```

### Effect-based Atom Execution

```typescript
// Atom.ts:482-525
function makeEffect<A, E>(
  ctx: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  initialValue: Result.Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result.Result<A, E> {
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))  // Scope-based cleanup
  })
  
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
    ctx.addFinalizer(cancel)  // Register fiber cancellation
  }
  
  // ...
}
```

## AtomRef: Observable Value Containers

For fine-grained subscriptions on object properties:

```typescript
// AtomRef.ts:87-99
class ReadonlyRefImpl<A> implements ReadonlyRef<A> {
  listeners: Array<(a: A) => void> = []
  listenerCount = 0

  subscribe(f: (a: A) => void): () => void {
    this.listeners.push(f)
    this.listenerCount++
    return () => {
      const index = this.listeners.indexOf(f)
      if (index !== -1) {
        this.listeners[index] = this.listeners[this.listenerCount - 1]
        this.listeners.pop()
        this.listenerCount--
      }
    }
  }
}
```

### Derived Subscriptions (MapRef)

```typescript
// AtomRef.ts:139-149
subscribe(f: (a: B) => void): () => void {
  let previous = this.transform(this.parent.value)
  return this.parent.subscribe((a) => {
    const next = this.transform(a)
    if (Equal.equals(next, previous)) {
      return  // Skip notification if value unchanged
    }
    previous = next
    f(next)
  })
}
```

## Comparison: Manual vs Effect Atom

### Manual Approach (Current tRPC-Effect)

```typescript
function useTRPCQuery<T>(key: string) {
  const [state, setState] = useState<QueryState<T>>({ status: 'idle' })
  
  useEffect(() => {
    const subscription = client.subscribe(key, {
      onData: (data) => setState({ status: 'success', data }),
      onError: (error) => setState({ status: 'error', error })
    })
    
    return () => subscription.unsubscribe()  // Manual cleanup
  }, [key])
  
  return state
}
```

### Effect Atom Approach

```typescript
// Define once
const queryAtom = runtime.atom((get) => 
  client.query(key).pipe(
    Effect.map(data => Result.success(data)),
    Effect.catchAll(e => Effect.succeed(Result.failure(e)))
  )
)

// Use anywhere - cleanup is automatic
function useQuery() {
  return useAtomValue(queryAtom)
}
```

## Key Takeaways

1. **Automatic Cleanup**: Registry tracks all subscriptions and cleans up when atoms have no more listeners or children

2. **Dependency Tracking**: Parent-child relationships are automatically maintained, enabling cascading invalidation and cleanup

3. **React 18 Integration**: `useSyncExternalStore` provides concurrent-mode-safe subscriptions with SSR support

4. **Batching**: Multiple updates are batched to minimize re-renders

5. **Scope Integration**: Effect's `Scope` mechanism is used for cleanup of async operations

6. **Configurable Lifecycle**: `keepAlive`, `idleTTL`, and `autoDispose` give fine-grained control

7. **No Manual useEffect**: Subscription management is declarative via atom definitions, not imperative via hooks
