# H14: Effect Execution in React (Effect Atom)

## Summary

Effect Atom React executes Effects **without try/catch** by using Effect's structured concurrency model. Effects are run via `runCallbackSync` which uses `Runtime.runFork` with a `SyncScheduler`, processes results through callbacks with `Effect.Exit`, and handles cleanup through `Scope` finalizers.

## Effect Execution Architecture

### 1. Core Execution: `runCallbackSync`

**Location:** `packages/atom/src/internal/runtime.ts:35-63`

```typescript
export const runCallbackSync = <R, ER = never>(runtime: Runtime.Runtime<R>) => {
  const runFork = Runtime.runFork(runtime)
  return <A, E>(
    effect: Effect.Effect<A, E, R>,
    onExit: (exit: Exit.Exit<A, E | ER>) => void,
    uninterruptible = false
  ): (() => void) | undefined => {
    // Fast path for already-resolved effects
    const op = fastPath(effect)
    if (op) {
      onExit(op)
      return undefined
    }
    
    // Sync execution attempt
    const scheduler = new SyncScheduler()
    const fiberRuntime = runFork(effect, { scheduler })
    scheduler.flush()
    
    // Check if completed synchronously
    const result = fiberRuntime.unsafePoll()
    if (result) {
      onExit(result)
      return undefined
    }
    
    // Async case: register observer
    fiberRuntime.addObserver(onExit)
    
    // Return cancellation function
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

### 2. How Effects are Run in Atoms

**Location:** `packages/atom/src/Atom.ts:482-525`

```typescript
function makeEffect<A, E>(
  ctx: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  initialValue: Result.Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result.Result<A, E> {
  const previous = ctx.self<Result.Result<A, E>>()

  // Create scoped runtime
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))
  })
  
  // Build context with Scope and AtomRegistry
  const contextMap = new Map(runtime.context.unsafeMap)
  contextMap.set(Scope.Scope.key, scope)
  contextMap.set(AtomRegistry.key, ctx.registry)
  const scopedRuntime = Runtime.make({
    context: EffectContext.unsafeMake(contextMap),
    fiberRefs: runtime.fiberRefs,
    runtimeFlags: runtime.runtimeFlags
  })
  
  // Execute with callback
  let syncResult: Result.Result<A, E> | undefined
  let isAsync = false
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
  isAsync = true
  
  // Register cleanup
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }
  
  // Return synchronous or waiting result
  if (syncResult !== undefined) {
    return syncResult
  } else if (previous._tag === "Some") {
    return Result.waitingFrom(previous)
  }
  return Result.waiting(initialValue)
}
```

## Error Handling Without Try/Catch

### 1. Exit-Based Results

Effects never throw - they return `Exit<A, E>`:

```typescript
// Exit.Success or Exit.Failure
const result = fiberRuntime.unsafePoll()
if (result) {
  onExit(result)  // No try/catch needed
}
```

### 2. Result Data Type

**Location:** `packages/atom/src/Result.ts`

```typescript
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>

// Conversion from Exit to Result
const fromExitWithPrevious = <A, E>(
  exit: Exit.Exit<A, E>,
  previous: Option.Option<Result<A, E>>
): Success<A, E> | Failure<A, E> =>
  exit._tag === "Success" 
    ? success(exit.value) 
    : failureWithPrevious(exit.cause, { previous })
```

### 3. Fast Path Optimization

For already-resolved effects, no fiber is created:

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

## Cleanup Patterns

### 1. Scope-Based Cleanup

Every effect execution creates a `Scope`:

```typescript
const scope = Effect.runSync(Scope.make())
ctx.addFinalizer(() => {
  Effect.runFork(Scope.close(scope, Exit.void))
})
```

### 2. Lifetime Finalizers

**Location:** `packages/atom/src/internal/registry.ts:495-519`

```typescript
interface Lifetime<A> extends Atom.Context {
  finalizers: Array<() => void> | undefined
  disposed: boolean
  readonly dispose: () => void
}

// LifetimeProto.addFinalizer
addFinalizer(this: Lifetime<any>, f: () => void): void {
  if (this.disposed) {
    throw disposedError(this.node.atom)
  }
  this.finalizers ??= []
  this.finalizers.push(f)
}

// LifetimeProto.dispose
dispose(this: Lifetime<any>): void {
  this.disposed = true
  if (this.finalizers === undefined) {
    return
  }
  const finalizers = this.finalizers
  this.finalizers = undefined
  // LIFO order - last added, first executed
  for (let i = finalizers.length - 1; i >= 0; i--) {
    finalizers[i]()
  }
}
```

### 3. Fiber Interruption

For async effects, the cancel function interrupts the fiber:

```typescript
function cancel() {
  fiberRuntime.removeObserver(onExit)
  if (!uninterruptible) {
    fiberRuntime.unsafeInterruptAsFork(FiberId.none)
  }
}
```

### 4. Node Removal Cleanup

**Location:** `packages/atom/src/internal/registry.ts:428-438`

```typescript
disposeLifetime(): void {
  if (this.lifetime !== undefined) {
    this.lifetime.dispose()  // Runs all finalizers
    this.lifetime = undefined
  }
  
  if (this.parents.length !== 0) {
    this.previousParents = this.parents
    this.parents = []
  }
}
```

## React Integration

### 1. Registry Provider Cleanup

**Location:** `packages/atom-react/src/RegistryContext.ts:52-62`

```typescript
React.useEffect(() => {
  if (ref.current?.timeout !== undefined) {
    clearTimeout(ref.current.timeout)
  }
  return () => {
    // Delayed disposal for React StrictMode double-mount
    ref.current!.timeout = setTimeout(() => {
      ref.current?.registry.dispose()
      ref.current = null
    }, 500)
  }
}, [ref])
```

### 2. Atom Mount/Unmount

**Location:** `packages/atom-react/src/Hooks.ts:99-101`

```typescript
function mountAtom<A>(registry: Registry.Registry, atom: Atom.Atom<A>): void {
  React.useEffect(() => registry.mount(atom), [atom, registry])
}
```

### 3. Suspense for Async Results

**Location:** `packages/atom-react/src/Hooks.ts:241-270`

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

export const useAtomSuspense = <A, E>(atom, options?) => {
  const registry = React.useContext(RegistryContext)
  const result = atomResultOrSuspend(registry, atom, options?.suspendOnWaiting ?? false)
  if (result._tag === "Failure" && !options?.includeFailure) {
    throw Cause.squash(result.cause)  // Re-throw for error boundaries
  }
  return result
}
```

## Key Patterns for effect-trpc

### 1. SyncScheduler + Callback Pattern

```typescript
const scheduler = new SyncScheduler()
const fiber = runFork(effect, { scheduler })
scheduler.flush()

const result = fiber.unsafePoll()
if (result) {
  // Sync completion
} else {
  fiber.addObserver(onExit)  // Async
}
```

### 2. Scoped Runtime Construction

```typescript
const scope = Effect.runSync(Scope.make())
const scopedRuntime = Runtime.make({
  context: EffectContext.add(runtime.context, Scope.Scope, scope),
  ...
})
```

### 3. Result Data Type for States

```typescript
type Result<A, E> = 
  | Initial<A, E>       // Not started / loading
  | Success<A, E>       // Has value
  | Failure<A, E>       // Has error (keeps previousSuccess)

// Supports waiting flag for refetch states
```

### 4. LIFO Finalizer Cleanup

Finalizers run in reverse order (LIFO), matching Effect's cleanup semantics.

## Comparison with Other Approaches

| Aspect | Effect Atom | React Query | Jotai |
|--------|-------------|-------------|-------|
| Execution | `runCallbackSync` | Promises | Sync only |
| Errors | `Exit` / `Cause` | throw | throw |
| Cleanup | Scope + finalizers | Manual | Atoms |
| Cancellation | Fiber interrupt | AbortController | N/A |
| Dependencies | Effect Context | N/A | Atom deps |

## Implications for effect-trpc

1. **Use `runCallbackSync`** for sync-first execution with async fallback
2. **Result type** provides rich state (Initial/Success/Failure + waiting)
3. **Scope-based cleanup** integrates with React's useEffect lifecycle
4. **No try/catch needed** - Exit handling is type-safe
5. **Fiber interruption** provides proper cancellation
