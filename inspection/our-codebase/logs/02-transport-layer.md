# Transport Layer Analysis

## Overview

The Transport module (`src/Transport/index.ts`) defines how RPC requests travel between client and server. It provides an abstraction layer with multiple implementations.

## Transport Types

### 1. HTTP Transport (`Transport.http`)
**Lines 265-276**

Creates an HTTP-based transport layer for production use.

```typescript
export const http = (
  url: string,
  options?: HttpOptions
): Layer.Layer<Transport, never, never>
```

**Implementation details:**
- Uses `fetch` API (or custom implementation)
- Sends POST requests with JSON body
- Supports timeout via AbortController (lines 290-293)
- Schema-validates response envelope (lines 342-350)

### 2. Mock Transport (`Transport.mock`)
**Lines 426-484**

Type-safe mock transport for testing.

```typescript
export const mock = <D extends Router.Definition>(
  handlers: MockHandlers<D>
): Layer.Layer<Transport, never, never>
```

**Features:**
- Fully typed handlers matching router definition
- Converts tag to path for handler lookup (lines 435, 488-493)
- Returns Success/Failure envelopes appropriately

### 3. Loopback Transport (`Transport.loopback`)
**Lines 575-601**

Direct connection to Server for testing without HTTP.

```typescript
export const loopback = <D extends Router.Definition, R>(
  server: {
    readonly handle: (request: TransportRequest) => Effect.Effect<TransportResponse, never, R>
    readonly handleStream: (request: TransportRequest) => Stream.Stream<StreamResponse, never, R>
  }
): Layer.Layer<Transport, never, R>
```

### 4. Custom Transport (`Transport.make`)
**Lines 518-521**

Factory for custom transport implementations.

---

## Batching Configuration

### Issue: BATCHING CONFIG IS COMPLETELY IGNORED

**Severity: HIGH**

The `HttpOptions` interface defines batching configuration (lines 212-238):

```typescript
readonly batching?: {
  readonly enabled?: boolean
  readonly window?: Duration.DurationInput
  readonly maxSize?: number
  readonly queries?: boolean
  readonly mutations?: boolean
}
```

However, examining `Transport.http` implementation (lines 265-276):

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

**Evidence:**
1. `options?.batching` is never read
2. No batching logic exists anywhere in the file
3. The test at `test/transport.test.ts:54-66` only verifies config is "accepted" (no runtime check)
4. Each request is sent individually via `sendHttp`

**tRPC Reference Implementation:**
In tRPC, batching is implemented via `dataLoader` pattern (see `inspection/external-repos/trpc/packages/client/src/internals/dataLoader.ts`):
- Collects requests in a microtask window
- Validates batch size/URL length
- Sends single HTTP request with multiple operations
- Distributes responses back to callers

**What's missing:**
- Request queue/collector
- Window timing (microtask or configurable delay)
- Batch validation (maxSize, URL length)
- Batch encoding (multiple requests in one HTTP call)
- Response distribution

---

## SSE/Streaming Implementation

### Issue: STREAMING IS NOT IMPLEMENTED

**Severity: HIGH**

**Evidence at line 361:**

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
        if (Schema.is(Success)(response)) {
          return new StreamChunk({ id: response.id, chunk: response.value })
        }
        return response // Failure passes through
      })
    )
  )
```

**Current behavior:**
- `sendHttpStream` makes a single HTTP request
- Converts the single response into a one-element stream
- Does NOT implement actual SSE streaming

**tRPC Reference:**
In tRPC, streaming uses `EventSource` via `httpSubscriptionLink` (see `inspection/external-repos/trpc/packages/client/src/links/httpSubscriptionLink.ts`):
- Uses `EventSource` or ponyfill
- Consumes SSE stream via `sseStreamConsumer`
- Handles connection states (connecting, pending, idle)
- Supports reconnection with `lastEventId`

**What's missing:**
- EventSource integration
- SSE protocol handling
- Connection state management
- Reconnection logic
- Server-side SSE response formatting

---

## Transport Abstraction Quality

### Strengths

1. **Clean Service Interface** (lines 162-176)
   ```typescript
   interface TransportService {
     readonly send: (request: TransportRequest) => Effect.Effect<TransportResponse, TransportError>
     readonly sendStream: (request: TransportRequest) => Stream.Stream<StreamResponse, TransportError>
   }
   ```

2. **Proper Response Schemas** (lines 84-137)
   - `Success`, `Failure`, `StreamChunk`, `StreamEnd` with Schema validation
   - Clear discriminated union for type-safe handling

3. **Error Classification** (lines 65-72, 533-538)
   - `TransportError` with reason: Network, Timeout, Protocol, Closed
   - `isTransientError` helper for retry logic

4. **Context.Tag Pattern** (lines 184-187)
   - Proper Effect service definition

### Weaknesses

1. **No WebSocket Transport**
   - Module docstring mentions WebSocket but no implementation exists
   - tRPC supports WebSocket via `wsLink`

2. **No Retry Logic Built-in**
   - `isTransientError` helper exists but no automatic retry
   - Should integrate with Effect's retry policies

3. **No Request Deduplication**
   - Same query sent twice results in two network requests
   - No caching layer for identical in-flight requests

---

## Issues Summary

| Issue | Severity | Location | Description |
|-------|----------|----------|-------------|
| Batching config ignored | HIGH | lines 265-276 | `batching` option is defined but never used |
| SSE streaming stub | HIGH | lines 355-371 | `sendHttpStream` is a TODO stub |
| Missing WebSocket | MEDIUM | - | Documented but not implemented |
| No request deduplication | LOW | - | Could optimize repeated queries |
| No built-in retry | LOW | - | Helper exists but no automatic retry |

---

## Recommendations

1. **Implement Batching**
   - Port tRPC's dataLoader pattern to Effect
   - Use `Effect.forkDaemon` for batch collector
   - Use `Deferred` for response distribution
   - Example structure:
     ```typescript
     // Collect requests in window
     const batcher = Effect.gen(function* () {
       const queue = yield* Ref.make<TransportRequest[]>([])
       const flush = yield* Deferred.make<void>()
       // ... batch and send logic
     })
     ```

2. **Implement SSE Streaming**
   - Create `EventSource` wrapper in Effect
   - Handle SSE protocol (data:, id:, event:, retry:)
   - Return `Stream.async` with proper cleanup

3. **Add WebSocket Transport**
   - Similar interface to HTTP
   - Built-in reconnection
   - Message queuing for offline

4. **Integrate Retry Policy**
   - Accept `Schedule` for retry configuration
   - Use `isTransientError` to determine retry eligibility
