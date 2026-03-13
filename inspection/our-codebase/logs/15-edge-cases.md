# Edge Case Analysis — effect-trpc

Deep analysis of error paths, payload limits, timeouts, reconnection logic, and security considerations.

## Executive Summary

**Overall Rating: C+ (Significant Gaps)**

The codebase handles common error cases well but lacks handling for many critical edge cases:

| Category | Status | Notes |
|----------|--------|-------|
| Error Paths | B | Well-typed but silent fallbacks |
| Payload Limits | F | No limits implemented |
| Timeouts | C | HTTP only, no streams |
| Reconnection | F | Not implemented |
| Security | C | Missing input validation |

---

## 1. Error Path Analysis

### 1.1 Handled Error Scenarios

| Scenario | Location | Handling |
|----------|----------|----------|
| Invalid payload (decode failure) | Server/index.ts:267-272 | Returns Failure envelope with cause |
| Unknown procedure | Server/index.ts:244-249 | Returns Failure with "Unknown procedure" message |
| Handler domain errors | Server/index.ts:277-290 | Encodes via errorSchema, wraps in Failure |
| Transport errors | Transport/index.ts:279-287 | TransportError with reason discriminant |
| Network failure | Transport/index.ts:280-281 | TransportError(reason: "Network") |
| HTTP timeout | Transport/index.ts:260-262 | AbortController triggers TransportError(reason: "Timeout") |
| Non-200 HTTP response | Transport/index.ts:291-298 | TransportError(reason: "Protocol") |
| Invalid response JSON | Transport/index.ts:300-308 | TransportError(reason: "Protocol") |
| Invalid response envelope | Transport/index.ts:311-318 | TransportError(reason: "Protocol") |
| Stream procedure via handle() | Server/index.ts:253-258 | Returns Failure suggesting handleStream |
| Non-stream via handleStream() | Server/index.ts:341-346 | Returns Failure suggesting handle |

### 1.2 Missing Error Scenarios

| Scenario | Current Behavior | Risk Level |
|----------|------------------|------------|
| Error encoding failure | Silent fallback to unencoded error | **CRITICAL** |
| Success encoding failure | Silent fallback to unencoded value | **HIGH** |
| Middleware service missing | Runtime crash (Effect.serviceNotFound) | **HIGH** |
| AbortSignal in middleware | Not connected to request lifecycle | **MEDIUM** |
| Handler throws (non-Effect) | Unhandled exception | **HIGH** |
| Double response | No guard against | **LOW** |

### 1.3 Error Encoding Fallback (Critical Issue)

**Location**: `Server/index.ts:278-285` and `Server/index.ts:292-299`

```typescript
onFailure: (error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.catchAll((encodeError) =>
      Effect.logWarning("Failed to encode error response", {...})
        .pipe(Effect.as(error))  // ← Returns RAW, unencoded error!
    ),
```

**Problem**: When the error doesn't match the declared errorSchema (common when using `yield* Effect.fail(someError)` with wrong type), the raw error object is sent to the client.

**Impact**:
- Breaks type safety guarantees
- Potential information leakage (stack traces, internal types)
- Client receives unexpected error structure

**Example**:
```typescript
// Declared error type
error: NotFoundError

// Handler accidentally fails with wrong type
yield* Effect.fail(new ValidationError({...}))
// Result: ValidationError sent raw (unencoded) to client
```

---

## 2. Payload Size Limits

### 2.1 Current State: NO LIMITS

**Analysis of Transport/index.ts:266-278** (HTTP send):
```typescript
body: JSON.stringify({
  id: request.id,
  tag: request.tag,
  payload: request.payload,  // ← No size check!
}),
```

**No payload limits are enforced at any layer**:
- Transport layer: No check
- Server layer: No check  
- Procedure layer: No check

### 2.2 Attack Vectors

| Attack | Vector | Severity |
|--------|--------|----------|
| Memory exhaustion (client) | Large response body | **HIGH** |
| Memory exhaustion (server) | Large request payload | **HIGH** |
| JSON parse DoS | Deeply nested objects | **MEDIUM** |
| Regex DoS | Long strings in schema validation | **MEDIUM** |
| Stream flooding | Unbounded stream chunks | **HIGH** |

### 2.3 Recommended Limits

```typescript
// Transport/index.ts - Add to HttpOptions
export interface HttpOptions {
  readonly maxPayloadSize?: number   // default: 1MB
  readonly maxResponseSize?: number  // default: 10MB
  readonly maxNestedDepth?: number   // default: 32
}

// Server - Add to ServerOptions
export interface ServerOptions {
  readonly maxPayloadSize?: number   // default: 1MB
  readonly maxStreamChunks?: number  // default: 10000
}
```

### 2.4 Implementation Recommendations

**Client-side (Transport)**:
```typescript
const sendHttp = (...) => Effect.gen(function* () {
  // Check request size
  const body = JSON.stringify({ id, tag, payload })
  if (body.length > (options?.maxPayloadSize ?? 1_000_000)) {
    return yield* Effect.fail(new TransportError({
      reason: "Protocol",
      message: `Payload exceeds ${maxPayloadSize} bytes`,
    }))
  }
  
  // Check response size (via Content-Length or streaming)
  const response = yield* Effect.tryPromise({...})
  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > maxResponseSize) {
    return yield* Effect.fail(new TransportError({
      reason: "Protocol", 
      message: `Response exceeds ${maxResponseSize} bytes`,
    }))
  }
  // ...
})
```

**Server-side**:
```typescript
const handle = (request: TransportRequest) => Effect.gen(function* () {
  // Check serialized payload size
  const payloadSize = JSON.stringify(request.payload).length
  if (payloadSize > maxPayloadSize) {
    return new Transport.Failure({
      id: request.id,
      error: { _tag: "PayloadTooLarge", maxSize: maxPayloadSize },
    })
  }
  // ...
})
```

---

## 3. Timeout Handling

### 3.1 Current State

| Layer | Timeout Support | Default |
|-------|-----------------|---------|
| HTTP Transport | YES | 30 seconds |
| Mock Transport | NO | N/A |
| Loopback Transport | NO | N/A |
| Server handle() | NO | Never times out |
| Server handleStream() | NO | Never times out |
| Middleware execution | NO | Never times out |
| Client hooks | NO (deferred to transport) | N/A |

### 3.2 HTTP Timeout Implementation

**Transport/index.ts:239, 259-262**:
```typescript
const timeout = options?.timeout ? Duration.toMillis(options.timeout) : 30000

// In sendHttp:
const controller = new globalThis.AbortController()
const timeoutId = timeout
  ? globalThis.setTimeout(() => controller.abort(), timeout)
  : undefined
```

**Issues**:
1. Uses `globalThis.setTimeout` instead of Effect.timeout
2. No cleanup on early success (potential memory leak)
3. AbortController not passed to stream handling

**Line 289** does clear the timeout:
```typescript
if (timeoutId) globalThis.clearTimeout(timeoutId)
```

### 3.3 Missing Timeout Scenarios

| Scenario | Current Behavior | Recommended |
|----------|------------------|-------------|
| Stream connection timeout | Waits forever | Add initial connection timeout |
| Stream idle timeout | Waits forever | Disconnect after N seconds of no chunks |
| Server handler timeout | Waits forever | Add per-procedure timeout config |
| Middleware chain timeout | Waits forever | Add aggregate middleware timeout |
| Slow payload decode | Waits forever | Timeout around Schema.decodeUnknown |

### 3.4 Recommendations

**Effect-idiomatic timeout (Transport)**:
```typescript
const sendHttp = (...) => 
  Effect.gen(function* () {
    // ... request setup ...
  }).pipe(
    Effect.timeout(timeout),
    Effect.mapError((e) => 
      e._tag === "TimeoutException"
        ? new TransportError({ reason: "Timeout", message: "Request timed out" })
        : e
    )
  )
```

**Per-procedure timeout (Procedure)**:
```typescript
export interface QueryOptions<...> {
  readonly timeout?: Duration.DurationInput  // Per-procedure timeout
}

// In Server handle():
const handlerWithTimeout = procedureTimeout
  ? handler(payload).pipe(Effect.timeout(procedureTimeout))
  : handler(payload)
```

**Stream timeouts**:
```typescript
// Connection timeout (time to first chunk)
Stream.timeout(connectionTimeout),

// Idle timeout (time between chunks)
Stream.timeoutFail(idleTimeout, () => 
  new TransportError({ reason: "Timeout", message: "Stream idle timeout" })
)
```

---

## 4. Reconnection Logic

### 4.1 Current State: NOT IMPLEMENTED

**Analysis**: No reconnection logic exists in the codebase.

- `Transport.http()` creates a stateless layer
- Each request is independent (no connection pooling)
- Stream failures are terminal (no retry)
- WebSocket transport not implemented

### 4.2 Missing Features

| Feature | Status | Notes |
|---------|--------|-------|
| HTTP request retry | NOT IMPLEMENTED | `isTransientError` helper exists but unused |
| Stream reconnection | NOT IMPLEMENTED | No reconnect on disconnect |
| WebSocket keepalive | N/A | WebSocket not implemented |
| Circuit breaker | NOT IMPLEMENTED | No failure rate tracking |
| Exponential backoff | NOT IMPLEMENTED | No retry delay |

### 4.3 The `isTransientError` Helper (Unused)

**Transport/index.ts:502-507**:
```typescript
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransportError) {
    return error.reason === "Network" || error.reason === "Timeout"
  }
  return false
}
```

This helper exists but is **never used** anywhere in the codebase.

### 4.4 Recommended Implementation

**Retry middleware for Transport**:
```typescript
// Transport/retry.ts
export const withRetry = (
  options: {
    maxAttempts?: number      // default: 3
    initialDelay?: Duration   // default: 100ms
    maxDelay?: Duration       // default: 5s
    backoffFactor?: number    // default: 2
  }
) => (layer: Layer.Layer<Transport>) => 
  Layer.map(layer, (transport) => ({
    send: (request) => transport.send(request).pipe(
      Effect.retry(
        Schedule.exponential(initialDelay, backoffFactor).pipe(
          Schedule.compose(Schedule.recurs(maxAttempts)),
          Schedule.whileInput(isTransientError)
        )
      )
    ),
    sendStream: (request) => transport.sendStream(request).pipe(
      Stream.retry(
        // Reconnect on transient errors
        Schedule.exponential(initialDelay, backoffFactor).pipe(
          Schedule.compose(Schedule.recurs(maxAttempts))
        )
      )
    ),
  }))
```

**Usage**:
```typescript
const transport = Transport.http("/api").pipe(
  Transport.withRetry({ maxAttempts: 3 })
)
```

**Stream reconnection with state preservation**:
```typescript
// For streams, we may need to restart from a cursor/position
interface ReconnectableStreamOptions {
  readonly getCursor: () => Effect.Effect<string | undefined>
  readonly onReconnect?: (cursor: string | undefined) => Effect.Effect<void>
}

export const reconnectableStream = <A, E>(
  create: (cursor?: string) => Stream.Stream<A, E>,
  options: ReconnectableStreamOptions
): Stream.Stream<A, E> =>
  Stream.unwrap(Effect.gen(function* () {
    const cursor = yield* options.getCursor()
    return create(cursor).pipe(
      Stream.retry(
        Schedule.exponential("100 millis").pipe(
          Schedule.compose(Schedule.recurs(5))
        )
      )
    )
  }))
```

---

## 5. Security Considerations

### 5.1 Input Validation Gaps

| Layer | Validation | Status |
|-------|------------|--------|
| Transport Request | Schema validation | PARTIAL (tag not validated) |
| Payload | Procedure schema | YES |
| Headers | None | **NOT VALIDATED** |
| Response | Envelope schema | YES |

### 5.2 Missing Security Features

#### 5.2.1 No Request ID Validation

**Transport/index.ts:146-151**:
```typescript
export class TransportRequest extends Schema.Class<TransportRequest>("TransportRequest")({
  id: Schema.String,  // ← Any string accepted, no format validation
  tag: Schema.String,
  payload: Schema.Unknown,
  headers: Schema.optionalWith(Schema.Record({...}), {...}),
})
```

**Risk**: Request ID injection (e.g., `id: "../../../etc/passwd"` if used in file paths)

**Recommendation**:
```typescript
const RequestId = Schema.String.pipe(
  Schema.pattern(/^[\w-]{1,64}$/)
)

export class TransportRequest extends Schema.Class<TransportRequest>("TransportRequest")({
  id: RequestId,
  // ...
})
```

#### 5.2.2 No Tag Path Traversal Protection

**Server/index.ts:244**:
```typescript
const entry = handlerMap.get(request.tag)
```

The tag is used directly as a map key. While the current implementation is safe (exact match required), there's no validation that the tag conforms to expected format.

**Recommendation**:
```typescript
const ProcedureTag = Schema.String.pipe(
  Schema.pattern(/^@[\w-]+(?:\/[\w-]+)*$/),  // e.g., "@api/users/list"
  Schema.maxLength(256)
)
```

#### 5.2.3 No Header Injection Prevention

**Server/index.ts:481-498** (HTTP handler):
```typescript
for (const name of commonHeaders) {
  const value = (request.headers as any).get(name)
  if (value) headers[name] = value  // ← No sanitization
}
```

**Risk**: Header value could contain newlines, enabling header injection in some contexts.

**Recommendation**:
```typescript
const sanitizeHeaderValue = (value: string): string =>
  value.replace(/[\r\n]/g, "")

for (const name of commonHeaders) {
  const value = (request.headers as any).get(name)
  if (value) headers[name] = sanitizeHeaderValue(value)
}
```

#### 5.2.4 No Rate Limiting

No rate limiting is implemented at any layer.

**Recommendation**: Add rate limiting middleware:
```typescript
// Example rate limit middleware
class RateLimitMiddleware extends Middleware.Tag<void, RateLimitError>(...)

const RateLimitMiddlewareLive = Middleware.implement(RateLimitMiddleware, (request) =>
  Effect.gen(function* () {
    const rateLimiter = yield* RateLimiter
    const allowed = yield* rateLimiter.check(request.headers.get("x-forwarded-for") ?? "unknown")
    if (!allowed) {
      return yield* Effect.fail(new RateLimitError({ retryAfter: 60 }))
    }
  })
)
```

#### 5.2.5 No CORS Configuration

The HTTP handlers don't set CORS headers.

**Transport/index.ts** `toHttpHandler`, `toFetchHandler` return:
```typescript
headers: { "Content-Type": "application/json" },
```

**Recommendation**: Add CORS options:
```typescript
export interface HttpHandlerOptions {
  readonly path?: string
  readonly cors?: {
    readonly origin: string | string[] | ((origin: string) => boolean)
    readonly methods?: string[]
    readonly allowedHeaders?: string[]
    readonly maxAge?: number
  }
}
```

### 5.3 Information Disclosure Risks

| Risk | Location | Mitigation |
|------|----------|------------|
| Stack traces in errors | Server encode fallback | Return generic InternalError |
| Internal type names | Schema decode errors | Strip error details in production |
| Procedure existence probe | Unknown procedure message | Use generic "Not found" message |
| Timing attacks | Handler execution | Constant-time responses (optional) |

### 5.4 Prototype Pollution Protection

**Transport/index.ts:300-308** (JSON parsing):
```typescript
const json = yield* Effect.tryPromise({
  try: () => response.json(),  // ← Native JSON.parse
  catch: ...
})
```

The native `response.json()` is safe from prototype pollution. However, `Schema.decodeUnknown` should also be safe since Effect Schema doesn't use `__proto__` or `constructor` during decoding.

**Status**: SAFE

---

## 6. Stream-Specific Edge Cases

### 6.1 Handled

| Case | Handling | Location |
|------|----------|----------|
| Stream error mid-way | Failure envelope | Server/index.ts:372-374 |
| Stream completion | StreamEnd envelope | Server/index.ts:375 |
| Client disconnect | N/A (HTTP, no persistent connection) | — |

### 6.2 Not Handled

| Case | Current Behavior | Risk |
|------|------------------|------|
| Infinite stream | Runs forever | Memory exhaustion |
| Backpressure | None | Memory exhaustion |
| Slow consumer | No buffering limits | Memory exhaustion |
| Stream error encoding | Raw error sent | Type safety broken |

### 6.3 Stream Error Encoding Issue

**Server/index.ts:372-374** (in handleStream):
```typescript
Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
  Stream.succeed(new Transport.Failure({ id: request.id, error }))
),
```

**Problem**: Stream errors are sent raw without schema encoding, unlike single-response errors.

**Compare with handle() (Line 278)**:
```typescript
Schema.encode(procedure.errorSchema)(error).pipe(...)
```

**Recommendation**: Apply same encoding to stream errors:
```typescript
Stream.catchAll((error) =>
  Stream.fromEffect(
    Schema.encode(procedure.errorSchema)(error).pipe(
      Effect.map((encoded) => 
        new Transport.Failure({ id: request.id, error: encoded })
      ),
      Effect.catchAll(() =>
        Effect.succeed(new Transport.Failure({ 
          id: request.id, 
          error: { _tag: "InternalError" } 
        }))
      )
    )
  )
)
```

---

## 7. Middleware Edge Cases

### 7.1 Handled

| Case | Handling | Location |
|------|----------|----------|
| Middleware failure | Error returned to client | Middleware/index.ts:356-371 |
| Middleware provides service | Service available to handler | Middleware/index.ts:386-390 |
| Combined middleware | All executed in order | Middleware/index.ts:362-364 |

### 7.2 Not Handled

| Case | Current Behavior | Risk |
|------|------------------|------|
| Middleware service not provided | Runtime crash | **HIGH** |
| Middleware timeout | Never times out | Resource exhaustion |
| Circular middleware deps | Stack overflow | **MEDIUM** |
| Async middleware cleanup | Not supported | Resource leaks |

### 7.3 Missing Service Error

**Middleware/index.ts:378-380**:
```typescript
const executeOne = <...>(...) =>
  Effect.gen(function* () {
    const impl = yield* middleware as any  // ← Throws if not in context
```

If the middleware service is not provided in the Layer, this will crash with an unhandled `NoSuchElementException`.

**Recommendation**:
```typescript
const impl = yield* Effect.serviceOption(middleware as any)
if (impl._tag === "None") {
  return yield* Effect.fail(new MiddlewareNotProvidedError({
    middleware: middleware.key,
    message: `Middleware ${middleware.key} not provided. Add its Layer to the server.`,
  }))
}
```

---

## 8. Recommendations Summary

### Critical (Fix Now)

| Issue | Location | Severity | Effort |
|-------|----------|----------|--------|
| No payload size limits | Transport, Server | **HIGH** | Medium |
| Error encoding fallback | Server/index.ts:279 | **HIGH** | Low |
| Stream error not encoded | Server/index.ts:372 | **HIGH** | Low |
| Middleware service crash | Middleware/index.ts:378 | **HIGH** | Low |

### High Priority (Fix Soon)

| Issue | Location | Severity | Effort |
|-------|----------|----------|--------|
| No request retry | Transport | MEDIUM | Medium |
| No stream reconnection | Transport | MEDIUM | High |
| No rate limiting | Server/Middleware | MEDIUM | Medium |
| No request ID validation | Transport | MEDIUM | Low |

### Medium Priority

| Issue | Location | Severity | Effort |
|-------|----------|----------|--------|
| No stream backpressure | Server | MEDIUM | High |
| No Effect-based timeout | Transport | LOW | Medium |
| No CORS configuration | Server | LOW | Low |
| Unused isTransientError | Transport | LOW | Low |

### Low Priority (Nice to Have)

| Issue | Location | Notes |
|-------|----------|-------|
| WebSocket transport | Transport | Not planned |
| Circuit breaker | Transport | For resilience |
| Request tracing | Server | For observability |

---

## 9. Testing Recommendations

### Edge Case Tests to Add

```typescript
describe("Edge Cases", () => {
  describe("Payload Limits", () => {
    it("rejects payloads exceeding maxPayloadSize")
    it("rejects responses exceeding maxResponseSize")
    it("handles deeply nested JSON gracefully")
  })
  
  describe("Timeouts", () => {
    it("times out slow handlers")
    it("times out slow middleware")
    it("times out stream connection")
    it("times out idle streams")
  })
  
  describe("Reconnection", () => {
    it("retries on transient network errors")
    it("respects maxAttempts")
    it("applies exponential backoff")
    it("reconnects streams with cursor")
  })
  
  describe("Security", () => {
    it("rejects malformed request IDs")
    it("rejects malformed procedure tags")
    it("sanitizes header values")
    it("rate limits excessive requests")
    it("does not leak internal error details")
  })
  
  describe("Streams", () => {
    it("enforces stream chunk limits")
    it("encodes stream errors via schema")
    it("handles slow consumers gracefully")
    it("terminates infinite streams")
  })
  
  describe("Middleware", () => {
    it("fails gracefully when middleware service missing")
    it("times out slow middleware chains")
    it("cleans up middleware resources on error")
  })
})
```

---

## 10. Conclusion

The effect-trpc codebase handles standard error cases adequately but has significant gaps in edge case handling:

1. **No payload/response size limits** — DoS risk
2. **No retry/reconnection** — Poor resilience  
3. **Incomplete timeout coverage** — Resource exhaustion risk
4. **Stream error encoding gap** — Type safety broken
5. **Missing middleware service handling** — Runtime crashes

The `isTransientError` helper shows intention for retry logic that was never implemented. The core architecture is sound but needs hardening for production use.

Priority focus areas:
1. Add payload size limits (immediate security concern)
2. Fix error encoding fallbacks (type safety)
3. Implement request retry with backoff (resilience)
4. Add stream-specific safeguards (resource management)
