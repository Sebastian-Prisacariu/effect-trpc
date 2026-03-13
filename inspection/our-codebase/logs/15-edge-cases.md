# Edge Cases and Error Paths Analysis

## Overview

This document provides a deep analysis of edge case handling, error paths, security considerations, and robustness gaps across the effect-trpc codebase. The analysis focuses on the Server, Client, and Transport modules.

---

## 1. Edge Cases Currently Handled

### Server (`Server/index.ts`)

| Edge Case | Location | How It's Handled |
|-----------|----------|------------------|
| Unknown procedure | Line 220-227 | Returns `Transport.Failure` with "Unknown procedure: {tag}" message |
| Invalid payload | Line 240-245 | Returns `Transport.Failure` with "Invalid payload" and cause |
| Handler error | Line 249-256 | Encodes error via schema, returns `Transport.Failure` |
| Stream called with `handle()` | Line 230-236 | Returns `Transport.Failure` with "Use handleStream for streaming procedures" |
| Non-stream called with `handleStream()` | Line 298-304 | Returns `Stream.succeed(Failure)` with "Use handle for non-streaming procedures" |
| Middleware applied to handlers | Line 269-278 | Executes middleware chain before handler |

### Client (`Client/index.ts`)

| Edge Case | Location | How It's Handled |
|-----------|----------|------------------|
| Success response decoding failure | Line 118-125 | Returns `TransportError("Protocol", "Failed to decode success response")` |
| Error response decoding failure | Line 127-134 | Returns `TransportError("Protocol", "Failed to decode error response")` |
| Unexpected stream response type | Line 177-181 | Returns `TransportError("Protocol", "Unexpected stream response type")` |
| `runPromise` without runtime | Line 637-638, 673 | Throws error "runPromise requires a bound runtime" |
| Unknown procedure type | Line 686 | Throws error (should be unreachable) |
| React hooks outside Provider | Line 53-61 (react.ts) | Throws clear error message |
| React not available | Line 720-726 | Returns stub provider |

### Transport (`Transport/index.ts`)

| Edge Case | Location | How It's Handled |
|-----------|----------|------------------|
| HTTP request timeout | Line 290-293 | Uses AbortController, returns `TransportError("Timeout")` |
| Network failure | Line 295-318 | Catches fetch error, returns `TransportError("Network")` |
| Non-OK HTTP status | Line 322-329 | Returns `TransportError("Protocol", "HTTP {status}: {statusText}")` |
| JSON parse failure | Line 331-339 | Returns `TransportError("Protocol", "Failed to parse response JSON")` |
| Invalid response envelope | Line 342-350 | Returns `TransportError("Protocol", "Invalid response envelope")` |
| Mock handler missing | Line 438-446 | Returns `TransportError("Protocol", "No mock handler for: {tag}")` |
| Transient error identification | Line 532-538 | `isTransientError()` helper for retry logic |

### React Hooks (`Client/react.ts`)

| Edge Case | Location | How It's Handled |
|-----------|----------|------------------|
| Component unmounts during fetch | Line 153, 171-173 | `mountedRef` prevents state updates |
| Fetch superseded by newer fetch | Line 154, 173 | `fetchIdRef` ensures only latest fetch updates state |
| Mutation error | Line 298-306 | Sets error state, calls `onError`, re-throws |
| Stream error | Line 425-430 | Sets `error` state, stops streaming |
| Reactivity subscription cleanup | Line 196-201 | Returns unsubscribe function from useEffect |
| Refetch interval cleanup | Line 204-209 | Clears interval on unmount/dependency change |

---

## 2. Edge Cases NOT Handled

### HIGH PRIORITY - Security/Robustness Issues

#### 2.1 No Payload Size Limits

**Location:** `Server/index.ts`, `Transport/index.ts`

**Issue:** No validation of payload size before processing. A malicious client could send extremely large payloads:

```typescript
// Current code (Server/index.ts:240)
Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
// No size check before decoding
```

**Risk:**
- Memory exhaustion attacks
- CPU exhaustion during schema validation
- DoS vulnerability

**Recommendation:**
```typescript
const MAX_PAYLOAD_SIZE = 1_048_576 // 1MB default

const validatePayloadSize = (payload: unknown): Effect.Effect<void, Transport.Failure> => {
  const size = JSON.stringify(payload).length
  if (size > MAX_PAYLOAD_SIZE) {
    return Effect.fail(new Transport.Failure({
      id: request.id,
      error: { 
        _tag: "PayloadTooLarge",
        maxSize: MAX_PAYLOAD_SIZE,
        actualSize: size,
      },
    }))
  }
  return Effect.void
}
```

#### 2.2 No Request Rate Limiting

**Location:** `Server/index.ts`

**Issue:** No built-in rate limiting mechanism. Each request is processed immediately.

**Risk:**
- DoS attacks from flooding
- Resource exhaustion

**Recommendation:** Add optional rate limiting middleware or configuration:
```typescript
export interface ServerOptions {
  readonly rateLimit?: {
    readonly maxRequests: number
    readonly windowMs: number
  }
}
```

#### 2.3 No Stream Chunk Limits

**Location:** `Server/index.ts:306-324`

**Issue:** Streaming handlers can emit unlimited chunks without any backpressure or limits:

```typescript
// Current code - no limits
return stream.pipe(
  Stream.map((value): Transport.StreamResponse => 
    new Transport.StreamChunk({ id: request.id, chunk: value })
  ),
  // No limit on chunks
)
```

**Risk:**
- Memory exhaustion on client
- Connection resource exhaustion
- Potential DoS vector

**Recommendation:**
```typescript
export interface StreamOptions {
  readonly maxChunks?: number
  readonly chunkTimeout?: Duration.DurationInput
}
```

#### 2.4 No Connection Timeout for Streams

**Location:** `Transport/index.ts:355-371`

**Issue:** HTTP streaming (`sendHttpStream`) has no timeout handling:

```typescript
// Current code - no timeout
const sendHttpStream = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<StreamResponse, TransportError> =>
  // No timeout parameter passed
  Stream.fromEffect(
    sendHttp(url, request, fetchFn, headers, undefined)  // <-- undefined timeout
  )
```

**Risk:**
- Connection hangs indefinitely
- Resource leaks

### MEDIUM PRIORITY - Robustness Gaps

#### 2.5 No Reconnection Logic

**Location:** `Transport/index.ts`

**Issue:** HTTP transport has no automatic reconnection or retry logic:

```typescript
// Current code - single attempt
const response = yield* Effect.tryPromise({
  try: () => fetchFn(url, { ... }),
  catch: (cause) => new TransportError({ reason: "Network", ... }),
})
// No retry
```

**Note:** The codebase provides `isTransientError()` helper (Line 532-538) but doesn't use it for automatic retries.

**Recommendation:**
```typescript
export interface HttpOptions {
  readonly retry?: {
    readonly times: number
    readonly delay: Duration.DurationInput
    readonly exponentialBackoff?: boolean
  }
}
```

#### 2.6 No Request ID Collision Handling

**Location:** `Transport/index.ts:546-547`

**Issue:** Request IDs are generated with `Date.now()` + random suffix:

```typescript
export const generateRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
```

**Risk:**
- High request rates could cause collisions
- `Date.now()` has millisecond precision
- `Math.random()` is not cryptographically secure

**Recommendation:** Use UUIDv4 or a more robust ID generator:
```typescript
export const generateRequestId = (): string =>
  crypto.randomUUID() // or use @effect/platform's RandomId
```

#### 2.7 No Header Validation

**Location:** `Server/index.ts:400-418`

**Issue:** Headers are extracted without validation or sanitization:

```typescript
// Current code - no validation
const headers: Record<string, string> = {}
if (request.headers) {
  // Headers directly used without sanitization
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      headers[key.toLowerCase()] = value
    }
  }
}
```

**Risk:**
- Header injection attacks
- Prototype pollution (if headers object is user-controlled)

#### 2.8 No Graceful Shutdown

**Location:** `Client/index.ts:593`

**Issue:** `BoundClient.shutdown()` immediately disposes runtime without waiting for in-flight requests:

```typescript
shutdown: () => runtime.dispose(),  // Immediate shutdown
```

**Risk:**
- Requests in progress are aborted
- Data loss potential

**Recommendation:**
```typescript
shutdown: async (options?: { graceful?: boolean; timeout?: number }) => {
  if (options?.graceful) {
    // Wait for pending requests with timeout
  }
  return runtime.dispose()
}
```

### LOW PRIORITY - Potential Issues

#### 2.9 No Memory Leak Protection for Subscriptions

**Location:** `Reactivity/index.ts:138-159`

**Issue:** Subscriptions are stored in a `Map` without limits:

```typescript
const subscriptions = new Map<string, Set<InvalidationCallback>>()
```

**Risk:**
- If unsubscribe is never called, callbacks accumulate
- Memory grows unbounded

#### 2.10 No Request Deduplication

**Location:** `Client/index.ts`

**Issue:** Multiple identical queries are sent separately. No deduplication:

```typescript
// Each call creates a new request
const createRunEffect = (payload: unknown) =>
  Effect.gen(function* () {
    const service = yield* ClientServiceTag
    return yield* service.send(tag, payload, successSchema, errorSchema)
  })
```

**Note:** This is partially mitigated by Effect's general design, but explicit deduplication could help.

#### 2.11 No Payload Validation Timeout

**Location:** `Server/index.ts:240`

**Issue:** Complex schemas with recursive structures could cause long validation times:

```typescript
Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
// No timeout around validation
```

**Risk:**
- ReDoS-style attacks via complex payloads
- Server thread blocking

---

## 3. Error Path Analysis

### 3.1 Error Encoding Silent Fallback (CRITICAL)

**Location:** `Server/index.ts:251-252, 259-260`

**Issue:** If schema encoding fails, raw values are silently used:

```typescript
// Error encoding
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.orElseSucceed(() => error),  // <-- SILENT: raw error sent
  Effect.map((encodedError) => new Transport.Failure({ ... }))
)

// Success encoding
Schema.encode(procedure.successSchema)(value).pipe(
  Effect.orElseSucceed(() => value),  // <-- SILENT: raw value sent
  ...
)
```

**Consequence:**
1. Client may receive malformed data
2. Client decoding may fail with confusing error
3. Internal data structures may leak (security issue)
4. No indication that encoding failed

**Recommendation:** Log encoding failures and wrap in structured error:

```typescript
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.tapError((encodingError) =>
    Effect.logError("Failed to encode error response", { 
      tag: request.tag, 
      errorType: error?._tag,
      encodingError 
    })
  ),
  Effect.orElse(() =>
    Effect.succeed({
      _tag: "ServerError",
      message: "An internal error occurred",
      code: "ENCODING_FAILED",
    })
  ),
)
```

### 3.2 HTTP Adapter Catch-All (MEDIUM)

**Location:** `Server/index.ts:434-438`

**Issue:** All errors caught at HTTP boundary become generic:

```typescript
Effect.catchAll(() => Effect.succeed({
  status: 400,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: "Invalid request" }),
}))
```

**Consequence:**
- Any unexpected error returns 400 "Invalid request"
- Differentiation between client errors (4xx) and server errors (5xx) lost
- Debugging difficult

**Recommendation:**
```typescript
Effect.catchAll((error) => {
  const isClientError = isPayloadError(error) || isValidationError(error)
  return Effect.succeed({
    status: isClientError ? 400 : 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      error: isClientError ? "Invalid request" : "Internal server error",
      code: error?._tag ?? "UNKNOWN",
    }),
  })
})
```

### 3.3 Stream Error in `handleStream` (LOW)

**Location:** `Server/index.ts:316-321`

**Issue:** Stream errors are caught and converted but lose context:

```typescript
Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
  Stream.succeed(new Transport.Failure({
    id: request.id,
    error,  // Raw error passed, no encoding attempted
  }))
),
```

**Consequence:**
- Stream errors are not schema-encoded like regular errors
- Inconsistent error handling between `handle` and `handleStream`

---

## 4. Security Considerations

### 4.1 Payload Size Limits (NOT IMPLEMENTED)

| Component | Max Size | Enforcement |
|-----------|----------|-------------|
| Server payload | None | None |
| Client payload | None | None |
| Stream chunks | None | None |
| HTTP body | Server-dependent | External |

**Recommendation:** Add configurable limits:

```typescript
export interface ServerOptions {
  readonly limits?: {
    readonly maxPayloadSize?: number  // bytes
    readonly maxChunks?: number       // for streams
    readonly maxConcurrentRequests?: number
  }
}
```

### 4.2 Input Sanitization (PARTIAL)

| Input | Sanitized? | Notes |
|-------|------------|-------|
| Payload | Via Schema | Schema validates structure but not content |
| Headers | Lowercase only | No other sanitization |
| Tag/Path | No | Used directly in handler lookup |

**Recommendation:** Validate tags against known procedures before processing:

```typescript
const handle = (request: TransportRequest) => {
  // Validate tag format
  if (!isValidTag(request.tag)) {
    return Effect.succeed(new Transport.Failure({
      id: request.id,
      error: { message: "Invalid tag format" },
    }))
  }
  // ... continue
}
```

### 4.3 Error Information Disclosure (PARTIAL)

| Error Type | Disclosed Information |
|------------|----------------------|
| ParseError (payload) | Full parse error with cause |
| Handler errors | Full error object if encoding fails |
| Transport errors | Reason + message + optional cause |

**Risk:** Stack traces and internal structure could leak in production.

**Recommendation:** Add production mode that sanitizes errors:

```typescript
export interface ServerOptions {
  readonly production?: boolean  // Strips detailed error info
}
```

### 4.4 Request Forgery Protection (NOT IMPLEMENTED)

No CSRF protection is built into the transport layer. This is expected to be handled at the HTTP server level (e.g., Express, Hono), but could be documented.

---

## 5. Timeout Handling Analysis

| Operation | Timeout? | Default | Configurable? |
|-----------|----------|---------|---------------|
| HTTP request | YES | 30s | YES (Transport.http options) |
| HTTP streaming | NO | - | NO |
| Payload validation | NO | - | NO |
| Handler execution | NO | - | NO |
| Schema encoding | NO | - | NO |

**Gaps:**
1. No handler execution timeout - a slow handler blocks indefinitely
2. No streaming timeout - streams can run forever
3. No validation timeout - complex schemas could block

**Recommendation:**
```typescript
export interface ServerOptions {
  readonly timeouts?: {
    readonly handler?: Duration.DurationInput   // Max handler execution time
    readonly validation?: Duration.DurationInput // Max payload validation time
    readonly stream?: Duration.DurationInput    // Max stream duration
  }
}
```

---

## 6. Reconnection Logic Analysis

### Current State

| Scenario | Handled? | Notes |
|----------|----------|-------|
| Network failure | NO | Single attempt, then TransportError |
| Timeout | NO | Single attempt, then TransportError |
| Server unavailable | NO | Single attempt, then TransportError |
| Connection closed | NO | For streams, error emitted |

### `isTransientError` Helper

The codebase provides `Transport.isTransientError()` which correctly identifies retryable errors:

```typescript
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransportError) {
    return error.reason === "Network" || error.reason === "Timeout"
  }
  return false
}
```

However, this is not used internally for automatic retries.

### Recommended Retry Implementation

```typescript
export interface RetryOptions {
  readonly times: number
  readonly delay: Duration.DurationInput
  readonly backoff?: "linear" | "exponential"
  readonly jitter?: boolean
  readonly onRetry?: (attempt: number, error: TransportError) => Effect.Effect<void>
}

const retryTransient = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: RetryOptions
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry({
      times: options.times,
      schedule: Schedule.exponential(options.delay),
      while: (error) => isTransientError(error),
    })
  )
```

---

## 7. Robustness Recommendations

### Immediate (Security Critical)

1. **Add payload size limits** - Prevent DoS via large payloads
2. **Fix silent encoding fallbacks** - Log failures, return structured errors
3. **Validate request ID format** - Prevent injection via IDs

### Short-term (Stability)

4. **Add handler execution timeouts** - Prevent indefinite blocking
5. **Implement retry logic for transient errors** - Use existing `isTransientError`
6. **Add graceful shutdown** - Wait for in-flight requests
7. **Improve request ID generation** - Use crypto.randomUUID()

### Medium-term (Production Readiness)

8. **Add configurable rate limiting** - Per-client or global
9. **Add stream chunk limits** - Prevent memory exhaustion
10. **Add production error sanitization** - Hide internal details
11. **Add metrics/observability hooks** - Track error rates, latencies

### Long-term (Enterprise Features)

12. **Add request deduplication** - For identical concurrent queries
13. **Add circuit breaker pattern** - For failing services
14. **Add request prioritization** - For QoS
15. **Add distributed tracing integration** - OpenTelemetry

---

## 8. Summary

| Category | Handled | Not Handled | Critical Gaps |
|----------|---------|-------------|---------------|
| Error responses | 10+ cases | 3 silent fallbacks | Encoding failures |
| Timeouts | HTTP only | Handlers, streams, validation | Handler timeout |
| Size limits | None | All payloads | DoS vulnerability |
| Reconnection | Helper exists | Auto-retry | Network resilience |
| Security | Schema validation | Size, rate, injection | DoS, info leak |
| Cleanup | Basic | Graceful shutdown | In-flight requests |

**Overall Assessment:** The codebase handles many common edge cases well, particularly around response typing, unknown procedures, and basic error wrapping. However, it lacks critical production hardening features: payload size limits, handler timeouts, retry logic, and proper error encoding fallbacks. The silent encoding fallbacks are the most critical issue as they can cause hard-to-debug client-side failures and potential information leakage.
