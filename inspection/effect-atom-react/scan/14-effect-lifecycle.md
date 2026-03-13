# H14: Effect Lifecycle in React - Effect Atom React Analysis

## Summary

Effect Atom React provides a sophisticated system for running Effects within React's lifecycle. Unlike naive `runPromise` approaches, it uses a custom runtime execution model with proper lifecycle management, synchronous optimization paths, and automatic cleanup integration.

## Key Finding: No Direct `runPromise` Usage

Effect Atom React does **not** use `Effect.runPromise` in React lifecycle code. Instead, it implements a custom `runCallbackSync` pattern that:

1. Optimizes for synchronous completion
2. Provides proper cancellation
3. Integrates with React's `useSyncExternalStore`

---

## Effect Execution Patterns

### 1. Custom Runtime Callback (`internal/runtime.ts:35-63`)

The core execution primitive is `runCallbackSync`:

```typescript
export const runCallbackSync = <R, ER = never>(runtime: Runtime.Runtime<R>) => {
  const runFork = Runtime.runFork(runtime)
  return <A, E>(
    effect: Effect.Effect<A, E, R>,
    onExit: (exit: Exit.Exit<A, E | ER>) => void,
    uninterruptible = false
  ): (() => void) | undefined => {
    // Fast path for immediate values
    const op = fastPath(effect)
    if (op) {
      onExit(op)
      return undefined  // No cleanup needed
    }
    
    // Sync scheduler for immediate execution attempt
    const scheduler = new SyncScheduler()
    const fiberRuntime = runFork(effect, { scheduler })
    scheduler.flush()
    
    // Check if completed synchronously
    const result = fiberRuntime.unsafePoll()
    if (result) {
      onExit(result)
      return undefined  // No cleanup needed
    }
    
    // Async: register observer and return cancel function
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

**Key characteristics:**
- Uses `SyncScheduler` for synchronous execution attempt
- Returns `undefined` (no cancel) if effect completes synchronously
- Returns cancel function for async effects
- Supports uninterruptible mode for critical operations

### 2. Fast Path Optimization (`internal/runtime.ts:11-32`)

Direct handling of already-resolved values:

```typescript
const fastPath = <R, E, A>(effect: Effect.Effect<A, E, R>): Exit.Exit<A, E> | undefined => {
  const op = effect as any
  switch (op._tag) {
    case "Failure":
    case "Success":
      return op
    case "Left":
      return Exit.fail(op.left)
    case "Right":
      return Exit.succeed(op.right)
    case "Some":
      return Exit.succeed(op.value)
    case "None":
      return Exit.fail(new NoSuchElementException())
  }
}
```

---

## Cleanup Patterns

### 1. Lifetime-Based Cleanup (`internal/registry.ts:495-719`)

Each atom computation gets a `Lifetime` object that manages:

```typescript
interface Lifetime<A> extends Atom.Context {
  isFn: boolean
  readonly node: Node<A>
  finalizers: Array<() => void> | undefined
  disposed: boolean
  readonly dispose: () => void
}
```

The `addFinalizer` method registers cleanup callbacks:

```typescript
addFinalizer(this: Lifetime<any>, f: () => void): void {
  if (this.disposed) {
    throw disposedError(this.node.atom)
  }
  this.finalizers ??= []
  this.finalizers.push(f)
}
```

Cleanup is invoked in reverse order on disposal:

```typescript
dispose(this: Lifetime<any>): void {
  this.disposed = true
  if (this.finalizers === undefined) {
    return
  }
  const finalizers = this.finalizers
  this.finalizers = undefined
  // Reverse order - LIFO
  for (let i = finalizers.length - 1; i >= 0; i--) {
    finalizers[i]()
  }
}
```

### 2. Effect Cleanup Integration (`Atom.ts:482-525`)

When an effect is executed, cleanup is automatically registered:

```typescript
function makeEffect<A, E>(
  ctx: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  initialValue: Result.Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result.Result<A, E> {
  // Create a scoped runtime
  const scope = Effect.runSync(Scope.make())
  
  // Register scope cleanup as finalizer
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))
  })
  
  // Execute effect
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
  
  // Register fiber cancellation as finalizer
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }
  // ...
}
```

### 3. Registry Provider Cleanup (`RegistryContext.ts:52-62`)

React-level cleanup with graceful timeout:

```typescript
React.useEffect(() => {
  if (ref.current?.timeout !== undefined) {
    clearTimeout(ref.current.timeout)
  }
  return () => {
    // Delayed disposal allows for fast remounts
    ref.current!.timeout = setTimeout(() => {
      ref.current?.registry.dispose()
      ref.current = null
    }, 500)
  }
}, [ref])
```

### 4. Registry Disposal (`internal/registry.ts:247-259`)

Complete cleanup of all resources:

```typescript
reset(): void {
  // Clear all timeout buckets
  this.timeoutBuckets.forEach(([, handle]) => clearTimeout(handle))
  this.timeoutBuckets.clear()
  this.nodeTimeoutBucket.clear()

  // Dispose all nodes
  this.nodes.forEach((node) => node.remove())
  this.nodes.clear()
}

dispose(): void {
  this.disposed = true
  this.reset()
}
```

---

## React Integration Patterns

### 1. useSyncExternalStore Integration (`Hooks.ts:53-57`)

The primary React hook uses `useSyncExternalStore`:

```typescript
function useStore<A>(registry: Registry.Registry, atom: Atom.Atom<A>): A {
  const store = makeStore(registry, atom)
  return React.useSyncExternalStore(
    store.subscribe, 
    store.snapshot, 
    store.getServerSnapshot
  )
}
```

This ensures proper React 18 concurrent mode compatibility.

### 2. Mount Effect Pattern (`Hooks.ts:99-101`)

Atoms are mounted via `useEffect`:

```typescript
function mountAtom<A>(registry: Registry.Registry, atom: Atom.Atom<A>): void {
  React.useEffect(() => registry.mount(atom), [atom, registry])
}
```

The `mount` returns an unsubscribe function that React calls on cleanup.

### 3. Suspense Pattern (`Hooks.ts:241-251`)

For async atoms, suspense is implemented by throwing a Promise:

```typescript
function atomResultOrSuspend<A, E>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)
  }
  return value
}
```

The Promise is cached to prevent duplicate suspensions:

```typescript
const atomPromiseMap = globalValue(
  "@effect-atom/atom-react/atomPromiseMap",
  () => ({
    suspendOnWaiting: new Map<Atom.Atom<any>, Promise<void>>(),
    default: new Map<Atom.Atom<any>, Promise<void>>()
  })
)
```

---

## Scoped Effect Execution

### 1. Effect.Scope Integration (`Atom.ts:490-502`)

Each atom effect gets its own scope:

```typescript
const scope = Effect.runSync(Scope.make())
ctx.addFinalizer(() => {
  Effect.runFork(Scope.close(scope, Exit.void))
})

const contextMap = new Map(runtime.context.unsafeMap)
contextMap.set(Scope.Scope.key, scope)
contextMap.set(AtomRegistry.key, ctx.registry)

const scopedRuntime = Runtime.make({
  context: EffectContext.unsafeMake(contextMap),
  fiberRefs: runtime.fiberRefs,
  runtimeFlags: runtime.runtimeFlags
})
```

### 2. AtomRuntime for Service Layers (`Atom.ts:652-706`)

Service layers get their own scoped runtime:

```typescript
export const context: (options: {
  readonly memoMap: Layer.MemoMap
}) => RuntimeFactory = (options) => {
  function factory<E, R>(
    create: Layer.Layer<R, E, AtomRegistry | Reactivity.Reactivity>
  ): AtomRuntime<R, E> {
    // Build layer with memoization
    self.read = function read(get: Context) {
      const layer = get(layerAtom)
      const build = Effect.flatMap(
        Effect.flatMap(Effect.scope, (scope) => 
          Layer.buildWithMemoMap(layer, options.memoMap, scope)
        ),
        (context) => Effect.provide(Effect.runtime<R>(), context)
      )
      // Uninterruptible to prevent partial initialization
      return effect(get, build, { uninterruptible: true })
    }
  }
}
```

---

## Stream Execution Pattern (`Atom.ts:753-818`)

Streams are handled with a channel-based approach:

```typescript
function makeStream<A, E>(
  ctx: Context,
  stream: Stream.Stream<A, E, AtomRegistry>,
  initialValue: Result.Result<A, E | NoSuchElementException>,
  runtime = Runtime.defaultRuntime
): Result.Result<A, E | NoSuchElementException> {
  const writer: Channel.Channel<never, Chunk.Chunk<A>, never, E> = Channel.readWithCause({
    onInput(input: Chunk.Chunk<A>) {
      return Channel.suspend(() => {
        const last = Chunk.last(input)
        if (last._tag === "Some") {
          ctx.setSelf(Result.success(last.value, { waiting: true }))
        }
        return writer
      })
    },
    onFailure(cause: Cause.Cause<E>) {
      return Channel.sync(() => {
        ctx.setSelf(Result.failureWithPrevious(cause, {
          previous: ctx.self<Result.Result<A, E | NoSuchElementException>>()
        }))
      })
    },
    onDone(_done: unknown) {
      // Handle stream completion
    }
  })

  const cancel = runCallbackSync(registryRuntime)(
    Channel.runDrain(Channel.pipeTo(Stream.toChannel(stream), writer)),
    constVoid,
    false
  )
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }
}
```

---

## React Scheduler Integration (`RegistryContext.ts:14-16`)

Uses React's scheduler for task scheduling:

```typescript
import * as Scheduler from "scheduler"

export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

This ensures atom updates are coordinated with React's rendering priority.

---

## Batching System (`internal/registry.ts:760-820`)

Effect executions are batched for performance:

```typescript
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
      // Notify listeners
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

---

## TTL-Based Garbage Collection (`internal/registry.ts:188-245`)

Idle atoms are cleaned up with configurable TTL:

```typescript
setNodeTimeout(node: Node<any>): void {
  let idleTTL = node.atom.idleTTL ?? this.defaultIdleTTL!
  const ttl = Math.ceil(idleTTL! / this.timeoutResolution) * this.timeoutResolution
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
  this.nodeTimeoutBucket.set(node, bucket)
}
```

---

## Key Patterns for effect-trpc

### 1. Avoid `runPromise` in Hooks
Use callback-based execution with proper cleanup registration.

### 2. Synchronous Fast Path
Optimize for effects that complete synchronously using `SyncScheduler`.

### 3. Scoped Effect Context
Provide proper Effect context (Scope, services) to effects.

### 4. Automatic Cleanup
Register cleanup functions via `addFinalizer` pattern.

### 5. React Scheduler Coordination
Use React's scheduler for updates to ensure proper priority.

### 6. useSyncExternalStore
For React 18 compatibility and concurrent mode support.

### 7. Suspense Integration
Throw cached promises for suspense boundaries.

### 8. Batching
Batch multiple atom updates for performance.

---

## Architecture Comparison

| Pattern | Naive Approach | Effect Atom React |
|---------|----------------|-------------------|
| Execution | `runPromise` in useEffect | `runCallbackSync` with cancellation |
| Cleanup | Manual fiber tracking | Automatic via `addFinalizer` |
| Sync optimization | None | Fast path + SyncScheduler |
| React integration | useState + useEffect | useSyncExternalStore |
| Scope management | Manual | Automatic per-atom scopes |
| Error handling | Try/catch | Result type with Cause |
| Suspense | Custom | Built-in with Promise caching |

---

## Files Analyzed

- `packages/atom-react/src/Hooks.ts` - React hooks
- `packages/atom-react/src/RegistryContext.ts` - Registry provider
- `packages/atom-react/src/ScopedAtom.ts` - Scoped atom pattern
- `packages/atom/src/Atom.ts` - Core atom implementation
- `packages/atom/src/Registry.ts` - Registry public API
- `packages/atom/src/internal/registry.ts` - Registry implementation
- `packages/atom/src/internal/runtime.ts` - Effect execution primitives
