# Transport Layer Deep Analysis

**Module:** `/src/Transport/index.ts`
**Date:** 2024
**Scope:** HTTP transport, batching, SSE/streaming

---

## Executive Summary

The Transport module provides a clean abstraction for RPC request/response handling, but **SSE/streaming is stubbed** and **batching is not implemented**. The core HTTP transport works for simple request/response patterns.

| Feature | Status | Severity |
|---------|--------|----------|
| HTTP Transport (basic) | Working | - |
| Timeout handling | Working | - |
| Custom headers | Working | - |
| Mock transport | Working | - |
| Loopback transport | Working | - |
| **SSE/Streaming** | **STUBBED** | **HIGH** |
| **Batching** | **NOT IMPLEMENTED** | **MEDIUM** |

---

## 1. HTTP Transport Analysis

### What Works

The `Transport.http()` constructor creates a functional HTTP transport layer:

```typescript
// src/Transport/index.ts:234-245
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

**Working features:**
- POST requests with JSON body
- Timeout with AbortController (lines 259-262)
- Custom headers (static or async function)
- Custom fetch implementation
- Response envelope validation via Schema

### Evidence of Working HTTP

```typescript
// src/Transport/index.ts:264-288
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
```

---

## 2. SSE/Streaming Implementation - STUBBED

### Severity: HIGH

The streaming implementation is explicitly marked as TODO and does not implement actual SSE:

```typescript
// src/Transport/index.ts:324-340
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
        if (Schema.is(Success)(response)) {
          return new StreamChunk({ id: response.id, chunk: response.value })
        }
        return response // Failure passes through
      })
    )
  )
```

### What's Missing

1. **No EventSource/SSE client** - The implementation just wraps a single HTTP request
2. **No streaming response parsing** - No `ReadableStream` handling
3. **No reconnection logic** - SSE typically auto-reconnects
4. **No server-side SSE endpoint** - `Server.toHttpHandler` doesn't handle streams

### Impact

- `Procedure.stream()` works **only via loopback** transport (in-memory)
- Real HTTP streaming is **non-functional**
- React `useStream` hook will not work with HTTP transport

### Evidence of Issue

The e2e tests only pass because they use loopback transport:

```typescript
// test/e2e/suite.ts:167-177 - Uses loopback, not HTTP
yield* service.sendStream(
  "@test/users/watch",
  undefined,
  proc.successSchema,
  proc.errorSchema
).pipe(
  Stream.take(1),
  Stream.runForEach((user) => 
    Effect.sync(() => { chunks.push(user as User) })
  )
)
```

---

## 3. Batching - NOT IMPLEMENTED

### Severity: MEDIUM

Batching was **explicitly removed** from the API because it had no implementation:

```typescript
// src/Transport/index.ts:213-214
// Note: Batching is planned but not yet implemented.
// See /plans/batching.md for the implementation roadmap.
```

### HttpOptions Interface

```typescript
// src/Transport/index.ts:196-211
export interface HttpOptions {
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  readonly timeout?: Duration.DurationInput
  readonly fetch?: typeof globalThis.fetch
  // NOTE: No batching option exists
}
```

### Implementation Plan

A detailed plan exists at `/plans/batching.md`:

```markdown
## Status: NOT IMPLEMENTED

The batching configuration was removed from the API because it had no implementation.

## Proposed API
const layer = Transport.http("/api/trpc", {
  batching: {
    enabled: true,
    window: Duration.millis(10),
    maxSize: 50,
    queries: true,
    mutations: false,
  },
})
```

### Impact

- Each RPC call is a separate HTTP request
- No request deduplication
- No network optimization for concurrent calls
- Performance penalty for apps with many parallel queries

---

## 4. Transport Abstraction Quality

### Well-Designed

The `TransportService` interface is clean:

```typescript
// src/Transport/index.ts:159-173
export interface TransportService {
  readonly send: (
    request: TransportRequest
  ) => Effect.Effect<TransportResponse, TransportError>
  
  readonly sendStream: (
    request: TransportRequest
  ) => Stream.Stream<StreamResponse, TransportError>
}
```

### Protocol Types - Well-Defined

```typescript
// Response envelopes
export class Success extends Schema.TaggedClass<Success>()("Success", {...})
export class Failure extends Schema.TaggedClass<Failure>()("Failure", {...})
export class StreamChunk extends Schema.TaggedClass<StreamChunk>()("StreamChunk", {...})
export class StreamEnd extends Schema.TaggedClass<StreamEnd>()("StreamEnd", {...})
```

### Mock Transport - Working

```typescript
// src/Transport/index.ts:395-453
export const mock = <D extends Router.Definition>(
  handlers: MockHandlers<D>
): Layer.Layer<Transport, never, never> => {
  // Full implementation with proper Success/Failure wrapping
}
```

### Loopback Transport - Working

```typescript
// src/Transport/index.ts:544-570
export const loopback = <D extends Router.Definition, R>(
  server: {
    readonly handle: (request: TransportRequest) => Effect.Effect<TransportResponse, never, R>
    readonly handleStream: (request: TransportRequest) => Stream.Stream<StreamResponse, never, R>
  }
): Layer.Layer<Transport, never, R> => {
  // Direct in-memory connection to server
}
```

---

## 5. Server-Side Streaming

The Server module **does handle streams properly** on the server side:

```typescript
// src/Server/index.ts:327-417
const handleStream = (
  request: Transport.TransportRequest
): Stream.Stream<Transport.StreamResponse, never, R> => {
  // Full implementation with middleware, error handling, StreamEnd
}
```

But `toHttpHandler` only handles single requests:

```typescript
// src/Server/index.ts:474
return server.handle(transportRequest)  // Not handleStream!
```

**Missing:** No `toHttpStreamHandler` or SSE endpoint support.

---

## 6. Client-Side Stream Handling

The `ClientService.sendStream` properly processes stream responses:

```typescript
// src/Client/index.ts:150-184
return transport.sendStream(request).pipe(
  Stream.takeWhile((response) => !Schema.is(Transport.StreamEnd)(response)),
  Stream.mapEffect((response): Effect.Effect<S, E | Transport.TransportError> => {
    if (Schema.is(Transport.StreamChunk)(response)) {
      return Schema.decodeUnknown(successSchema)(response.chunk).pipe(...)
    }
    // ...
  })
)
```

But this only works if the transport actually streams - which HTTP transport doesn't.

---

## 7. React useStream Hook - Incomplete

```typescript
// src/Client/react.ts:422-436
useEffect(() => {
  if (!enabled) return
  
  setIsConnected(true)
  setData([])
  setError(undefined)
  
  // Use the atom to get stream values
  // This is simplified - proper implementation would use useAtomValue
  
  return () => {
    setIsConnected(false)
    abortRef.current?.()
  }
}, [enabled, streamAtom])
```

**Issues:**
- No actual subscription to stream events
- `data` state never gets updated
- "simplified" comment indicates incompleteness

---

## Summary Table

| Component | Implementation | Notes |
|-----------|---------------|-------|
| `Transport.http().send` | Complete | Handles timeout, headers, errors |
| `Transport.http().sendStream` | **STUBBED** | Returns single response as stream |
| `Transport.mock()` | Complete | Works for testing |
| `Transport.loopback()` | Complete | In-memory, no network |
| Batching | **NOT STARTED** | Plan exists in `/plans/batching.md` |
| Server stream handling | Complete | `Server.handleStream` works |
| Server SSE endpoint | **MISSING** | `toHttpHandler` doesn't expose streams |
| Client stream handling | Complete | Works with proper transport |
| React useStream | **INCOMPLETE** | State never updates |

---

## Recommendations

### Priority 1: SSE Implementation (HIGH)

1. Implement `sendHttpStream` with proper SSE:
   ```typescript
   const sendHttpStream = (url, request, ...) =>
     Stream.async((emit) => {
       const es = new EventSource(`${url}?...`)
       es.onmessage = (e) => emit.single(parseChunk(e.data))
       es.onerror = () => emit.fail(new TransportError(...))
       return () => es.close()
     })
   ```

2. Add `Server.toSseHandler()` for SSE endpoints

### Priority 2: Fix useStream Hook (HIGH)

The React hook needs actual stream subscription logic.

### Priority 3: Batching (MEDIUM)

Follow the plan in `/plans/batching.md`:
- Use Effect `Queue` for request collection
- Implement batch window with `Schedule`
- Add batch endpoint to Server

---

## Test Coverage

```
test/transport.test.ts - Basic protocol types, mock transport
test/e2e/suite.ts - Stream tests pass only with loopback
```

No HTTP integration tests for streaming exist because the feature is stubbed.
