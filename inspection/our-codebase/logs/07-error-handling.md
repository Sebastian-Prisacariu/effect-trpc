# Error Handling Patterns Analysis

**Date:** March 13, 2026  
**Scope:** Error flow, encoding/decoding, transport errors, middleware failures, and Effect best practice compliance

---

## Executive Summary

The error handling in effect-trpc is **mostly well-designed** but has several areas for improvement:

| Category | Status | Impact |
|----------|--------|--------|
| TransportError class | Well-designed | Good |
| Domain error flow (Server → Client) | **Asymmetric encoding** | Medium |
| Error type preservation | **Lost at Failure envelope** | High |
| throw/catch usage | **6 violations in Client** | Medium |
| Silent error swallowing | 2 locations found | Low-Medium |
| Schema decode error handling | Good | Good |
| Middleware error flow | Good | Good |
| Error logging | **Sparse, inconsistent** | Medium |

---

## 1. TransportError Class Analysis

### Location: `src/Transport/index.ts:65-72`

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

### Assessment: Good Design

**Strengths:**
1. Uses `Schema.TaggedError` - enables encoding/decoding
2. Discriminated union for `reason` - precise error categorization
3. Optional `cause` for wrapping underlying errors
4. Follows Effect best practices for domain errors

**Weakness:**
- `cause: Schema.Unknown` loses type information. Consider:
  ```typescript
  cause: Schema.optional(Schema.Defect) // preserves stack traces
  ```

### Utility Function

```typescript
// src/Transport/index.ts:533-538
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransportError) {
    return error.reason === "Network" || error.reason === "Timeout"
  }
  return false
}
```

**Good:** Enables retry logic based on error category.

---

## 2. Failure Response Envelope Analysis

### Location: `src/Transport/index.ts:94-98`

```typescript
export class Failure extends Schema.TaggedClass<Failure>()("Failure", {
  id: Schema.String,
  error: Schema.Unknown,  // <-- Problem: loses type
}) {}
```

### Problem: Error Type Erasure

The `error: Schema.Unknown` means domain errors are **not type-safe** through the wire:

```
Client                          Server
   │                              │
   │  ← Failure { error: any }    │ ← NotFoundError { _tag, entity, id }
   │                              │
   └──────────────────────────────┘
        Type information lost!
```

### Where This Matters

**Server Side (src/Server/index.ts:250-256):**
```typescript
onFailure: (error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.orElseSucceed(() => error),  // Falls back to raw error
    Effect.map((encodedError) => new Transport.Failure({
      id: request.id,
      error: encodedError,  // Schema.Unknown accepts anything
    }))
  ),
```

**Client Side (src/Client/index.ts:127-134):**
```typescript
const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
  Effect.mapError((e) => new Transport.TransportError({
    reason: "Protocol",
    message: "Failed to decode error response",
    cause: e,
  }))
)
return yield* Effect.fail(error)
```

### Assessment: Asymmetric Encoding

The server **encodes** with `Schema.encode(procedure.errorSchema)` but falls back silently if encoding fails. The client **decodes** with `Schema.decodeUnknown(errorSchema)` and wraps failures as `TransportError`.

**Issue 1:** If the server's `Schema.encode` fails, the raw error object is sent. This may not decode correctly on the client.

**Issue 2:** The client turns decode failures into `TransportError` with `reason: "Protocol"`. This masks the original domain error.

**Recommendation:**
1. Server should not fall back to raw error - fail loudly
2. Client should preserve original error in decode failure

---

## 3. Error Flow Through System Layers

### 3.1 Happy Path (Success)

```
Handler Effect
    │
    ↓ Effect.succeed(user)
    │
    ↓ Schema.encode(successSchema)
    │
    ↓ Transport.Success { id, value: encoded }
    │
    ↓ JSON.stringify
    │
    ↓ (wire)
    │
    ↓ JSON.parse
    │
    ↓ Schema.decodeUnknown(TransportResponse)
    │
    ↓ Schema.decodeUnknown(successSchema)
    │
    ↓ Typed Success Value
```

### 3.2 Domain Error Path

```
Handler Effect
    │
    ↓ Effect.fail(new NotFoundError({ ... }))
    │
    ↓ matchEffect.onFailure
    │
    ↓ Schema.encode(errorSchema)
    │   │
    │   └─ orElseSucceed(() => error)  ← SILENT FALLBACK
    │
    ↓ Transport.Failure { id, error: encoded or raw }
    │
    ↓ JSON.stringify  ← MAY LOSE NON-SERIALIZABLE DATA
    │
    ↓ (wire)
    │
    ↓ JSON.parse
    │
    ↓ Schema.decodeUnknown(TransportResponse)
    │
    ↓ Schema.decodeUnknown(errorSchema)
    │   │
    │   └─ mapError(() => TransportError)  ← ORIGINAL ERROR MASKED
    │
    ↓ Effect.fail(decodedError OR TransportError)
```

### 3.3 Transport Error Path

```
HTTP Request
    │
    ↓ fetchFn(...)
    │   │
    │   └─ catch → TransportError { reason: "Network", cause }
    │
    ↓ response.ok check
    │   │
    │   └─ !ok → TransportError { reason: "Protocol", message: "HTTP 4xx/5xx" }
    │
    ↓ response.json()
    │   │
    │   └─ catch → TransportError { reason: "Protocol", cause }
    │
    ↓ Schema.decodeUnknown(TransportResponse)
    │   │
    │   └─ mapError → TransportError { reason: "Protocol", cause }
    │
    ↓ Effect.fail(TransportError)
```

---

## 4. throw/catch Violations

### Found in `src/Client/index.ts`

| Line | Code | Context | Severity |
|------|------|---------|----------|
| 637 | `throw new Error("runPromise requires...")` | Query runPromise fallback | Medium |
| 672 | `throw new Error("runPromise requires...")` | Mutation runPromise fallback | Medium |
| 685 | `throw new Error("Unknown procedure type...")` | createProcedureClient guard | Low |
| 726 | `throw new Error("useQuery requires React...")` | React hook stub | Acceptable |
| 736 | `throw new Error("useMutation requires React...")` | React hook stub | Acceptable |
| 746 | `throw new Error("useStream requires React...")` | React hook stub | Acceptable |

### Found in `src/Reactivity/index.ts:195-197`

```typescript
try {
  callback()
} catch (error) {
  console.error("[Reactivity] Callback error:", error)
}
```

**Context:** Invalidation callback invocation.

**Assessment:** Acceptable - prevents one callback failure from stopping others. But should use Effect's error handling if callbacks were Effects.

### Recommendations

1. **Replace throw in runPromise:**
   ```typescript
   // Instead of:
   : () => { throw new Error("runPromise requires...") }
   
   // Use:
   : () => Promise.reject(new Error("runPromise requires..."))
   ```

2. **Replace throw in createProcedureClient:**
   ```typescript
   // Use Effect.dieMessage for programming errors:
   return Effect.dieMessage(`Unknown procedure type: ${(procedure as any)._tag}`)
   ```

---

## 5. Silent Error Swallowing

### 5.1 Server Error Encoding Fallback

**Location:** `src/Server/index.ts:251`

```typescript
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.orElseSucceed(() => error),  // <-- Silently sends raw error
```

**Problem:** If encoding fails, the raw error is sent without any indication that encoding failed.

**Fix:**
```typescript
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.catchAll((encodeError) =>
    Effect.succeed({
      _tag: "EncodingFailed",
      originalError: String(error),
      encodeError: String(encodeError),
    })
  ),
```

### 5.2 Console.warn in Unbound Client

**Location:** `src/Client/index.ts:571`

```typescript
invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  console.warn("invalidate() on unbound client requires ReactivityService in scope...")
},
```

**Problem:** User calls `invalidate()`, nothing happens except a console warning. The error is effectively swallowed.

**Fix:** Should this throw or return a no-op? At minimum, make the warning more prominent or make the function unavailable on unbound clients.

### 5.3 Reactivity Callback Error

**Location:** `src/Reactivity/index.ts:195-197`

```typescript
try {
  callback()
} catch (error) {
  console.error("[Reactivity] Callback error:", error)
}
```

**Assessment:** This is intentional - prevents one bad callback from breaking others. But the error is only logged, not reported to any error boundary.

---

## 6. Schema Decode Error Handling

### 6.1 Server-Side Payload Decoding

**Location:** `src/Server/index.ts:240-245`

```typescript
return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
  Effect.matchEffect({
    onFailure: (cause) => Effect.succeed(new Transport.Failure({
      id: request.id,
      error: { message: "Invalid payload", cause },  // Good: includes cause
    })),
    // ...
  })
)
```

**Assessment: Good** - Decode failures become typed Failure responses with the parse error included.

### 6.2 Client-Side Success Decoding

**Location:** `src/Client/index.ts:119-125`

```typescript
return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
  Effect.mapError((e) => new Transport.TransportError({
    reason: "Protocol",
    message: "Failed to decode success response",
    cause: e,
  }))
)
```

**Assessment: Good** - Decode failures are wrapped in TransportError with original parse error as cause.

### 6.3 Client-Side Error Decoding

**Location:** `src/Client/index.ts:127-134`

```typescript
const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
  Effect.mapError((e) => new Transport.TransportError({
    reason: "Protocol",
    message: "Failed to decode error response",
    cause: e,
  }))
)
return yield* Effect.fail(error)
```

**Assessment: Concerning** - If error decoding fails, we get `TransportError` instead of the domain error. This loses error type information.

**Recommendation:**
```typescript
// Try to decode as domain error, fall back to generic failure
const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
  Effect.orElse(() => Effect.succeed({
    _tag: "UnknownError" as const,
    raw: response.error,
  }))
)
```

---

## 7. Middleware Error Handling

### 7.1 Middleware Execution

**Location:** `src/Middleware/index.ts:329-344`

```typescript
export const execute = <A, E, R>(
  middlewares: ReadonlyArray<Applicable>,
  request: MiddlewareRequest,
  handler: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure<typeof middlewares[number]>, ...> => {
  const flatMiddlewares = middlewares.flatMap((m) =>
    MiddlewareTypeId in m ? (m as CombinedMiddleware<any>).tags : [m]
  )
  
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler as Effect.Effect<A, any, any>
  )
}
```

**Assessment: Good** - Middleware failures are properly typed via `Failure<M>` type. Error channel is unified.

### 7.2 Individual Middleware Execution

**Location:** `src/Middleware/index.ts:346-365`

```typescript
const executeOne = <A, E, R, Provides, Failure>(
  middleware: MiddlewareTag<any, Provides, Failure>,
  request: MiddlewareRequest,
  next: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure, R> =>
  Effect.gen(function* () {
    const impl = yield* middleware
    
    if ("wrap" in impl) {
      return yield* (impl as WrapMiddlewareImpl<Failure>).wrap(request, next)
    } else {
      const provided = yield* (impl as MiddlewareImpl<Provides, Failure>).run(request)
      return yield* next.pipe(Effect.provideService(middleware.provides, provided))
    }
  })
```

**Assessment: Good** - Middleware failures short-circuit the chain and propagate to the handler result.

### 7.3 Server-Side Middleware Integration

**Location:** `src/Server/index.ts:269-276`

```typescript
if (middlewares.length > 0) {
  return Middleware.execute(
    middlewares,
    middlewareRequest,
    handlerEffect
  ) as Effect.Effect<Transport.TransportResponse, never, R>
}
```

**Assessment: Good** - Middleware errors are integrated into the response flow.

---

## 8. Error Logging Patterns

### Current Logging

| Location | Level | Message |
|----------|-------|---------|
| `src/Reactivity/index.ts:197` | `console.error` | `[Reactivity] Callback error: ${error}` |
| `src/Client/index.ts:571` | `console.warn` | `invalidate() on unbound client requires...` |

### Assessment: Sparse and Inconsistent

**Problems:**
1. No logging in Transport layer (fetch failures)
2. No logging in Server handler errors
3. No logging in middleware failures
4. No structured logging (JSON format for observability)

**Recommendations:**

1. **Add configurable logger service:**
   ```typescript
   class Logger extends Context.Tag("Logger")<Logger, {
     readonly error: (module: string, message: string, cause?: unknown) => void
     readonly warn: (module: string, message: string) => void
     readonly debug: (module: string, message: string) => void
   }>() {}
   ```

2. **Log at key failure points:**
   - Transport fetch failures
   - Schema decode failures
   - Middleware failures
   - Handler uncaught errors

3. **Use Effect's built-in logging:**
   ```typescript
   Effect.logError("Failed to decode payload").pipe(
     Effect.annotateLogs("request.id", request.id),
     Effect.annotateLogs("error", cause)
   )
   ```

---

## 9. Comparison with Effect Best Practices

### Expected Pattern

```typescript
// Define rich domain error
class MyError extends Schema.TaggedError<MyError>()(
  'MyError',
  {
    module: Schema.String,
    method: Schema.String,
    description: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect),
  }
) {
  get message(): string {
    return `${this.module}.${this.method}: ${this.description ?? 'Failed'}`
  }
}
```

### Current Violations

| Rule | Status | Details |
|------|--------|---------|
| No async/await | **Compliant** | Uses Effect throughout |
| No try/catch in Effect code | **Mostly compliant** | 1 violation in Reactivity |
| Never throw in Effect code | **Partial violation** | 6 throws in Client for edge cases |
| No `Schema.decodeUnknownSync` | **Compliant** | Uses `Schema.decodeUnknown` |
| Rich domain errors | **Partial** | TransportError is good; Failure envelope loses types |
| Context.Tag for services | **Compliant** | Transport, Reactivity, ClientService all use Tags |

---

## 10. Error Type Preservation Analysis

### Where Types Are Preserved

1. **Procedure Definition:** `errorSchema` is typed
2. **Handler Type:** `Effect<Success, Error, R>` preserves error type
3. **Middleware Chain:** `Failure<M>` type accumulates correctly

### Where Types Are Lost

1. **Wire Protocol:**
   - `Transport.Failure.error: Schema.Unknown`
   - JSON serialization may lose class instances

2. **Client Decode Failure:**
   - Maps to `TransportError` instead of preserving original

3. **Server Encode Fallback:**
   - Falls back to raw error without type marker

### Recommendations

1. **Use union error schema in Failure:**
   ```typescript
   export class Failure extends Schema.TaggedClass<Failure>()("Failure", {
     id: Schema.String,
     errorTag: Schema.String,  // The _tag of the error class
     error: Schema.Unknown,    // The encoded error
   }) {}
   ```

2. **Add error registry for client:**
   ```typescript
   const errorRegistry = new Map<string, Schema.Schema<any>>()
   // Register all procedure error schemas
   // Use errorTag to look up correct decoder
   ```

---

## 11. Stream Error Handling

### Current Implementation

**Location:** `src/Server/index.ts:306-324`

```typescript
const makeStream = (payload: unknown): Stream.Stream<...> => {
  const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
  
  return stream.pipe(
    Stream.map((value): Transport.StreamResponse => 
      new Transport.StreamChunk({ id: request.id, chunk: value })
    ),
    Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
      Stream.succeed(new Transport.Failure({ id: request.id, error }))
    ),
    Stream.concat(Stream.succeed(new Transport.StreamEnd({ id: request.id })))
  )
}
```

**Assessment: Good** - Stream errors are converted to Failure and the stream is terminated cleanly with StreamEnd.

**Minor Issue:** Error encoding is skipped for stream errors. Should use same encode logic:
```typescript
Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
  Stream.fromEffect(
    Schema.encode(procedure.errorSchema)(error).pipe(
      Effect.orElseSucceed(() => error),
      Effect.map((encoded) => new Transport.Failure({ id: request.id, error: encoded }))
    )
  )
),
```

---

## 12. Summary of Findings

### Critical Issues (P0)

1. **Error type erasure through Failure envelope** - Domain errors lose type information on the wire
2. **Silent encode fallback** - Server doesn't indicate when error encoding fails

### Medium Issues (P1)

1. **6 throw statements in Client** - Should use Effect.die or Promise.reject
2. **Console.warn for unbound invalidate** - Operation silently fails
3. **No structured logging** - Difficult to debug production issues

### Low Issues (P2)

1. **Reactivity catch block** - Acceptable but should consider Effect-based callbacks
2. **Stream error not encoded** - Missing Schema.encode for stream errors
3. **cause: Schema.Unknown** - Could use Schema.Defect for better stack traces

---

## 13. Recommendations

### Immediate Fixes

1. **Remove silent encode fallback:**
   ```typescript
   // Instead of:
   Effect.orElseSucceed(() => error)
   
   // Use:
   Effect.catchAll((encodeError) => 
     Effect.succeed({ 
       _tag: "EncodingError", 
       message: String(encodeError) 
     })
   )
   ```

2. **Replace throws with Effect patterns:**
   ```typescript
   // For programming errors:
   Effect.dieMessage("Unknown procedure type")
   
   // For user errors:
   Promise.reject(new Error("..."))
   ```

### Future Improvements

1. **Add error registry for type-safe decoding**
2. **Implement structured logging service**
3. **Add error boundaries for React components**
4. **Consider using Effect.cause for full error chain**

---

## Files Analyzed

| File | Lines | Key Findings |
|------|-------|--------------|
| `src/Transport/index.ts` | 601 | TransportError, Failure envelope, HTTP error handling |
| `src/Server/index.ts` | 496 | Handler error encoding, middleware integration |
| `src/Client/index.ts` | 760 | Error decoding, throw statements |
| `src/Middleware/index.ts` | 400 | Middleware error flow |
| `src/Reactivity/index.ts` | 305 | Callback error handling |
| `test/server.test.ts` | 334 | Error handling tests |
| `test/e2e/suite.ts` | 342 | E2E error flow tests |
| `test/e2e/fixtures.ts` | 257 | Domain error definitions |
