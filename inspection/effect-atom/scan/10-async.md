# H10: Async State Handling in Effect Atom

## Summary

Effect Atom uses a custom `Result` type (not `Effect.Result`) specifically designed for reactive state management with async operations. This type has three states (`Initial`, `Success`, `Failure`) plus a `waiting` boolean flag to track in-flight async operations while preserving previous values.

## The Result Type

```typescript
// Result.ts:25
type Result<A, E = never> = Initial<A, E> | Success<A, E> | Failure<A, E>
```

### States

| State | Structure | Purpose |
|-------|-----------|---------|
| `Initial` | `{ _tag: "Initial", waiting: boolean }` | No value yet, optionally waiting for first fetch |
| `Success` | `{ _tag: "Success", value: A, timestamp: number, waiting: boolean }` | Has value, optionally waiting for refresh |
| `Failure` | `{ _tag: "Failure", cause: Cause<E>, previousSuccess: Option<Success>, waiting: boolean }` | Error occurred, preserves previous success |

### Key Design Decisions

1. **`waiting` flag on every state** - Allows showing stale data while refetching
2. **`previousSuccess` on Failure** - Fallback display during errors
3. **`timestamp` on Success** - Enables optimistic update conflict resolution
4. **Uses `Cause<E>` not `E`** - Full Effect error handling including defects

## How Async Effects Become Result

### From Effect.Effect (Atom.ts:470-525)

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
  
  // Create scoped runtime
  const scope = Effect.runSync(Scope.make())
  ctx.addFinalizer(() => Effect.runFork(Scope.close(scope, Exit.void)))
  
  let syncResult: Result.Result<A, E> | undefined
  let isAsync = false
  
  // Run the effect with callback
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
  
  // Handle cancellation
  if (cancel !== undefined) {
    ctx.addFinalizer(cancel)
  }
  
  // Return appropriate initial state
  if (syncResult !== undefined) {
    return syncResult  // Effect completed synchronously
  } else if (previous._tag === "Some") {
    return Result.waitingFrom(previous)  // Preserve stale value
  }
  return Result.waiting(initialValue)  // Show loading
}
```

### From Stream (Atom.ts:753-818)

Streams emit `Result.success` on each chunk, `Result.failure` on error, and handle completion gracefully:

```typescript
function makeStream<A, E>(
  ctx: Context,
  stream: Stream.Stream<A, E, AtomRegistry>,
  initialValue: Result.Result<A, E | NoSuchElementException>,
  runtime = Runtime.defaultRuntime
): Result.Result<A, E | NoSuchElementException> {
  const writer: Channel.Channel<never, Chunk.Chunk<A>, never, E> = Channel.readWithCause({
    onInput(input: Chunk.Chunk<A>) {
      // Update with latest value, mark as waiting for more
      const last = Chunk.last(input)
      if (last._tag === "Some") {
        ctx.setSelf(Result.success(last.value, { waiting: true }))
      }
      return writer
    },
    onFailure(cause: Cause.Cause<E>) {
      ctx.setSelf(Result.failureWithPrevious(cause, {
        previous: ctx.self<Result.Result<A, E>>()
      }))
    },
    onDone(_done: unknown) {
      // Stream completed - mark as not waiting
      const currentValue = Result.value(ctx.self<Result.Result<A, E>>())
      if (Option.isSome(currentValue)) {
        ctx.setSelf(Result.success(currentValue.value))  // waiting: false
      } else {
        ctx.setSelf(Result.fail(new NoSuchElementException()))
      }
    }
  })
  // ...
}
```

## Result Combinators

### Pattern Matching (Result.ts:439-463)

```typescript
const match: {
  <A, E, X, Y, Z>(options: {
    readonly onInitial: (_: Initial<A, E>) => X
    readonly onFailure: (_: Failure<A, E>) => Y
    readonly onSuccess: (_: Success<A, E>) => Z
  }): (self: Result<A, E>) => X | Y | Z
}
```

### Enhanced Matching with Waiting (Result.ts:507-542)

```typescript
const matchWithWaiting: {
  <A, E, W, X, Y, Z>(options: {
    readonly onWaiting: (_: Result<A, E>) => W     // Handles waiting state first
    readonly onError: (error: E, _: Failure<A, E>) => X
    readonly onDefect: (defect: unknown, _: Failure<A, E>) => Y
    readonly onSuccess: (_: Success<A, E>) => Z
  }): (self: Result<A, E>) => W | X | Y | Z
}
```

### Fluent Builder Pattern (Result.ts:593-743)

```typescript
Result.builder(result)
  .onWaiting(() => <Spinner />)
  .onInitial(() => <Skeleton />)
  .onError((e) => <ErrorDisplay error={e} />)
  .onErrorTag("NotFound", () => <NotFound />)
  .onDefect((defect) => <CrashReport defect={defect} />)
  .onSuccess((value) => <Content data={value} />)
  .render()  // Returns appropriate JSX or throws on unhandled failure
```

### Combining Results (Result.ts:551-587)

```typescript
const all = <const Arg extends Iterable<any> | Record<string, any>>(
  results: Arg
): Result<...> => {
  // Short-circuits on first non-Success
  // Propagates waiting flag
  // Works with arrays, records, and mixed Result/non-Result values
}
```

## React Integration

### Suspense Support (Hooks.ts:241-270)

```typescript
const useAtomSuspense = <A, E>(
  atom: Atom.Atom<Result.Result<A, E>>,
  options?: {
    readonly suspendOnWaiting?: boolean  // Suspend during refetch
    readonly includeFailure?: boolean    // Return Failure instead of throwing
  }
): Result.Success<A, E> | Result.Failure<A, E> => {
  const result = atomResultOrSuspend(registry, atom, options?.suspendOnWaiting ?? false)
  if (result._tag === "Failure" && !options?.includeFailure) {
    throw Cause.squash(result.cause)  // Trigger ErrorBoundary
  }
  return result
}
```

### Promise Mode for Mutations (Hooks.ts:103-129)

```typescript
const useAtomSet = <R, W>(
  atom: Atom.Writable<R, W>,
  options?: { readonly mode?: "value" | "promise" | "promiseExit" }
) => {
  // mode: "promise" - Returns Promise<Success value> (throws on failure)
  // mode: "promiseExit" - Returns Promise<Exit<Success, Failure>>
  // mode: "value" (default) - Fire and forget
}
```

## Function Atoms (Actions/Mutations)

### AtomResultFn (Atom.ts:1041)

```typescript
interface AtomResultFn<Arg, A, E = never> 
  extends Writable<Result.Result<A, E>, Arg | Reset | Interrupt> {}
```

Triggered by writing an argument, returns Result:
- Write `arg` -> Runs effect with that arg
- Write `Reset` -> Clears to initial
- Write `Interrupt` -> Cancels current operation

### Concurrent Mode (Atom.ts:1117-1123)

```typescript
const fibersAtom = options?.concurrent
  ? readable((get) => {
      const fibers = new Set<Fiber.RuntimeFiber<any, any>>()
      get.addFinalizer(() => fibers.forEach(f => f.unsafeInterruptAsFork(FiberId.none)))
      return fibers
    })
  : undefined
```

## Optimistic Updates (Atom.ts:1582-1730)

```typescript
const optimistic = <A>(self: Atom<A>): Writable<A, Atom<Result.Result<A, unknown>>> => {
  // Tracks pending transitions
  // Shows optimistic value immediately
  // Reverts on failure
  // Refreshes source on success
  // Uses timestamp to resolve conflicts
}

const optimisticFn: {
  <A, W, XA, XE, OW>(options: {
    readonly reducer: (current: A, update: OW) => W
    readonly fn: AtomResultFn<OW, XA, XE>
  }): (self: Writable<A, Atom<Result.Result<W, unknown>>>) => AtomResultFn<OW, XA, XE>
}
```

## RPC Integration (AtomRpc.ts)

### Query Atoms (AtomRpc.ts:65-92)

```typescript
readonly query: <Tag>(tag, payload, options?) => 
  Atom<Result.Result<Success, Error>>  // Regular queries
  | Writable<PullResult<A, E>, void>   // Stream queries
```

### Mutation Functions (AtomRpc.ts:42-63)

```typescript
readonly mutation: <Tag>(tag) => 
  AtomResultFn<{
    payload: PayloadConstructor,
    reactivityKeys?: ...,
    headers?: ...
  }, Success, Error>
```

## Pull Result (Paginated Streams)

```typescript
type PullResult<A, E = never> = Result.Result<{
  readonly done: boolean
  readonly items: NonEmptyArray<A>
}, E | NoSuchElementException>
```

## Key Patterns for effect-trpc

### Pattern 1: Effect -> Result Conversion

```typescript
// Always via makeEffect, which:
// 1. Creates scoped runtime
// 2. Handles sync/async completion
// 3. Preserves previous values on refresh
// 4. Sets up cancellation
```

### Pattern 2: Waiting Flag Management

```typescript
// Starting async: Result.waiting(previous) or Result.waiting(initial)
// During stream: Result.success(value, { waiting: true })
// On complete: Result.success(value) or Result.failure(cause)
```

### Pattern 3: Error Preservation

```typescript
// Failures preserve previousSuccess for stale-while-error display
Result.failureWithPrevious(cause, { previous })
```

### Pattern 4: React Rendering

```typescript
// Three modes:
// 1. Direct rendering with builder pattern
// 2. Suspense with useAtomSuspense
// 3. Manual checking with useAtomValue
```

## Comparison with Other Approaches

| Feature | Effect Atom | TanStack Query | SWR |
|---------|-------------|----------------|-----|
| Type | `Result<A,E>` | `QueryStatus` union | `data \| error \| isLoading` |
| Error type | `Cause<E>` | `unknown` | `unknown` |
| Stale while revalidate | `waiting + previousValue` | `isPreviousData` | Implicit |
| Stale while error | `previousSuccess` | N/A | N/A |
| Pattern matching | Yes (builder) | No | No |
| Effect integration | Native | Adapter | Adapter |

## Recommendations for effect-trpc

1. **Adopt Result type** - The three-state + waiting design is proven effective
2. **Preserve previous success on failure** - Essential for good UX
3. **Use Cause<E> for errors** - Enables defect handling
4. **Provide builder pattern** - Ergonomic for React rendering
5. **Support suspense** - Modern React integration
6. **Consider timestamp** - Helps with optimistic update conflicts
