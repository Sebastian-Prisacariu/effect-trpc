# Edge Cases and Robustness Analysis

## Overview

This document analyzes edge cases in the effect-trpc codebase and identifies potential crash scenarios, missing handling, and recommendations for hardening.

---

## 1. Empty Payloads/Responses

### Current Handling

**Empty Payloads:**
- Procedures with `Schema.Void` payload: The system defaults to `Schema.Void` when no payload schema is provided
- `Server/index.ts:240`: Payload decoding uses `Schema.decodeUnknown(procedure.payloadSchema)(request.payload)`
- `undefined` is valid for void payloads

**Empty Responses:**
- `Schema.Void` for success schema works correctly
- Server encodes responses with `Schema.encode(procedure.successSchema)(value)`

### Issues Found

1. **Missing `undefined` handling in HTTP transport** (`Transport/index.ts:303-306`):
   ```typescript
   body: JSON.stringify({
     id: request.id,
     tag: request.tag,
     payload: request.payload,  // Could be undefined
   })
   ```
   - `JSON.stringify` converts `undefined` to no key at all, which is fine
   - But server expects payload to be present in request

2. **No validation of empty string payloads**:
   - An empty string `""` is different from `undefined` but might slip through

### Recommendations

- Add explicit `undefined` → `null` conversion for JSON serialization consistency
- Consider validating that void procedures don't receive non-void payloads

---

## 2. Very Large Payloads

### Current Handling

- **No payload size limits anywhere in the codebase**
- HTTP transport (`Transport/index.ts:295-318`) sends entire payload via `JSON.stringify`
- Server processes payloads without size validation

### Issues Found

1. **No memory protection**:
   ```typescript
   // Transport/index.ts:303
   body: JSON.stringify({...payload})  // Unbounded
   ```

2. **No streaming for large payloads**:
   - Client buffers entire response in memory
   - `Schema.decodeUnknown` operates on full object

3. **No request body size limit in HTTP handler**:
   ```typescript
   // Server/index.ts:382-384
   Effect.tryPromise({
     try: () => request.json(),  // No size limit
     catch: () => ({ id: "", tag: "", payload: undefined }),
   })
   ```

### Potential Crash Scenarios

- **OOM on server**: Malicious client sends multi-GB payload
- **OOM on client**: Server returns huge response
- **JSON.stringify stack overflow**: Extremely nested objects

### Recommendations

1. Add `maxPayloadSize` option to transport configuration
2. Implement streaming JSON parsing for large responses
3. Add depth limit for nested structures
4. Server middleware for request size validation

---

## 3. Concurrent Requests

### Current Handling

- **Request IDs**: `Transport.generateRequestId()` uses `Date.now()` + random string
- **No request deduplication** or queuing
- **Independent handling**: Each request processed separately

### Issues Found

1. **Potential ID collision** (unlikely but possible):
   ```typescript
   // Transport/index.ts:546-547
   export const generateRequestId = (): string =>
     `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
   ```
   - `Math.random()` could theoretically produce duplicates

2. **No concurrency control for streams**:
   - Multiple streams could exhaust resources
   - No limit on concurrent SSE connections

3. **Race conditions in Reactivity**:
   ```typescript
   // Reactivity/index.ts:162-199
   const invalidate = (tags: ReadonlyArray<string>): void => {
     // Callbacks invoked synchronously
     // Could cause issues if callback modifies subscriptions
   }
   ```

4. **Database state not synchronized in tests**:
   - E2E test fixtures use separate database instances per request
   - This hides real concurrency bugs

### Recommendations

1. Use UUID v4 or Effect's random for request IDs
2. Add `maxConcurrentRequests` option
3. Add `maxConcurrentStreams` option
4. Consider mutex/semaphore for Reactivity invalidation
5. Add concurrency tests

---

## 4. Middleware Throws

### Current Handling

```typescript
// Middleware/index.ts:346-365
const executeOne = <A, E, R, Provides, Failure>(
  middleware: MiddlewareTag<any, Provides, Failure>,
  request: MiddlewareRequest,
  next: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure, R> =>
  Effect.gen(function* () {
    const impl = yield* middleware as any // Could throw if not provided
    if ("wrap" in impl) {
      return yield* (impl as WrapMiddlewareImpl<Failure>).wrap(request, next)
    } else {
      const provided = yield* (impl as MiddlewareImpl<Provides, Failure>).run(request)
      return yield* next.pipe(Effect.provideService(middleware.provides, provided))
    }
  })
```

### Issues Found

1. **Missing middleware in context causes unclear error**:
   - If middleware tag is not in context, Effect.gen yields generic service missing error
   - No custom error message indicating which middleware failed

2. **No timeout for middleware execution**:
   - A slow auth check could hang the request indefinitely

3. **Middleware errors not encoded properly**:
   - Server wraps handler errors but not middleware failures
   - Middleware failures bypass the encoding path

4. **No middleware error isolation**:
   - If one middleware in a chain fails, the whole chain fails
   - No fallback mechanism

### Potential Crash Scenarios

- **Unhandled rejection**: Middleware `run()` throws synchronously
- **Infinite loop**: Middleware with circular dependency
- **Missing tag**: `Effect.gen` yields missing service

### Recommendations

1. Add timeout option per middleware
2. Wrap middleware execution in `Effect.try` for sync errors
3. Add clear error messages for missing middleware
4. Consider `Effect.catchAll` for middleware-specific error handling in server

---

## 5. Network Disconnection During Stream

### Current Handling

```typescript
// Transport/index.ts:355-371
const sendHttpStream = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<StreamResponse, TransportError> =>
  // TODO: Implement proper SSE/streaming - for now just convert single response
  Stream.fromEffect(
    sendHttp(url, request, fetchFn, headers, undefined).pipe(...)
  )
```

### Issues Found

1. **Streaming not actually implemented**:
   - The `sendHttpStream` is a stub that doesn't do real SSE
   - No actual streaming protocol

2. **No reconnection logic**:
   - If connection drops, stream fails permanently

3. **No heartbeat/keepalive**:
   - No detection of silent failures

4. **Client-side stream not cleaned up on disconnect**:
   ```typescript
   // Client/index.ts:150-184
   // Stream.takeWhile but no timeout or cleanup
   ```

5. **Server stream not cancelled on client disconnect**:
   ```typescript
   // Server/index.ts:306-323
   const makeStream = (payload: unknown): Stream.Stream<...> => {
     const stream = handler(payload) as Stream.Stream<...>
     return stream.pipe(...)  // No cancellation token
   }
   ```

### Potential Issues

- **Memory leak**: Server continues streaming to disconnected client
- **Resource exhaustion**: Zombie streams accumulate
- **No backpressure**: Client can't slow down server

### Recommendations

1. Implement proper SSE transport with EventSource
2. Add reconnection with exponential backoff
3. Implement heartbeat (ping/pong every N seconds)
4. Add `Stream.interruptible` for cancellation
5. Implement backpressure signaling

---

## 6. Malformed Responses

### Current Handling

```typescript
// Transport/index.ts:342-350
const decoded = yield* Schema.decodeUnknown(TransportResponse)(json).pipe(
  Effect.mapError((cause) =>
    new TransportError({
      reason: "Protocol",
      message: "Invalid response envelope",
      cause,
    })
  )
)
```

### Issues Found

1. **JSON parse errors handled but generic**:
   ```typescript
   // Transport/index.ts:331-339
   const json = yield* Effect.tryPromise({
     try: () => response.json(),
     catch: (cause) => new TransportError({...})
   })
   ```

2. **No validation of response.id matching request.id**:
   - Server could return wrong ID
   - No request/response correlation check

3. **Schema decode errors lose context**:
   - Original response is not preserved in error
   - Hard to debug what was actually received

4. **Client doesn't validate success/error schema match**:
   ```typescript
   // Client/index.ts:118-135
   if (Schema.is(Transport.Success)(response)) {
     return yield* Schema.decodeUnknown(successSchema)(response.value)
   } else {
     const error = yield* Schema.decodeUnknown(errorSchema)(response.error)
     return yield* Effect.fail(error)
   }
   ```
   - If server sends wrong error shape, decode fails with generic error

### Potential Issues

- **Silent data corruption**: Schema allows `unknown`, might pass invalid shapes
- **Confusing errors**: User sees "Protocol error" without details
- **Type unsafety**: Runtime types might not match TypeScript types

### Recommendations

1. Add request/response ID correlation check
2. Preserve original response in decode errors
3. Add verbose logging mode for debugging
4. Consider `Schema.Strict` variants where appropriate

---

## 7. Invalid Tags

### Current Handling

```typescript
// Server/index.ts:220-228
const handle = (request: TransportRequest): Effect.Effect<...> => {
  const entry = handlerMap.get(request.tag)
  
  if (!entry) {
    return Effect.succeed(new Transport.Failure({
      id: request.id,
      error: { message: `Unknown procedure: ${request.tag}` },
    }))
  }
  // ...
}
```

### Issues Found

1. **Unknown procedure returns Failure, not TransportError**:
   - Client might try to decode as user error schema
   - Inconsistent with other protocol errors

2. **No tag format validation**:
   - Malformed tags like `"@api//users"` or `"@api"` not checked
   - Could cause Map lookup issues

3. **Tag injection not prevented**:
   - Tag comes from client, could contain malicious content
   - Not sanitized before logging

4. **Stream vs non-stream mismatch not well handled**:
   ```typescript
   // Server/index.ts:229-236
   if (isStream) {
     return Effect.succeed(new Transport.Failure({
       id: request.id,
       error: { message: `Use handleStream for streaming procedures: ${request.tag}` },
     }))
   }
   ```
   - Returns Failure instead of proper protocol error

5. **Mock transport tag conversion could fail**:
   ```typescript
   // Transport/index.ts:488-493
   const tagToPath = (tag: string): string => {
     const parts = tag.split("/")
     return parts.slice(1).join(".")  // Assumes format, could fail
   }
   ```

### Recommendations

1. Create distinct `ProcedureNotFoundError` type
2. Validate tag format with regex
3. Sanitize tags in error messages (prevent XSS in logs)
4. Add type hints for stream vs non-stream mismatch

---

## 8. Circular References in Payloads

### Current Handling

**None** - The codebase does not handle circular references.

### Issues Found

1. **JSON.stringify throws on circular refs**:
   ```typescript
   // Transport/index.ts:303-306
   body: JSON.stringify({
     id: request.id,
     tag: request.tag,
     payload: request.payload,  // If circular, throws
   })
   ```
   - `TypeError: Converting circular structure to JSON`

2. **No detection before serialization**:
   - Error occurs at serialization time, not validation time

3. **Schema doesn't prevent circular structures**:
   - `Schema.Unknown` allows anything including circular refs

### Potential Crash Scenarios

- **Uncaught TypeError**: Transport throws without Effect wrapping in some paths
- **Stack overflow**: Deep recursion before hitting circular detection

### Recommendations

1. Add `safeStringify` utility with circular reference detection
2. Return proper TransportError for serialization failures
3. Document that circular references are not supported
4. Consider adding `maxDepth` check for nested structures

---

## 9. Very Deep Nesting in Routers

### Current Handling

```typescript
// Router/index.ts:179-205
const walk = (def: Definition, pathPrefix: string, tagPrefix: string): void => {
  for (const key of Object.keys(def)) {
    const value = def[key]
    const path = pathPrefix ? `${pathPrefix}.${key}` : key
    const procedureTag = `${tagPrefix}/${key}`
    
    if (Procedure.isProcedure(value)) {
      // ...
    } else {
      walk(value, path, procedureTag)  // Recursive!
    }
  }
}
```

### Issues Found

1. **No depth limit on router nesting**:
   - Recursive `walk` could stack overflow
   - Very long tags could cause issues

2. **Path string concatenation unbounded**:
   - `"${pathPrefix}.${key}"` grows without limit
   - Long paths could cause memory issues

3. **Client proxy recursion unbounded**:
   ```typescript
   // Client/index.ts:544-556
   const buildProxy = <Def extends Definition>(
     def: Def,
     pathParts: readonly string[]
   ): ClientProxy<Def> =>
     Record.map(def, (value, key) => {
       // ... recursive
       return buildProxy(value as Router.Definition, newPath)
     })
   ```

4. **Server handler map building unbounded**:
   ```typescript
   // Server/index.ts:160-200
   const buildHandlerMap = (def, handlerDef, pathParts, inheritedMiddlewares) => {
     // ... recursive walk
   }
   ```

### Potential Crash Scenarios

- **Stack overflow**: Router with 1000+ levels of nesting
- **String length overflow**: Extremely long path strings
- **Map size limits**: Router with millions of procedures

### Recommendations

1. Add `maxDepth` constant (e.g., 100 levels)
2. Validate depth at router creation time
3. Use iterative tree walking instead of recursion
4. Add path/tag length limits

---

## 10. Undefined vs Null Handling

### Current Handling

Schema.js and Effect generally distinguish `undefined` from `null`:
- `Schema.Void` represents `undefined`/void
- `Schema.Null` represents `null`
- `Schema.Unknown` accepts both

### Issues Found

1. **Inconsistent void handling**:
   ```typescript
   // Procedure/index.ts:268
   self.payloadSchema = options.payload ?? Schema.Void
   
   // But void payloads get passed as `undefined`
   ```

2. **JSON serialization converts undefined to null (mostly)**:
   ```typescript
   // undefined in object values → omitted
   // undefined as standalone value → "null" in JSON
   JSON.stringify(undefined)  // → "undefined" (invalid JSON!)
   JSON.stringify({ a: undefined })  // → "{}" (key omitted)
   ```

3. **Schema.Void decoding strictness**:
   - `Schema.Void` expects exactly `undefined`
   - `null` from JSON won't decode properly

4. **Response value could be null vs undefined**:
   ```typescript
   // Transport/index.ts:84-87
   export class Success extends Schema.TaggedClass<Success>()("Success", {
     id: Schema.String,
     value: Schema.Unknown,  // Could be null
   }) {}
   ```

5. **Optional fields inconsistent**:
   ```typescript
   // Transport/index.ts:153
   headers: Schema.optionalWith(Schema.Record(...), { default: () => ({}) })
   // This handles undefined but what about null?
   ```

### Potential Issues

- **Type mismatch at runtime**: TypeScript says `void`, runtime sees `null`
- **Decode failures for null payloads**: Server sends null, client expects undefined
- **Inconsistent behavior across transports**: HTTP vs WebSocket might handle differently

### Recommendations

1. Normalize `undefined`/`null` at transport boundary
2. Use `Schema.NullOr(Schema.Void)` for nullable void
3. Document null vs undefined semantics clearly
4. Add integration tests for null/undefined round-trips

---

## Summary of Potential Crash Scenarios

| Scenario | Likelihood | Impact | Location |
|----------|------------|--------|----------|
| Large payload OOM | Medium | High | Transport, Server |
| Circular reference TypeError | Low | Medium | Transport |
| Deep nesting stack overflow | Low | High | Router, Server, Client |
| Middleware missing in context | Medium | Medium | Middleware |
| Request ID collision | Very Low | Low | Transport |
| Stream resource leak | Medium | High | Server, Client |
| JSON parse failure | Low | Low | Transport (handled) |
| Unknown procedure | Medium | Low | Server (handled) |
| Schema decode failure | Medium | Low | Client (handled) |

---

## Priority Recommendations

### High Priority (Security/Stability)

1. **Add payload size limits** - Prevent OOM attacks
2. **Implement proper SSE streaming** - Current stub is not production-ready
3. **Add circular reference detection** - Prevent uncaught TypeError
4. **Add router depth limits** - Prevent stack overflow

### Medium Priority (Robustness)

5. **Improve error context** - Preserve original data in decode errors
6. **Add middleware timeout** - Prevent hanging requests
7. **Validate tag format** - Prevent injection/malformed tags
8. **Normalize null/undefined** - Consistent behavior

### Lower Priority (Polish)

9. **UUID for request IDs** - Better uniqueness guarantee
10. **Concurrency limits** - Resource protection
11. **Request/response correlation** - Verify IDs match
12. **Iterative tree walking** - Avoid recursion limits

---

## Test Coverage Gaps

The following edge cases lack test coverage:

1. Empty payload round-trip
2. Very large payloads (boundary testing)
3. Concurrent request handling
4. Middleware timeout scenarios
5. Network disconnection during stream
6. Malformed JSON responses
7. Invalid/malformed tags
8. Circular reference in payload
9. Deeply nested routers (>10 levels)
10. Null vs undefined in various positions
