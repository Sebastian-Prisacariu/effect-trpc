# H10: Async State Handling in Effect Atom

## Executive Summary

Effect Atom has a sophisticated **Result type** that unifies async state representation, eliminating the need for manual loading/error state management. The key insight is that **async is a property of the Result, not the atom** - atoms are always synchronous, but their values can represent async operations in progress.

## The Result Type: Core Async Model

### Three-State Union

```typescript
// packages/atom/src/Result.ts:25
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>
```

**States:**

| State | Meaning | Data |
|-------|---------|------|
| `Initial` | Never executed / no data yet | `waiting: boolean` |
| `Success` | Has value | `value: A`, `timestamp: number`, `waiting: boolean` |
| `Failure` | Has error | `cause: Cause<E>`, `previousSuccess: Option<Success<A, E>>`, `waiting: boolean` |

### The `waiting` Flag

Critical design: **Every state has a `waiting: boolean` flag**. This enables:

```typescript
// Result.ts:106
export const isWaiting = <A, E>(result: Result<A, E>): boolean => result.waiting

// Initial can be waiting (first load)
initial(true)  // Result.Initial, waiting: true

// Success can be waiting (refetching while showing stale data)  
success(value, { waiting: true })  // Result.Success, waiting: true

// Failure can be waiting (retrying after error)
failure(cause, { waiting: true })  // Result.Failure, waiting: true
```

### State Transitions

```
Initial(waiting: false) ─→ Initial(waiting: true) ─→ Success/Failure
                                                         │
Success(waiting: false) ─→ Success(waiting: true) ──────┘ (refetch)
                                                         │
Failure(waiting: false) ─→ Failure(waiting: true) ──────┘ (retry)
```

## Async Atom Construction

### Effect-Based Atoms

```typescript
// Atom.ts:375-396 - The make constructor
export const make: {
  // Effect → Result atom
  <A, E>(effect: Effect<A, E, Scope | AtomRegistry>, options?: {
    readonly initialValue?: A
  }): Atom<Result.Result<A, E>>
  
  // Stream → Result atom
  <A, E>(stream: Stream<A, E, AtomRegistry>, options?: {
    readonly initialValue?: A
  }): Atom<Result.Result<A, E>>
  
  // Sync value → Writable atom
  <A>(initialValue: A): Writable<A>
}
```

### Internal Effect Execution

```typescript
// Atom.ts:482-525 - makeEffect function
function makeEffect<A, E>(
  ctx: Context,
  effect: Effect<A, E, Scope | AtomRegistry>,
  initialValue: Result<A, E>,
  runtime = Runtime.defaultRuntime,
  uninterruptible = false
): Result<A, E> {
  const previous = ctx.self<Result<A, E>>()
  
  // Create scoped runtime
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => {
    Effect.runFork(Scope.close(scope, Exit.void))
  })
  
  // Sync execution attempt
  let syncResult: Result<A, E> | undefined
  let isAsync = false
  
  const cancel = runCallbackSync(scopedRuntime)(
    effect,
    function(exit) {
      syncResult = Result.fromExitWithPrevious(exit, previous)
      if (isAsync) {
        ctx.setSelf(syncResult)  // Async completion updates atom
      }
    },
    uninterruptible
  )
  isAsync = true
  
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)  // Cleanup on unmount
  }
  
  // Return immediately
  if (syncResult !== undefined) {
    return syncResult  // Sync result
  } else if (previous._tag === "Some") {
    return Result.waitingFrom(previous)  // Preserve previous + waiting
  }
  return Result.waiting(initialValue)  // Initial waiting state
}
```

### Stream Execution Pattern

```typescript
// Atom.ts:753-818 - makeStream function
function makeStream<A, E>(
  ctx: Context,
  stream: Stream<A, E, AtomRegistry>,
  initialValue: Result<A, E | NoSuchElementException>,
  runtime = Runtime.defaultRuntime
): Result<A, E | NoSuchElementException> {
  const previous = ctx.self()
  
  // Channel-based consumption
  const writer: Channel<never, Chunk<A>, never, E> = Channel.readWithCause({
    onInput(input: Chunk<A>) {
      const last = Chunk.last(input)
      if (last._tag === "Some") {
        ctx.setSelf(Result.success(last.value, { waiting: true }))
      }
      return writer
    },
    onFailure(cause: Cause<E>) {
      ctx.setSelf(Result.failureWithPrevious(cause, {
        previous: ctx.self()
      }))
    },
    onDone(_done: unknown) {
      // Mark as complete (not waiting)
      pipe(
        ctx.self(),
        Option.flatMap(Result.value),
        Option.match({
          onNone: () => ctx.setSelf(Result.failWithPrevious(
            new NoSuchElementException(), { previous: ctx.self() }
          )),
          onSome: (a) => ctx.setSelf(Result.success(a))  // waiting: false
        })
      )
    }
  })
  
  // Initial state
  if (previous._tag === "Some") {
    return Result.waitingFrom(previous)
  }
  return Result.waiting(initialValue)
}
```

## Previous Value Preservation

### On Failure

```typescript
// Result.ts:204-208
export interface Failure<A, E = never> extends Result.Proto<A, E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly previousSuccess: Option.Option<Success<A, E>>  // Preserved!
}

// Result.ts:246-261 - failureWithPrevious
export const failureWithPrevious = <A, E>(
  cause: Cause<E>,
  options: { readonly previous: Option<Result<A, E>> }
): Failure<A, E> =>
  failure(cause, {
    previousSuccess: Option.flatMap(options.previous, (result) =>
      isSuccess(result)
        ? Option.some(result)
        : isFailure(result)
        ? result.previousSuccess  // Chain through failures
        : Option.none()),
    waiting: options.waiting
  })
```

### Value Accessor

```typescript
// Result.ts:331-338 - Gets value from Success OR previousSuccess
export const value = <A, E>(self: Result<A, E>): Option<A> => {
  if (self._tag === "Success") {
    return Option.some(self.value)
  } else if (self._tag === "Failure") {
    return Option.map(self.previousSuccess, (s) => s.value)  // Stale data!
  }
  return Option.none()
}
```

## React Integration: Async Hooks

### Suspense Integration

```typescript
// atom-react/src/Hooks.ts:241-270
function atomResultOrSuspend<A, E>(
  registry: Registry,
  atom: Atom<Result<A, E>>,
  suspendOnWaiting: boolean
) {
  const value = useStore(registry, atom)
  if (value._tag === "Initial" || (suspendOnWaiting && value.waiting)) {
    throw atomToPromise(registry, atom, suspendOnWaiting)  // Suspend!
  }
  return value
}

export const useAtomSuspense = <A, E>(
  atom: Atom<Result<A, E>>,
  options?: {
    readonly suspendOnWaiting?: boolean  // Also suspend on refetch?
    readonly includeFailure?: boolean    // Return Failure or throw?
  }
): Result.Success<A, E> => {
  const result = atomResultOrSuspend(registry, atom, options?.suspendOnWaiting ?? false)
  if (result._tag === "Failure" && !options?.includeFailure) {
    throw Cause.squash(result.cause)  // Error boundary
  }
  return result
}
```

### Promise Mode for Mutations

```typescript
// atom-react/src/Hooks.ts:103-129
function setAtom<R, W>(
  registry: Registry,
  atom: Writable<R, W>,
  options?: { readonly mode?: "value" | "promise" | "promiseExit" }
) {
  if (options?.mode === "promise") {
    return React.useCallback((value: W) => {
      registry.set(atom, value)
      return Effect.runPromiseExit(
        Registry.getResult(registry, atom, { suspendOnWaiting: true })
      ).then(flattenExit)  // Throws on failure
    }, [registry, atom])
  }
  // ... value mode
}
```

## Builder Pattern for UI Rendering

```typescript
// Result.ts:593-743 - Fluent API for exhaustive pattern matching
export const builder = <A extends Result<any, any>>(self: A): Builder<...> =>
  new BuilderImpl(self)

// Usage in components:
Result.builder(result)
  .onInitial(() => <Loading />)
  .onWaiting(() => <RefreshingIndicator />)
  .onError((error) => <ErrorMessage error={error} />)
  .onDefect((defect) => <CrashReport defect={defect} />)
  .onSuccess((value) => <Content data={value} />)
  .render()
```

### Match Variants

```typescript
// Basic match
Result.match(result, {
  onInitial: (_) => ...,
  onFailure: (_) => ...,
  onSuccess: (_) => ...
})

// With error discrimination
Result.matchWithError(result, {
  onInitial: (_) => ...,
  onError: (error, _) => ...,      // Expected errors (E)
  onDefect: (defect, _) => ...,    // Unexpected errors (Cause.Die)
  onSuccess: (_) => ...
})

// With waiting discrimination
Result.matchWithWaiting(result, {
  onWaiting: (_) => ...,           // Any state with waiting: true
  onError: (error, _) => ...,
  onDefect: (defect, _) => ...,
  onSuccess: (_) => ...
})
```

## Comparison: Manual vs Effect Atom

### Manual Approach (Current tRPC-Effect)

```typescript
// Must track 3+ pieces of state manually
const [data, setData] = useState<T | null>(null)
const [error, setError] = useState<E | null>(null)
const [isLoading, setIsLoading] = useState(false)
const [isRefetching, setIsRefetching] = useState(false)

// Must coordinate state transitions
const fetch = async () => {
  setIsLoading(true)
  try {
    const result = await api.call()
    setData(result)
    setError(null)
  } catch (e) {
    setError(e)
    // What about data? Clear or preserve?
  } finally {
    setIsLoading(false)
  }
}
```

### Effect Atom Approach

```typescript
// Single Result atom handles all states
const dataAtom = runtime.atom(
  Effect.gen(function*() {
    return yield* api.call()
  })
)

// UI reads unified state
function Component() {
  const result = useAtomValue(dataAtom)
  
  return Result.builder(result)
    .onWaiting(() => <Spinner />)
    .onError((e) => <ErrorDisplay error={e} />)
    .onSuccess((data) => <DataView data={data} />)
    .render()
}
```

## Key Design Insights

### 1. Atoms Are Always Synchronous

```typescript
// Atom read function is pure and sync
const read: (get: Context) => A

// Async operations return Result<A, E> immediately
// The waiting flag indicates in-progress state
```

### 2. Result Carries History

```typescript
// Failure preserves previous success for stale-while-revalidate
interface Failure<A, E> {
  cause: Cause<E>
  previousSuccess: Option<Success<A, E>>  // Historical data
}
```

### 3. Waiting Is Orthogonal to State

```typescript
// Any state can be "waiting" for the next state
Initial(waiting: true)   // First load
Success(waiting: true)   // Refetching
Failure(waiting: true)   // Retrying
```

### 4. Type-Safe State Transitions

```typescript
// Exit → Result conversion preserves types
const fromExit = <A, E>(exit: Exit<A, E>): Success<A, E> | Failure<A, E>

// Can only go from Exit (completed) to terminal Result
// Initial is only for "never started"
```

## Recommendations for tRPC-Effect

1. **Adopt Result Type**: Use `@effect-atom/atom`'s Result directly or create compatible version
2. **Remove Manual State**: Replace useState trios with Result atoms
3. **Leverage Suspense**: Use `useAtomSuspense` for cleaner async boundaries
4. **Use Builder Pattern**: Exhaustive matching prevents UI bugs
5. **Preserve Previous Values**: Stale-while-revalidate is built-in

## File References

- `packages/atom/src/Result.ts` - Core Result type (857 lines)
- `packages/atom/src/Atom.ts` - Atom constructors with async support (2105 lines)
- `packages/atom-react/src/Hooks.ts` - React integration (310 lines)
- `packages/atom/src/internal/runtime.ts` - Sync execution with callback (64 lines)
