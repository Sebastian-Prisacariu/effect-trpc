# H20: tRPC Links Architecture Analysis

## Overview

tRPC's "links" pattern is a **middleware chain for client-side operations**. Links intercept, transform, and handle RPC operations as they flow from client to server and back.

## Core Types

```typescript
// The public link factory type
type TRPCLink<TInferrable extends InferrableClientTypes> = (
  opts: TRPCClientRuntime,
) => OperationLink<TInferrable>;

// The actual link implementation
type OperationLink<TInferrable, TInput = unknown, TOutput = unknown> = (opts: {
  op: Operation<TInput>;
  next: (op: Operation<TInput>) => OperationResultObservable<TInferrable, TOutput>;
}) => OperationResultObservable<TInferrable, TOutput>;

// Operation metadata
type Operation<TInput = unknown> = {
  id: number;
  type: 'mutation' | 'query' | 'subscription';
  input: TInput;
  path: string;
  context: OperationContext;
  signal: Maybe<AbortSignal>;
};
```

## Chain Execution

The chain is built via `createChain()` in `links/internals/createChain.ts`:

```typescript
export function createChain<TRouter, TInput, TOutput>(opts: {
  links: OperationLink<TRouter, TInput, TOutput>[];
  op: Operation<TInput>;
}): OperationResultObservable<TRouter, TOutput> {
  return observable((observer) => {
    function execute(index = 0, op = opts.op) {
      const next = opts.links[index];
      if (!next) {
        throw new Error('No more links to execute - did you forget to add an ending link?');
      }
      const subscription = next({
        op,
        next(nextOp) {
          return execute(index + 1, nextOp);
        },
      });
      return subscription;
    }
    const obs$ = execute();
    return obs$.subscribe(observer);
  });
}
```

**Key characteristics:**
1. **Recursive execution** - Each link calls `next()` to invoke the next link
2. **Observable-based** - All links return `Observable<OperationResultEnvelope, TRPCClientError>`
3. **Terminating link required** - The final link must not call `next()` (e.g., `httpLink`, `wsLink`)
4. **Links can modify operations** - Can transform `op` before passing to next

## Link Categories

### 1. Terminating Links (don't call `next()`)

| Link | Purpose | Transport |
|------|---------|-----------|
| `httpLink` | Single HTTP request | HTTP |
| `httpBatchLink` | Batched HTTP requests | HTTP |
| `httpBatchStreamLink` | Streaming batched responses | HTTP |
| `wsLink` | WebSocket transport | WebSocket |
| `httpSubscriptionLink` | SSE for subscriptions | HTTP/SSE |
| `localLink` | In-process, no network | Direct call |

### 2. Pass-Through Links (call `next()`)

| Link | Purpose |
|------|---------|
| `loggerLink` | Logs operations up/down |
| `retryLink` | Retries failed operations |
| `splitLink` | Conditional routing to different link chains |
| `dedupeLink` | Deduplicates identical in-flight queries |

## Link Implementation Patterns

### Pattern 1: Simple Pass-Through (loggerLink)

```typescript
export function loggerLink<TRouter>(): TRPCLink<TRouter> {
  return () => {                          // Runtime initialization
    return ({ op, next }) => {            // Per-request
      return observable((observer) => {
        logger({ ...op, direction: 'up' });
        const requestStartTime = Date.now();
        
        return next(op)
          .pipe(tap({
            next(result) { logger({ ...op, direction: 'down', elapsedMs: Date.now() - requestStartTime, result }); },
            error(result) { logger({ ...op, direction: 'down', result }); },
          }))
          .subscribe(observer);
      });
    };
  };
}
```

### Pattern 2: Terminating (httpLink)

```typescript
export function httpLink<TRouter>(opts: HTTPLinkOptions<TRouter>): TRPCLink<TRouter> {
  const resolvedOpts = resolveHTTPLinkOptions(opts);
  
  return () => {                           // Runtime init
    return (operationOpts) => {            // Per-request
      const { op } = operationOpts;
      // NOTE: Does NOT call next() - terminates chain
      return observable((observer) => {
        const request = universalRequester({ ...resolvedOpts, type: op.type, path, input, signal: op.signal });
        request.then((res) => {
          observer.next({ context: res.meta, result: transformed.result });
          observer.complete();
        }).catch((cause) => {
          observer.error(TRPCClientError.from(cause, { meta }));
        });
        return () => { /* cleanup */ };
      });
    };
  };
}
```

### Pattern 3: Conditional Routing (splitLink)

```typescript
export function splitLink<TRouter>(opts: {
  condition: (op: Operation) => boolean;
  true: TRPCLink<TRouter> | TRPCLink<TRouter>[];
  false: TRPCLink<TRouter> | TRPCLink<TRouter>[];
}): TRPCLink<TRouter> {
  return (runtime) => {
    const yes = asArray(opts.true).map((link) => link(runtime));
    const no = asArray(opts.false).map((link) => link(runtime));
    
    return (props) => {
      return observable((observer) => {
        const links = opts.condition(props.op) ? yes : no;
        return createChain({ op: props.op, links }).subscribe(observer);
      });
    };
  };
}
```

### Pattern 4: Retry with State (retryLink)

```typescript
export function retryLink<TInferrable>(opts: RetryLinkOptions<TInferrable>): TRPCLink<TInferrable> {
  return () => {
    return (callOpts) => {
      return observable((observer) => {
        let lastEventId: string | undefined;
        
        function attempt(attempts: number) {
          const op = { ...callOpts.op, input: inputWithTrackedEventId(callOpts.op.input, lastEventId) };
          
          callOpts.next(op).subscribe({
            error(error) {
              if (opts.retry({ op, attempts, error })) {
                setTimeout(() => attempt(attempts + 1), opts.retryDelayMs?.(attempts) ?? 0);
              } else {
                observer.error(error);
              }
            },
            next(envelope) {
              if (envelope.result.id) lastEventId = envelope.result.id;
              observer.next(envelope);
            },
            complete() { observer.complete(); },
          });
        }
        
        attempt(1);
        return () => { /* cleanup */ };
      });
    };
  };
}
```

## Client Integration

The `TRPCUntypedClient` initializes links at construction:

```typescript
constructor(opts: CreateTRPCClientOptions<TInferrable>) {
  this.requestId = 0;
  this.runtime = {};
  // Initialize all links with runtime context
  this.links = opts.links.map((link) => link(this.runtime));
}

private $request<TInput, TOutput>(opts) {
  const chain$ = createChain<AnyRouter, TInput, TOutput>({
    links: this.links,
    op: { ...opts, context: opts.context ?? {}, id: ++this.requestId },
  });
  return chain$.pipe(share());
}
```

## Composition Examples

```typescript
// Standard setup
const client = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    httpBatchLink({ url: 'http://localhost:3000/trpc' }),
  ],
});

// Split by operation type
const client = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({ url: '/trpc' }),
    }),
  ],
});

// Retry + batching
const client = createTRPCClient<AppRouter>({
  links: [
    retryLink({ retry: (opts) => opts.attempts < 3 }),
    httpBatchLink({ url: '/trpc' }),
  ],
});
```

## Effect-TRPC Implications

### Should We Adopt Links?

**Arguments FOR:**

1. **Familiar to tRPC users** - Existing mental model transfers
2. **Compositional** - Mix and match concerns cleanly
3. **Extensible** - Users can write custom links
4. **Separation of concerns** - Logging, retry, auth are distinct

**Arguments AGAINST:**

1. **Effect already has middleware** - `@effect/rpc` has middleware via `Layer`
2. **Observable vs Effect** - Links use RxJS-style Observable; Effect has `Stream`
3. **Complexity** - Two-phase initialization (factory -> runtime -> per-request)
4. **Context threading** - Effect's native `Context` system is more powerful

### Recommendation

**Don't directly adopt tRPC links.** Instead, map the patterns to Effect idioms:

| tRPC Link | Effect Equivalent |
|-----------|-------------------|
| `loggerLink` | `Effect.tap` + `Tracer` |
| `retryLink` | `Effect.retry` with `Schedule` |
| `splitLink` | Pattern matching on operation type |
| `httpLink` | `HttpClient` layer |
| `wsLink` | WebSocket `Stream` |

### Effect-Native Middleware

Instead of Observable-based links, use Effect's composition:

```typescript
// Effect middleware wraps the execution
const withLogging = <R, E, A>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Request started")
    const result = yield* effect
    yield* Effect.logInfo("Request completed")
    return result
  })

// Retry via Schedule
const withRetry = <R, E, A>(
  effect: Effect.Effect<A, E, R>,
  schedule: Schedule.Schedule<unknown, E>
): Effect.Effect<A, E, R> =>
  Effect.retry(effect, schedule)

// Transport selection via service
interface RpcTransport {
  readonly execute: <I, O>(
    op: RpcOperation<I, O>
  ) => Effect.Effect<O, RpcError, RpcTransport>
}

const HttpTransport = Layer.succeed(RpcTransport, { /* ... */ })
const WsTransport = Layer.succeed(RpcTransport, { /* ... */ })
```

### Key Insight

tRPC links solve **cross-cutting concerns** for RPC operations. Effect solves these natively:

| Concern | tRPC Link | Effect |
|---------|-----------|--------|
| Logging | `loggerLink` | `Tracer`, `Effect.annotateLogs` |
| Retry | `retryLink` | `Effect.retry`, `Schedule` |
| Timeout | Custom link | `Effect.timeout` |
| Caching | `dedupeLink` | `Cache`, `Request` deduplication |
| Auth | Custom link | `Context.Tag` for credentials |
| Error handling | Link `catch` | `Effect.catchTag`, error channel |

## Summary

tRPC's links are a well-designed Observable middleware chain. For effect-trpc, we should **not port the Observable pattern** but instead provide Effect-native equivalents that leverage:

1. **Effect's error channel** for typed errors
2. **Context/Layer** for dependency injection
3. **Schedule** for retry policies
4. **Stream** for subscriptions
5. **Tracer** for observability

The user-facing API can still support composable middleware, but implemented via Effect's functional composition rather than Observable chains.
