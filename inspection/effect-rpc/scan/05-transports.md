# H5: Transport Protocols in Effect RPC

## Summary

Effect RPC has a **sophisticated transport abstraction** via the `Protocol` service tag. It supports **5 transport types** out of the box:
1. HTTP (request/response)
2. WebSocket (bidirectional streaming)
3. Socket (TCP/Unix sockets)
4. Worker (Web Workers/Node Workers)
5. Stdio (stdin/stdout for CLI tools)

**SSE is NOT directly supported** as a transport, but exists as a separate utility in `@effect/experimental/Sse`.

---

## Transport Architecture

### Protocol Abstraction

Both client and server define a `Protocol` service that abstracts the transport layer:

```typescript
// Server Protocol (RpcServer.ts:793-814)
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

// Client Protocol (RpcClient.ts:816-831)
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
```

### Protocol Capabilities

| Transport | supportsAck | supportsTransferables | supportsSpanPropagation |
|-----------|-------------|----------------------|-------------------------|
| HTTP      | ❌          | ❌                   | ❌                      |
| WebSocket | ✅          | ❌                   | ✅                      |
| Socket    | ✅          | ❌                   | ✅                      |
| Worker    | ✅          | ✅                   | ✅                      |
| Stdio     | ✅          | ❌                   | ✅                      |

---

## Transport Implementations

### 1. HTTP Transport

**Location:** `RpcClient.ts:837-929`, `RpcServer.ts:945-1083`

**Characteristics:**
- Request/response model (no true bidirectional streaming)
- Uses HTTP POST for requests
- Supports JSON and binary (msgpack) serialization
- Streaming responses via `includesFraming` (ndjson/msgpack)

```typescript
// Client HTTP Protocol
export const makeProtocolHttp = (client: HttpClient.HttpClient): Effect.Effect<
  Protocol["Type"],
  never,
  RpcSerialization.RpcSerialization
>

// Server HTTP App
export const makeProtocolWithHttpApp: Effect.Effect<{
  readonly protocol: Protocol["Type"]
  readonly httpApp: HttpApp.Default<never, Scope.Scope>
}, never, RpcSerialization.RpcSerialization>
```

**Limitations:**
- No `supportsAck` - client cannot acknowledge stream chunks
- No `supportsTransferables` - cannot transfer binary data efficiently
- Streams must complete in a single response

### 2. WebSocket Transport

**Location:** `RpcClient.ts:935-1069`, `RpcServer.ts:846-939`

**Characteristics:**
- Full bidirectional communication
- Supports Ack protocol for flow control
- Built-in ping/pong for connection health
- Auto-reconnect with exponential backoff

```typescript
// Client WebSocket Protocol
export const makeProtocolSocket = (options?: {
  readonly retryTransientErrors?: boolean
  readonly retrySchedule?: Schedule.Schedule<any, Socket.SocketError>
}): Effect.Effect<Protocol["Type"], never, Scope.Scope | RpcSerialization.RpcSerialization | Socket.Socket>

// Server WebSocket Protocol
export const makeProtocolWithHttpAppWebsocket: Effect.Effect<{
  readonly protocol: Protocol["Type"]
  readonly httpApp: HttpApp.Default<never, Scope.Scope>
}, never, RpcSerialization.RpcSerialization>
```

**Features:**
- Ping/pong keep-alive (10 second interval)
- Automatic reconnection on transient errors
- Message framing with ndjson/msgpack

### 3. Socket (TCP/Unix) Transport

**Location:** `RpcServer.ts:820-840`, uses `@effect/platform/SocketServer`

**Characteristics:**
- Raw TCP or Unix socket communication
- Requires `SocketServer` from platform
- Same wire protocol as WebSocket

```typescript
export const makeProtocolSocketServer: Effect.Effect<
  Protocol["Type"],
  never,
  RpcSerialization.RpcSerialization | SocketServer.SocketServer
>
```

### 4. Worker Transport

**Location:** `RpcClient.ts:1071-1239`, `RpcServer.ts:1130-1191`

**Characteristics:**
- Web Workers or Node.js Worker Threads
- Supports `Transferable` objects (ArrayBuffer, etc.)
- Connection pooling with configurable size
- Initial message support for setup

```typescript
// Client Worker Protocol
export const makeProtocolWorker = (options: {
  readonly size: number
  readonly concurrency?: number
  readonly targetUtilization?: number
} | {
  readonly minSize: number
  readonly maxSize: number
  readonly timeToLive: Duration.DurationInput
}): Effect.Effect<Protocol["Type"], WorkerError, Scope.Scope | Worker.PlatformWorker | Worker.Spawner>

// Server Worker Runner
export const makeProtocolWorkerRunner: Effect.Effect<
  Protocol["Type"],
  WorkerError,
  WorkerRunner.PlatformRunner | Scope.Scope
>
```

### 5. Stdio Transport

**Location:** `RpcServer.ts:1343-1412`

**Characteristics:**
- Uses stdin/stdout streams
- Ideal for CLI tools and language servers
- Single client model

```typescript
export const makeProtocolStdio = <EIn, EOut, RIn, ROut>(options: {
  readonly stdin: Stream.Stream<Uint8Array, EIn, RIn>
  readonly stdout: Sink.Sink<void, Uint8Array | string, unknown, EOut, ROut>
}): Effect.Effect<Protocol["Type"], never, RpcSerialization.RpcSerialization | RIn | ROut>
```

---

## Serialization Formats

**Location:** `RpcSerialization.ts`

| Format | Content-Type | Framing | Binary |
|--------|-------------|---------|--------|
| json | application/json | ❌ | ❌ |
| ndjson | application/ndjson | ✅ | ❌ |
| jsonRpc | application/json | ❌ | ❌ |
| ndJsonRpc | application/json-rpc | ✅ | ❌ |
| msgPack | application/msgpack | ✅ | ✅ |

---

## SSE (Server-Sent Events)

**Location:** `@effect/experimental/Sse.ts`

SSE exists as a **separate utility** in the experimental package, not as an RPC transport:

```typescript
// SSE Parser/Encoder in @effect/experimental
export const makeChannel: <IE, Done>(options?: {
  readonly bufferSize?: number
}) => Channel.Channel<Chunk.Chunk<Event>, Chunk.Chunk<string>, IE, IE, void, Done>

export interface Event {
  readonly _tag: "Event"
  readonly event: string
  readonly id: string | undefined
  readonly data: string
}
```

**Why SSE is not an RPC transport:**
1. SSE is server-to-client only (unidirectional)
2. RPC needs bidirectional communication for requests
3. SSE would require HTTP POST for requests + SSE for responses
4. WebSocket provides better bidirectional support

---

## Adding New Transports

To add a new transport, implement the `Protocol` interface:

### Client Protocol Requirements

```typescript
interface ClientProtocol {
  // Run the protocol - receives server messages
  run: (f: (data: FromServerEncoded) => Effect.Effect<void>) => Effect.Effect<never>
  
  // Send a message to server
  send: (request: FromClientEncoded, transferables?: Transferable[]) => Effect.Effect<void, RpcClientError>
  
  // Capability flags
  supportsAck: boolean
  supportsTransferables: boolean
}
```

### Server Protocol Requirements

```typescript
interface ServerProtocol {
  // Run the protocol - receives client messages
  run: (f: (clientId: number, data: FromClientEncoded) => Effect.Effect<void>) => Effect.Effect<never>
  
  // Mailbox of disconnected client IDs
  disconnects: Mailbox.ReadonlyMailbox<number>
  
  // Send response to specific client
  send: (clientId: number, response: FromServerEncoded, transferables?: Transferable[]) => Effect.Effect<void>
  
  // Signal client session ended
  end: (clientId: number) => Effect.Effect<void>
  
  // Get connected client IDs
  clientIds: Effect.Effect<ReadonlySet<number>>
  
  // Optional initial message from client
  initialMessage: Effect.Effect<Option.Option<unknown>>
  
  // Capability flags
  supportsAck: boolean
  supportsTransferables: boolean
  supportsSpanPropagation: boolean
}
```

### Example: Adding SSE Transport

If we wanted SSE for effect-trpc:

```typescript
// Hypothetical SSE Protocol
const makeProtocolSSE = Effect.gen(function*() {
  // HTTP POST for client->server
  // SSE stream for server->client
  
  return {
    run: (writeRequest) => {
      // Set up SSE EventSource and POST endpoint
    },
    disconnects: yield* Mailbox.make<number>(),
    send: (clientId, response) => {
      // Write to SSE stream
    },
    end: (clientId) => Effect.void,
    clientIds: Effect.sync(() => new Set()),
    initialMessage: Effect.succeedNone,
    supportsAck: false,  // SSE is unidirectional
    supportsTransferables: false,
    supportsSpanPropagation: false
  }
})
```

---

## Recommendations for effect-trpc

### 1. Start with HTTP

Effect RPC's HTTP transport is the closest to what tRPC uses:
- Request/response model
- JSON serialization
- Supports streaming via ndjson framing

### 2. Consider WebSocket for Subscriptions

tRPC's subscriptions map well to Effect RPC's WebSocket transport:
- Bidirectional streaming
- Ack protocol for backpressure
- Auto-reconnection

### 3. Skip SSE Initially

SSE adds complexity without clear benefits:
- Requires separate HTTP + SSE channels
- WebSocket is simpler and more capable
- Can add later if needed for specific use cases

### 4. Protocol Adapter Pattern

Create adapter from tRPC links to Effect RPC protocols:

```typescript
// Conceptual bridge
const tRPCHttpLinkToEffectProtocol = (link: TRPCLink) => 
  makeProtocolHttp(HttpClient.make().pipe(
    HttpClient.mapRequest(/* adapt tRPC request format */)
  ))
```

### 5. Serialization Compatibility

Use `RpcSerialization.json` or `RpcSerialization.jsonRpc` for tRPC compatibility:
- tRPC uses JSON by default
- JSON-RPC format is close to tRPC's wire format

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `RpcClient.ts:816-831` | Client Protocol definition |
| `RpcClient.ts:837-929` | HTTP client transport |
| `RpcClient.ts:935-1069` | WebSocket client transport |
| `RpcClient.ts:1071-1239` | Worker client transport |
| `RpcServer.ts:793-814` | Server Protocol definition |
| `RpcServer.ts:820-939` | WebSocket/Socket server transports |
| `RpcServer.ts:945-1083` | HTTP server transport |
| `RpcServer.ts:1130-1191` | Worker server transport |
| `RpcServer.ts:1343-1412` | Stdio transport |
| `RpcSerialization.ts` | Serialization formats |
| `Socket.ts` | WebSocket/Socket abstraction |
| `Sse.ts` | SSE parser (experimental, not RPC) |
