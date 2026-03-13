# H5: Effect RPC Transport Protocols

## Summary

Effect RPC supports **6 transport protocols** through a pluggable `Protocol` abstraction:

| Transport | Streaming | Ack | Transferables | Span Propagation |
|-----------|-----------|-----|---------------|------------------|
| HTTP (POST) | Partial | No | No | No |
| WebSocket | Full | Yes | No | Yes |
| Socket Server | Full | Yes | No | Yes |
| Worker | Full | Yes | Yes | Yes |
| Stdio | Full | Yes | No | Yes |
| Custom | Configurable | Configurable | Configurable | Configurable |

## Protocol Abstraction

Effect RPC uses a `Protocol` Context.Tag that abstracts transport concerns:

```typescript
// RpcClient.ts:816-831
class Protocol extends Context.Tag("@effect/rpc/RpcClient/Protocol")<Protocol, {
  readonly run: (
    f: (data: FromServerEncoded) => Effect.Effect<void>
  ) => Effect.Effect<never>
  readonly send: (
    request: FromClientEncoded,
    transferables?: ReadonlyArray<globalThis.Transferable>
  ) => Effect.Effect<void, RpcClientError>
  readonly supportsAck: boolean
  readonly supportsTransferables: boolean
}>()

// RpcServer.ts:793-814
class Protocol extends Context.Tag("@effect/rpc/RpcServer/Protocol")<Protocol, {
  readonly run: (
    f: (clientId: number, data: FromClientEncoded) => Effect.Effect<void>
  ) => Effect.Effect<never>
  readonly disconnects: Mailbox.ReadonlyMailbox<number>
  readonly send: (
    clientId: number,
    response: FromServerEncoded,
    transferables?: ReadonlyArray<globalThis.Transferable>
  ) => Effect.Effect<void>
  readonly end: (clientId: number) => Effect.Effect<void>
  readonly clientIds: Effect.Effect<ReadonlySet<number>>
  readonly initialMessage: Effect.Effect<Option.Option<unknown>>
  readonly supportsAck: boolean
  readonly supportsTransferables: boolean
  readonly supportsSpanPropagation: boolean
}>()
```

## Transport Implementations

### 1. HTTP Transport (POST-based)

**Location:** `RpcClient.ts:837-929`, `RpcServer.ts:945-1124`

```typescript
// Client
export const makeProtocolHttp = (client: HttpClient.HttpClient): Effect.Effect<
  Protocol["Type"],
  never,
  RpcSerialization.RpcSerialization
>

export const layerProtocolHttp = (options: {
  readonly url: string
  readonly transformClient?: <E, R>(client: HttpClient.HttpClient.With<E, R>) => HttpClient.HttpClient.With<E, R>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | HttpClient.HttpClient>
```

**Characteristics:**
- Request/response per procedure call
- JSON or streaming (NDJSON) body
- **No acknowledgments** (`supportsAck: false`)
- **No transferables** (`supportsTransferables: false`)
- **No span propagation** (`supportsSpanPropagation: false`)
- Supports streaming responses via HTTP streaming

### 2. WebSocket Transport

**Location:** `RpcClient.ts:935-1069`, `RpcServer.ts:820-939`

```typescript
// Client
export const makeProtocolSocket = (options?: {
  readonly retryTransientErrors?: boolean | undefined
  readonly retrySchedule?: Schedule.Schedule<any, Socket.SocketError> | undefined
}): Effect.Effect<
  Protocol["Type"],
  never,
  Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket
>

// Server
export const layerProtocolWebsocket = <I = HttpRouter.Default>(options: {
  readonly path: HttpRouter.PathInput
  readonly routerTag?: HttpRouter.HttpRouter.TagClass<I, string, any, any>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization>
```

**Characteristics:**
- Full duplex communication
- **Supports acknowledgments** (`supportsAck: true`)
- **No transferables** (`supportsTransferables: false`)
- **Supports span propagation** (`supportsSpanPropagation: true`)
- Built-in ping/pong for keepalive (10 second interval)
- Automatic reconnection with exponential backoff
- Integrates with HttpRouter or HttpLayerRouter

### 3. Socket Server Transport

**Location:** `RpcServer.ts:820-840`

```typescript
export const makeProtocolSocketServer: Effect.Effect<
  Protocol["Type"],
  never,
  RpcSerialization.RpcSerialization | SocketServer.SocketServer
>

export const layerProtocolSocketServer: Layer.Layer<
  Protocol,
  never,
  RpcSerialization.RpcSerialization | SocketServer.SocketServer
>
```

**Characteristics:**
- Server-side socket handling
- Multi-client support via `clientId`
- **Supports acknowledgments** (`supportsAck: true`)
- **Supports span propagation** (`supportsSpanPropagation: true`)

### 4. Worker Transport (Web Workers / Node Workers)

**Location:** `RpcClient.ts:1075-1239`, `RpcServer.ts:1130-1191`

```typescript
// Client
export const makeProtocolWorker = (
  options: {
    readonly size: number
    readonly concurrency?: number | undefined
    readonly targetUtilization?: number | undefined
  } | {
    readonly minSize: number
    readonly maxSize: number
    readonly concurrency?: number | undefined
    readonly targetUtilization?: number | undefined
    readonly timeToLive: Duration.DurationInput
  }
): Effect.Effect<
  Protocol["Type"],
  WorkerError,
  Scope.Scope | Worker.PlatformWorker | Worker.Spawner
>

// Server (Worker Runner)
export const makeProtocolWorkerRunner: Effect.Effect<
  Protocol["Type"],
  WorkerError,
  WorkerRunner.PlatformRunner | Scope.Scope
>
```

**Characteristics:**
- Worker pool management with fixed or dynamic sizing
- **Supports acknowledgments** (`supportsAck: true`)
- **Supports transferables** (`supportsTransferables: true`) - Structured cloning + transfer
- **Supports span propagation** (`supportsSpanPropagation: true`)
- Initial message support for worker configuration
- Auto-scaling based on target utilization

### 5. Stdio Transport (Standard I/O)

**Location:** `RpcServer.ts:1343-1412`

```typescript
export const makeProtocolStdio = Effect.fnUntraced(function*<EIn, EOut, RIn, ROut>(options: {
  readonly stdin: Stream.Stream<Uint8Array, EIn, RIn>
  readonly stdout: Sink.Sink<void, Uint8Array | string, unknown, EOut, ROut>
})

export const layerProtocolStdio = <EIn, EOut, RIn, ROut>(options: {
  readonly stdin: Stream.Stream<Uint8Array, EIn, RIn>
  readonly stdout: Sink.Sink<void, Uint8Array | string, unknown, EOut, ROut>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | RIn | ROut>
```

**Characteristics:**
- Stream-based I/O for CLI tools and subprocess communication
- **Supports acknowledgments** (`supportsAck: true`)
- **No transferables** (`supportsTransferables: false`)
- **Supports span propagation** (`supportsSpanPropagation: true`)
- Single client (clientId: 0)

## Serialization Formats

Effect RPC provides pluggable serialization via `RpcSerialization`:

```typescript
// RpcSerialization.ts:14-18
export class RpcSerialization extends Context.Tag("@effect/rpc/RpcSerialization")<RpcSerialization, {
  unsafeMake(): Parser
  readonly contentType: string
  readonly includesFraming: boolean
}>() {}
```

### Available Formats

| Format | Content-Type | Framing | Binary | Use Case |
|--------|-------------|---------|--------|----------|
| `json` | application/json | No | No | HTTP single request |
| `ndjson` | application/ndjson | Yes | No | HTTP streaming |
| `jsonRpc` | application/json | No | No | JSON-RPC compatibility |
| `ndJsonRpc` | application/json-rpc | Yes | No | Streaming JSON-RPC |
| `msgPack` | application/msgpack | Yes | Yes | Compact binary |

```typescript
// Layer constructors
export const layerJson: Layer.Layer<RpcSerialization>
export const layerNdjson: Layer.Layer<RpcSerialization>
export const layerJsonRpc: (options?: { contentType?: string }) => Layer.Layer<RpcSerialization>
export const layerNdJsonRpc: (options?: { contentType?: string }) => Layer.Layer<RpcSerialization>
export const layerMsgPack: Layer.Layer<RpcSerialization>
```

## Streaming Support

Effect RPC has first-class streaming support via `RpcSchema.Stream`:

```typescript
// RpcSchema.ts:48-57
export interface Stream<A extends Schema.Schema.Any, E extends Schema.Schema.All> extends
  Schema.Schema<
    Stream_.Stream<A["Type"], E["Type"]>,
    Stream_.Stream<A["Encoded"], E["Encoded"]>,
    A["Context"] | E["Context"]
  >
{
  readonly success: A
  readonly failure: E
}
```

**Streaming protocol features:**
- Chunked responses via `ResponseChunk` messages
- Acknowledgment mechanism for flow control (when `supportsAck: true`)
- Stream interruption support
- Error propagation within streams

```typescript
// Message types for streaming
interface ResponseChunk<A extends Rpc.Any> {
  readonly _tag: "Chunk"
  readonly clientId: number
  readonly requestId: RequestId
  readonly values: NonEmptyReadonlyArray<Rpc.SuccessChunk<A>>
}

interface Ack {
  readonly _tag: "Ack"
  readonly requestId: RequestId
}
```

## Server-Sent Events (SSE) Support

**Not directly supported.** Effect RPC uses:
- HTTP streaming with NDJSON for unidirectional streaming
- WebSocket for bidirectional streaming

SSE could be implemented as a custom protocol, but the current architecture favors WebSocket for real-time scenarios.

## WebSocket Details

**Client connection flow:**
1. Connect via `Socket.Socket`
2. Send serialized `Request` messages
3. Receive `ResponseChunk` or `ResponseExit` messages
4. Ping/Pong keepalive every 10 seconds
5. Automatic reconnection with exponential backoff (500ms base, 1.5x factor, max 5s)

**Server setup options:**
```typescript
// Using HttpRouter
export const layerProtocolWebsocket = <I = HttpRouter.Default>(options: {
  readonly path: HttpRouter.PathInput
  readonly routerTag?: HttpRouter.HttpRouter.TagClass<I, string, any, any>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization>

// Using HttpLayerRouter
export const layerProtocolWebsocketRouter = (options: {
  readonly path: HttpLayerRouter.PathInput
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | HttpLayerRouter.HttpRouter>

// Using SocketServer directly
export const layerProtocolSocketServer: Layer.Layer<
  Protocol,
  never,
  RpcSerialization.RpcSerialization | SocketServer.SocketServer
>
```

## Custom Protocol Implementation

The `Protocol.make` helper enables custom transport creation:

```typescript
// RpcClient.ts:830
Protocol.make = withRun<Protocol["Type"]>()

// Usage pattern
const customProtocol = Protocol.make((writeResponse) => 
  Effect.succeed({
    send: (request, transferables?) => Effect.void,
    supportsAck: true,
    supportsTransferables: false
  })
)
```

## Key Observations

1. **No native SSE** - WebSocket preferred for bidirectional, NDJSON for unidirectional
2. **Protocol abstraction** - Clean separation allows custom transports
3. **Worker-first for heavy compute** - Full transferable support for zero-copy
4. **Streaming is first-class** - Not an afterthought, built into the type system
5. **Acknowledgments for flow control** - Back-pressure support on streaming transports
6. **Trace propagation** - Distributed tracing via span ID/trace ID in messages

## Comparison with tRPC

| Feature | Effect RPC | tRPC |
|---------|-----------|------|
| HTTP | Yes (POST) | Yes (GET/POST) |
| WebSocket | Yes (native) | Via subscription links |
| SSE | No (use NDJSON) | Via httpSubscriptionLink |
| Workers | Yes (pool) | Manual |
| Streaming | RpcSchema.Stream | Subscription/AsyncIterable |
| Serialization | Pluggable (JSON/MsgPack) | superjson/custom |
| Flow control | Ack messages | None |
| Batching | JSON-RPC mode | httpBatchLink |
