# tRPC Link Architecture Analysis

## Overview

tRPC's link system is a **middleware chain pattern** for client-side request processing. Links are composable, chainable units that can intercept, transform, batch, retry, or terminate requests.

## Core Type Definitions

### Operation

```typescript
// packages/client/src/links/types.ts:26-33
type Operation<TInput = unknown> = {
  id: number;
  type: 'mutation' | 'query' | 'subscription';
  input: TInput;
  path: string;
  context: OperationContext;
  signal: Maybe<AbortSignal>;
};
```

### OperationLink (The Chain Unit)

```typescript
// packages/client/src/links/types.ts:95-104
type OperationLink<TInferrable, TInput = unknown, TOutput = unknown> = (opts: {
  op: Operation<TInput>;
  next: (op: Operation<TInput>) => OperationResultObservable<TInferrable, TOutput>;
}) => OperationResultObservable<TInferrable, TOutput>;
```

Key insight: Each link receives:
- `op`: The current operation
- `next`: A function to call the next link in the chain

### TRPCLink (Factory Function)

```typescript
// packages/client/src/links/types.ts:109-111
type TRPCLink<TInferrable> = (
  opts: TRPCClientRuntime,
) => OperationLink<TInferrable>;
```

Links are factory functions that return `OperationLink`. This two-phase initialization allows:
1. **Config phase**: Initialize with runtime configuration
2. **Request phase**: Process individual operations

## Chain Execution

### createChain Implementation

```typescript
// packages/client/src/links/internals/createChain.ts:10-40
function createChain<TRouter, TInput, TOutput>(opts: {
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

**Pattern**: Recursive execution with index tracking. Each link can:
- Call `next(op)` to continue the chain
- Modify `op` before passing to `next`
- Handle responses from `next`
- Short-circuit and not call `next` (terminating links)

## Link Categories

### 1. Terminating Links (Must Be Last)

These links make actual requests and don't call `next`:

| Link | Purpose | Protocol |
|------|---------|----------|
| `httpLink` | Single HTTP requests | HTTP |
| `httpBatchLink` | Batched HTTP requests | HTTP |
| `httpBatchStreamLink` | Streaming batched requests | HTTP/SSE |
| `wsLink` | WebSocket transport | WebSocket |
| `httpSubscriptionLink` | SSE subscriptions | HTTP/SSE |
| `localLink` | In-process calls (no network) | Direct |

### 2. Middleware Links (Can Be Anywhere)

These links process and forward:

| Link | Purpose |
|------|---------|
| `loggerLink` | Request/response logging |
| `retryLink` | Automatic retry on failure |
| `splitLink` | Conditional routing |
| `dedupeLink` | Deduplicate concurrent queries |

## Detailed Link Analysis

### httpLink (Terminating)

```typescript
// packages/client/src/links/httpLink.ts:75-142
export function httpLink<TRouter extends AnyRouter>(
  opts: HTTPLinkOptions<TRouter['_def']['_config']['$types']>,
): TRPCLink<TRouter> {
  const resolvedOpts = resolveHTTPLinkOptions(opts);
  return () => {
    return (operationOpts) => {
      const { op } = operationOpts;
      return observable((observer) => {
        // Does NOT call next() - terminates the chain
        const request = universalRequester({ ... });
        request.then((res) => {
          observer.next({ context: res.meta, result: transformed.result });
          observer.complete();
        });
        return () => { /* cleanup */ };
      });
    };
  };
}
```

### loggerLink (Middleware)

```typescript
// packages/client/src/links/loggerLink.ts:214-267
export function loggerLink<TRouter extends AnyRouter>(
  opts: LoggerLinkOptions<TRouter> = {},
): TRPCLink<TRouter> {
  return () => {
    return ({ op, next }) => {
      return observable((observer) => {
        // Log request going up
        logger({ ...op, direction: 'up' });
        
        // Continue chain and observe response
        return next(op)
          .pipe(
            tap({
              next(result) { logger({ ...op, direction: 'down', result }); },
              error(result) { logger({ ...op, direction: 'down', result }); },
            }),
          )
          .subscribe(observer);
      });
    };
  };
}
```

### splitLink (Conditional Router)

```typescript
// packages/client/src/links/splitLink.ts:9-30
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

### retryLink (Error Handling)

```typescript
// packages/client/src/links/retryLink.ts:39-117
export function retryLink<TInferrable>(
  opts: RetryLinkOptions<TInferrable>,
): TRPCLink<TInferrable> {
  return () => {
    return (callOpts) => {
      return observable((observer) => {
        function attempt(attempts: number) {
          next$ = callOpts.next(op).subscribe({
            error(error) {
              const shouldRetry = opts.retry({ op, attempts, error });
              if (!shouldRetry) {
                observer.error(error);
                return;
              }
              // Retry with delay
              callNextTimeout = setTimeout(() => attempt(attempts + 1), delayMs);
            },
            next(envelope) { observer.next(envelope); },
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

### dedupeLink (Request Deduplication)

```typescript
// packages/client/src/links/internals/dedupeLink.ts:11-56
export function dedupeLink<TRouter>(): TRPCLink<TRouter> {
  return () => {
    const pending: Record<string, Observable<any, any>> = {};
    return ({ op, next }) => {
      if (op.type !== 'query') {
        return next(op);  // Only dedupe queries
      }
      const key = JSON.stringify([op.path, op.input]);
      const obs$ = pending[key];
      if (obs$) {
        return observable((observer) => obs$.subscribe(observer));
      }
      const shared$ = observable((observer) => {
        const subscription = next(op).subscribe({ ... });
        return () => { delete pending[key]; subscription.unsubscribe(); };
      }).pipe(share());
      pending[key] = shared$;
      return shared$;
    };
  };
}
```

## Client Integration

### TRPCUntypedClient

```typescript
// packages/client/src/internals/TRPCUntypedClient.ts:47-77
export class TRPCUntypedClient<TInferrable> {
  private readonly links: OperationLink<TInferrable>[];
  
  constructor(opts: CreateTRPCClientOptions<TInferrable>) {
    // Initialize links (config phase)
    this.links = opts.links.map((link) => link(this.runtime));
  }
  
  private $request<TInput, TOutput>(opts: { ... }) {
    // Execute chain for each request
    const chain$ = createChain<AnyRouter, TInput, TOutput>({
      links: this.links as OperationLink<any, any, any>[],
      op: { ...opts, context: opts.context ?? {}, id: ++this.requestId },
    });
    return chain$.pipe(share());
  }
}
```

## Observable-Based Design

tRPC uses `@trpc/server/observable` for reactive streams:

- **Queries/Mutations**: Single emission, then complete
- **Subscriptions**: Multiple emissions over time
- **Error handling**: Propagated through observable error channel
- **Cancellation**: Cleanup via unsubscribe

## Typical Link Chains

### Standard HTTP

```typescript
createTRPCClient({
  links: [
    loggerLink(),      // Middleware: logging
    httpLink({ url }), // Terminating: HTTP transport
  ],
});
```

### With Batching and Retry

```typescript
createTRPCClient({
  links: [
    loggerLink(),
    retryLink({ retry: (opts) => opts.attempts < 3 }),
    httpBatchLink({ url, maxURLLength: 2000 }),
  ],
});
```

### Split by Operation Type

```typescript
createTRPCClient({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({ url }),
    }),
  ],
});
```

## Key Design Patterns

### 1. Two-Phase Initialization

```
TRPCLink (config) -> OperationLink (per-request)
```

Benefits:
- Share state across requests (connection pools, caches)
- Configure once, execute many

### 2. Observable for All Operations

Even request/response operations use observables:
- Unified API for queries, mutations, subscriptions
- Built-in cancellation support
- Composable with RxJS-style operators

### 3. Explicit Chain Termination

Chain **must** end with a terminating link. Error thrown if `next()` called with no more links:

```typescript
if (!next) {
  throw new Error('No more links to execute - did you forget to add an ending link?');
}
```

### 4. Context Propagation

Operations carry a mutable `context` object through the chain:
- Links can add metadata
- Downstream links can access upstream additions
- Response includes final context state

## Comparison: Effect-tRPC Considerations

### Current Effect-tRPC: Single Transport

Effect-tRPC currently has a single `Transport` abstraction without composable links.

### Potential Link-Like Patterns in Effect

| tRPC Pattern | Effect Equivalent |
|--------------|-------------------|
| Observable chain | Effect.gen with yield* |
| Middleware link | Effect.tap / Effect.flatMap |
| Error handling | Effect.catchTag / Effect.retry |
| Conditional routing | Effect.if / Effect.match |
| Context propagation | Effect Context (R) |

### Key Questions for Effect-tRPC

1. **Do we need observable semantics?**
   - Effect streams handle subscriptions
   - Request/response can be plain Effects

2. **How do we handle batching?**
   - Effect has `Effect.all` for parallel execution
   - DataLoader pattern possible with refs

3. **What's the unit of composition?**
   - tRPC: `OperationLink` wrapping observables
   - Effect: Could be `Effect<A, E, R>` transformer

4. **Where does state live?**
   - tRPC: Closure in link factory
   - Effect: Service layer (Ref, ScopedRef)

## Recommendation

The link pattern provides valuable extensibility. For Effect-tRPC, consider:

1. **Layer-based middleware**: Use Effect layers for logging, retry, etc.
2. **Transport abstraction**: Keep single transport, but make it pluggable
3. **Effect composition**: Chain transformations via Effect operators
4. **Explicit subscription handling**: Separate API for streams vs request/response

The Observable-based approach in tRPC is elegant but may add complexity when Effect already provides similar capabilities through its native constructs.
