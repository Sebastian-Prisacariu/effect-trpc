# Batching Implementation Plan

## Overview

Batching combines multiple RPC requests into a single HTTP request, reducing network overhead and improving performance for applications with many concurrent queries.

## Status: NOT IMPLEMENTED

The batching configuration was removed from the API because it had no implementation. This plan outlines how to implement it properly.

## Proposed API

```typescript
const layer = Transport.http("/api/trpc", {
  batching: {
    /**
     * Enable batching (default: false)
     */
    enabled: true,
    
    /**
     * Time window to collect requests before sending batch.
     * Default: 0 (send immediately after microtask)
     */
    window: Duration.millis(10),
    
    /**
     * Maximum requests per batch.
     * Default: 50
     */
    maxSize: 50,
    
    /**
     * Batch queries (default: true when batching enabled)
     */
    queries: true,
    
    /**
     * Batch mutations (default: false - mutations usually need ordering)
     */
    mutations: false,
  },
})
```

## Implementation Approach

### 1. Request Collection

Use Effect's `Queue` or `Mailbox` to collect requests during the batch window:

```typescript
interface PendingRequest {
  readonly request: TransportRequest
  readonly resolve: (response: TransportResponse) => void
  readonly reject: (error: TransportError) => void
}

// Collect requests
const pendingQueue: Queue.Queue<PendingRequest>

// Flush on window expiry or max size
Effect.gen(function*() {
  const pending = yield* Queue.takeBetween(pendingQueue, 1, maxSize)
  const batchRequest = createBatchRequest(pending)
  const responses = yield* sendBatch(batchRequest)
  // Route responses back to individual resolvers
})
```

### 2. Wire Protocol

Batch request format (JSON):
```json
{
  "batch": [
    { "id": "1", "tag": "@api/users/list", "payload": {} },
    { "id": "2", "tag": "@api/users/get", "payload": { "id": "123" } }
  ]
}
```

Batch response format:
```json
{
  "batch": [
    { "id": "1", "_tag": "Success", "value": [...] },
    { "id": "2", "_tag": "Success", "value": { ... } }
  ]
}
```

### 3. Server Support

Server needs a batch endpoint handler:

```typescript
// Server.toHttpHandler already handles single requests
// Add Server.toBatchHttpHandler for batch requests
const batchHandler = Server.toBatchHttpHandler(server)

// Or auto-detect in toHttpHandler:
// if body has "batch" array, handle as batch
```

### 4. Stream Exclusion

Streams cannot be batched (they have their own lifecycle). The transport should automatically exclude stream requests from batching:

```typescript
if (procedure.isStream) {
  return sendDirect(request)  // Skip batching
}
```

### 5. Error Handling

If batch request fails:
- Network error: Reject all pending requests
- Partial failure: Route individual errors to their requests

### 6. Cancellation

Use Effect's interruption:
- If a request is cancelled, remove from pending queue
- If batch is in-flight, the cancelled request's response is ignored

## Dependencies

- Effect `Queue` or `Mailbox` for request collection
- Effect `Schedule` for window timing
- Schema for batch request/response encoding

## Testing Strategy

1. Unit tests for batching logic
2. E2E tests with mock server
3. Timing tests to verify window behavior
4. Stress tests with many concurrent requests

## Priority

LOW - Batching is an optimization. Focus on core functionality first:
1. ✅ Stream middleware (security)
2. 🔄 React hooks refactor
3. 🔄 Cache integration with Effect Atom
4. ⏳ Batching (this)

## References

- tRPC batching: https://trpc.io/docs/client/links/httpBatchLink
- Effect Queue: https://effect.website/docs/data-types/queue
- Effect Mailbox: https://effect.website/docs/data-types/mailbox
