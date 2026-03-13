# H18: tRPC Subscription Architecture

## Overview

tRPC subscriptions are real-time event streams between client and server. They support two transport mechanisms:
1. **WebSockets** - Full duplex, persistent connection
2. **Server-Sent Events (SSE)** - HTTP-based, unidirectional

## Server-Side Architecture

### Procedure Definition

Subscriptions are defined using async generators (preferred) or observables (deprecated):

```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:408-423
subscription<$Output extends AsyncIterable<any, void, any>>(
  resolver: ProcedureResolver<
    TContext,
    TMeta,
    TContextOverrides,
    TInputOut,
    TOutputIn,
    $Output
  >
): SubscriptionProcedure<{...}>

// Deprecated observable signature (to be removed in v12):
subscription<$Output extends Observable<any, any>>(
  resolver: ProcedureResolver<...>
): LegacyObservableSubscriptionProcedure<{...}>
```

### Procedure Resolver

The resolver receives standard options plus an `AbortSignal`:

```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:98-119
interface ProcedureResolverOptions<TContext, _TMeta, TContextOverridesIn, TInputOut> {
  ctx: Simplify<Overwrite<TContext, TContextOverridesIn>>;
  input: TInputOut extends UnsetMarker ? undefined : TInputOut;
  signal: AbortSignal | undefined;  // Key for cleanup
  path: string;
  batchIndex?: number;
}
```

## Middleware and Subscription Interaction

### How It Works

Middleware runs **before** the subscription resolver starts. The middleware chain executes synchronously before the async generator begins yielding values:

```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:634-696
async function callRecursive(index, _def, opts): Promise<MiddlewareResult> {
  const middleware = _def.middlewares[index]!;
  const result = await middleware({
    ...opts,
    next(_nextOpts?) {
      return callRecursive(index + 1, _def, {
        ...opts,
        ctx: nextOpts?.ctx ? { ...opts.ctx, ...nextOpts.ctx } : opts.ctx,
        input: nextOpts && 'input' in nextOpts ? nextOpts.input : opts.input,
      });
    },
  });
  return result;
}
```

**Key insight**: Middleware wraps the entire subscription call, not individual yielded values. The resolver middleware (added last) returns the async iterable:

```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:574-584
middlewares: [
  async function resolveMiddleware(opts) {
    const data = await resolver(opts);  // Returns AsyncIterable
    return {
      marker: middlewareMarker,
      ok: true,
      data,  // The async iterable is returned as data
      ctx: opts.ctx,
    } as const;
  },
]
```

### Middleware Execution Timeline

```
Request arrives
    |
    v
[Middleware 1] -> next()
    |
    v
[Middleware 2] -> next()
    |
    v
[Input validation middleware]
    |
    v
[Output validation middleware] <-- Wraps the AsyncIterable
    |
    v
[Resolver middleware] -> returns AsyncIterable
    |
    v
Middleware chain completes (returns AsyncIterable wrapped in MiddlewareResult)
    |
    v
Transport layer iterates over AsyncIterable
```

### Output Validation for Subscriptions

Output validation wraps the async iterable through a transformer:

```typescript
// From docs: zAsyncIterable pattern
zAsyncIterable({
  yield: z.object({ count: z.number() }),
  tracked: true,
}).transform(async function* (iter) {
  const iterator = iter[Symbol.asyncIterator]();
  try {
    let next;
    while ((next = await iterator.next()) && !next.done) {
      if (opts.tracked) {
        const [id, data] = trackedEnvelopeSchema.parse(next.value);
        yield tracked(id, await opts.yield.parseAsync(data));
        continue;
      }
      yield opts.yield.parseAsync(next.value);
    }
  } finally {
    await iterator.return?.();
  }
})
```

## Transport Implementations

### WebSocket Handler

```typescript
// packages/server/src/adapters/ws.ts:239-434
// Key flow:
if (msg.method === 'subscription.stop') {
  clientSubscriptions.get(id)?.abort();
  return;
}

// Call the procedure
const result = await callTRPCProcedure({
  router, path, getRawInput, ctx, type, signal: abortController.signal, batchIndex
});

// Validate result type
if (type !== 'subscription') {
  if (isIterableResult) throw new TRPCError({...});
  // Send data response
  return;
}

// Handle subscription result
const iterable = isObservable(result)
  ? observableToAsyncIterable(result, abortController.signal)
  : result;

// Iterate and send messages
while (true) {
  next = await Unpromise.race([
    iterator.next().catch(getTRPCErrorFromUnknown),
    abortPromise,
  ]);
  
  if (next === 'abort') {
    await iterator.return?.();
    break;
  }
  
  respond({ id, jsonrpc, result: { type: 'data', data: next.value } });
}

respond({ id, jsonrpc, result: { type: 'stopped' } });
```

### SSE Handler (HTTP)

```typescript
// packages/server/src/unstable-core-do-not-import/http/resolveResponse.ts:457-567
case 'subscription': {
  const iterable = run(() => {
    if (error) return errorToAsyncIterable(error);
    if (!experimentalSSE) return errorToAsyncIterable(...);
    
    const dataAsIterable = isObservable(result.data)
      ? observableToAsyncIterable(result.data, opts.req.signal)
      : result.data;
    return dataAsIterable;
  });

  const stream = sseStreamProducer({
    data: iterable,
    serialize: (v) => config.transformer.output.serialize(v),
    formatError(errorOpts) {
      // Format errors for SSE
    },
  });
  
  return new Response(stream, { headers: sseHeaders });
}
```

### SSE Stream Producer

```typescript
// packages/server/src/unstable-core-do-not-import/stream/sse.ts:85-199
function sseStreamProducer(opts) {
  async function* generator() {
    yield { event: CONNECTED_EVENT, data: JSON.stringify(client) };
    
    for await (value of iterable) {
      if (value === PING_SYM) {
        yield { event: PING_EVENT, data: '' };
        continue;
      }
      
      chunk = isTrackedEnvelope(value)
        ? { id: value[0], data: value[1] }
        : { data: value };
      
      yield chunk;
    }
  }
  
  // Convert to SSE format
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      if ('event' in chunk) controller.enqueue(`event: ${chunk.event}\n`);
      if ('data' in chunk) controller.enqueue(`data: ${chunk.data}\n`);
      if ('id' in chunk) controller.enqueue(`id: ${chunk.id}\n`);
      controller.enqueue('\n\n');
    },
  })).pipeThrough(new TextEncoderStream());
}
```

## Tracked Events for Reconnection

```typescript
// packages/server/src/unstable-core-do-not-import/stream/tracked.ts
export type TrackedEnvelope<TData> = [TrackedId, TData, typeof trackedSymbol];

export function tracked<TData>(id: string, data: TData): TrackedEnvelope<TData> {
  if (id === '') throw new Error('`id` must not be empty');
  return [id as TrackedId, data, trackedSymbol];
}

export function isTrackedEnvelope<TData>(value: unknown): value is TrackedEnvelope<TData> {
  return Array.isArray(value) && value[2] === trackedSymbol;
}
```

## Client-Side Implementation

### SSE Client (httpSubscriptionLink)

```typescript
// packages/client/src/links/httpSubscriptionLink.ts:65-240
export function httpSubscriptionLink(opts) {
  return () => ({ op }) => {
    return observable((observer) => {
      let lastEventId: string | undefined;
      const ac = new AbortController();
      
      const eventSourceStream = sseStreamConsumer({
        url: async () => getUrl({
          input: inputWithTrackedEventId(input, lastEventId),
          // ... 
        }),
        signal,
        EventSource: opts.EventSource ?? globalThis.EventSource,
      });
      
      for await (const chunk of eventSourceStream) {
        switch (chunk.type) {
          case 'data':
            if (chunkData.id) lastEventId = chunkData.id;  // Track for reconnect
            observer.next({ result });
            break;
          case 'connected':
            observer.next({ result: { type: 'started' } });
            break;
          case 'serialized-error':
            if (retryableRpcCodes.includes(chunk.error.code)) {
              // Auto-reconnect
              break;
            }
            throw TRPCClientError.from({ error: chunk.error });
        }
      }
    });
  };
}
```

### WebSocket Client

```typescript
// packages/client/src/links/wsLink/wsClient/wsClient.ts
class WsClient {
  public readonly connectionState: BehaviorSubject<TRPCConnectionState>;
  
  request({ op, transformer, lastEventId }) {
    return observable((observer) => {
      const abort = this.batchSend({
        id, method: type,
        params: { input, path, lastEventId }
      }, {
        next(event) {
          const transformed = transformResult(event, transformer.output);
          observer.next({ result: transformed.result });
        },
        // ...
      });
      
      return () => {
        abort();
        if (type === 'subscription' && this.activeConnection.isOpen()) {
          this.send({ id, method: 'subscription.stop' });
        }
      };
    });
  }
}
```

## Connection State Management

```typescript
// packages/client/src/links/internals/subscriptions.ts
export type TRPCConnectionState<TError> =
  | { type: 'state'; state: 'idle'; error: null }
  | { type: 'state'; state: 'connecting'; error: TError | null }
  | { type: 'state'; state: 'pending'; error: null };
```

## RPC Message Protocol

```typescript
// packages/server/src/unstable-core-do-not-import/rpc/envelopes.ts
// Subscription stop request
interface JSONRPC2.BaseRequest<'subscription.stop'> { id: JSONRPC2.RequestId }

// Response message types
type: 'started' | 'data' | 'stopped'
```

## Key Design Decisions

### 1. Async Generators as Primary API
- Observables deprecated (removal in v12)
- Native JavaScript async generators are simpler to understand
- Better TypeScript inference
- Natural cleanup with `finally` blocks

### 2. Middleware Runs Once Per Subscription
- Context and authentication validated at subscription start
- **Middleware does NOT wrap individual yielded values**
- Output validation (if any) wraps the entire async iterable

### 3. AbortSignal for Cleanup
- Passed through resolver options
- Used by adapters to cancel iteration
- Supports `try...finally` cleanup pattern

### 4. Tracked Events for Reliability
- `tracked(id, data)` helper enables resumption
- Client automatically reconnects with `lastEventId`
- Server can replay missed events

### 5. Transport Agnostic
- Same subscription procedure works with WS or SSE
- Observable-to-AsyncIterable conversion for backward compatibility

## Implications for effect-trpc

### Middleware + Streams Challenge

The key insight is that **tRPC middleware only runs once at subscription start**. It does not:
- Intercept each yielded value
- Run cleanup code after each yield
- Transform the stream inline

If effect-trpc needs middleware to interact with streams:
1. **Pre-stream execution**: Same as tRPC - run middleware before stream starts
2. **Stream wrapping**: Output middleware can wrap the entire stream (see `zAsyncIterable`)
3. **Per-value middleware**: Would require different approach - either:
   - Custom stream transformer pipeline
   - Integration with Effect's stream operators

### Recommended Approach

Follow tRPC's model:
1. Middleware establishes context (auth, logging setup, etc.)
2. Subscription resolver returns `Stream<...>`
3. Output validation (if needed) wraps stream with Effect schema validation
4. Transport layer (adapter) handles iteration and cleanup via AbortSignal

```typescript
// Conceptual effect-trpc approach
subscription: (resolver) => {
  // 1. Run middleware chain (Effect pipeline)
  // 2. Get Stream from resolver
  // 3. Optionally wrap with output validation
  // 4. Adapter iterates Stream, converts to SSE/WS
}
```
