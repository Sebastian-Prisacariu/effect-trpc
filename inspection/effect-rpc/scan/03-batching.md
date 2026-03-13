# Effect RPC: Request Batching Analysis

## Summary

**Effect RPC does NOT implement automatic client-side request batching** like tRPC's `httpBatchLink`.

There is no DataLoader-style batching that combines multiple concurrent RPC calls into a single HTTP request. Each `client.myMethod()` call results in an independent network request.

## What "Batching" Exists

### 1. JSON-RPC Response Batching (Serialization Layer)

The term "batch" appears in `RpcSerialization.ts` but refers to **response correlation for JSON-RPC**, not request batching:

```typescript
// RpcSerialization.ts:97-100
const batches = new Map<string, {
  readonly size: number
  readonly responses: Map<string, RpcMessage.FromServerEncoded>
}>()
```

This tracks responses that arrive together in a JSON-RPC batch response format (per JSON-RPC 2.0 spec), correlating them back to their original requests. It's about **parsing**, not request combining.

### 2. Stream Chunk Batching

For streaming RPCs, multiple values are batched into chunks:

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
  // ...
})
```

This batches stream values for efficiency, not client requests.

## Request Flow Analysis

### Client Side (`RpcClient.ts`)

Each request is sent independently:

```typescript
// RpcClient.ts:343-360
const id = generateRequestId()
const send = middleware({
  _tag: "Request",
  id,
  tag: rpc._tag as Rpc.Tag<Rpcs>,
  payload,
  // ...
})
// Immediately sent via protocol
```

The `generateRequestId()` creates a unique ID per request (line 249):
```typescript
const generateRequestId = options?.generateRequestId ?? (() => requestIdCounter++ as RequestId)
```

### HTTP Protocol (`RpcClient.ts:846-910`)

The HTTP protocol sends each request immediately:

```typescript
const send = (request: FromClientEncoded): Effect.Effect<void, RpcClientError> => {
  if (request._tag !== "Request") {
    return Effect.void
  }
  // Encodes and sends immediately
  return client.post("", { body }).pipe(...)
}
```

No buffering, no wait time, no combining multiple requests.

## No Batching Configuration

Unlike tRPC which offers:
```typescript
// tRPC batching config
httpBatchLink({
  maxURLLength: 2083,
  maxBatchSize: 10,
})
```

Effect RPC has **no equivalent options**. The `make` function accepts only:
- `spanPrefix`
- `spanAttributes`
- `generateRequestId`
- `disableTracing`
- `flatten`

## Protocol Comparison

| Feature | tRPC `httpBatchLink` | Effect RPC |
|---------|---------------------|------------|
| Combine concurrent requests | Yes | No |
| Configurable batch size | Yes | N/A |
| Configurable batch window | Yes | N/A |
| URL length limits | Yes | N/A |
| DataLoader pattern | Yes | No |

## Why This Matters

Without batching:
1. N concurrent calls = N HTTP requests
2. Higher network overhead for bulk operations
3. More TCP connections / HTTP/2 streams
4. No deduplication of identical requests within a time window

## Historical Context

The CHANGELOG mentions `BatchedRequestResolver` (line 2534):
```
change: BatchedRequestResolver works with NonEmptyArray
```

This refers to Effect's `RequestResolver` for batching at the application layer, but Effect RPC doesn't integrate with it automatically.

## Implications for effect-trpc

If we expose batching configuration from tRPC:
- **It will be ignored** - Effect RPC has no batching implementation
- We should either:
  1. Document this limitation clearly
  2. Build a batching layer on top of Effect RPC
  3. Not expose batching config (prevents user confusion)

## Recommendation

Consider implementing a batching layer using Effect's `RequestResolver` or similar pattern if batching is required. This would need to:
1. Buffer requests for a configurable time window
2. Combine them into a single transport call
3. Distribute responses back to callers

This is non-trivial and would require changes to both client and server protocols.
