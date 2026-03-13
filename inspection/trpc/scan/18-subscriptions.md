# H18: Subscription Handling in tRPC

## Overview

tRPC supports real-time subscriptions through two transport mechanisms:
1. **WebSockets** - Bidirectional, persistent connection
2. **Server-Sent Events (SSE)** - Unidirectional HTTP streaming (recommended by tRPC for simplicity)

## Server-Side Implementation

### Procedure Definition

Subscriptions are defined using `.subscription()` on the procedure builder:

```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:408-423
subscription<$Output extends AsyncIterable<any, void, any>>(
  resolver: ProcedureResolver<TContext, TMeta, TContextOverrides, TInputOut, TOutputIn, $Output>,
): SubscriptionProcedure<{
  input: DefaultValue<TInputIn, void>;
  output: inferSubscriptionOutput<DefaultValue<TOutputOut, $Output>>;
  meta: TMeta;
}>;
```

### Two Return Types Supported

1. **AsyncIterable/AsyncGenerator** (recommended):
```typescript
t.procedure.subscription(async function* (opts) {
  for await (const [data] of on(ee, 'add', { signal: opts.signal })) {
    yield data;
  }
});
```

2. **Observable** (deprecated, removed in v12):
```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:424-444
subscription<$Output extends Observable<any, any>>(
  resolver: ...
): LegacyObservableSubscriptionProcedure<...>;
```

### The `tracked()` Helper

For automatic reconnection with state resumption:

```typescript
// packages/server/src/unstable-core-do-not-import/stream/tracked.ts
export function tracked<TData>(id: string, data: TData): TrackedEnvelope<TData> {
  if (id === '') {
    throw new Error('`id` must not be an empty string');
  }
  return [id as TrackedId, data, trackedSymbol];
}

export type TrackedEnvelope<TData> = [TrackedId, TData, typeof trackedSymbol];
```

Usage:
```typescript
yield tracked(post.id, post);  // Client can resume from last received ID
```

## Transport: WebSocket Adapter

### Server Handler

```typescript
// packages/server/src/adapters/ws.ts:110-570
export function getWSConnectionHandler<TRouter extends AnyRouter>(opts: WSSHandlerOptions<TRouter>) {
  return (client: ws.WebSocket, req: IncomingMessage) => {
    const clientSubscriptions = new Map<number | string, AbortController>();
    
    function handleRequest(msg: TRPCClientOutgoingMessage, batchIndex: number) {
      // Handle subscription.stop
      if (msg.method === 'subscription.stop') {
        clientSubscriptions.get(id)?.abort();
        return;
      }
      
      // Call procedure
      const result = await callTRPCProcedure({...});
      
      // For subscriptions, iterate the async iterable
      if (type === 'subscription') {
        const iterable = isObservable(result)
          ? observableToAsyncIterable(result, abortController.signal)
          : result;
          
        // Stream values to client
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          
          respond({
            id,
            jsonrpc,
            result: { type: 'data', data: next.value },
          });
        }
        
        respond({ id, jsonrpc, result: { type: 'stopped' } });
      }
    }
  };
}
```

### WebSocket Message Protocol (JSON-RPC 2.0)

**Client -> Server:**
- Request: `{ id, method: 'query'|'mutation'|'subscription', params: { path, input, lastEventId? } }`
- Stop subscription: `{ id, method: 'subscription.stop' }`

**Server -> Client:**
- Started: `{ id, result: { type: 'started' } }`
- Data: `{ id, result: { type: 'data', data, id? } }`
- Stopped: `{ id, result: { type: 'stopped' } }`
- Error: `{ id, error: TRPCErrorShape }`
- Reconnect notification: `{ id: null, method: 'reconnect' }`

### Keep-Alive / Heartbeat

```typescript
// packages/server/src/adapters/ws.ts:576-612
export function handleKeepAlive(client: ws.WebSocket, pingMs = 30_000, pongWaitMs = 5_000) {
  // Sends PING, expects PONG
  // Terminates connection if no response
}
```

## Transport: Server-Sent Events (SSE)

### SSE Stream Producer

```typescript
// packages/server/src/unstable-core-do-not-import/stream/sse.ts:85-199
export function sseStreamProducer<TValue>(opts: SSEStreamProducerOptions<TValue>) {
  async function* generator(): AsyncIterable<SSEvent, void> {
    // Initial connected event with client options
    yield { event: 'connected', data: JSON.stringify(client) };
    
    for await (value of iterable) {
      if (value === PING_SYM) {
        yield { event: 'ping', data: '' };
        continue;
      }
      
      // Handle tracked values
      chunk = isTrackedEnvelope(value)
        ? { id: value[0], data: value[1] }
        : { data: value };
      
      yield chunk;
    }
  }
  
  // Transform to SSE format: "event: ...\ndata: ...\nid: ...\n\n"
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

### SSE Event Types

| Event | Purpose |
|-------|---------|
| `connected` | Initial connection with client options |
| `message` | Default data event |
| `ping` | Keep-alive heartbeat |
| `serialized-error` | Error payload |
| `return` | Subscription completed |

### SSE Consumer (Client-Side)

```typescript
// packages/server/src/unstable-core-do-not-import/stream/sse.ts:279-447
export function sseStreamConsumer<TConfig>(opts: SSEStreamConsumerOptions<TConfig>) {
  return run(async function* () {
    await using stream = getStreamResource();
    
    while (true) {
      let promise = stream.read();
      
      // Handle timeout with reconnection
      if (timeoutMs) {
        promise = withTimeout({
          promise,
          timeoutMs,
          onTimeout: async () => {
            await stream.recreate();  // Reconnect
            return { type: 'timeout', ms: timeoutMs };
          },
        });
      }
      
      const result = await promise;
      if (result.done) return;
      yield result.value;
    }
  });
}
```

## Client-Side Links

### WebSocket Link

```typescript
// packages/client/src/links/wsLink/wsLink.ts
export function wsLink<TRouter extends AnyRouter>(opts: WebSocketLinkOptions<TRouter>): TRPCLink<TRouter> {
  return () => ({ op }) => observable((observer) => {
    const connStateSubscription = op.type === 'subscription'
      ? client.connectionState.subscribe({
          next(result) {
            observer.next({ result, context: op.context });
          },
        })
      : null;
    
    const requestSubscription = client.request({ op, transformer }).subscribe(observer);
    
    return () => {
      requestSubscription.unsubscribe();
      connStateSubscription?.unsubscribe();
    };
  });
}
```

### HTTP Subscription Link (SSE)

```typescript
// packages/client/src/links/httpSubscriptionLink.ts
export function httpSubscriptionLink<TInferrable, TEventSource>(opts) {
  return () => ({ op }) => observable((observer) => {
    let lastEventId: string | undefined = undefined;
    
    const eventSourceStream = sseStreamConsumer({
      url: async () => getUrl({
        input: inputWithTrackedEventId(input, lastEventId),
        ...
      }),
      EventSource: opts.EventSource ?? globalThis.EventSource,
      ...
    });
    
    for await (const chunk of eventSourceStream) {
      switch (chunk.type) {
        case 'data':
          if (chunkData.id) lastEventId = chunkData.id;  // Track for reconnection
          observer.next({ result });
          break;
        case 'connected':
          observer.next({ result: { type: 'started' } });
          break;
        case 'serialized-error':
          if (retryableRpcCodes.includes(chunk.error.code)) {
            // Will reconnect automatically
          } else {
            throw error;  // Non-retryable
          }
          break;
      }
    }
  });
}
```

### WebSocket Client State Machine

```typescript
// packages/client/src/links/internals/subscriptions.ts
export type TRPCConnectionState<TError> =
  | { state: 'idle'; error: null }
  | { state: 'connecting'; error: TError | null }
  | { state: 'pending'; error: null };
```

## React Integration

### useSubscription Hook

```typescript
// packages/tanstack-react-query/src/internals/subscriptionOptions.ts
export function useSubscription<TOutput, TError>(opts) {
  const [state, setState] = React.useState<TRPCSubscriptionResult>(...);
  
  const reset = useCallback(() => {
    const subscription = opts.subscribe({
      onStarted: () => updateState({ status: 'pending' }),
      onData: (data) => updateState({ status: 'pending', data }),
      onError: (error) => updateState({ status: 'error', error }),
      onConnectionStateChange: (result) => {
        // Handle connecting/pending/idle states
      },
    });
    
    currentSubscriptionRef.current = () => subscription.unsubscribe();
  }, [queryKey, enabled]);
  
  useEffect(() => {
    if (enabled) reset();
    return () => currentSubscriptionRef.current?.();
  }, [reset, enabled]);
  
  return state;
}

export type TRPCSubscriptionStatus = 'idle' | 'connecting' | 'pending' | 'error';
```

## Reconnection & Recovery

### Automatic Reconnection Flow

1. Client stores `lastEventId` from `tracked()` values
2. On disconnect, client reconnects with `lastEventId` in input
3. Server queries events since that ID
4. Client receives missed events seamlessly

```typescript
// Server-side pattern
.subscription(async function* (opts) {
  const iterable = ee.toIterable('add', { signal: opts.signal });
  
  // Replay missed events
  if (opts.input?.lastEventId) {
    const items = await db.post.findMany({ where: { id: { gt: lastEventId } } });
    for (const item of items) {
      yield tracked(item.id, item);
    }
  }
  
  // Continue with live events
  for await (const [data] of iterable) {
    yield tracked(data.id, data);
  }
});
```

### SSE Reconnection

- Browser's EventSource API automatically reconnects on disconnect
- Server can send `reconnectAfterInactivityMs` in connected event
- Client uses `Last-Event-ID` header (SSE spec) or query param

### WebSocket Reconnection

- Custom retry logic with configurable delay
- `broadcastReconnectNotification()` signals clients to reconnect after server restart
- Connection params preserved across reconnections

## Error Handling

### Server-Side

```typescript
// In subscription, throw to propagate error
.subscription(async function* (opts) {
  try {
    for await (const data of source) {
      yield data;
    }
  } finally {
    // Cleanup runs when client disconnects or error
  }
});
```

### Client-Side

- **5xx errors**: Automatic reconnection with `lastEventId`
- **4xx errors**: Subscription cancelled, error propagated to `onError`
- **Network errors**: Automatic reconnection (EventSource/WebSocket behavior)

## Configuration Options

### Server SSE Options

```typescript
// In initTRPC.create()
sse: {
  enabled: true,
  ping: { enabled: true, intervalMs: 1000 },
  maxDurationMs: 60000,  // Max subscription duration
  emitAndEndImmediately: false,  // For serverless
  client: { reconnectAfterInactivityMs: 10000 },
}
```

### WebSocket Options

```typescript
// WSSHandlerOptions
keepAlive: {
  enabled: true,
  pingMs: 30_000,
  pongWaitMs: 5_000,
}
```

## Key Design Patterns

1. **AsyncIterable as Primary Interface**: Modern v11+ uses async generators, converting legacy Observables internally
2. **TrackedEnvelope Pattern**: Tuple `[id, data, symbol]` enables automatic resumption
3. **AbortSignal Integration**: Subscriptions respect `opts.signal` for cleanup
4. **Transport Abstraction**: Same subscription code works with WS or SSE
5. **Observable Conversion**: Legacy Observable support via `observableToAsyncIterable()`

## Files Summary

| File | Purpose |
|------|---------|
| `procedureBuilder.ts:408-556` | `.subscription()` method definition |
| `adapters/ws.ts` | WebSocket server handler |
| `stream/sse.ts` | SSE producer/consumer |
| `stream/tracked.ts` | `tracked()` helper |
| `links/wsLink/` | WebSocket client link |
| `links/httpSubscriptionLink.ts` | SSE client link |
| `tanstack-react-query/internals/subscriptionOptions.ts` | React hook |
