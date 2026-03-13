# H14: Effect in React Lifecycle

## Summary

Effect Atom uses a **synchronous-first execution model** where Effects are run during atom value computation, not during React's render or effect phases. The key insight is that Effects are run via `runCallbackSync` which attempts synchronous execution first, falling back to async with observer callbacks.

## Where Effects Are Executed

### 1. Atom Value Computation (NOT render phase)

Effects are executed when an atom's value is computed. This happens:

1. **On first subscription/mount** - When React mounts a component using `useAtomValue`, the registry creates the atom node and computes its value
2. **On invalidation** - When dependencies change, the atom recomputes

**File:** `packages/atom/src/Atom.ts:482-525`
```typescript
function makeEffect<A, E>(
  ctx: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  initialValue: Result.Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result.Result<A, E> {
  const previous = ctx.self<Result.Result<A, E>>()

  // Create a scope for cleanup
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))
  })
  
  // Build runtime with scope + registry
  const contextMap = new Map(runtime.context.unsafeMap)
  contextMap.set(Scope.Scope.key, scope)
  contextMap.set(AtomRegistry.key, ctx.registry)
  const scopedRuntime = Runtime.make({...})
  
  // Execute synchronously if possible
  let syncResult: Result.Result<A, E> | undefined
  let isAsync = false
  const cancel = runCallbackSync(scopedRuntime)(
    effect,
    function(exit) {
      syncResult = Result.fromExitWithPrevious(exit, previous)
      if (isAsync) {
        ctx.setSelf(syncResult)  // Update atom value asynchronously
      }
    },
    uninterruptible
  )
  isAsync = true
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }
  
  // Return synchronous result or waiting state
  if (syncResult !== undefined) {
    return syncResult
  } else if (previous._tag === "Some") {
    return Result.waitingFrom(previous)
  }
  return Result.waiting(initialValue)
}
```

### 2. Synchronous-First Execution via `runCallbackSync`

**File:** `packages/atom/src/internal/runtime.ts:35-63`
```typescript
export const runCallbackSync = <R, ER = never>(runtime: Runtime.Runtime<R>) => {
  const runFork = Runtime.runFork(runtime)
  return <A, E>(
    effect: Effect.Effect<A, E, R>,
    onExit: (exit: Exit.Exit<A, E | ER>) => void,
    uninterruptible = false
  ): (() => void) | undefined => {
    // Fast path for already-completed Effects
    const op = fastPath(effect)
    if (op) {
      onExit(op)
      return undefined
    }
    
    // Try synchronous execution first
    const scheduler = new SyncScheduler()
    const fiberRuntime = runFork(effect, { scheduler })
    scheduler.flush()
    
    const result = fiberRuntime.unsafePoll()
    if (result) {
      onExit(result)
      return undefined  // No cleanup needed - completed synchronously
    }
    
    // Async case - add observer for completion
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

## Runtime Management

### 1. Registry as Runtime Context

The Registry serves as the runtime context for all atoms:

**File:** `packages/atom-react/src/RegistryContext.ts:22-25`
```typescript
export const RegistryContext = React.createContext<Registry.Registry>(Registry.make({
  scheduleTask,
  defaultIdleTTL: 400
}))
```

### 2. Scheduler Integration with React

Uses React's scheduler for task scheduling:

```typescript
import * as Scheduler from "scheduler"

export function scheduleTask(f: () => void): void {
  Scheduler.unstable_scheduleCallback(Scheduler.unstable_LowPriority, f)
}
```

### 3. Scoped Runtime per Effect Execution

Each Effect atom creates a scoped runtime with:
- Fresh `Scope` for resource management
- `AtomRegistry` service for atom access
- Inherited `Runtime` context (layers, fiber refs)

## Cleanup Patterns

### 1. Lifetime-based Cleanup

Each atom node has a `Lifetime` that tracks finalizers:

**File:** `packages/atom/src/internal/registry.ts:495-501`
```typescript
interface Lifetime<A> extends Atom.Context {
  isFn: boolean
  readonly node: Node<A>
  finalizers: Array<() => void> | undefined
  disposed: boolean
  readonly dispose: () => void
}
```

### 2. Scope Closure on Dispose

When an atom's lifetime ends, the scope is closed:

```typescript
const scope = Effect.runSync(Scope.make())
ctx.addFinalizer(() => {
  Effect.runFork(Scope.close(scope, Exit.void))
})
```

### 3. Fiber Interruption on Cancellation

For async Effects, the fiber is interrupted on cleanup:

```typescript
function cancel() {
  fiberRuntime.removeObserver(onExit)
  if (!uninterruptible) {
    fiberRuntime.unsafeInterruptAsFork(FiberId.none)
  }
}
return cancel
```

### 4. Registry Provider Cleanup

**File:** `packages/atom-react/src/RegistryContext.ts:52-62`
```typescript
React.useEffect(() => {
  if (ref.current?.timeout !== undefined) {
    clearTimeout(ref.current.timeout)
  }
  return () => {
    // Delayed disposal to handle React StrictMode double-mount
    ref.current!.timeout = setTimeout(() => {
      ref.current?.registry.dispose()
      ref.current = null
    }, 500)
  }
}, [ref])
```

### 5. Atom Mount/Unmount Lifecycle

**File:** `packages/atom-react/src/Hooks.ts:99-101`
```typescript
function mountAtom<A>(registry: Registry.Registry, atom: Atom.Atom<A>): void {
  React.useEffect(() => registry.mount(atom), [atom, registry])
}
```

## Rules for Effect Execution in React

### Rule 1: Effects Run Outside Render Phase
Effects are executed when atom nodes compute their values, which happens:
- During the first `useSyncExternalStore` subscription
- When the atom is invalidated and needs recomputation

### Rule 2: Synchronous Effects Complete Immediately
If an Effect can complete synchronously (using `SyncScheduler`), the atom value is immediately available without triggering a re-render.

### Rule 3: Async Effects Return Waiting State
Async Effects return `Result.waiting(initialValue)` and trigger a re-render when they complete via `ctx.setSelf()`.

### Rule 4: Cleanup via Scope and Finalizers
- Effects get a fresh `Scope` 
- Finalizers are registered via `ctx.addFinalizer()`
- Scope closes when atom is invalidated or removed

### Rule 5: Interruption is Supported
Async Effects can be interrupted when:
- The atom is invalidated (new value computation)
- The atom is removed from the registry
- The component unmounts (via subscription cleanup)

## How This Applies to Our Mutation Hooks

### Pattern 1: Use `Atom.fn` for Mutations

```typescript
// Creates a writable atom that runs an Effect when written to
const mutationAtom = Atom.fn<Input, Output, Error>(
  (input, get) => Effect.gen(function*() {
    // Your mutation logic here
    return yield* someEffect(input)
  })
)

// In React:
const [result, mutate] = useAtom(mutationAtom)
// mutate(input) triggers the Effect
```

### Pattern 2: Runtime Integration for Services

```typescript
const Rx = Atom.context({ memoMap: Atom.defaultMemoMap })

const myRuntime = Rx(MyServiceLayer)

const mutationAtom = myRuntime.fn<Input, A, E>(
  (input, get) => Effect.gen(function*() {
    const service = yield* MyService
    return yield* service.mutate(input)
  })
)
```

### Pattern 3: Handle Result States

```typescript
const result = useAtomValue(mutationAtom)

Result.match(result, {
  onInitial: () => <IdleState />,
  onSuccess: (data) => <SuccessState data={data} />,
  onFailure: (error) => <ErrorState error={error} />
})

// Or with waiting state:
if (result.waiting) {
  return <LoadingState previousData={Result.value(result)} />
}
```

### Pattern 4: Suspense Integration

```typescript
// useAtomSuspense throws a promise for React Suspense
const result = useAtomSuspense(queryAtom, { 
  suspendOnWaiting: true 
})
// result is always Success | Failure (never Initial)
```

### Key Insights for effect-trpc

1. **No `Effect.runPromise` in React components** - Atom handles execution
2. **Mutations use `Atom.fn`** - Returns `Result<A, E>` automatically
3. **Cleanup is automatic** - Scopes close on unmount/invalidation
4. **Reactivity via `withReactivity`** - Ties atoms to server mutation keys

### Example Mutation Pattern

```typescript
// Define mutation atom
const createUserAtom = Rx.fn<CreateUserInput, User, CreateUserError>(
  (input, _get) => Effect.gen(function*() {
    const client = yield* TrpcClient
    return yield* client.user.create(input)
  }),
  { reactivityKeys: ["users"] }  // Invalidates user queries on success
)

// Use in component
function CreateUserForm() {
  const [result, createUser] = useAtom(createUserAtom)
  
  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      createUser({ name: "..." })
    }}>
      {result.waiting && <Spinner />}
      {Result.isFailure(result) && <Error cause={result.cause} />}
      {Result.isSuccess(result) && <Success user={result.value} />}
      <button type="submit">Create</button>
    </form>
  )
}
```

## Sequence Diagram

```
Component Mount
     │
     ▼
useAtomValue(atom)
     │
     ▼
useSyncExternalStore
     │
     ▼
registry.subscribe(atom)
     │
     ▼
registry.ensureNode(atom)
     │
     ▼
node.value() ◀─── First value computation
     │
     ▼
atom.read(lifetime)
     │
     ▼
makeEffect(ctx, effect)
     │
     ▼
runCallbackSync(runtime)(effect)
     │
     ├─sync─► Return Result immediately
     │
     └─async─► Return Result.waiting
                    │
                    ▼ (later)
              fiber completes
                    │
                    ▼
              ctx.setSelf(result)
                    │
                    ▼
              node.setValue(result)
                    │
                    ▼
              listeners notified
                    │
                    ▼
              React re-renders
```

## Summary Table

| Phase | Where Effects Run | API Used |
|-------|-------------------|----------|
| Mount | Node value computation | `runCallbackSync` |
| Recomputation | Node invalidation | `runCallbackSync` |
| Cleanup | Lifetime disposal | `Scope.close`, `fiber.interrupt` |
| Async completion | Fiber observer | `ctx.setSelf()` |
| React notification | `useSyncExternalStore` | Registry subscription |
