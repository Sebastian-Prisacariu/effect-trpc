# Error Handling Analysis — effect-trpc

Deep analysis of error encoding, silent fallbacks, and Effect pattern compliance.

## Executive Summary

**Overall Rating: B+ (Good with Identified Issues)**

The codebase demonstrates solid Effect-idiomatic error handling in most areas, with proper use of `Schema.TaggedError`, typed error schemas, and Effect error channels. However, several patterns require attention:

1. **Silent error swallowing** in encoding failures
2. **Throw statements** in React integration code
3. **Inconsistent error propagation** in client hooks
4. **Missing error schema validation** at transport boundaries

---

## 1. Error Pipeline Analysis

### 1.1 Server-Side Error Flow

```
Request → Decode Payload → Middleware → Handler → Encode Response
            ↓ fail           ↓ fail       ↓ fail      ↓ fail
         Failure           Failure      Failure    Failure/Success
```

**Server/index.ts:267-320** — The core error handling:

```typescript
// GOOD: Proper payload decode error handling
Effect.matchEffect({
  onFailure: (cause) => Effect.succeed(new Transport.Failure({
    id: request.id,
    error: { message: "Invalid payload", cause },
  })),
  
  // ISSUE: Silent fallback on encode failure
  onSuccess: (payload) => {
    handlerEffect.pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Schema.encode(procedure.errorSchema)(error).pipe(
            Effect.catchAll((encodeError) =>
              Effect.logWarning("Failed to encode error response", {
                tag: request.tag,
                encodeError,
                originalError: error,
              }).pipe(Effect.as(error))  // ← SILENT FALLBACK
            ),
            Effect.map((encodedError) => new Transport.Failure({...}))
          ),
```

**Problem**: When error encoding fails, the original error is returned unencoded. This can:
- Leak internal error structures to clients
- Bypass schema validation guarantees
- Create inconsistent error formats

### 1.2 Client-Side Error Flow

```
send(request) → Transport → Decode Response → Return Result
                   ↓             ↓
              TransportError   Protocol Error
```

**Client/index.ts:108-136** — ClientService error handling:

```typescript
// GOOD: Proper typed errors
send: (tag, payload, successSchema, errorSchema) =>
  Effect.gen(function* () {
    const response = yield* transport.send(request)
    
    if (Schema.is(Transport.Success)(response)) {
      return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
        Effect.mapError((e) => new Transport.TransportError({
          reason: "Protocol",
          message: "Failed to decode success response",
          cause: e,
        }))
      )
    } else {
      // GOOD: Properly decode and fail with domain error
      const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
        Effect.mapError((e) => new Transport.TransportError({
          reason: "Protocol", 
          message: "Failed to decode error response",
          cause: e,
        }))
      )
      return yield* Effect.fail(error)
    }
  }),
```

**Status**: Well-structured. Domain errors properly typed and decoded.

---

## 2. Violations Found

### 2.1 Silent Error Swallowing (CRITICAL)

**Location**: `Server/index.ts:279-285` and `Server/index.ts:293-299`

```typescript
Effect.catchAll((encodeError) =>
  Effect.logWarning("Failed to encode error response", {
    tag: request.tag,
    encodeError,
    originalError: error,
  }).pipe(Effect.as(error))  // ← Returns unencoded error!
),
```

**Impact**: 
- Error contracts broken (schema guarantees bypassed)
- Security risk (internal structures exposed)
- Client receives unpredictable error format

**Recommendation**:
```typescript
// Option 1: Fail loudly with internal error
Effect.catchAll((encodeError) =>
  Effect.succeed(new Transport.Failure({
    id: request.id,
    error: { _tag: "InternalError", message: "Failed to encode error" },
  }))
),

// Option 2: Create a dedicated EncodingError
class EncodingError extends Schema.TaggedError<EncodingError>()(
  "EncodingError",
  {
    module: Schema.String,
    method: Schema.String,
    originalError: Schema.Unknown,
  }
) {}
```

### 2.2 Throw Statements (Pattern Violation)

**Location**: `Client/index.ts:638, 672, 685`

```typescript
// Line 638
runPromise: runtime
  ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
  : () => { throw new Error("runPromise requires a bound runtime...") },

// Line 685
throw new Error(`Unknown procedure type: ${(procedure as any)._tag}`)
```

**Impact**:
- Violates Effect's "no throw" principle
- Uncaught exceptions crash the runtime
- Not type-safe (error not in type signature)

**Recommendation**:
```typescript
// Use Effect.die for unrecoverable errors (defects)
const runPromise = runtime
  ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
  : (payload?: unknown) => 
      Effect.runPromise(
        Effect.die(new Error("runPromise requires a bound runtime"))
      )

// For the procedure type check, use Schema.asserts or exhaustive switch
const createProcedureClient = <P extends Procedure.Any>(
  tag: string,
  procedure: P,
  runtime: ManagedRuntime<...> | null
): ProcedureClient<P> => {
  // Use exhaustive switch
  switch (procedure._tag) {
    case "Query": return { /* ... */ } as ProcedureClient<P>
    case "Mutation": return { /* ... */ } as ProcedureClient<P>
    case "Stream": return { /* ... */ } as ProcedureClient<P>
    default: return procedure satisfies never  // Type error if not exhaustive
  }
}
```

### 2.3 Silent Promise Catch (React Integration)

**Location**: `Client/react.ts:337-340`

```typescript
const mutate = useCallback((payload: Payload) => {
  mutateAsync(payload).catch(() => {
    // Error already handled via onError
  })
}, [mutateAsync])
```

**Impact**:
- Errors silently swallowed
- Comment claims "already handled" but no guarantee
- Fire-and-forget pattern can lose errors

**Recommendation**:
```typescript
const mutate = useCallback((payload: Payload) => {
  mutateAsync(payload).catch((error) => {
    // Ensure error state is set even if onError throws
    setResult(Result.fail(error as Error))
    // Log for debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('[effect-trpc] Mutation error:', error)
    }
  })
}, [mutateAsync])
```

### 2.4 Missing Transport Error Handling in Loopback

**Location**: `Transport/index.ts:554-568`

```typescript
send: (request: TransportRequest) => 
  server.handle(request).pipe(
    Effect.mapError(() => new TransportError({ 
      reason: "Protocol", 
      message: "Server error" 
    }))
  ) as Effect.Effect<TransportResponse, TransportError>,
```

**Issue**: Server errors are mapped to generic "Server error" message, losing the original error context.

**Recommendation**:
```typescript
send: (request: TransportRequest) => 
  server.handle(request).pipe(
    Effect.mapError((cause) => new TransportError({ 
      reason: "Protocol", 
      message: "Server error",
      cause,  // ← Preserve original error
    }))
  ),
```

### 2.5 Console.warn Usage

**Location**: `Client/index.ts:572`

```typescript
console.warn("invalidate() on unbound client requires ReactivityService...")
```

**Impact**: Side effect in non-Effect code, not testable, not suppressible.

**Recommendation**:
```typescript
// Either: Make it Effect and let user handle
invalidate: (paths: readonly string[]) => {
  return Effect.logWarning("invalidate() on unbound client...").pipe(
    Effect.provide(Logger.minimumLogLevel(LogLevel.Warning))
  )
}

// Or: Document it clearly and make it a no-op
invalidate: (paths: readonly string[]) => {
  // No-op on unbound client - use api.provide(layer).invalidate() instead
}
```

---

## 3. Error Type Inventory

### 3.1 Transport Errors (Well-Defined)

**Transport/index.ts:62-69**

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

**Status**: GOOD
- Tagged error pattern
- Discriminated union for reason
- Optional cause for debugging

### 3.2 Response Envelopes (Good)

```typescript
export class Success extends Schema.TaggedClass<Success>()("Success", {...})
export class Failure extends Schema.TaggedClass<Failure>()("Failure", {...})
export class StreamChunk extends Schema.TaggedClass<StreamChunk>()("StreamChunk", {...})
export class StreamEnd extends Schema.TaggedClass<StreamEnd>()("StreamEnd", {...})
```

**Status**: GOOD
- Clean tagged classes for transport envelopes
- Enables type-safe pattern matching

### 3.3 Domain Errors (User-Defined)

Procedures define their own error schemas:
```typescript
const getUser = Procedure.query({
  payload: Schema.Struct({ id: Schema.String }),
  success: User,
  error: NotFoundError,  // ← User-defined Schema error
})
```

**Status**: GOOD pattern, but lacks validation that user errors are Schema-encodable.

---

## 4. Error Propagation Patterns

### 4.1 Middleware Error Flow

**Middleware/index.ts:356-392**

```typescript
export const execute = <A, E, R>(
  middlewares: ReadonlyArray<Applicable>,
  request: MiddlewareRequest,
  handler: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure<typeof middlewares[number]>, R | Provides<...>> => {
  // Flatten and execute
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler
  )
}
```

**Status**: GOOD
- Error types properly union'd
- Middleware failures properly typed in signature
- reduceRight ensures correct execution order

### 4.2 Stream Error Handling

**Server/index.ts:372-386**

```typescript
Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
  Stream.succeed(new Transport.Failure({ id: request.id, error }))
),
```

**Status**: ACCEPTABLE
- Stream errors converted to Failure envelope
- But: raw error object sent, not schema-encoded

---

## 5. Recommendations Summary

### Critical (Fix Now)

| Issue | Location | Fix |
|-------|----------|-----|
| Silent encode fallback | Server/index.ts:279,293 | Return InternalError or fail explicitly |
| throw statements | Client/index.ts:638,672,685 | Use Effect.die or exhaustive patterns |
| Silent .catch() | Client/react.ts:338 | Ensure error state is set |

### Important (Fix Soon)

| Issue | Location | Fix |
|-------|----------|-----|
| Lost error context | Transport/index.ts:556 | Preserve cause in TransportError |
| console.warn | Client/index.ts:572 | Use Effect.log or document as no-op |
| Stream error encoding | Server/index.ts:373,383 | Apply schema encoding to stream errors |

### Nice to Have

| Issue | Location | Fix |
|-------|----------|-----|
| Error schema validation | Procedure constructor | Validate error type is Schema-encodable |
| Unified error module | New file | Create `Errors/index.ts` with all error types |
| Error documentation | All modules | Document error flow in module JSDoc |

---

## 6. Code Examples for Fixes

### Fix 1: Silent Encode Fallback

```typescript
// Server/index.ts - Replace the catchAll blocks

// Define a safe fallback error
const InternalErrorSchema = Schema.Struct({
  _tag: Schema.Literal("InternalError"),
  message: Schema.String,
  requestId: Schema.String,
})

// In handle():
onFailure: (error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.catchAll((encodeError) =>
      Effect.gen(function* () {
        yield* Effect.logError("Failed to encode error response", {
          tag: request.tag,
          encodeError,
          // Don't log originalError in production - security risk
        })
        // Return safe, predictable error structure
        return new Transport.Failure({
          id: request.id,
          error: {
            _tag: "InternalError",
            message: "An internal error occurred",
            requestId: request.id,
          },
        })
      })
    ),
    Effect.map((encodedError) => new Transport.Failure({
      id: request.id,
      error: encodedError,
    }))
  ),
```

### Fix 2: Replace Throws with Effect Patterns

```typescript
// Client/index.ts - Replace throw with Effect.die or type-safe patterns

// For runPromise without runtime:
const createProcedureClient = <P extends Procedure.Any>(
  tag: string,
  procedure: P,
  runtime: ManagedRuntime.ManagedRuntime<ClientServiceTag, never> | null
): ProcedureClient<P> => {
  const notBound = Effect.dieMessage(
    "runPromise requires a bound runtime. Use api.provide(layer) first."
  )
  
  // For procedure type - use exhaustive matching
  const _tag = procedure._tag
  
  if (_tag === "Query") {
    return {
      useQuery: createUseQuery(tag, procedure),
      run: /* ... */,
      runPromise: runtime
        ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
        : (payload?: unknown) => Effect.runPromise(notBound),
      prefetch: /* ... */,
    } as ProcedureClient<P>
  }
  
  if (_tag === "Mutation") {
    // ...
  }
  
  if (_tag === "Stream") {
    // ...
  }
  
  // TypeScript will catch if we miss a case
  return _tag satisfies never
}
```

### Fix 3: Silent Catch in React

```typescript
// Client/react.ts - Proper error handling in mutate

const mutate = useCallback((payload: Payload) => {
  mutateAsync(payload).catch((error: unknown) => {
    // Always update state - onError might not be provided or might throw
    const typedError = error instanceof Error 
      ? error 
      : new Error(String(error))
    
    setResult((prev) => 
      // Only update if not already failed with same error
      Result.isFailure(prev) ? prev : Result.fail(typedError)
    )
    
    // onError is secondary, we already have the error in state
    try {
      onError?.(typedError as Error)
    } catch (callbackError) {
      console.error('[effect-trpc] onError callback threw:', callbackError)
    }
  })
}, [mutateAsync, onError])
```

---

## 7. Testing Error Handling

Recommended test cases to add:

```typescript
describe("Error Handling", () => {
  describe("Server", () => {
    it("should return InternalError when error encoding fails", async () => {
      // Setup: procedure with error that fails to encode
      // Assert: Failure envelope with InternalError tag
    })
    
    it("should not expose internal error details in production", async () => {
      // Setup: NODE_ENV=production, trigger encoding error
      // Assert: No stack traces or internal types in response
    })
  })
  
  describe("Client", () => {
    it("should propagate TransportError on network failure", async () => {
      // Setup: mock transport to fail
      // Assert: TransportError with reason="Network"
    })
    
    it("should decode domain errors from Failure response", async () => {
      // Setup: mock transport to return Failure
      // Assert: properly decoded domain error in failure channel
    })
  })
  
  describe("Middleware", () => {
    it("should union middleware errors with handler errors", async () => {
      // Setup: middleware that can fail + handler that can fail
      // Assert: both error types in union
    })
  })
})
```

---

## 8. Conclusion

The effect-trpc codebase has a solid foundation for error handling, following Effect patterns in most areas. The main gaps are:

1. **Silent fallbacks** — Should fail explicitly or return safe sentinel errors
2. **throw statements** — Should use Effect.die or exhaustive patterns
3. **Stream error encoding** — Should match the encoding applied to single responses
4. **Console usage** — Should use Effect.log for consistency

Fixing these issues will bring the error handling to A+ level and ensure type safety and predictability throughout the error pipeline.
