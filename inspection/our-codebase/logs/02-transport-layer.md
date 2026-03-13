# Transport Layer Implementation Analysis

## Executive Summary

The transport layer is **partially implemented**. The HTTP transport provides basic request/response functionality but lacks critical production features. Batching is configured but **not implemented**. SSE/streaming has a clear TODO marker and falls back to single-response behavior. The loopback transport works for testing but has subtle issues.

---

## 1. HTTP Transport Analysis

### What's Implemented

**Location:** `src/Transport/index.ts:265-276`

```typescript
export const http = (
  url: string,
  options?: HttpOptions
): Layer.Layer<Transport, never, never> => {
  const fetchFn = options?.fetch ?? globalThis.fetch
  const timeout = options?.timeout ? Duration.toMillis(options.timeout) : 30000
  
  return Layer.succeed(Transport, {
    send: (request) => sendHttp(url, request, fetchFn, options?.headers, timeout),
    sendStream: (request) => sendHttpStream(url, request, fetchFn, options?.headers),
  })
}
```

**Actual HTTP request logic:** `src/Transport/index.ts:278-353`

The `sendHttp` function handles:
- Header resolution (static or async function)
- Timeout via AbortController
- POST request with JSON body
- Response status validation
- JSON parsing
- Schema validation of response envelope

### What's Missing/Issues

#### Issue 1: Batching is Configured but NOT Implemented

**Configuration accepted:** `src/Transport/index.ts:213-238`
```typescript
readonly batching?: {
  readonly enabled?: boolean
  readonly window?: Duration.DurationInput
  readonly maxSize?: number
  readonly queries?: boolean
  readonly mutations?: boolean
}
```

**But never used!** The `http` function completely ignores the batching options:
```typescript
export const http = (
  url: string,
  options?: HttpOptions  // batching is in here
): Layer.Layer<Transport, never, never> => {
  const fetchFn = options?.fetch ?? globalThis.fetch
  const timeout = options?.timeout ? Duration.toMillis(options.timeout) : 30000
  
  return Layer.succeed(Transport, {
    send: (request) => sendHttp(url, request, fetchFn, options?.headers, timeout),
    // ^ No batching logic whatsoever!
    sendStream: (request) => sendHttpStream(url, request, fetchFn, options?.headers),
  })
}
```

**Impact:** Users configure batching expecting it to work (like tRPC), but every request goes individually.

**Recommendation:** Implement batching using:
- `Ref` to collect requests within a time window
- `Deferred` for each request to wait for batch response
- A fiber that flushes the batch

#### Issue 2: Timeout Cleanup Not Guaranteed

**Location:** `src/Transport/index.ts:291-320`
```typescript
const controller = new globalThis.AbortController()
const timeoutId = timeout
  ? globalThis.setTimeout(() => controller.abort(), timeout)
  : undefined

const response = yield* Effect.tryPromise({...})

if (timeoutId) globalThis.clearTimeout(timeoutId)  // Only reached on success!
```

**Bug:** If the fetch throws an error BEFORE the timeout fires, the timeout is **not cleared**. The `tryPromise.catch` path doesn't clear it.

**Fix:**
```typescript
return Effect.gen(function* () {
  // ... setup
}).pipe(
  Effect.ensuring(Effect.sync(() => {
    if (timeoutId) globalThis.clearTimeout(timeoutId)
  }))
)
```

#### Issue 3: No Retry Logic

The transport has `isTransientError` helper:
```typescript
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransportError) {
    return error.reason === "Network" || error.reason === "Timeout"
  }
  return false
}
```

But **no built-in retry** mechanism exists. Users must implement their own retry wrapper.

**Recommendation:** Add retry configuration to `HttpOptions`:
```typescript
readonly retry?: {
  readonly times?: number
  readonly delay?: Duration.DurationInput
  readonly when?: (error: TransportError) => boolean
}
```

#### Issue 4: No Request Deduplication

Multiple components calling the same query simultaneously will make multiple HTTP requests. tRPC handles this with request deduplication.

---

## 2. Batching Configuration vs Implementation Gap

### Test Shows Configuration is Accepted

**Location:** `test/transport.test.ts:54-66`
```typescript
it("accepts batching configuration", () => {
  const layer = Transport.http("/api/trpc", {
    batching: {
      enabled: true,
      window: "10 millis",
      maxSize: 50,
      queries: true,
      mutations: false,
    },
  })

  expect(layer).toBeDefined()  // Just checks the layer exists, not that batching works!
})
```

**Problem:** Test only verifies the configuration doesn't throw, not that batching actually batches requests.

### How Batching Should Work

1. Collect requests within `window` duration
2. Combine into single HTTP request with array body
3. Parse array response and route to individual callers
4. Respect `maxSize` limit
5. Optionally separate queries vs mutations

### Implementation Sketch

```typescript
interface BatchState {
  readonly requests: Array<{
    request: TransportRequest
    deferred: Deferred.Deferred<TransportResponse, TransportError>
  }>
  readonly flushFiber: Fiber.RuntimeFiber<void, never> | null
}

const createBatchedSend = (
  url: string,
  options: HttpOptions
) => {
  const state = Ref.unsafeMake<BatchState>({ requests: [], flushFiber: null })
  const window = options.batching?.window ?? Duration.millis(0)
  
  return (request: TransportRequest) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<TransportResponse, TransportError>()
      
      yield* Ref.update(state, (s) => ({
        ...s,
        requests: [...s.requests, { request, deferred }],
      }))
      
      // Schedule flush if not already scheduled
      yield* scheduleFlush(state, url, window)
      
      return yield* Deferred.await(deferred)
    })
}
```

---

## 3. SSE/Streaming Analysis

### The TODO

**Location:** `src/Transport/index.ts:355-371`
```typescript
const sendHttpStream = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<StreamResponse, TransportError> =>
  // TODO: Implement proper SSE/streaming - for now just convert single response
  Stream.fromEffect(
    sendHttp(url, request, fetchFn, headers, undefined).pipe(
      Effect.map((response): StreamResponse => {
        if (Schema.is(Transport.Success)(response)) {
          return new StreamChunk({ id: response.id, chunk: response.value })
        }
        return response // Failure passes through
      })
    )
  )
```

### What's Missing

1. **No actual SSE connection** - It just makes a regular HTTP request
2. **No EventSource usage** - Should use EventSource or fetch with streaming body
3. **No reconnection logic** - SSE needs automatic reconnection
4. **No heartbeat handling** - Standard SSE pattern
5. **No timeout for streams** - Streams need different timeout handling

### Proper SSE Implementation Would Look Like:

```typescript
const sendHttpStream = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<StreamResponse, TransportError> =>
  Stream.async<StreamResponse, TransportError>((emit) => {
    const eventSource = new EventSource(
      `${url}/stream?tag=${encodeURIComponent(request.tag)}&payload=${encodeURIComponent(JSON.stringify(request.payload))}`
    )
    
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      emit.single(new StreamChunk({ id: request.id, chunk: data }))
    }
    
    eventSource.onerror = () => {
      emit.fail(new TransportError({ reason: "Closed", message: "SSE connection closed" }))
    }
    
    eventSource.addEventListener("end", () => {
      emit.single(new StreamEnd({ id: request.id }))
      emit.end()
    })
    
    return Effect.sync(() => eventSource.close())
  })
```

### Server-Side Stream Handling

**Location:** `src/Server/index.ts:285-337`

The server correctly handles streams:
```typescript
const handleStream = (request: TransportRequest): Stream.Stream<StreamResponse, never, R> => {
  // ... validation
  const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
  
  return stream.pipe(
    Stream.map((value): StreamResponse => 
      new StreamChunk({ id: request.id, chunk: value })
    ),
    Stream.catchAll((error): Stream.Stream<StreamResponse, never, R> =>
      Stream.succeed(new Transport.Failure({ id: request.id, error }))
    ),
    Stream.concat(Stream.succeed(new Transport.StreamEnd({ id: request.id })))
  )
}
```

**Gap:** Server handles streams correctly, but client HTTP transport doesn't actually stream them.

---

## 4. Loopback Transport Analysis

### Implementation

**Location:** `src/Transport/index.ts:575-601`
```typescript
export const loopback = <D extends Router.Definition, R>(
  server: {
    readonly handle: (request: TransportRequest) => Effect.Effect<TransportResponse, never, R>
    readonly handleStream: (request: TransportRequest) => Stream.Stream<StreamResponse, never, R>
  }
): Layer.Layer<Transport, never, R> =>
  Layer.effect(
    Transport,
    Effect.gen(function* () {
      return {
        send: (request: TransportRequest) => 
          server.handle(request).pipe(
            Effect.mapError(() => new TransportError({ 
              reason: "Protocol", 
              message: "Server error" 
            }))
          ) as Effect.Effect<TransportResponse, TransportError>,
        sendStream: (request: TransportRequest) => 
          server.handleStream(request).pipe(
            Stream.mapError(() => new TransportError({ 
              reason: "Protocol", 
              message: "Server stream error" 
            }))
          ) as Stream.Stream<StreamResponse, TransportError>,
      }
    })
  )
```

### Issues

#### Issue 1: Error Information Lost

```typescript
Effect.mapError(() => new TransportError({ 
  reason: "Protocol", 
  message: "Server error"  // Original error context lost!
}))
```

**Fix:**
```typescript
Effect.mapError((cause) => new TransportError({ 
  reason: "Protocol", 
  message: "Server error",
  cause,  // Preserve original error
}))
```

#### Issue 2: Server Never Errors

Looking at `Server.handle`:
```typescript
readonly handle: (
  request: Transport.TransportRequest
) => Effect.Effect<Transport.TransportResponse, never, R>  // Error type is `never`
```

The server converts all errors to `Failure` responses, so `mapError` in loopback **never triggers**. The error mapping is dead code.

#### Issue 3: Type Assertion

```typescript
) as Effect.Effect<TransportResponse, TransportError>,
```

These `as` casts are needed because the server's error type is `never` but transport expects `TransportError`. While technically safe, it hides the actual type relationship.

### Test Implementation

**Location:** `test/e2e/loopback.test.ts:14-31`
```typescript
const LoopbackTransportLayer = Layer.succeed(
  Transport.Transport,
  {
    send: (request: Transport.TransportRequest) => 
      testServer.handle(request).pipe(
        Effect.provide(TestDatabaseLive)
      ) as Effect.Effect<Transport.TransportResponse, Transport.TransportError>,
    sendStream: (request: Transport.TransportRequest) => 
      Stream.unwrap(
        Effect.provide(
          Effect.succeed(testServer.handleStream(request)),
          TestDatabaseLive
        )
      ).pipe(
        Stream.provideLayer(TestDatabaseLive)
      ) as Stream.Stream<Transport.StreamResponse, Transport.TransportError>,
  }
)
```

**Issue:** The stream handling is awkward:
1. `Effect.succeed(testServer.handleStream(request))` - wraps stream in Effect
2. `Stream.unwrap` - unwraps it
3. `Stream.provideLayer(TestDatabaseLive)` - provides layer again

This is convoluted. Cleaner approach:
```typescript
sendStream: (request) => 
  testServer.handleStream(request).pipe(
    Stream.provideLayer(TestDatabaseLive)
  )
```

---

## 5. Mock Transport Analysis

### Implementation

**Location:** `src/Transport/index.ts:426-484`
```typescript
export const mock = <D extends Router.Definition>(
  handlers: MockHandlers<D>
): Layer.Layer<Transport, never, never> => {
  const handlerMap = handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>
  
  return Layer.succeed(Transport, {
    send: (request) =>
      Effect.gen(function* () {
        const path = tagToPath(request.tag)
        const handler = handlerMap[path]
        
        if (!handler) {
          return yield* Effect.fail(
            new TransportError({
              reason: "Protocol",
              message: `No mock handler for: ${request.tag} (path: ${path})`,
            })
          )
        }
        
        const result = yield* handler(request.payload).pipe(Effect.either)
        
        if (result._tag === "Left") {
          return new Failure({ id: request.id, error: result.left })
        }
        
        return new Success({ id: request.id, value: result.right })
      }),
      
    sendStream: (request) =>
      Stream.fromEffect(
        Effect.gen(function* () {
          const path = tagToPath(request.tag)
          const handler = handlerMap[path]
          
          if (!handler) {
            return yield* Effect.fail(
              new TransportError({
                reason: "Protocol",
                message: `No mock handler for: ${request.tag}`,
              })
            )
          }
          
          const result = yield* Effect.mapError(
            handler(request.payload),
            (err) => new TransportError({
              reason: "Protocol",
              message: "Handler error",
              cause: err,
            })
          )
          
          return new StreamChunk({ id: request.id, chunk: result })
        })
      ),
  })
}
```

### Issues

#### Issue 1: Stream Mock Only Returns One Chunk

The `sendStream` mock:
```typescript
sendStream: (request) =>
  Stream.fromEffect(
    Effect.gen(function* () {
      // ...
      return new StreamChunk({ id: request.id, chunk: result })
    })
  )
```

This only ever produces ONE chunk. It doesn't:
- Support handlers that return `Stream`
- Emit `StreamEnd`
- Support multiple chunks

**Should be:**
```typescript
sendStream: (request) =>
  Effect.gen(function* () {
    const handler = handlerMap[path]
    const result = handler(request.payload)
    
    // Check if handler returns Stream
    if (Stream.isStream(result)) {
      return result.pipe(
        Stream.map((chunk) => new StreamChunk({ id: request.id, chunk })),
        Stream.concat(Stream.succeed(new StreamEnd({ id: request.id })))
      )
    }
    
    // Single value - wrap in stream
    const value = yield* result
    return Stream.make(
      new StreamChunk({ id: request.id, chunk: value }),
      new StreamEnd({ id: request.id })
    )
  }).pipe(Stream.unwrap)
```

#### Issue 2: No StreamEnd Signal

Mock streams never emit `StreamEnd`, which breaks clients expecting it:
```typescript
// In Client.ts
Stream.takeWhile((response) => !Schema.is(Transport.StreamEnd)(response))
```

Without `StreamEnd`, the stream hangs forever (or until timeout).

#### Issue 3: tagToPath Brittle

```typescript
const tagToPath = (tag: string): string => {
  const parts = tag.split("/")
  return parts.slice(1).join(".")
}
```

Example: `"@api/users/list"` → `"users.list"` (correct)

But what about: `"@my-app/api/users/list"` → `"api.users.list"` (incorrect if user expects `"users.list"`)

The function assumes the root tag is a single segment.

---

## 6. Error Handling Gaps

### Transport Error Types

```typescript
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}
```

**Coverage:**
- `"Network"` - fetch fails
- `"Timeout"` - request times out
- `"Protocol"` - invalid response format
- `"Closed"` - connection closed (defined but not used!)

### Unused Error Reason

`"Closed"` is defined but **never used** anywhere in the codebase:
```bash
$ grep -r '"Closed"' src/
# Only appears in Schema.Literal definition
```

This should be used for:
- WebSocket disconnection
- SSE connection closed
- Server shutdown

### Missing Error Cases

1. **HTTP status errors** - Currently all non-2xx become `"Protocol"`, but 503 should probably be `"Network"` (transient)
2. **Parse errors** - JSON parse failures are `"Protocol"`, which is correct
3. **Schema validation errors** - Also `"Protocol"`, correct
4. **No network error classification** - Can't distinguish DNS failure from connection refused

---

## 7. Timeout Handling Analysis

### Current Implementation

```typescript
const timeout = options?.timeout ? Duration.toMillis(options.timeout) : 30000

// In sendHttp:
const controller = new globalThis.AbortController()
const timeoutId = timeout
  ? globalThis.setTimeout(() => controller.abort(), timeout)
  : undefined

// ...fetch with signal...

if (timeoutId) globalThis.clearTimeout(timeoutId)
```

### Issues

1. **Global default of 30 seconds** - Hardcoded, not configurable globally
2. **No per-request timeout** - Can't override for specific calls
3. **Stream timeout missing** - `sendHttpStream` doesn't pass timeout
4. **Cleanup on error** - See earlier analysis

### Recommendation

```typescript
interface TransportRequest {
  // ... existing fields
  readonly timeout?: Duration.DurationInput  // Per-request override
}
```

---

## 8. Race Conditions and Resource Leaks

### Potential Race Condition 1: Batch Flush

If batching were implemented, there's a classic race:
```
T1: Request A arrives, schedules flush in 10ms
T2: Request B arrives, sees flush scheduled
T3: Flush triggers, sends [A]
T4: Request B added to batch
T5: B never sent (no new flush scheduled)
```

### Potential Race Condition 2: Timeout vs Response

```typescript
const timeoutId = globalThis.setTimeout(() => controller.abort(), timeout)
const response = yield* Effect.tryPromise({
  try: () => fetchFn(url, { signal: controller.signal }),
  catch: (cause) => new TransportError({
    reason: controller.signal.aborted ? "Timeout" : "Network",
    // ^^^ Race: signal might be aborted AFTER this check but BEFORE error created
  }),
})
```

This is unlikely to cause issues in practice, but the check is technically racy.

### Resource Leak: AbortController

```typescript
const controller = new globalThis.AbortController()
// If Effect is interrupted, controller is never aborted
```

Should use `Effect.acquireRelease`:
```typescript
Effect.acquireRelease(
  Effect.sync(() => new AbortController()),
  (controller) => Effect.sync(() => controller.abort())
)
```

### Resource Leak: EventSource (if implemented)

If SSE is implemented with EventSource, there's no `Effect.addFinalizer` to close it on interruption.

---

## 9. WebSocket Transport Feasibility

### Current Architecture Support

The transport interface is generic enough:
```typescript
interface TransportService {
  readonly send: (request: TransportRequest) => Effect.Effect<TransportResponse, TransportError>
  readonly sendStream: (request: TransportRequest) => Stream.Stream<StreamResponse, TransportError>
}
```

WebSocket could implement both:
- `send` - Send message, wait for response with matching ID
- `sendStream` - Subscribe to events with request ID

### Implementation Considerations

```typescript
export const websocket = (
  url: string,
  options?: WebSocketOptions
): Layer.Layer<Transport, never, never> =>
  Layer.scoped(
    Transport,
    Effect.gen(function* () {
      const ws = yield* Effect.acquireRelease(
        Effect.async((resume) => {
          const socket = new WebSocket(url)
          socket.onopen = () => resume(Effect.succeed(socket))
          socket.onerror = () => resume(Effect.fail(new TransportError(...)))
        }),
        (socket) => Effect.sync(() => socket.close())
      )
      
      const pending = new Map<string, Deferred<TransportResponse, TransportError>>()
      const streams = new Map<string, (response: StreamResponse) => void>()
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (pending.has(data.id)) {
          Deferred.succeed(pending.get(data.id)!, data)
        }
        if (streams.has(data.id)) {
          streams.get(data.id)!(data)
        }
      }
      
      return {
        send: (request) =>
          Effect.gen(function* () {
            const deferred = yield* Deferred.make<TransportResponse, TransportError>()
            pending.set(request.id, deferred)
            ws.send(JSON.stringify(request))
            return yield* Deferred.await(deferred)
          }),
        sendStream: (request) =>
          Stream.async((emit) => {
            streams.set(request.id, (response) => {
              if (response._tag === "StreamEnd") {
                emit.end()
              } else {
                emit.single(response)
              }
            })
            ws.send(JSON.stringify(request))
            return Effect.sync(() => streams.delete(request.id))
          })
      }
    })
  )
```

### Missing Pieces for WebSocket

1. **Reconnection logic** - WebSocket connections drop
2. **Message correlation** - Match responses to requests by ID
3. **Subscription management** - Track active streams
4. **Heartbeat/keepalive** - Detect dead connections
5. **Server-side WebSocket handler** - Not just client

---

## 10. Summary of Findings

### Critical Issues

| Issue | Severity | Location |
|-------|----------|----------|
| Batching not implemented | High | `Transport/index.ts:265-276` |
| SSE streaming not implemented | High | `Transport/index.ts:361` |
| Mock streams missing StreamEnd | Medium | `Transport/index.ts:456-482` |
| Timeout cleanup on error | Medium | `Transport/index.ts:320` |
| Loopback error context lost | Low | `Transport/index.ts:587` |

### Architectural Gaps

1. **No batching** despite configuration support
2. **No retry logic** despite error classification
3. **No request deduplication**
4. **No WebSocket transport** (mentioned in docs)
5. **"Closed" error reason unused**

### Recommendations

1. **Implement batching** - Users expect it based on config
2. **Implement SSE properly** - Critical for real-time features
3. **Add retry with exponential backoff** - Use `Effect.retry`
4. **Fix timeout cleanup** - Use `Effect.ensuring`
5. **Add WebSocket transport** - Modern RPC standard
6. **Fix mock stream to emit StreamEnd**
7. **Preserve error context in loopback**

### Test Coverage Gaps

- No tests for actual HTTP behavior (would need mock server)
- No tests for timeout firing
- No tests for stream continuation
- No integration tests for batching (because not implemented)

---

## Appendix: Code Snippets for Reference

### Complete HTTP sendHttp Function

```typescript
const sendHttp = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"],
  timeout?: number
): Effect.Effect<TransportResponse, TransportError> =>
  Effect.gen(function* () {
    const resolvedHeaders = typeof headers === "function"
      ? yield* Effect.promise(() => Promise.resolve(headers()))
      : headers ?? {}
    
    const controller = new globalThis.AbortController()
    const timeoutId = timeout
      ? globalThis.setTimeout(() => controller.abort(), timeout)
      : undefined
    
    const response = yield* Effect.tryPromise({
      try: () =>
        fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(resolvedHeaders as Record<string, string>),
          },
          body: JSON.stringify({
            id: request.id,
            tag: request.tag,
            payload: request.payload,
          }),
          signal: controller.signal,
        }),
      catch: (cause) =>
        new TransportError({
          reason: controller.signal.aborted ? "Timeout" : "Network",
          message: controller.signal.aborted
            ? "Request timed out"
            : "Failed to send request",
          cause,
        }),
    })
    
    if (timeoutId) globalThis.clearTimeout(timeoutId)
    
    if (!response.ok) {
      return yield* Effect.fail(
        new TransportError({
          reason: "Protocol",
          message: `HTTP ${response.status}: ${response.statusText}`,
        })
      )
    }
    
    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new TransportError({
          reason: "Protocol",
          message: "Failed to parse response JSON",
          cause,
        }),
    })
    
    const decoded = yield* Schema.decodeUnknown(TransportResponse)(json).pipe(
      Effect.mapError((cause) =>
        new TransportError({
          reason: "Protocol",
          message: "Invalid response envelope",
          cause,
        })
      )
    )
    
    return decoded
  })
```

### TransportService Interface

```typescript
export interface TransportService {
  readonly send: (
    request: TransportRequest
  ) => Effect.Effect<TransportResponse, TransportError>
  
  readonly sendStream: (
    request: TransportRequest
  ) => Stream.Stream<StreamResponse, TransportError>
}
```
