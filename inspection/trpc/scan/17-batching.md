# H17: Batching Implementation

## Overview

tRPC implements a DataLoader-inspired batching system that automatically collects multiple RPC calls within the same event loop tick and sends them as a single HTTP request.

## Core Architecture

### 1. DataLoader (`internals/dataLoader.ts`)

The batching is built on a custom DataLoader implementation:

```typescript
type BatchItem<TKey, TValue> = {
  aborted: boolean;
  key: TKey;
  resolve: ((value: TValue) => void) | null;
  reject: ((error: Error) => void) | null;
  batch: Batch<TKey, TValue> | null;
};

type BatchLoader<TKey, TValue> = {
  validate: (keys: TKey[]) => boolean;
  fetch: (keys: TKey[]) => Promise<TValue[] | Promise<TValue>[]>;
};
```

**Key characteristics:**
- No caching (unlike GraphQL DataLoader)
- Individual request cancellation support
- Batch only cancelled when ALL items are cancelled

### 2. Timing Mechanism

**Uses `setTimeout(dispatch)` with no delay argument:**

```typescript
function load(key: TKey): Promise<TValue> {
  const item: BatchItem<TKey, TValue> = {
    aborted: false,
    key,
    batch: null,
    resolve: throwFatalError,
    reject: throwFatalError,
  };

  const promise = new Promise<TValue>((resolve, reject) => {
    item.reject = reject;
    item.resolve = resolve;

    pendingItems ??= [];
    pendingItems.push(item);
  });

  // Schedules dispatch for next tick
  dispatchTimer ??= setTimeout(dispatch);

  return promise;
}
```

This means:
- All synchronous calls in the same execution context are batched
- Dispatch happens on the next event loop tick
- Single timer shared across all pending items

### 3. Batch Grouping with Validation

The DataLoader supports splitting batches based on validation rules:

```typescript
function groupItems(items: BatchItem<TKey, TValue>[]) {
  const groupedItems: BatchItem<TKey, TValue>[][] = [[]];
  let index = 0;
  
  while (true) {
    const item = items[index];
    if (!item) break;
    
    const lastGroup = groupedItems[groupedItems.length - 1]!;
    
    if (item.aborted) {
      item.reject?.(new Error('Aborted'));
      index++;
      continue;
    }
    
    // Check if adding this item exceeds constraints
    const isValid = batchLoader.validate(
      lastGroup.concat(item).map((it) => it.key),
    );
    
    if (isValid) {
      lastGroup.push(item);
      index++;
      continue;
    }
    
    // Start new group if current item is too large for empty group
    if (lastGroup.length === 0) {
      item.reject?.(new Error('Input is too big for a single dispatch'));
      index++;
      continue;
    }
    
    // Create new group
    groupedItems.push([]);
  }
  return groupedItems;
}
```

## HTTP Batch Links

### httpBatchLink

Standard batch link that waits for full response:

```typescript
const batchLoader = (type: ProcedureType): BatchLoader<Operation, HTTPResult> => {
  return {
    validate(batchOps) {
      // Validation checks
      if (batchOps.length > maxItems) return false;
      
      // URL length validation for GET requests
      const url = getUrl({...resolvedOpts, type, path, inputs, signal: null});
      return url.length <= maxURLLength;
    },
    
    async fetch(batchOps) {
      const path = batchOps.map((op) => op.path).join(',');
      const inputs = batchOps.map((op) => op.input);
      const signal = allAbortSignals(...batchOps.map((op) => op.signal));
      
      const res = await jsonHttpRequester({...});
      
      // Parse array response back into individual results
      const resJSON = Array.isArray(res.json)
        ? res.json
        : batchOps.map(() => res.json);
        
      return resJSON.map((item) => ({ meta: res.meta, json: item }));
    },
  };
};

// Separate loaders per operation type
const query = dataLoader(batchLoader('query'));
const mutation = dataLoader(batchLoader('mutation'));
```

### httpBatchStreamLink

Streaming variant that returns results as they complete:

```typescript
async fetch(batchOps) {
  const responsePromise = fetchHTTPResponse({
    ...resolvedOpts,
    trpcAcceptHeader: 'application/jsonl',  // JSONL streaming
    // ...
  });
  
  const res = await responsePromise;
  const [head] = await jsonlStreamConsumer<Record<string, Promise<any>>>({
    from: res.body!,
    // ...
  });
  
  // Returns promises that resolve individually as stream completes
  const promises = Object.keys(batchOps).map(
    async (key): Promise<HTTPResult> => {
      let json: TRPCResponse = await Promise.resolve(head[key]);
      // ...
    },
  );
  return promises;
}
```

## Batch Options

```typescript
type HTTPBatchLinkOptions<TRoot extends AnyClientTypes> = {
  url: string | URL;
  
  /** Maximum URL length (for GET requests) */
  maxURLLength?: number;  // default: Infinity
  
  /** Maximum number of calls in a single batch request */
  maxItems?: number;      // default: Infinity
  
  /** Headers callback receives full operation list */
  headers?: HTTPHeaders | ((opts: { opList: NonEmptyArray<Operation> }) => HTTPHeaders | Promise<HTTPHeaders>);
};
```

## HTTP Protocol

### URL Format

Batched requests use comma-separated paths:
```
GET /api/trpc/user.get,post.list?batch=1&input={...}
```

The `batch=1` query parameter signals to the server that this is a batched request.

### Input Format

Inputs are serialized as an object with numeric keys:
```typescript
function arrayToDict(array: unknown[]) {
  const dict: Record<number, unknown> = {};
  for (let index = 0; index < array.length; index++) {
    dict[index] = array[index];
  }
  return dict;
}
```

Result: `{ "0": input1, "1": input2, "2": input3 }`

### Server-Side Handling

Server detects batch calls via query parameter:

```typescript
const isBatchCall = opts.searchParams.get('batch') === '1';
const paths = isBatchCall ? opts.path.split(',') : [opts.path];
```

## WebSocket Batching

WebSocket uses a different batching mechanism via `RequestManager`:

### Request States

```typescript
class RequestManager {
  // Requests queued but not yet sent
  private outgoingRequests = new Array<Request & { id: MessageId }>();
  
  // Requests sent, awaiting response
  private pendingRequests: Record<MessageId, Request> = {};
  
  // Move outgoing -> pending and return for sending
  public flush() {
    const requests = this.outgoingRequests;
    this.outgoingRequests = [];
    for (const request of requests) {
      this.pendingRequests[request.id] = request;
    }
    return requests;
  }
}
```

### Timing

WebSocket batching uses `sleep(0)` (Promise.resolve() equivalent):

```typescript
private batchSend(message: TRPCClientOutgoingMessage, callbacks: TCallbacks) {
  run(async () => {
    if (!this.activeConnection.isOpen()) {
      await this.open();
    }
    await sleep(0);  // Yield to collect more requests
    
    if (!this.requestManager.hasOutgoingRequests()) return;
    
    // Flush and send all queued requests
    this.send(this.requestManager.flush().map(({ message }) => message));
  });
  
  return this.requestManager.register(message, callbacks);
}
```

### Wire Format

WebSocket sends either single message or array:
```typescript
this.activeConnection.ws.send(
  this.encoder.encode(messages.length === 1 ? messages[0] : messages)
);
```

## Signal Handling

### allAbortSignals

For batch cancellation - aborts only when ALL requests abort:

```typescript
function allAbortSignals(...signals: Maybe<AbortSignal>[]): AbortSignal {
  // Merged signal aborts when all individual signals abort
}
```

### raceAbortSignals

For streaming - aborts when ANY signal aborts:

```typescript
function raceAbortSignals(...signals: Maybe<AbortSignal>[]): AbortSignal {
  // Ponyfill for AbortSignal.any()
}
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| `setTimeout(dispatch)` no delay | Batches all synchronous calls in same tick |
| Separate query/mutation loaders | Different HTTP methods, can't mix in same request |
| No caching | Simplicity, caching belongs in application layer |
| Validation-based splitting | Handles URL length limits, max items gracefully |
| Batch cancelled only when ALL abort | Prevents partial batch failures |
| Numeric input keys | Maintains order, supports sparse arrays |
| `batch=1` query param | Simple server-side detection |

## Comparison with GraphQL DataLoader

| Feature | tRPC | GraphQL DataLoader |
|---------|------|-------------------|
| Timing | `setTimeout()` | `process.nextTick()` or `setTimeout()` |
| Caching | None | Per-request cache |
| Cancellation | Full support | Limited |
| Validation | Custom validate function | Max batch size only |
| Error handling | Per-item | Per-batch or per-item |

## Effect-TS Adaptation

For Effect-TS implementation, consider:

1. **Use `Effect.sleep(0)` or `Effect.yieldNow()`** for microtask-based batching
2. **Leverage `@effect/platform` Request/Resolver** for DataLoader-like batching
3. **Use `Fiber` interruption** instead of AbortSignal
4. **Consider `Effect.cached` or `RequestResolver`** for optional caching layer
5. **Schema-based validation** for batch size/URL length constraints
