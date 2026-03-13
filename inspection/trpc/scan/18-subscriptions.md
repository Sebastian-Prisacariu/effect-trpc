# H18: Subscriptions and Streaming in tRPC

## Executive Summary

tRPC supports real-time subscriptions through two transport mechanisms:
1. **WebSocket** (`wsLink`) - Full-duplex, bidirectional communication
2. **Server-Sent Events (SSE)** (`httpSubscriptionLink`) - HTTP-based, server-to-client streaming

Both support **async iterables** (recommended) and legacy **Observables** (deprecated in v12).

---

## 1. Subscription Procedure Definition

### Server-Side Definition

```typescript
// packages/server/src/unstable-core-do-not-import/procedureBuilder.ts:555

subscription(resolver: ProcedureResolver<any, any, any, any, any, any>) {
  return createResolver({ ..._def, type: 'subscription' }, resolver) as any;
}
```

Subscriptions must return either:
- `AsyncIterable<T>` (recommended) - async generators
- `Observable<T, E>` (deprecated) - converted internally to async iterable

### Procedure Types

```typescript
// packages/server/src/unstable-core-do-not-import/procedure.ts:5
export const procedureTypes = ['query', 'mutation', 'subscription'] as const;

// Types:
export interface SubscriptionProcedure<TDef extends BuiltProcedureDef>
  extends Procedure<'subscription', TDef> {}

export interface LegacyObservableSubscriptionProcedure<TDef>
  extends SubscriptionProcedure<TDef> {
  // Marked as deprecated
}
```

---

## 2. WebSocket Transport

### Message Protocol (JSON-RPC 2.0 Based)

Location: `packages/server/src/unstable-core-do-not-import/rpc/envelopes.ts`

#### Client Outgoing Messages

```typescript
// Request message
interface TRPCRequestMessage {
  id: number | string | null;
  jsonrpc?: '2.0';
  method: 'query' | 'mutation' | 'subscription';
  params: {
    path: string;
    input: unknown;
    lastEventId?: string;  // For resumption
  };
}

// Stop subscription
interface TRPCSubscriptionStopNotification {
  method: 'subscription.stop';
  id: number | string;
}
```

#### Server Response Messages

```typescript
// Result message
interface TRPCResultMessage<TData> {
  id: number | string;
  jsonrpc?: '2.0';
  result: 
    | { type: 'started'; data?: never }   // Subscription started
    | { type: 'stopped'; data?: never }   // Subscription ended
    | { type: 'data'; data: TData; id?: string }; // Data event
}

// Error response
interface TRPCErrorResponse {
  id: number | string;
  error: TRPCErrorShape;
}

// Server-initiated reconnect request
interface TRPCReconnectNotification {
  id: null;
  method: 'reconnect';
}
```

### WebSocket Adapter Implementation

Location: `packages/server/src/adapters/ws.ts`

```typescript
export function getWSConnectionHandler<TRouter extends AnyRouter>(
  opts: WSSHandlerOptions<TRouter>,
) {
  return (client: ws.WebSocket, req: IncomingMessage) => {
    // Track active subscriptions per client
    const clientSubscriptions = new Map<number | string, AbortController>();
    
    // Handle incoming messages
    client.on('message', (rawData, isBinary) => {
      // Parse JSON-RPC message
      const msgs = parseTRPCMessage(raw, transformer);
      
      for (const msg of msgs) {
        if (msg.method === 'subscription.stop') {
          // Abort the subscription
          clientSubscriptions.get(msg.id)?.abort();
        } else {
          // Handle procedure call
          handleRequest(msg);
        }
      }
    });
    
    // On client disconnect, abort all subscriptions
    client.once('close', () => {
      for (const sub of clientSubscriptions.values()) {
        sub.abort();
      }
    });
  };
}
```

#### Subscription Lifecycle (Server)

```typescript
// packages/server/src/adapters/ws.ts:276-425

// 1. Call procedure
const result = await callTRPCProcedure({ router, path, ... });

// 2. Validate it's an iterable
const iterable = isObservable(result)
  ? observableToAsyncIterable(result, abortController.signal)
  : result;

// 3. Send 'started' notification
respond({ id, result: { type: 'started' } });

// 4. Stream values
await using iterator = iteratorResource(iterable);
while (true) {
  const next = await Unpromise.race([
    iterator.next().catch(getTRPCErrorFromUnknown),
    abortPromise,
  ]);
  
  if (next === 'abort' || next.done) break;
  
  // Support tracked envelopes for resumption
  if (isTrackedEnvelope(next.value)) {
    const [id, data] = next.value;
    respond({ id, result: { type: 'data', data: { id, data }, id } });
  } else {
    respond({ id, result: { type: 'data', data: next.value } });
  }
}

// 5. Send 'stopped' notification
respond({ id, result: { type: 'stopped' } });
```

### Keep-Alive / Heartbeat

```typescript
// packages/server/src/adapters/ws.ts:574-612

export function handleKeepAlive(
  client: ws.WebSocket,
  pingMs = 30_000,
  pongWaitMs = 5_000,
) {
  const schedulePing = () => {
    ping = setTimeout(() => {
      client.send('PING');
      timeout = setTimeout(() => client.terminate(), pongWaitMs);
    }, pingMs);
  };
  
  client.on('message', () => {
    clearTimeout(ping);
    clearTimeout(timeout);
    schedulePing();
  });
}
```

---

## 3. Server-Sent Events (SSE) Transport

### SSE Stream Producer

Location: `packages/server/src/unstable-core-do-not-import/stream/sse.ts`

```typescript
export function sseStreamProducer<TValue>(opts: SSEStreamProducerOptions<TValue>) {
  async function* generator(): AsyncIterable<SSEvent, void> {
    // 1. Send connected event with client options
    yield {
      event: 'connected',
      data: JSON.stringify(clientOptions),
    };
    
    // 2. Stream data with optional ping
    for await (const value of iterable) {
      if (value === PING_SYM) {
        yield { event: 'ping', data: '' };
        continue;
      }
      
      // Support tracked envelopes (id field for resumption)
      const chunk = isTrackedEnvelope(value)
        ? { id: value[0], data: value[1] }
        : { data: value };
      
      yield chunk;
    }
    
    // 3. Send return event to signal completion
    yield { event: 'return', data: '' };
  }
  
  // Transform to SSE wire format
  return stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      if ('event' in chunk) controller.enqueue(`event: ${chunk.event}\n`);
      if ('data' in chunk) controller.enqueue(`data: ${chunk.data}\n`);
      if ('id' in chunk) controller.enqueue(`id: ${chunk.id}\n`);
      controller.enqueue('\n\n');
    },
  }));
}
```

### SSE Event Types

| Event | Purpose |
|-------|---------|
| `connected` | Initial handshake, sends client config |
| `message` (default) | Data payload |
| `ping` | Keep-alive heartbeat |
| `serialized-error` | Error from server |
| `return` | Stream completed normally |

### SSE Headers

```typescript
export const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
  'Connection': 'keep-alive',
} as const;
```

### SSE Consumer (Client)

Location: `packages/server/src/unstable-core-do-not-import/stream/sse.ts:279-447`

```typescript
export function sseStreamConsumer<TConfig>(opts: SSEStreamConsumerOptions<TConfig>)
  : AsyncIterable<ConsumerStreamResult<TConfig>> 
{
  return run(async function* () {
    const eventSource = new opts.EventSource(url, init);
    
    eventSource.addEventListener('connected', (msg) => {
      // Parse client options
      controller.enqueue({ type: 'connected', options: JSON.parse(msg.data) });
    });
    
    eventSource.addEventListener('message', (msg) => {
      // Data event
      controller.enqueue({ type: 'data', data: deserialize(JSON.parse(msg.data)) });
    });
    
    eventSource.addEventListener('serialized-error', (msg) => {
      controller.enqueue({ type: 'serialized-error', error: JSON.parse(msg.data) });
    });
    
    eventSource.addEventListener('return', () => {
      eventSource.close();
      controller.close();
    });
    
    // Support timeout and reconnection
    while (true) {
      const result = await withTimeout({
        promise: stream.read(),
        timeoutMs: clientOptions.reconnectAfterInactivityMs,
        onTimeout: async () => ({ type: 'timeout', ms: timeoutMs }),
      });
      
      if (result.done) return;
      yield result.value;
    }
  });
}
```

---

## 4. Tracked Envelopes (Resumption Support)

Location: `packages/server/src/unstable-core-do-not-import/stream/tracked.ts`

```typescript
// Create a tracked envelope for resumable subscriptions
export function tracked<TData>(id: string, data: TData): TrackedEnvelope<TData> {
  return [id as TrackedId, data, trackedSymbol];
}

// Type for tracked data received by client
export interface TrackedData<TData> {
  id: string;    // Event ID for resumption
  data: TData;   // Actual payload
}
```

### Usage Example

```typescript
// Server
t.procedure.subscription(async function* ({ input }) {
  let cursor = input.lastEventId ?? 0;
  while (true) {
    const data = await getNextEvent(cursor);
    yield tracked(String(cursor++), data);  // <-- tracked for resumption
  }
});

// Client automatically tracks lastEventId and sends on reconnect
```

---

## 5. Client Implementation

### WebSocket Client

Location: `packages/client/src/links/wsLink/wsClient/wsClient.ts`

```typescript
export class WsClient {
  public readonly connectionState: BehaviorSubject<TRPCConnectionState>;
  
  public request({ op, transformer, lastEventId }) {
    return observable((observer) => {
      const abort = this.batchSend(
        {
          id: op.id,
          method: op.type,
          params: {
            input: transformer.input.serialize(op.input),
            path: op.path,
            lastEventId,  // For resumption
          },
        },
        {
          next(event) {
            observer.next({ result: transformResult(event) });
          },
          error: observer.error,
          complete: observer.complete,
        }
      );
      
      return () => {
        abort();
        // Send subscription.stop on unsubscribe
        if (op.type === 'subscription') {
          this.send({ id: op.id, method: 'subscription.stop' });
        }
      };
    });
  }
}
```

### HTTP Subscription Link (SSE Client)

Location: `packages/client/src/links/httpSubscriptionLink.ts`

```typescript
export function httpSubscriptionLink<TInferrable>(opts) {
  return () => ({ op }) => {
    return observable((observer) => {
      let lastEventId: string | undefined;
      
      const eventSourceStream = sseStreamConsumer({
        url: () => getUrl({ input: inputWithTrackedEventId(input, lastEventId), ... }),
        deserialize: transformer.output.deserialize,
        EventSource: opts.EventSource ?? globalThis.EventSource,
      });
      
      for await (const chunk of eventSourceStream) {
        switch (chunk.type) {
          case 'data':
            if (chunk.data.id) lastEventId = chunk.data.id;  // Track for resumption
            observer.next({ result: { data: chunk.data } });
            break;
          case 'connected':
            observer.next({ result: { type: 'started' } });
            break;
          case 'serialized-error':
            // Handle error, possibly retry
            break;
        }
      }
      
      return () => ac.abort();
    });
  };
}
```

---

## 6. Connection State Management

```typescript
// packages/client/src/links/internals/subscriptions.ts

export type TRPCConnectionState<TError> =
  | { type: 'state'; state: 'idle'; error: null }
  | { type: 'state'; state: 'connecting'; error: TError | null }
  | { type: 'state'; state: 'pending'; error: null };
```

Connection states are emitted alongside subscription data:
- `idle` - Not connected
- `connecting` - Establishing connection (may include error from previous attempt)
- `pending` - Connected and ready

---

## 7. JSON Lines Streaming (Batch Streaming)

Location: `packages/server/src/unstable-core-do-not-import/stream/jsonl.ts`

Used by `httpBatchStreamLink` for streaming batch responses. Handles:
- Promises that resolve later
- AsyncIterables within response objects
- Nested async values

Wire format: JSON Lines (newline-delimited JSON)

---

## 8. Implementation Recommendations for effect-trpc

### Transport Layer

1. **Use Effect.Stream** for subscription data flow
   - Natural fit for async iterables
   - Built-in resource management
   - Composable with other Effect primitives

2. **WebSocket Support**
   - Use `@effect/platform` WebSocket primitives
   - Model connection state as Effect state machine
   - Track subscriptions with Effect Ref/Map

3. **SSE Support**
   - Use `@effect/platform` HTTP streaming
   - Consider `EventSource` polyfill for non-browser

### Protocol Mapping

```typescript
// Effect-native subscription type
type Subscription<A, E> = Effect.Effect<
  Stream.Stream<A, E>,  // The actual subscription stream
  SubscriptionError,     // Setup errors
  SubscriptionContext    // Dependencies
>

// Or using @effect/rpc patterns
const subscription = Rpc.streamProcedure(
  'chat.onMessage',
  Schema.Struct({ roomId: Schema.String }),
  Schema.Struct({ message: Schema.String, from: Schema.String }),
)
```

### Connection State

```typescript
// Model as Effect discriminated union
type ConnectionState<E> = Data.TaggedEnum<{
  Idle: {}
  Connecting: { error: Option.Option<E> }
  Connected: {}
  Disconnected: { error: E }
}>
```

### Tracked Events (Resumption)

```typescript
// Schema for tracked events
const TrackedEvent = <A>(schema: Schema.Schema<A>) =>
  Schema.Struct({
    id: Schema.String,
    data: schema,
  })

// Usage in subscription
yield* Stream.fromAsyncIterable(
  async function* () {
    for (const event of events) {
      yield { id: event.cursor, data: event.payload }
    }
  },
  identity
)
```

### Key Differences from Vanilla tRPC

| Aspect | Vanilla tRPC | effect-trpc |
|--------|--------------|-------------|
| Return type | `AsyncIterable<T>` | `Stream.Stream<A, E, R>` |
| Error handling | Try/catch | Effect error channel |
| Cancellation | AbortSignal | Effect interruption |
| Connection state | Observable | Effect state |
| Resumption | Manual `lastEventId` | Could be automatic with Effect Ref |

---

## 9. Protocol Summary

### WebSocket Message Flow

```
Client                              Server
  |                                   |
  |-- subscription request ---------->|
  |                                   |
  |<--------- { type: 'started' } ----|
  |                                   |
  |<--------- { type: 'data', ... } --|  (multiple)
  |<--------- { type: 'data', ... } --|
  |                                   |
  |-- subscription.stop ------------->|  (client unsubscribe)
  |                                   |
  |<--------- { type: 'stopped' } ----|
```

### SSE Event Flow

```
Client                              Server
  |                                   |
  |-- GET /trpc/sub?input=... ------->|
  |                                   |
  |<--- event: connected -------------|
  |<--- data: {"reconnectAfter":...} -|
  |                                   |
  |<--- data: {"id":"1","data":...} --|  (tracked)
  |<--- event: ping ------------------|  (keepalive)
  |<--- data: {"id":"2","data":...} --|
  |                                   |
  |<--- event: return ----------------|  (normal end)
  |   or                              |
  |<--- event: serialized-error ------|  (error end)
```

---

## 10. Files Analyzed

- `packages/server/src/unstable-core-do-not-import/stream/sse.ts` - SSE producer/consumer
- `packages/server/src/unstable-core-do-not-import/stream/tracked.ts` - Event tracking
- `packages/server/src/unstable-core-do-not-import/stream/jsonl.ts` - JSON Lines streaming
- `packages/server/src/unstable-core-do-not-import/rpc/envelopes.ts` - Wire protocol types
- `packages/server/src/adapters/ws.ts` - WebSocket adapter
- `packages/client/src/links/wsLink/wsClient/wsClient.ts` - WS client
- `packages/client/src/links/httpSubscriptionLink.ts` - SSE client link
- `packages/server/src/unstable-core-do-not-import/procedureBuilder.ts` - Subscription builder
