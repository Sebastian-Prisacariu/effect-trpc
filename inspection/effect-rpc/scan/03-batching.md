# Effect RPC Batching Analysis

## Summary

**Effect RPC does NOT have automatic request batching** in the traditional sense (like tRPC's httpBatchLink or DataLoader). However, it has a different batching mechanism specifically for JSON-RPC serialization response collection.

## Batching Mechanisms Found

### 1. Response Batching in JSON-RPC Serialization

Location: `RpcSerialization.ts:97-180` and `RpcSerialization.ts:240-260`

Effect RPC has a **response batching** mechanism for JSON-RPC format:

```typescript
// RpcSerialization.ts:97-100
const batches = new Map<string, {
  readonly size: number
  readonly responses: Map<string, RpcMessage.FromServerEncoded>
}>()
```

When decoding a JSON-RPC **batch request** (array of requests), it tracks how many requests were in the batch. Responses are collected and only sent when all responses for the batch are ready:

```typescript
// RpcSerialization.ts:250-257
const batch = batches.get(response.requestId)
if (batch) {
  batches.delete(response.requestId)
  batch.responses.set(response.requestId, response as any)
  if (batch.size === batch.responses.size) {
    return Array.from(batch.responses.values(), encodeJsonRpcMessage)
  }
  return undefined  // Wait for more responses
}
```

This is **server-side response batching** - it waits to collect all responses before sending them back as a single JSON-RPC batch response.

### 2. HTTP Protocol - One Request Per HTTP Call

Location: `RpcClient.ts:846-903`

The HTTP protocol sends **one request per HTTP call**:

```typescript
// RpcClient.ts:846-849
const send = (request: FromClientEncoded): Effect.Effect<void, RpcClientError> => {
  if (request._tag !== "Request") {
    return Effect.void
  }
  // Each request becomes its own POST request
  const encoded = parser.encode(request)!
  const body = typeof encoded === "string" ?
    HttpBody.text(encoded, serialization.contentType) :
    HttpBody.uint8Array(encoded, serialization.contentType)
```

**There is no DataLoader-style batching** that would collect multiple concurrent requests and send them as a single HTTP request.

### 3. Stream Chunk Batching

Location: `RpcServer.ts:356-403`

For streaming RPCs, chunks are batched naturally via `Mailbox`:

```typescript
// RpcServer.ts:391-402
return Stream.runForEachChunk(stream, (chunk) => {
  if (!Chunk.isNonEmpty(chunk)) return Effect.void
  const write = options.onFromServer({
    _tag: "Chunk",
    clientId: client.id,
    requestId: request.id,
    values: Chunk.toReadonlyArray(chunk)
  })
```

Streaming responses send chunks efficiently, but this is response streaming, not request batching.

## What Effect RPC DOES Have

| Feature | Status | Notes |
|---------|--------|-------|
| Request batching (client) | **NO** | Each request = separate HTTP call |
| Response batching (JSON-RPC) | **YES** | Server collects responses for batch requests |
| Stream chunk batching | **YES** | Natural chunking via Effect streams |
| WebSocket multiplexing | **YES** | Multiple concurrent requests over single connection |
| Worker pool concurrency | **YES** | Multiple workers process requests in parallel |

## What Effect RPC is MISSING

### 1. DataLoader-style Request Batching

tRPC's `httpBatchLink` collects requests within a time window and sends them as a single HTTP request:

```typescript
// tRPC example - NOT in Effect RPC
httpBatchLink({
  url: '/trpc',
  maxURLLength: 2083,
})
```

Effect RPC has no equivalent. Each `client.myProcedure()` call immediately sends an HTTP request.

### 2. Automatic Request Deduplication

No mechanism to deduplicate identical requests made within a time window.

### 3. Per-Request Batching Configuration

No way to configure which requests should batch together or batching strategies.

## Transport-Level Comparison

| Transport | Batching Behavior |
|-----------|-------------------|
| HTTP | One request per POST - no batching |
| WebSocket | Multiplexed - multiple requests share connection |
| Worker | Pooled - requests distributed across workers |

## Architecture Implication for effect-trpc

Effect RPC's lack of client-side request batching is significant for effect-trpc:

1. **Preserve tRPC batching**: If effect-trpc wraps tRPC, it can use tRPC's batching links
2. **Add batching layer**: Could implement a batching layer between effect-trpc client and Effect RPC
3. **Leverage WebSocket**: For real-time apps, WebSocket transport provides implicit efficiency

## Recommendation for effect-trpc

Given Effect RPC doesn't have DataLoader-style batching:

1. **Option A**: Use Effect RPC's WebSocket protocol for efficiency (multiplexed connection)
2. **Option B**: Implement custom batching in effect-trpc's HTTP layer
3. **Option C**: Keep tRPC's transport layer and only use Effect RPC for handler definition

The WebSocket approach may be more idiomatic for Effect's streaming-first design philosophy.
