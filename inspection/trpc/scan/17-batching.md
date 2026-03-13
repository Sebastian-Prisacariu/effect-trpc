# H17: Request Batching Analysis

## Overview

tRPC implements request batching using a custom DataLoader pattern inspired by Facebook's GraphQL DataLoader. The implementation allows multiple procedure calls made in the same event loop tick to be combined into a single HTTP request.

## Core Implementation

### DataLoader (`internals/dataLoader.ts`)

The batching system is built on a custom DataLoader implementation:

```typescript
// Key data structures
type BatchItem<TKey, TValue> = {
  aborted: boolean;
  key: TKey;
  resolve: ((value: TValue) => void) | null;
  reject: ((error: Error) => void) | null;
  batch: Batch<TKey, TValue> | null;
};

type Batch<TKey, TValue> = {
  items: BatchItem<TKey, TValue>[];
};

export type BatchLoader<TKey, TValue> = {
  validate: (keys: TKey[]) => boolean;  // Can this batch accept more items?
  fetch: (keys: TKey[]) => Promise<TValue[] | Promise<TValue>[]>;  // Execute the batch
};
```

### Timing Mechanism

The timing uses `setTimeout(dispatch)` with no delay (0ms):

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

  // Schedule dispatch for next event loop tick
  dispatchTimer ??= setTimeout(dispatch);

  return promise;
}
```

**Key insight**: The batching window is exactly one event loop tick. All requests made synchronously in the same tick are batched together. This is the classic DataLoader pattern.

### Request Aggregation Strategy

The `groupItems` function handles splitting items into valid batches:

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

    // Ask the loader if adding this item would still be valid
    const isValid = batchLoader.validate(
      lastGroup.concat(item).map((it) => it.key),
    );

    if (isValid) {
      lastGroup.push(item);
      index++;
      continue;
    }

    // Item doesn't fit - start a new group
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

## HTTP Batch Link Implementation

### httpBatchLink (`links/httpBatchLink.ts`)

Creates separate DataLoaders for queries and mutations:

```typescript
export function httpBatchLink<TRouter extends AnyRouter>(
  opts: HTTPBatchLinkOptions<TRouter['_def']['_config']['$types']>,
): TRPCLink<TRouter> {
  const maxURLLength = opts.maxURLLength ?? Infinity;
  const maxItems = opts.maxItems ?? Infinity;

  return () => {
    const batchLoader = (type: ProcedureType): BatchLoader<Operation, HTTPResult> => {
      return {
        // Validate if batch can accept more operations
        validate(batchOps) {
          if (maxURLLength === Infinity && maxItems === Infinity) {
            return true;  // Fast path
          }
          if (batchOps.length > maxItems) {
            return false;
          }
          // Check URL length constraint (for GET requests)
          const path = batchOps.map((op) => op.path).join(',');
          const inputs = batchOps.map((op) => op.input);
          const url = getUrl({ ...resolvedOpts, type, path, inputs, signal: null });
          return url.length <= maxURLLength;
        },
        
        // Execute the batched request
        async fetch(batchOps) {
          const path = batchOps.map((op) => op.path).join(',');
          const inputs = batchOps.map((op) => op.input);
          const signal = allAbortSignals(...batchOps.map((op) => op.signal));
          
          const res = await jsonHttpRequester({
            ...resolvedOpts,
            path,
            inputs,
            type,
            headers() { /* ... */ },
            signal,
          });
          
          // Distribute responses back to individual callers
          const resJSON = Array.isArray(res.json)
            ? res.json
            : batchOps.map(() => res.json);
          return resJSON.map((item) => ({
            meta: res.meta,
            json: item,
          }));
        },
      };
    };

    const query = dataLoader(batchLoader('query'));
    const mutation = dataLoader(batchLoader('mutation'));
    const loaders = { query, mutation };
    
    return ({ op }) => {
      // Use the appropriate loader
      const loader = loaders[op.type];
      const promise = loader.load(op);
      // ...
    };
  };
}
```

### Configuration Options

```typescript
type HTTPBatchLinkOptions<TRoot extends AnyClientTypes> = {
  url: string | URL;
  maxURLLength?: number;   // Max URL length for GET requests
  maxItems?: number;       // Max operations per batch (default: Infinity)
  headers?: HTTPHeaders | ((opts: { opList: NonEmptyArray<Operation> }) => HTTPHeaders | Promise<HTTPHeaders>);
};
```

## URL Construction

Batched requests use a specific URL format:

```typescript
// From httpUtils.ts
export const getUrl: GetUrl = (opts) => {
  let url = base + '/' + opts.path;  // Paths joined by comma: "user.get,post.list"
  const queryParts: string[] = [];

  if ('inputs' in opts) {
    queryParts.push('batch=1');  // Signal to server this is a batch
  }
  if (opts.type === 'query' || opts.type === 'subscription') {
    const input = getInput(opts);  // Inputs as indexed object: {0: ..., 1: ...}
    if (input !== undefined && opts.methodOverride !== 'POST') {
      queryParts.push(`input=${encodeURIComponent(JSON.stringify(input))}`);
    }
  }
  // ...
};
```

**Example batched URL:**
```
/api/trpc/user.get,post.list?batch=1&input={"0":{"id":"123"},"1":{"limit":10}}
```

## Response Distribution

When the batch response arrives, responses are distributed back to individual callers:

```typescript
// In dispatch()
const promise = batchLoader.fetch(batch.items.map((_item) => _item.key));

promise.then(async (result) => {
  await Promise.all(
    result.map(async (valueOrPromise, index) => {
      const item = batch.items[index]!;
      try {
        const value = await Promise.resolve(valueOrPromise);
        item.resolve?.(value);  // Resolve individual promise
      } catch (cause) {
        item.reject?.(cause as Error);  // Reject individual promise
      }
      item.batch = null;
    }),
  );
});
```

## Abort Signal Handling

The batching system has sophisticated abort handling:

```typescript
// allAbortSignals: Batch is only aborted when ALL items are aborted
export function allAbortSignals(...signals: Maybe<AbortSignal>[]): AbortSignal {
  const ac = new AbortController();
  let abortedCount = 0;
  
  const onAbort = () => {
    if (++abortedCount === signals.length) {
      ac.abort();
    }
  };
  
  for (const signal of signals) {
    signal?.addEventListener('abort', onAbort, { once: true });
  }
  
  return ac.signal;
}
```

**Key behavior**: A batched request is only aborted when ALL operations in the batch are cancelled. This prevents one cancelled operation from affecting others.

## httpBatchStreamLink Variant

The streaming variant uses JSONL (JSON Lines) format for progressive responses:

```typescript
// Uses jsonlStreamConsumer for parsing
const [head] = await jsonlStreamConsumer<Record<string, Promise<any>>>({
  from: res.body!,
  deserialize: (data) => resolvedOpts.transformer.output.deserialize(data),
  formatError(opts) {
    return TRPCClientError.from({ error: opts.error });
  },
  abortController,
});

// Responses come as promises indexed by position
const promises = Object.keys(batchOps).map(
  async (key): Promise<HTTPResult> => {
    let json: TRPCResponse = await Promise.resolve(head[key]);
    // ...
  },
);
```

## WebSocket Batching

WebSocket connections also support batching:

```typescript
// In wsClient.ts
private batchSend(message: TRPCClientOutgoingMessage, callbacks: TCallbacks) {
  this.inactivityTimeout.reset();

  run(async () => {
    if (!this.activeConnection.isOpen()) {
      await this.open();
    }
    await sleep(0);  // Wait for next tick (like setTimeout)

    if (!this.requestManager.hasOutgoingRequests()) return;

    // Send all pending messages as array
    this.send(this.requestManager.flush().map(({ message }) => message));
  });

  return this.requestManager.register(message, callbacks);
}
```

The RequestManager tracks outgoing vs pending requests:
- **Outgoing**: Queued, waiting to be sent
- **Pending**: Sent, awaiting response

## Server-Side Handling

The server detects batched requests and processes them:

```typescript
// In contentType.ts
const isBatchCall = opts.searchParams.get('batch') === '1';
const paths = isBatchCall ? opts.path.split(',') : [opts.path];

// Parse indexed inputs
const calls = await Promise.all(
  paths.map(async (path, index): Promise<TRPCRequestInfo['calls'][number]> => {
    const procedure = await getProcedureAtPath(opts.router, path);
    return {
      batchIndex: index,
      path,
      procedure,
      getRawInput: async () => {
        const inputs = await getInputs.read();
        return inputs[index];
      },
    };
  }),
);
```

Response format for batch:
```json
[
  { "result": { "data": "..." } },
  { "result": { "data": "..." } },
  { "error": { "code": -32600, "message": "..." } }
]
```

## Effect Implementation Strategy

### 1. Effect-based DataLoader

```typescript
import { Effect, Deferred, Queue, Fiber, Duration, Schedule } from "effect"

interface BatchItem<K, V> {
  readonly key: K
  readonly deferred: Deferred.Deferred<V, Error>
  readonly signal: AbortSignal | null
}

interface BatchLoader<K, V> {
  validate: (keys: readonly K[]) => boolean
  fetch: (keys: readonly K[]) => Effect.Effect<readonly V[], Error>
}

const makeDataLoader = <K, V>(
  loader: BatchLoader<K, V>
) => Effect.gen(function* () {
  const queue = yield* Queue.unbounded<BatchItem<K, V>>()
  
  // Process batches
  const processBatch = Effect.gen(function* () {
    // Collect all pending items
    const items = yield* Queue.takeAll(queue)
    if (items.length === 0) return
    
    // Group items by validation
    const groups = groupByValidation(items, loader.validate)
    
    // Process each group
    yield* Effect.forEach(groups, (group) => 
      Effect.gen(function* () {
        const keys = group.map(item => item.key)
        const result = yield* loader.fetch(keys)
        
        // Resolve individual deferreds
        yield* Effect.forEach(
          group,
          (item, index) => Deferred.succeed(item.deferred, result[index]),
          { discard: true }
        )
      }).pipe(
        Effect.catchAll((error) =>
          Effect.forEach(
            group,
            (item) => Deferred.fail(item.deferred, error),
            { discard: true }
          )
        )
      )
    , { discard: true })
  })
  
  // Schedule batch processing on next tick
  const scheduleLoop = processBatch.pipe(
    Effect.delay(Duration.zero),  // Next tick
    Effect.forever,
    Effect.fork
  )
  
  yield* scheduleLoop
  
  return {
    load: (key: K, signal?: AbortSignal) => 
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<V, Error>()
        yield* Queue.offer(queue, { key, deferred, signal: signal ?? null })
        return yield* Deferred.await(deferred)
      })
  }
})
```

### 2. Batch-aware HTTP Client

```typescript
const makeBatchHttpClient = (config: BatchConfig) =>
  Effect.gen(function* () {
    const queryLoader = yield* makeDataLoader({
      validate: (ops) => {
        if (ops.length > config.maxItems) return false
        const url = buildBatchUrl(ops)
        return url.length <= config.maxURLLength
      },
      fetch: (ops) => 
        Effect.gen(function* () {
          const path = ops.map(op => op.path).join(',')
          const inputs = Object.fromEntries(ops.map((op, i) => [i, op.input]))
          
          const response = yield* HttpClient.request
            .get(`${config.url}/${path}`)
            .pipe(
              HttpClient.request.setUrlParam("batch", "1"),
              HttpClient.request.setUrlParam("input", JSON.stringify(inputs)),
              HttpClient.client.execute,
              HttpClient.response.json
            )
          
          return response as readonly unknown[]
        })
    })
    
    return queryLoader
  })
```

### 3. Abort Signal Integration

```typescript
// Create combined abort for batch
const combinedAbort = (signals: readonly (AbortSignal | null)[]) =>
  Effect.gen(function* () {
    // Only abort when ALL signals abort
    const scope = yield* Effect.scope
    let abortedCount = 0
    
    const deferred = yield* Deferred.make<void, never>()
    
    for (const signal of signals) {
      if (signal) {
        signal.addEventListener('abort', () => {
          abortedCount++
          if (abortedCount === signals.length) {
            Effect.runSync(Deferred.succeed(deferred, undefined))
          }
        })
      }
    }
    
    return yield* Deferred.await(deferred)
  })
```

### 4. Streaming Batch Support

```typescript
const batchStreamLink = Effect.gen(function* () {
  return {
    fetch: (ops: readonly Operation[]) =>
      Effect.gen(function* () {
        const response = yield* httpRequest(ops)
        
        // Parse JSONL stream
        const stream = yield* Stream.fromReadableStream(
          () => response.body!,
          (error) => new Error(`Stream error: ${error}`)
        )
        
        // Collect indexed results
        const results = yield* stream.pipe(
          Stream.splitLines,
          Stream.mapEffect((line) => 
            Effect.try(() => JSON.parse(line))
          ),
          Stream.runCollect
        )
        
        return results
      })
  }
})
```

## Key Takeaways

1. **Timing**: Batching window is one event loop tick (`setTimeout(fn)` with no delay)
2. **Validation**: Batches are split based on URL length and item count constraints
3. **Abort handling**: Batch only aborts when ALL operations are cancelled
4. **Response mapping**: Results are indexed and distributed to individual callers
5. **Separate loaders**: Queries and mutations have separate batch queues
6. **Server detection**: `batch=1` query param signals batch mode

## Effect Advantages

- **Queue-based batching**: Use `Queue.unbounded` for collecting items
- **Deferred for individual results**: Clean resolution pattern
- **Stream for JSONL**: Native streaming support
- **Fiber for background processing**: Clean lifecycle management
- **Duration.zero**: Equivalent to setTimeout(fn, 0) for next-tick scheduling
