# Effect RPC Transport Analysis

## Transport Architecture Overview

Effect RPC uses a **Protocol abstraction** that cleanly separates RPC logic from transport concerns. This design allows the same RPC handlers to work over multiple transports.

```
+------------------+     +------------------+     +------------------+
|   RpcClient      |<--->|    Protocol      |<--->|   RpcServer      |
|  (business logic)|     | (transport-agnostic) | (business logic)|
+------------------+     +------------------+     +------------------+
                                 |
                    +------------+------------+
                    |            |            |
              +-----v-----+ +----v----+ +-----v-----+
              |   HTTP    | | Socket  | |  Worker   |
              | Protocol  | |Protocol | | Protocol  |
              +-----------+ +---------+ +-----------+
```

## Protocol Tag (Transport Interface)

Both client and server define a `Protocol` Context.Tag that abstracts the transport layer.

### Client Protocol (`RpcClient.ts:816-831`)

```typescript
export class Protocol extends Context.Tag("@effect/rpc/RpcClient/Protocol")<Protocol, {
  readonly run: (
    f: (data: FromServerEncoded) => Effect.Effect<void>
  ) => Effect.Effect<never>
  readonly send: (
    request: FromClientEncoded,
    transferables?: ReadonlyArray<globalThis.Transferable>
  ) => Effect.Effect<void, RpcClientError>
  readonly supportsAck: boolean
  readonly supportsTransferables: boolean
}>() {}
```

### Server Protocol (`RpcServer.ts:793-814`)

```typescript
export class Protocol extends Context.Tag("@effect/rpc/RpcServer/Protocol")<Protocol, {
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
}>() {}
```

## Supported Transports

### 1. HTTP Transport

**Client:** `makeProtocolHttp`, `layerProtocolHttp`

**Server:** `makeProtocolHttp`, `layerProtocolHttp`, `layerProtocolHttpRouter`

**Characteristics:**
- Request/response model
- No streaming backpressure (supportsAck: false)
- No transferables (supportsTransferables: false)
- Response can be streamed via NDJSON or msgpack framing

**HTTP Protocol Flow:**
```
Client                          Server
   |--- POST /rpc ------------->|
   |    [Request message]       |
   |<-- Response (streamed) ----|
   |    [Exit/Chunk messages]   |
```

### 2. WebSocket Transport

**Client:** `makeProtocolSocket`, `layerProtocolSocket`

**Server:** `makeProtocolWebsocket`, `layerProtocolWebsocket`, `layerProtocolWebsocketRouter`, `makeProtocolSocketServer`, `layerProtocolSocketServer`

**Characteristics:**
- Full duplex bidirectional
- Supports backpressure via Ack messages (supportsAck: true)
- Automatic reconnection with configurable retry schedule
- Ping/pong keep-alive mechanism
- Span propagation support (supportsSpanPropagation: true)

**WebSocket Protocol Flow:**
```
Client                          Server
   |<-- WebSocket Upgrade ----->|
   |                            |
   |--- Request --------------->|
   |<-- Chunk ------------------|
   |--- Ack ------------------->|  (backpressure)
   |<-- Chunk ------------------|
   |--- Ack ------------------->|
   |<-- Exit -------------------|
   |                            |
   |--- Ping ------------------>|  (keep-alive)
   |<-- Pong -------------------|
```

### 3. Worker Transport (Web Workers/Node Workers)

**Client:** `makeProtocolWorker`, `layerProtocolWorker`

**Server:** `makeProtocolWorkerRunner`, `layerProtocolWorkerRunner`

**Characteristics:**
- For same-process communication (Web Workers, Node Worker Threads)
- Supports transferables (supportsTransferables: true)
- Supports backpressure (supportsAck: true)
- Worker pooling with configurable size, concurrency, TTL
- Initial message passing for worker initialization

**Worker Protocol Features:**
- Fixed pool: `{ size: number, concurrency?, targetUtilization? }`
- Dynamic pool: `{ minSize, maxSize, timeToLive, concurrency?, targetUtilization? }`

### 4. Stdio Transport (Streams)

**Server:** `makeProtocolStdio`, `layerProtocolStdio`

**Characteristics:**
- For CLI tools and subprocess communication
- Uses Effect Streams and Sinks
- Single client (clientId: 0)
- Supports backpressure (supportsAck: true)
- Supports span propagation (supportsSpanPropagation: true)

```typescript
export const layerProtocolStdio = <EIn, EOut, RIn, ROut>(options: {
  readonly stdin: Stream.Stream<Uint8Array, EIn, RIn>
  readonly stdout: Sink.Sink<void, Uint8Array | string, unknown, EOut, ROut>
}): Layer.Layer<Protocol, never, RpcSerialization.RpcSerialization | RIn | ROut>
```

## Serialization Layer

Effect RPC separates serialization from transport via `RpcSerialization`:

| Format | Content-Type | Framing | Use Case |
|--------|--------------|---------|----------|
| `json` | application/json | No | Simple HTTP request/response |
| `ndjson` | application/ndjson | Yes | Streaming responses |
| `jsonRpc` | application/json | No | JSON-RPC 2.0 compatibility |
| `ndJsonRpc` | application/json-rpc | Yes | Streaming JSON-RPC |
| `msgPack` | application/msgpack | Yes | Binary efficiency |

## Streaming Support

Effect RPC has first-class streaming support via `RpcSchema.Stream`:

```typescript
// Define a streaming RPC
const ListUsers = Rpc.make("ListUsers", {
  success: RpcSchema.Stream({
    success: User,
    failure: Schema.Never
  })
})

// Returns Stream<User, never>
```

**Streaming Protocol:**
1. Client sends Request
2. Server sends multiple Chunk messages with batched values
3. Client sends Ack after processing each Chunk (on ack-supporting transports)
4. Server sends Exit when stream completes

## Transport Feature Matrix

| Transport | Duplex | Ack | Transferables | Span Propagation | Reconnect |
|-----------|--------|-----|---------------|------------------|-----------|
| HTTP | No | No | No | No | No |
| WebSocket | Yes | Yes | No | Yes | Yes |
| Worker | Yes | Yes | Yes | Yes | N/A |
| Stdio | Yes | Yes | No | Yes | Via retry |

## Message Types

### Client -> Server (FromClient)

| Message | Purpose |
|---------|---------|
| `Request` | RPC invocation |
| `Ack` | Backpressure acknowledgment |
| `Interrupt` | Cancel request |
| `Eof` | Client done sending |
| `Ping` | Keep-alive |

### Server -> Client (FromServer)

| Message | Purpose |
|---------|---------|
| `Chunk` | Streaming data batch |
| `Exit` | Request completion |
| `Defect` | Unrecoverable error |
| `Pong` | Keep-alive response |
| `ClientEnd` | Client disconnected |

## Key Insights for effect-trpc

1. **Protocol abstraction is powerful** - Same handler code works across all transports
2. **HTTP is simple but limited** - No backpressure, no bidirectional streaming
3. **WebSocket is full-featured** - Backpressure, reconnection, keep-alive
4. **Workers enable structured concurrency** - Pooling, transferables
5. **Stdio enables CLI tooling** - Process-based RPC

### Integration Options for effect-trpc

| tRPC Transport | Effect RPC Equivalent | Notes |
|----------------|----------------------|-------|
| HTTP | `layerProtocolHttp` | Direct mapping |
| WebSocket | `layerProtocolWebsocket` | tRPC uses ws adapter |
| SSE | None built-in | Could use `makeProtocolWithHttpApp` with SSE response |
| Fetch adapter | `toWebHandler` | For serverless |

### Missing from Effect RPC (that tRPC has)

- **Server-Sent Events (SSE)** - tRPC supports SSE for subscriptions
- **Lambda/Edge adapters** - tRPC has first-class serverless support
- **Batch HTTP** - tRPC supports request batching

### Effect RPC has (that tRPC lacks)

- **MessagePack serialization** - Binary efficiency
- **Worker transport** - Structured concurrency
- **Stdio transport** - CLI tooling
- **Automatic reconnection** - Built into WebSocket protocol
- **Backpressure** - Ack-based flow control for streams
- **Transferables** - Zero-copy data transfer in workers
