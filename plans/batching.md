# Batching Implementation

## Status: ✅ IMPLEMENTED

Batching is now implemented using Effect Queue + Stream.groupedWithin pattern.

## Usage

### Client-side (Transport)

```typescript
import { Transport } from "effect-trpc"
import { Duration } from "effect"

// Use batching transport instead of regular http
const layer = Transport.Batching.layer("/api/trpc", {
  maxSize: 25,                    // Max requests per batch
  window: Duration.millis(10),    // Time window to collect
  queries: true,                  // Batch queries (default)
  mutations: false,               // Don't batch mutations (default)
})
```

### Server-side (automatic)

Server.toHttpHandler automatically detects and handles batch requests:

```typescript
// Server automatically handles both:
// - Single requests: { id, tag, payload }
// - Batch requests: { batch: [{ id, tag, payload }, ...] }

const handler = Server.toHttpHandler(server)
```

## Wire Protocol

### Batch Request
```json
{
  "batch": [
    { "id": "1", "tag": "@api/users/list", "payload": {} },
    { "id": "2", "tag": "@api/users/get", "payload": { "id": "123" } }
  ]
}
```

### Batch Response
```json
{
  "batch": [
    { "id": "1", "_tag": "Success", "value": [...] },
    { "id": "2", "_tag": "Success", "value": { ... } }
  ]
}
```

## Implementation Details

### Key Components

1. **Queue** (`Queue.unbounded<PendingRequest>`)
   - Collects requests as they come in
   - Each request includes a Deferred for response routing

2. **Stream.groupedWithin(maxSize, window)**
   - Batches requests by count OR time window
   - Whichever comes first

3. **Latch** (`Effect.makeLatch`)
   - Gates batch processing
   - Can pause/resume (e.g., when offline)

4. **Deferred**
   - Routes responses back to individual callers
   - Each request waits on its own Deferred

### Pattern (from react-interview-test-queues-and-streams)

```typescript
// Collect requests
const queue = yield* Queue.unbounded<PendingRequest>()

// Process in batches
Stream.fromQueue(queue).pipe(
  Stream.groupedWithin(maxSize, window),
  Stream.mapEffect(processBatch),
  Stream.runDrain,
  Effect.forkScoped
)

// Latch for pause/resume
const latch = yield* Effect.makeLatch(true)
// ...
latch.whenOpen  // Wait for latch before processing
```

## Exclusions

- **Streams** are never batched (have their own lifecycle)
- **Mutations** are not batched by default (need ordering guarantees)

## Testing

See `test/batching.test.ts`:
- BatchRequest/BatchResponse encoding
- isBatchRequest detection
- Server batch handling
- Order preservation
- Parallel processing
