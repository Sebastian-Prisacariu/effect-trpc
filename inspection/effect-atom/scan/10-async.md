# H10: Async State Handling in Effect Atom

## Overview

Effect Atom provides a sophisticated system for handling Effect-based async computations within atoms. The core abstraction is the `Result<A, E>` type that tracks loading, success, and failure states with rich metadata.

## Core Async Types

### Result Type

```typescript
// Result.ts
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>

interface Initial<A, E = never> extends Result.Proto<A, E> {
  readonly _tag: "Initial"
  // waiting: boolean - inherited from Proto
}

interface Success<A, E = never> extends Result.Proto<A, E> {
  readonly _tag: "Success"
  readonly value: A
  readonly timestamp: number  // For staleness checks
}

interface Failure<A, E = never> extends Result.Proto<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>  // Full Effect Cause
  readonly previousSuccess: Option.Option<Success<A, E>>  // Stale data
}
```

The `waiting` flag is orthogonal to the state tag - any state can be "waiting":
- `Initial + waiting` = Loading for the first time
- `Success + waiting` = Refetching with stale data
- `Failure + waiting` = Retrying after error

### Result Construction Helpers

```typescript
// Constructors with waiting state
Result.initial(waiting?: boolean): Initial<A, E>
Result.success(value, { waiting?: boolean, timestamp?: number }): Success<A, E>
Result.failure(cause, { previousSuccess?, waiting? }): Failure<A, E>

// Transition helpers
Result.waiting(result): R  // Sets waiting=true on any result
Result.waitingFrom(previous: Option<Result>): Result  // Preserve previous value
Result.fromExit(exit): Success | Failure
Result.fromExitWithPrevious(exit, previous): Success | Failure
```

## Creating Async Atoms

### The `make` Function

```typescript
// Creates atoms from Effects or Streams
const make: {
  // Effect-based
  <A, E>(effect: Effect<A, E, Scope | AtomRegistry>, options?: {
    readonly initialValue?: A
  }): Atom<Result<A, E>>
  
  // Stream-based  
  <A, E>(stream: Stream<A, E, AtomRegistry>, options?: {
    readonly initialValue?: A
  }): Atom<Result<A, E>>
  
  // With getter context
  <A, E>(create: (get: Context) => Effect<A, E, Scope | AtomRegistry>): Atom<Result<A, E>>
  
  // Sync value (no Result wrapper)
  <A>(initialValue: A): Writable<A>
}
```

### Effect Execution (Atom.ts:470-525)

```typescript
const effect = <A, E>(
  get: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  options?: { readonly initialValue?: A; readonly uninterruptible?: boolean },
  runtime?: Runtime.Runtime<any>
): Result.Result<A, E> => {
  const initialValue = options?.initialValue !== undefined
    ? Result.success<A, E>(options.initialValue)
    : Result.initial<A, E>()
  return makeEffect(get, effect, initialValue, runtime, options?.uninterruptible)
}

function makeEffect<A, E>(
  ctx: Context,
  effect: Effect.Effect<A, E, Scope.Scope | AtomRegistry>,
  initialValue: Result.Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result.Result<A, E> {
  const previous = ctx.self<Result.Result<A, E>>()

  // Create scope for cleanup
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))
  })
  
  // Build scoped runtime
  const contextMap = new Map(runtime.context.unsafeMap)
  contextMap.set(Scope.Scope.key, scope)
  contextMap.set(AtomRegistry.key, ctx.registry)
  const scopedRuntime = Runtime.make({
    context: EffectContext.unsafeMake(contextMap),
    fiberRefs: runtime.fiberRefs,
    runtimeFlags: runtime.runtimeFlags
  })
  
  // Sync execution attempt via SyncScheduler
  let syncResult: Result.Result<A, E> | undefined
  let isAsync = false
  const cancel = runCallbackSync(scopedRuntime)(
    effect,
    function(exit) {
      syncResult = Result.fromExitWithPrevious(exit, previous)
      if (isAsync) {
        ctx.setSelf(syncResult)  // Update atom when async completes
      }
    },
    uninterruptible
  )
  isAsync = true
  
  // Register cancellation
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }
  
  // Return sync result or waiting state
  if (syncResult !== undefined) {
    return syncResult
  } else if (previous._tag === "Some") {
    return Result.waitingFrom(previous)  // Keep previous value
  }
  return Result.waiting(initialValue)
}
```

### Sync Execution Optimization (internal/runtime.ts)

```typescript
export const runCallbackSync = <R>(runtime: Runtime<R>) => {
  const runFork = Runtime.runFork(runtime)
  return <A, E>(
    effect: Effect<A, E, R>,
    onExit: (exit: Exit<A, E>) => void,
    uninterruptible = false
  ): (() => void) | undefined => {
    // Fast path for already-resolved effects
    const op = fastPath(effect)
    if (op) {
      onExit(op)
      return undefined
    }
    
    // Try synchronous execution with SyncScheduler
    const scheduler = new SyncScheduler()
    const fiberRuntime = runFork(effect, { scheduler })
    scheduler.flush()
    
    const result = fiberRuntime.unsafePoll()
    if (result) {
      onExit(result)
      return undefined  // No cancellation needed
    }
    
    // Effect is async - register observer
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

## Stream-Based Atoms

### Stream Execution (Atom.ts:753-818)

```typescript
function makeStream<A, E>(
  ctx: Context,
  stream: Stream<A, E, AtomRegistry>,
  initialValue: Result<A, E | NoSuchElementException>,
  runtime = Runtime.defaultRuntime
): Result<A, E | NoSuchElementException> {
  const previous = ctx.self<Result<A, E | NoSuchElementException>>()

  // Channel-based streaming with state updates
  const writer: Channel<never, Chunk<A>, never, E> = Channel.readWithCause({
    onInput(input: Chunk<A>) {
      return Channel.suspend(() => {
        const last = Chunk.last(input)
        if (last._tag === "Some") {
          ctx.setSelf(Result.success(last.value, { waiting: true }))
        }
        return writer
      })
    },
    onFailure(cause: Cause<E>) {
      return Channel.sync(() => {
        ctx.setSelf(Result.failureWithPrevious(cause, {
          previous: ctx.self<Result<A, E | NoSuchElementException>>()
        }))
      })
    },
    onDone(_done: unknown) {
      return Channel.sync(() => {
        // On stream completion, mark as not waiting
        pipe(
          ctx.self<Result<A, E | NoSuchElementException>>(),
          Option.flatMap(Result.value),
          Option.match({
            onNone: () => ctx.setSelf(
              Result.failWithPrevious(new NoSuchElementException(), {
                previous: ctx.self()
              })
            ),
            onSome: (a) => ctx.setSelf(Result.success(a))  // waiting=false
          })
        )
      })
    }
  })

  // Run stream with registry access
  const registryRuntime = Runtime.make({
    context: EffectContext.add(runtime.context, AtomRegistry, ctx.registry),
    fiberRefs: runtime.fiberRefs,
    runtimeFlags: runtime.runtimeFlags
  })

  const cancel = runCallbackSync(registryRuntime)(
    Channel.runDrain(Channel.pipeTo(Stream.toChannel(stream), writer)),
    constVoid,
    false
  )
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }

  // Initial value with waiting state
  if (previous._tag === "Some") {
    return Result.waitingFrom(previous)
  }
  return Result.waiting(initialValue)
}
```

## Function Atoms (Callable Atoms)

### `fn` - Effect-based Functions

```typescript
const fn: {
  <Arg>(): <E, A>(
    fn: (arg: Arg, get: FnContext) => Effect<A, E, Scope | AtomRegistry>
  ) => AtomResultFn<Arg, A, E>
  
  <E, A, Arg = void>(
    fn: (arg: Arg, get: FnContext) => Effect<A, E, Scope | AtomRegistry>
  ): AtomResultFn<Arg, A, E>
}

// Result fn writable atom
interface AtomResultFn<Arg, A, E> extends Writable<Result<A, E>, Arg | Reset | Interrupt>

// Special symbols for control
const Reset = Symbol.for("@effect-atom/atom/Atom/Reset")
const Interrupt = Symbol.for("@effect-atom/atom/Atom/Interrupt")
```

### Implementation (Atom.ts:1106-1163)

```typescript
function makeResultFn<Arg, E, A>(
  f: (arg: Arg, get: FnContext) => Effect<A, E, Scope | AtomRegistry> | Stream<A, E, AtomRegistry>,
  options?: { readonly initialValue?: A; readonly concurrent?: boolean }
) {
  const argAtom = removeTtl(state<[number, Arg | Interrupt]>([0, undefined as any]))
  const initialValue = options?.initialValue !== undefined
    ? Result.success<A, E>(options.initialValue)
    : Result.initial<A, E>()
  
  // Concurrent execution support
  const fibersAtom = options?.concurrent
    ? removeTtl(readable((get) => {
        const fibers = new Set<Fiber.RuntimeFiber<any, any>>()
        get.addFinalizer(() => fibers.forEach((f) => f.unsafeInterruptAsFork(FiberId.none)))
        return fibers
      }))
    : undefined

  function read(get: Context, runtime?: Runtime<any>): Result<A, E | NoSuchElementException> {
    const fibers = fibersAtom ? get(fibersAtom) : undefined
    ;(get as any).isFn = true
    const [counter, arg] = get.get(argAtom)
    
    if (counter === 0) {
      return initialValue  // Not yet called
    } else if (arg === Interrupt) {
      return Result.failureWithPrevious(Cause.interrupt(FiberId.none), { previous: get.self() })
    }
    
    let value = f(arg, get)
    if (Effect.EffectTypeId in value) {
      // Handle concurrent mode
      if (fibers) {
        const eff = value
        value = Effect.flatMap(Effect.runtime<any>(), (r) => {
          const fiber = Runtime.runFork(r, eff)
          fibers.add(fiber)
          fiber.addObserver(() => fibers.delete(fiber))
          return joinAll(Array.from(fibers))
        })
      }
      return makeEffect(get, value as any, initialValue, runtime, false)
    }
    return makeStream(get, value, initialValue, runtime)
  }
  
  function write(ctx: WriteContext<Result<A, E | NoSuchElementException>>, arg: Arg | Reset | Interrupt) {
    batch(() => {
      if (arg === Reset) {
        ctx.set(argAtom, [0, undefined as any])
      } else if (arg === Interrupt) {
        ctx.set(argAtom, [ctx.get(argAtom)[0] + 1, Interrupt])
      } else {
        ctx.set(argAtom, [ctx.get(argAtom)[0] + 1, arg])
      }
      ctx.refreshSelf()
    })
  }
  
  return [read, write, argAtom] as const
}
```

## React Integration

### Suspense Support (Hooks.ts:241-270)

```typescript
function atomResultOrSuspend<A, E>(
  registry: Registry,
  atom: Atom<Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)  // Suspense boundary
  }
  return value
}

export const useAtomSuspense = <A, E, const IncludeFailure extends boolean = false>(
  atom: Atom<Result<A, E>>,
  options?: {
    readonly suspendOnWaiting?: boolean
    readonly includeFailure?: IncludeFailure
  }
): Result.Success<A, E> | (IncludeFailure extends true ? Result.Failure<A, E> : never) => {
  const registry = React.useContext(RegistryContext)
  const result = atomResultOrSuspend(registry, atom, options?.suspendOnWaiting ?? false)
  if (result._tag === "Failure" && !options?.includeFailure) {
    throw Cause.squash(result.cause)  // Error boundary
  }
  return result as any
}
```

### Promise-based Set (Hooks.ts:103-129)

```typescript
function setAtom<R, W, Mode extends "value" | "promise" | "promiseExit" = never>(
  registry: Registry,
  atom: Writable<R, W>,
  options?: { readonly mode?: Mode }
): /* various return types */ {
  if (options?.mode === "promise" || options?.mode === "promiseExit") {
    return React.useCallback((value: W) => {
      registry.set(atom, value)
      const promise = Effect.runPromiseExit(
        Registry.getResult(registry, atom as Atom<Result<any, any>>, { suspendOnWaiting: true })
      )
      return options.mode === "promise" 
        ? promise.then(flattenExit) 
        : promise
    }, [registry, atom, options.mode]) as any
  }
  // Standard sync setter
  return React.useCallback((value: W | ((value: R) => W)) => {
    registry.set(atom, typeof value === "function" ? (value as any)(registry.get(atom)) : value)
  }, [registry, atom]) as any
}
```

## Runtime Integration

### AtomRuntime for Dependency Injection

```typescript
interface AtomRuntime<R, ER = never> extends Atom<Result<Runtime<R>, ER>> {
  readonly factory: RuntimeFactory
  readonly layer: Atom<Layer<R, ER>>
  
  readonly atom: <A, E>(
    create: (get: Context) => Effect<A, E, Scope | R | AtomRegistry>,
    options?: { readonly initialValue?: A }
  ) => Atom<Result<A, E | ER>>
  
  readonly fn: <Arg>() => <E, A>(
    fn: (arg: Arg, get: FnContext) => Effect<A, E, Scope | AtomRegistry | R>
  ) => AtomResultFn<Arg, A, E | ER>
  
  readonly pull: <A, E>(
    create: Stream<A, E, R | AtomRegistry>
  ) => Writable<PullResult<A, E | ER>, void>
}
```

### Example Usage

```typescript
// Define a runtime with services
const counterRuntime = Atom.runtime(CounterLive)

// Create atoms that use the service
const count = counterRuntime.atom(
  Effect.flatMap(Counter, (_) => _.get)
)

// Create callable atoms
const increment = counterRuntime.fn(
  Effect.fn(function*() {
    yield* Effect.flatMap(Counter, (_) => _.inc)
  })
)
```

## Lifecycle and Cleanup

### Context Methods

```typescript
interface Context {
  // Register cleanup
  addFinalizer(f: () => void): void
  
  // Mount atoms to keep alive
  mount<A>(atom: Atom<A>): void
  
  // Refresh/invalidate
  refresh<A>(atom: Atom<A>): void
  refreshSelf(): void
  
  // Get Effect from Result atom
  result<A, E>(atom: Atom<Result<A, E>>, options?: {
    readonly suspendOnWaiting?: boolean
  }): Effect<A, E>
  
  // Stream access
  stream<A>(atom: Atom<A>): Stream<A>
  streamResult<A, E>(atom: Atom<Result<A, E>>): Stream<A, E>
}
```

### Scope Integration

Effects run inside atoms have access to a `Scope` that:
1. Gets closed when the atom is unmounted
2. Handles fiber interruption properly
3. Runs finalizers in reverse order

## Key Patterns for Our useQuery Hook

### 1. Result Type for Loading States

```typescript
// Our hook should return Result-based state
type QueryResult<A, E> = {
  data: A | undefined
  error: E | undefined
  isLoading: boolean       // result._tag === "Initial" || result.waiting
  isRefetching: boolean    // result._tag === "Success" && result.waiting
  isError: boolean         // result._tag === "Failure"
  isSuccess: boolean       // result._tag === "Success"
}

// Can be derived from Result
function toQueryResult<A, E>(result: Result<A, E>): QueryResult<A, E> {
  return {
    data: Result.value(result).pipe(Option.getOrUndefined),
    error: Result.error(result).pipe(Option.getOrUndefined),
    isLoading: result._tag === "Initial" || result.waiting,
    isRefetching: result._tag === "Success" && result.waiting,
    isError: result._tag === "Failure",
    isSuccess: result._tag === "Success" && !result.waiting
  }
}
```

### 2. Previous Value Preservation

Effect Atom automatically preserves previous successful values on failure:

```typescript
interface Failure<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly previousSuccess: Option.Option<Success<A, E>>  // Stale data!
}
```

This is perfect for showing stale data while refetching or after errors.

### 3. Sync Execution First

The `runCallbackSync` pattern tries sync execution first:
- Pure effects resolve immediately
- Async effects get proper cleanup
- No unnecessary re-renders for sync operations

### 4. Suspense Integration

```typescript
// Effect Atom's pattern
if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
  throw atomToPromise(registry, atom, suspendOnWaiting)
}

// Our hook could support:
const { data } = useQuery(api.users.list, { suspense: true })
// Never loading state - just data or thrown promise
```

### 5. Callable Atoms for Mutations

The `fn` pattern creates callable atoms:

```typescript
const updateUser = Atom.fn((user: User) => 
  Effect.succeed(user)  // or actual effect
)

// Write to call, read to get result
registry.set(updateUser, newUser)
const result = registry.get(updateUser)  // Result<User, Error>
```

This maps directly to mutations:

```typescript
const mutation = useMutation(api.users.update)
mutation.mutate(newUser)  // Write
mutation.data             // Read result
```

## Summary

Effect Atom provides a complete async state management solution:

| Feature | Implementation |
|---------|---------------|
| Loading state | `Result.Initial` + `waiting` flag |
| Success state | `Result.Success` with timestamp |
| Error state | `Result.Failure` with full `Cause` |
| Stale-while-revalidate | `previousSuccess` on Failure, `waiting` on Success |
| Suspense | Throw promise in `useAtomSuspense` |
| Cancellation | Scope-based cleanup + fiber interruption |
| Service injection | `AtomRuntime` with Layer support |
| Mutations | `Atom.fn` callable atoms |

This architecture is directly applicable to our tRPC-Effect `useQuery` hook design.
