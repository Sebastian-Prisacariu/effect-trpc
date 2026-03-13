# H20 - tRPC Link Architecture Analysis

## Overview

tRPC uses a "links" system for composable, middleware-like request processing on the client side. This is a powerful pattern that enables:
- Chained request/response processing
- Conditional routing (split links)
- Transport abstraction (HTTP, WebSocket, local)
- Cross-cutting concerns (logging, retry, dedupe)

## Core Link Architecture

### Type Definitions (links/types.ts)

```typescript
// The core operation type - represents an RPC call
export type Operation<TInput = unknown> = {
  id: number;
  type: 'mutation' | 'query' | 'subscription';
  input: TInput;
  path: string;
  context: OperationContext;
  signal: Maybe<AbortSignal>;
};

// An OperationLink is a function that processes an operation
// and returns an Observable of results
export type OperationLink<TInferrable, TInput, TOutput> = (opts: {
  op: Operation<TInput>;
  next: (op: Operation<TInput>) => OperationResultObservable<TInferrable, TOutput>;
}) => OperationResultObservable<TInferrable, TOutput>;

// A TRPCLink is a factory that creates an OperationLink
// Called once per client instance (runtime initialization)
export type TRPCLink<TInferrable> = (
  opts: TRPCClientRuntime,
) => OperationLink<TInferrable>;
```

### Chain Execution (links/internals/createChain.ts)

```typescript
export function createChain<TRouter, TInput, TOutput>(opts: {
  links: OperationLink<TRouter, TInput, TOutput>[];
  op: Operation<TInput>;
}): OperationResultObservable<TRouter, TOutput> {
  return observable((observer) => {
    function execute(index = 0, op = opts.op) {
      const next = opts.links[index];
      if (!next) {
        throw new Error('No more links - did you forget an ending link?');
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

**Key insight**: Links form a chain where each link can:
1. Pass through to `next()` unchanged
2. Modify the operation before calling `next()`
3. Process the response from `next()` before returning
4. Short-circuit and not call `next()` at all

## Built-in Links

### 1. Transport Links (terminating)

| Link | File | Purpose |
|------|------|---------|
| `httpLink` | httpLink.ts | Single HTTP request per operation |
| `httpBatchLink` | httpBatchLink.ts | Batches multiple operations into one HTTP request |
| `httpBatchStreamLink` | httpBatchStreamLink.ts | Batching with JSONL streaming response |
| `httpSubscriptionLink` | httpSubscriptionLink.ts | SSE-based subscriptions |
| `wsLink` | wsLink/wsLink.ts | WebSocket transport |
| `unstable_localLink` | localLink.ts | Direct procedure invocation (no network) |

### 2. Middleware Links (non-terminating)

| Link | File | Purpose |
|------|------|---------|
| `loggerLink` | loggerLink.ts | Logs operations and results |
| `retryLink` | retryLink.ts | Retries failed operations |
| `splitLink` | splitLink.ts | Conditionally routes to different link chains |
| `dedupeLink` | internals/dedupeLink.ts | Deduplicates concurrent identical queries (internal) |

## Link Examples

### httpLink (transport/terminating)

```typescript
export function httpLink<TRouter extends AnyRouter>(
  opts: HTTPLinkOptions<TRouter['_def']['_config']['$types']>,
): TRPCLink<TRouter> {
  const resolvedOpts = resolveHTTPLinkOptions(opts);
  return () => {        // Runtime init phase
    return (operationOpts) => {   // Per-request phase
      const { op } = operationOpts;
      return observable((observer) => {
        // Make HTTP request
        const request = universalRequester({ ... });
        request
          .then((res) => {
            observer.next({ result: transformed.result });
            observer.complete();
          })
          .catch((cause) => observer.error(cause));
        
        return () => { /* cleanup */ };
      });
    };
  };
}
```

### splitLink (routing)

```typescript
export function splitLink<TRouter extends AnyRouter>(opts: {
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

### loggerLink (middleware)

```typescript
export function loggerLink<TRouter extends AnyRouter>(
  opts: LoggerLinkOptions<TRouter> = {},
): TRPCLink<TRouter> {
  return () => {
    return ({ op, next }) => {
      return observable((observer) => {
        // Log request going up
        logger({ ...op, direction: 'up' });
        
        // Call next link and tap the response
        return next(op)
          .pipe(
            tap({
              next(result) { logResult(result); },
              error(result) { logResult(result); },
            }),
          )
          .subscribe(observer);
      });
    };
  };
}
```

### retryLink (error handling)

```typescript
export function retryLink<TInferrable>(
  opts: RetryLinkOptions<TInferrable>,
): TRPCLink<TInferrable> {
  return () => {
    return (callOpts) => {
      return observable((observer) => {
        let attempts = 1;
        
        function attempt() {
          next$ = callOpts.next(callOpts.op).subscribe({
            error(error) {
              if (opts.retry({ op: callOpts.op, attempts, error })) {
                const delayMs = opts.retryDelayMs?.(attempts) ?? 0;
                setTimeout(() => attempt(attempts + 1), delayMs);
              } else {
                observer.error(error);
              }
            },
            next: observer.next,
            complete: observer.complete,
          });
        }
        
        attempt();
        return () => next$.unsubscribe();
      });
    };
  };
}
```

## Client Configuration

```typescript
const client = createTRPCClient<AppRouter>({
  links: [
    loggerLink(),
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({ url: '/api/trpc' }),
    }),
  ],
});
```

## Comparison with Our Transport

### Our Current Design (Transport/index.ts)

```typescript
// Single service interface
interface TransportService {
  send: (request: TransportRequest) => Effect<TransportResponse, TransportError>
  sendStream: (request: TransportRequest) => Stream<StreamResponse, TransportError>
}

// Transport as Context.Tag (single implementation)
class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}
```

### Key Differences

| Aspect | tRPC Links | Our Transport |
|--------|-----------|---------------|
| **Composability** | Chain of links, each wraps next | Single service, no chaining |
| **Middleware** | Links like `loggerLink`, `retryLink` | Would need separate Effect middleware |
| **Conditional routing** | `splitLink` for ws/http/etc | Single transport selection at config |
| **Observables** | Uses `@trpc/server/observable` | Uses Effect `Stream` |
| **Context passing** | `OperationContext` flows through | Headers in `TransportRequest` |
| **Error handling** | Links can retry/transform | Transport returns single error |

## Should We Adopt Links?

### Arguments FOR adopting links:

1. **Composability**: Links enable clean separation of concerns
   - Logging as a link
   - Retry logic as a link
   - Request tracing as a link
   
2. **Conditional routing**: Split link pattern is elegant
   ```typescript
   splitLink({
     condition: op => op.type === 'subscription',
     true: wsLink(...),
     false: httpLink(...),
   })
   ```

3. **Community familiarity**: tRPC users know this pattern

4. **Testing**: Can inject mock links anywhere in chain

### Arguments AGAINST adopting links:

1. **Effect already has middleware**: Effect's built-in composition handles:
   - Retry: `Effect.retry` with Schedule
   - Logging: `Effect.tap` + spans
   - Error handling: `Effect.catchTag` etc.
   
2. **Observable vs Effect/Stream mismatch**: Links use RxJS-style observables, not Effect
   - Would need to bridge or reimplement
   
3. **Complexity**: Links add conceptual overhead
   - Effect's layer system already provides composition
   
4. **Type complexity**: Link types are complex (TInferrable, TInput, TOutput)

## Recommended Approach

**Hybrid: Don't adopt links directly, but borrow the conditional routing concept**

### What to keep from our design:
- `Transport` as a single service tag
- Effect/Stream as the primitive
- Layer-based composition

### What to borrow from tRPC:
1. **Conditional transport selection** (like `splitLink`)
   ```typescript
   Transport.split({
     condition: (request) => request.tag.endsWith("/stream"),
     true: Transport.sse(url),
     false: Transport.http(url),
   })
   ```

2. **Middleware via Effect composition** (not links)
   ```typescript
   const withLogging = <A, E, R>(effect: Effect<A, E, R>) =>
     Effect.tap(effect, (a) => Effect.log("Response", a))
   
   const withRetry = <A, E, R>(effect: Effect<A, E, R>) =>
     Effect.retry(effect, Schedule.exponential(Duration.millis(100)))
   ```

3. **Operation context** concept
   - Our `TransportRequest` already has `headers`
   - Could add mutable `context` for middleware to decorate

### Implementation sketch:

```typescript
// Transport combinator for conditional selection
const split = <R1, R2>(
  condition: (request: TransportRequest) => boolean,
  onTrue: Layer.Layer<Transport, never, R1>,
  onFalse: Layer.Layer<Transport, never, R2>,
): Layer.Layer<Transport, never, R1 | R2> =>
  Layer.effect(
    Transport,
    Effect.gen(function* () {
      const trueTransport = yield* Effect.provide(Transport, onTrue)
      const falseTransport = yield* Effect.provide(Transport, onFalse)
      
      return {
        send: (request) =>
          (condition(request) ? trueTransport : falseTransport).send(request),
        sendStream: (request) =>
          (condition(request) ? trueTransport : falseTransport).sendStream(request),
      }
    })
  )
```

## Summary

tRPC's link system is elegant but designed around Observables and a different programming model. Our Effect-based design can achieve the same goals through:

1. **Layer composition** for transport selection
2. **Effect combinators** for retry, logging, etc.
3. **A `Transport.split` combinator** for conditional routing

We should NOT adopt the full link pattern because:
- Effect already provides better composition primitives
- Observable/Effect impedance mismatch
- Unnecessary complexity

We SHOULD adopt:
- The split/conditional routing concept
- Operation context for middleware decoration
- Multiple transport types (HTTP, WS, local) as interchangeable layers
