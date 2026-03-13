# H17: tRPC Batching Implementation

## Overview

tRPC implements request batching using a custom DataLoader pattern with **zero-delay setTimeout** for timing. The implementation is elegantly simple and battle-tested.

---

## Core Architecture

### 1. DataLoader Pattern

**Location:** `packages/client/src/internals/dataLoader.ts`

tRPC's batching is inspired by Facebook's DataLoader but with key differences:
- No caching
- Supports cancellation
- Uses validation function for batch splitting

```typescript
export function dataLoader<TKey, TValue>(
  batchLoader: BatchLoader<TKey, TValue>,
) {
  let pendingItems: BatchItem<TKey, TValue>[] | null = null;
  let dispatchTimer: ReturnType<typeof setTimeout> | null = null;

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

    // THE KEY TIMING MECHANISM
    dispatchTimer ??= setTimeout(dispatch);

    return promise;
  }

  return { load };
}
```

### 2. Timing Mechanism: Zero-Delay setTimeout

The critical line:
```typescript
dispatchTimer ??= setTimeout(dispatch);
```

**How it works:**
1. First call to `load()` adds item to `pendingItems` and schedules `dispatch`
2. `setTimeout` with no delay schedules for the **next event loop tick**
3. All synchronous `load()` calls in the same tick accumulate items
4. When the event loop processes the timer, `dispatch()` runs with all items

**Why this works:**
- JavaScript's event loop processes all synchronous code before timers
- A zero-delay `setTimeout` queues to the macrotask queue
- All operations in the current synchronous execution batch together

```
┌─────────────────────────────────────────────────────────────┐
│ Synchronous Execution (Current Tick)                        │
│                                                             │
│  client.user.get()  ──┐                                     │
│  client.post.list() ──┼──▶ pendingItems: [user.get, post.list, post.get]
│  client.post.get()  ──┘                                     │
│                                                             │
│  setTimeout(dispatch) queued ──▶ macrotask queue            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Next Event Loop Tick                                        │
│                                                             │
│  dispatch() runs                                            │
│    └─▶ batchLoader.fetch([user.get, post.list, post.get])   │
│          └─▶ Single HTTP request with all operations        │
└─────────────────────────────────────────────────────────────┘
```

---

## Batch Validation & Splitting

### The Validate Function

Before batching, items are validated and grouped:

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

    // Check if adding this item keeps the batch valid
    const isValid = batchLoader.validate(
      lastGroup.concat(item).map((it) => it.key),
    );

    if (isValid) {
      lastGroup.push(item);
      index++;
      continue;
    }

    // Item doesn't fit - start new group
    if (lastGroup.length === 0) {
      item.reject?.(new Error('Input is too big for a single dispatch'));
      index++;
      continue;
    }
    groupedItems.push([]);
  }
  return groupedItems;
}
```

### Validation Criteria

**httpBatchLink validation:**

```typescript
validate(batchOps) {
  // Fast path: no limits
  if (maxURLLength === Infinity && maxItems === Infinity) {
    return true;
  }
  
  // Check item count limit
  if (batchOps.length > maxItems) {
    return false;
  }
  
  // Check URL length limit
  const path = batchOps.map((op) => op.path).join(',');
  const inputs = batchOps.map((op) => op.input);
  const url = getUrl({ ...resolvedOpts, type, path, inputs, signal: null });
  
  return url.length <= maxURLLength;
}
```

**Limits:**
- `maxItems` - Maximum operations per batch (default: Infinity)
- `maxURLLength` - Maximum URL length for GET requests (default: Infinity)

---

## HTTP Batch Implementation

### httpBatchLink

**Location:** `packages/client/src/links/httpBatchLink.ts`

```typescript
export function httpBatchLink<TRouter extends AnyRouter>(
  opts: HTTPBatchLinkOptions<TRouter['_def']['_config']['$types']>,
): TRPCLink<TRouter> {
  return () => {
    // Separate loaders for queries and mutations
    const query = dataLoader(batchLoader('query'));
    const mutation = dataLoader(batchLoader('mutation'));
    const loaders = { query, mutation };

    return ({ op }) => {
      return observable((observer) => {
        const loader = loaders[op.type];
        const promise = loader.load(op);

        promise
          .then((res) => {
            const transformed = transformResult(res.json, ...);
            if (!transformed.ok) {
              observer.error(TRPCClientError.from(transformed.error));
              return;
            }
            observer.next({ context: res.meta, result: transformed.result });
            observer.complete();
          })
          .catch((err) => observer.error(TRPCClientError.from(err)));

        return () => { /* noop - no cancellation support */ };
      });
    };
  };
}
```

### Batch Fetch Implementation

```typescript
async fetch(batchOps) {
  const path = batchOps.map((op) => op.path).join(',');
  const inputs = batchOps.map((op) => op.input);
  const signal = allAbortSignals(...batchOps.map((op) => op.signal));

  const res = await jsonHttpRequester({
    ...resolvedOpts,
    path,      // "user.get,post.list,post.get"
    inputs,    // { "0": {...}, "1": {...}, "2": {...} }
    type,
    signal,
  });

  // Response is an array matching the request order
  const resJSON = Array.isArray(res.json)
    ? res.json
    : batchOps.map(() => res.json);
  
  return resJSON.map((item) => ({
    meta: res.meta,
    json: item,
  }));
}
```

---

## HTTP Batch Stream Link

**Location:** `packages/client/src/links/httpBatchStreamLink.ts`

For responses that may stream in out-of-order (JSONL streaming):

```typescript
async fetch(batchOps) {
  const responsePromise = fetchHTTPResponse({
    ...resolvedOpts,
    trpcAcceptHeader: 'application/jsonl',  // Request JSONL format
    ...
  });

  const res = await responsePromise;
  const [head] = await jsonlStreamConsumer<Record<string, Promise<any>>>({
    from: res.body!,
    deserialize: (data) => resolvedOpts.transformer.output.deserialize(data),
    ...
  });

  // Each result is a promise that resolves when that response arrives
  const promises = Object.keys(batchOps).map(
    async (key): Promise<HTTPResult> => {
      let json: TRPCResponse = await Promise.resolve(head[key]);
      // Unwrap nested promises for streaming data
      if ('result' in json) {
        const result = await Promise.resolve(json.result);
        json = { result: { data: await Promise.resolve(result.data) } };
      }
      return { json, meta: { response: res } };
    }
  );
  
  return promises;
}
```

---

## WebSocket Batching

### Request Manager

**Location:** `packages/client/src/links/wsLink/wsClient/requestManager.ts`

WebSocket uses a different pattern with explicit flush:

```typescript
export class RequestManager {
  // Requests waiting to be sent
  private outgoingRequests = new Array<Request & { id: MessageId }>();
  
  // Requests sent, awaiting response
  private pendingRequests: Record<MessageId, Request> = {};

  public register(message: TRPCClientOutgoingMessage, callbacks: TCallbacks) {
    this.outgoingRequests.push({
      id: String(message.id),
      message,
      end,
      callbacks: { ... },
    });
    return () => { this.delete(message.id); ... };
  }

  // Move all outgoing to pending and return them
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

### WsClient Batch Send

```typescript
private batchSend(message: TRPCClientOutgoingMessage, callbacks: TCallbacks) {
  run(async () => {
    if (!this.activeConnection.isOpen()) {
      await this.open();
    }
    
    // Zero-delay sleep for batching
    await sleep(0);

    if (!this.requestManager.hasOutgoingRequests()) return;

    // Send all queued messages as array
    this.send(this.requestManager.flush().map(({ message }) => message));
  });

  return this.requestManager.register(message, callbacks);
}
```

**Key difference:** Uses `sleep(0)` (Promise-based) instead of `setTimeout`, but achieves the same effect.

---

## Server-Side Batch Handling

### Request Parsing

**Location:** `packages/server/src/unstable-core-do-not-import/http/contentType.ts`

```typescript
async parse(opts) {
  const isBatchCall = opts.searchParams.get('batch') === '1';
  const paths = isBatchCall ? opts.path.split(',') : [opts.path];

  const getInputs = memo(async (): Promise<InputRecord> => {
    // GET: parse from ?input=JSON
    // POST: parse from body
    const inputs = ...;
    
    if (!isBatchCall) {
      return { 0: deserialize(inputs) };
    }

    // Batch: inputs is an object keyed by index
    if (!isObject(inputs)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '"input" needs to be an object when doing a batch call',
      });
    }
    
    const acc: InputRecord = {};
    for (const index of paths.keys()) {
      acc[index] = deserialize(inputs[index]);
    }
    return acc;
  });

  // Create call descriptors for each path
  const calls = await Promise.all(
    paths.map(async (path, index) => ({
      batchIndex: index,
      path,
      procedure: await getProcedureAtPath(opts.router, path),
      getRawInput: async () => (await getInputs.read())[index],
    }))
  );

  return { isBatchCall, calls, ... };
}
```

### Response Resolution

```typescript
// resolveResponse.ts
const allowBatching = opts.allowBatching ?? opts.batching?.enabled ?? true;

if (info.isBatchCall && !allowBatching) {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Batching is not enabled on the server',
  });
}

// Execute all calls in parallel
const rpcCalls = info.calls.map(async (call) => {
  const data = await proc({
    path: call.path,
    getRawInput: call.getRawInput,
    ctx: ctxManager.value(),
    batchIndex: call.batchIndex,  // Passed to middleware
  });
  return [undefined, { data }];
});

// Response handlers for batch vs single...
```

---

## Abort Signal Handling

### allAbortSignals (AND logic)

Only aborts when ALL operations are aborted:

```typescript
export function allAbortSignals(...signals: Maybe<AbortSignal>[]): AbortSignal {
  const ac = new AbortController();
  const count = signals.length;
  let abortedCount = 0;

  const onAbort = () => {
    if (++abortedCount === count) {
      ac.abort();
    }
  };

  for (const signal of signals) {
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  }

  return ac.signal;
}
```

### raceAbortSignals (OR logic)

Aborts when ANY operation is aborted:

```typescript
export function raceAbortSignals(...signals: Maybe<AbortSignal>[]): AbortSignal {
  const ac = new AbortController();

  for (const signal of signals) {
    if (signal?.aborted) {
      ac.abort();
    } else {
      signal?.addEventListener('abort', () => ac.abort(), { once: true });
    }
  }

  return ac.signal;
}
```

**httpBatchLink** uses `allAbortSignals` - batch continues until all cancelled
**httpBatchStreamLink** uses `raceAbortSignals` - can abort stream early

---

## Wire Format

### HTTP Batch Request

```
GET /api/trpc/user.get,post.list,post.getById?batch=1&input=%7B%220%22%3A%7B%7D%2C%221%22%3A%7B%7D%2C%222%22%3A%7B%22id%22%3A1%7D%7D

Decoded input: {"0":{},"1":{},"2":{"id":1}}
```

### HTTP Batch Response

```json
[
  {"result":{"data":{"id":1,"name":"John"}}},
  {"result":{"data":[{"id":1,"title":"Post 1"}]}},
  {"result":{"data":{"id":1,"title":"Post 1"}}}
]
```

### WebSocket Batch

Messages are sent as an array:
```json
[
  {"id":1,"method":"query","params":{"path":"user.get","input":{}}},
  {"id":2,"method":"query","params":{"path":"post.list","input":{}}},
  {"id":3,"method":"query","params":{"path":"post.getById","input":{"id":1}}}
]
```

---

## Summary: Why Our Batching Might Not Work

Based on this analysis, common issues with custom batching implementations:

1. **Timing:** Must use `setTimeout` with zero/no delay to defer to next tick
2. **Shared state:** Need mutable shared state (`pendingItems`) across calls
3. **Single dispatch:** Only one `setTimeout` should be scheduled per batch window
4. **Validation:** Need to split batches that exceed limits
5. **Promise resolution:** Each call needs its own promise that resolves with its result

### Key Pattern to Copy

```typescript
let pending: Item[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function load(item: Item): Promise<Result> {
  return new Promise((resolve, reject) => {
    pending ??= [];
    pending.push({ item, resolve, reject });
    
    // Only schedule once per batch window
    timer ??= setTimeout(() => {
      const batch = pending!;
      pending = null;
      timer = null;
      
      executeBatch(batch);
    });
  });
}
```

The critical insight: **`setTimeout(fn)` without a delay schedules `fn` for the next event loop tick**, allowing all synchronous calls to accumulate first.
