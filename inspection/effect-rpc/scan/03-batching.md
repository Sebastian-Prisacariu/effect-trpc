# H3: Request Batching Analysis

## Summary

**Effect RPC does NOT implement client-side request batching.** Each request is sent individually over the transport. The "batch" terminology found in the codebase refers to something different: JSON-RPC batch response correlation (grouping responses that arrived together).

## Findings

### 1. No Client-Side Request Aggregation

The HTTP protocol (`makeProtocolHttp` in `RpcClient.ts:837-910`) sends each request immediately and independently:

```typescript
const send = (request: FromClientEncoded): Effect.Effect<void, RpcClientError> => {
  if (request._tag !== "Request") {
    return Effect.void
  }

  const parser = serialization.unsafeMake()
  const encoded = parser.encode(request)!
  const body = typeof encoded === "string" ?
    HttpBody.text(encoded, serialization.contentType) :
    HttpBody.uint8Array(encoded, serialization.contentType)

  // Each request = one HTTP POST
  return client.post("", { body }).pipe(...)
}
```

There is:
- No request queue
- No batching window/delay
- No aggregation of concurrent requests
- No multiplexing over a single HTTP connection

### 2. What "Batches" Actually Are (JSON-RPC Protocol)

The `RpcSerialization.ts` file has "batch" references, but these are for JSON-RPC protocol compliance:

```typescript
// From RpcSerialization.ts:159-181
function decodeJsonRpcRaw(
  decoded: JsonRpcMessage | Array<JsonRpcMessage>,
  batches: Map<string, { size: number; responses: Map<string, ...> }>
) {
  if (Array.isArray(decoded)) {
    // This handles JSON-RPC batch *responses* that arrive together
    // NOT client-side request batching
    const batch = {
      size: 0,
      responses: new Map<string, RpcMessage.FromServerEncoded>()
    }
    for (let i = 0; i < decoded.length; i++) {
      const message = decodeJsonRpcMessage(decoded[i])
      if (message._tag === "Request") {
        batch.size++
        batches.set(message.id, batch)
      }
    }
    return messages
  }
  // ...
}
```

This code correlates responses for requests that were sent together (e.g., by the server or in a batch request format) - it doesn't aggregate outgoing requests.

### 3. Transport Models

Effect RPC has three transport models, none with built-in batching:

| Transport | Batching | Notes |
|-----------|----------|-------|
| HTTP | None | One request = one POST |
| Socket | None | One request = one message (multiplexed, but not batched) |
| Worker | None | One request = one message |

The Socket and Worker transports are **multiplexed** (multiple concurrent requests over one connection) but not **batched** (no aggregation window).

### 4. Server-Side: Single Request per Invocation

The server (`RpcServer.ts`) processes each request individually. The HTTP app decodes incoming requests and calls `writeRequest` for each:

```typescript
// RpcServer.ts:1015-1024
try {
  const decoded = parser.decode(data) as ReadonlyArray<FromClientEncoded>
  for (const message of decoded) {
    if (message._tag === "Request") {
      requestIds.push(RequestId(message.id))
    }
    yield* writeRequest(id, message)  // Each request handled individually
  }
}
```

While the server can receive an array of decoded messages (e.g., from NDJSON parsing), it processes them one at a time.

## Comparison with tRPC

tRPC provides explicit batching via `httpBatchLink`:

```typescript
// tRPC batching approach
import { httpBatchLink } from '@trpc/client'

createTRPCProxyClient({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      maxURLLength: 2083,      // URL length limit
      headers: () => ({ ... }),
    }),
  ],
})
```

tRPC batches requests by:
1. Collecting requests within a microtask
2. Combining them into a single HTTP request
3. Parsing batch responses and routing to callers

Effect RPC has no equivalent.

## Our Codebase: Config Without Implementation

Our `Transport/index.ts` defines batching config that is **not implemented**:

```typescript
// src/Transport/index.ts:211-238
readonly batching?: {
  /** Enable batching (default: true for queries) */
  readonly enabled?: boolean
  /** Time window to collect requests (default: 0 = microtask) */
  readonly window?: Duration.DurationInput
  /** Maximum requests per batch (default: 50) */
  readonly maxSize?: number
  /** Batch queries (default: true) */
  readonly queries?: boolean
  /** Batch mutations (default: false) */
  readonly mutations?: boolean
}
```

The actual HTTP implementation (`sendHttp` function) ignores these options entirely.

## Recommendations

### Option 1: Don't Implement Batching (Simplest)

Remove the batching config from `Transport.HttpOptions`. Effect RPC doesn't support it, and implementing it adds complexity. For most use cases:
- HTTP/2 multiplexing handles concurrent requests efficiently
- WebSocket connections inherently multiplex
- Batching has diminishing returns with modern networking

**Pros**: Simpler code, matches Effect RPC's design
**Cons**: More HTTP requests in high-frequency scenarios

### Option 2: Implement Application-Level Batching

If batching is required, implement it in our transport layer:

```typescript
// Conceptual batching transport wrapper
const batchedHttp = (options: HttpOptions): Layer.Layer<Transport> => {
  // Use Effect.Mailbox to collect requests
  // Flush after window duration or max size
  // Send batch as array, correlate responses
}
```

This would wrap the basic HTTP transport and:
1. Queue requests in a `Mailbox` or `Ref`
2. Flush on microtask/timer or when full
3. Send combined payload
4. Route responses back to callers via `Deferred`

**Pros**: Reduced HTTP overhead for high-frequency clients
**Cons**: Complexity, latency trade-off, error handling complexity

### Option 3: Use WebSocket Transport

For applications needing efficient concurrent requests, recommend WebSocket:
- Native multiplexing
- Lower overhead per message
- Better for real-time/high-frequency scenarios

```typescript
const wsLayer = Transport.websocket("/api/ws", {
  reconnect: { enabled: true, backoff: "exponential" }
})
```

## Conclusion

Effect RPC deliberately omits client-side batching. The "batch" code in `RpcSerialization` is JSON-RPC protocol handling, not request aggregation.

**Recommendation**: Remove or mark as "planned" the batching config in our `HttpOptions`. Document that:
1. HTTP transport sends one request per call
2. For high-frequency scenarios, use WebSocket transport
3. Batching can be added in userland if needed

This aligns with Effect RPC's design philosophy of simple, composable primitives rather than built-in optimization heuristics.
