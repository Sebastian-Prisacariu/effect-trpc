# Error Handling Analysis

## Overview

This document analyzes error handling patterns across the effect-trpc codebase, identifying the error encoding pipeline, silent error swallowing locations, Effect pattern violations, and providing recommendations.

---

## 1. Error Encoding Pipeline

### Transport Layer (`Transport/index.ts`)

The transport layer defines the foundational error type and response schemas:

```typescript
// Line 65-72
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}
```

**Response Envelopes:**
- `Success` - Contains `id` and `value`
- `Failure` - Contains `id` and `error`
- `StreamChunk` / `StreamEnd` for streaming

### Server Layer (`Server/index.ts`)

The server encodes errors through a multi-stage pipeline:

**Stage 1: Payload Validation (Line 240-245)**
```typescript
Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
  Effect.matchEffect({
    onFailure: (cause) => Effect.succeed(new Transport.Failure({
      id: request.id,
      error: { message: "Invalid payload", cause },
    })),
```

**Stage 2: Handler Error Encoding (Line 250-256)**
```typescript
onFailure: (error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.orElseSucceed(() => error),  // <-- SILENT FALLBACK
    Effect.map((encodedError) => new Transport.Failure({
      id: request.id,
      error: encodedError,
    }))
  ),
```

**Stage 3: Success Encoding (Line 258-265)**
```typescript
onSuccess: (value) =>
  Schema.encode(procedure.successSchema)(value).pipe(
    Effect.orElseSucceed(() => value),  // <-- SILENT FALLBACK
    Effect.map((encodedValue) => new Transport.Success({
      id: request.id,
      value: encodedValue,
    }))
  ),
```

### Client Layer (`Client/index.ts`)

The client decodes responses and maps errors:

**Success Decoding (Line 118-125)**
```typescript
if (Schema.is(Transport.Success)(response)) {
  return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
    Effect.mapError((e) => new Transport.TransportError({
      reason: "Protocol",
      message: "Failed to decode success response",
      cause: e,
    }))
  )
}
```

**Error Decoding (Line 127-134)**
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

---

## 2. Silent Error Swallowing Locations

### Critical: Server Error/Success Encoding Fallbacks

**Location:** `src/Server/index.ts:252` and `src/Server/index.ts:260`

```typescript
// Line 252 - Error encoding fallback
Effect.orElseSucceed(() => error)

// Line 260 - Success encoding fallback  
Effect.orElseSucceed(() => value)
```

**Issue:** If schema encoding fails, the raw unencoded value is silently used. This can:
1. Leak internal implementation details (raw Error objects, stack traces)
2. Break client-side decoding (if client expects encoded format)
3. Make debugging difficult (no indication encoding failed)

**Severity:** HIGH - Silent data corruption potential

### Medium: Stream Payload Decoding Fallback

**Location:** `src/Server/index.ts:334`

```typescript
const failureStream = Stream.succeed(new Transport.Failure({
  id: request.id,
  error: { message: "Invalid payload" },
})) as Stream.Stream<Transport.StreamResponse, never, R>

return Stream.unwrap(
  Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
    Effect.map(makeStream),
    Effect.orElseSucceed(() => failureStream)  // <-- SILENT FALLBACK
  )
)
```

**Issue:** Payload decoding errors are silently converted to a generic "Invalid payload" message, losing the actual validation error details.

**Severity:** MEDIUM - Loss of error context

### Low: HTTP Handler Fallback

**Location:** `src/Server/index.ts:434`

```typescript
Effect.catchAll(() => Effect.succeed({
  status: 400,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: "Invalid request" }),
}))
```

**Issue:** All errors are caught and converted to generic "Invalid request". However, this is at the HTTP boundary level which may be acceptable for security reasons.

**Severity:** LOW - Expected boundary behavior, but loses debugging context

### Low: Reactivity Callback Error Swallowing

**Location:** `src/Reactivity/index.ts:193-198`

```typescript
try {
  callback()
} catch (error) {
  console.error("[Reactivity] Callback error:", error)
}
```

**Issue:** Callback errors are logged but swallowed to prevent one callback from breaking others. This is a reasonable pattern but errors could accumulate silently.

**Severity:** LOW - Defensive pattern, but no aggregation

---

## 3. Effect Pattern Violations

### Throw Statements

| Location | Code | Assessment |
|----------|------|------------|
| `Client/index.ts:638` | `throw new Error("runPromise requires a bound runtime...")` | ACCEPTABLE - Guards against misuse |
| `Client/index.ts:673` | `throw new Error("runPromise requires a bound runtime...")` | ACCEPTABLE - Guards against misuse |
| `Client/index.ts:686` | `throw new Error(\`Unknown procedure type: ...\`)` | PROBLEMATIC - Should be Effect.fail |
| `Client/react.ts:56` | `throw new Error("useClientContext must be used within...")` | ACCEPTABLE - React hook violation |
| `Client/react.ts:305` | `throw err` | ACCEPTABLE - Re-throw in async context |
| `Client/index.ts:736,749,762` | `throw new Error("useQuery/useMutation/useStream requires React...")` | ACCEPTABLE - Environment validation |

**Most Problematic:** Line 686 in `Client/index.ts`:
```typescript
if (Procedure.isStream(procedure)) {
  // ...
}

throw new Error(`Unknown procedure type: ${(procedure as any)._tag}`)
```

This should use `Effect.fail` to stay within the Effect error channel, or this code path should be unreachable by design.

### Console Usage

| Location | Usage | Assessment |
|----------|-------|------------|
| `Client/index.ts:572` | `console.warn("invalidate() on unbound client...")` | PROBLEMATIC - Should fail explicitly |
| `Reactivity/index.ts:197` | `console.error("[Reactivity] Callback error:", error)` | ACCEPTABLE - Logging pattern |

---

## 4. Error Propagation Analysis

### Server Request Flow

```
TransportRequest
    |
    v
Schema.decodeUnknown(payloadSchema)
    |
    +--- Fail --> Transport.Failure("Invalid payload", cause)
    |
    v
Handler Execution
    |
    +--- Fail --> Schema.encode(errorSchema)
    |                 |
    |                 +--- Fail --> raw error (SILENT!)
    |                 |
    |                 v
    |             Transport.Failure(encodedError)
    |
    v
Schema.encode(successSchema)
    |
    +--- Fail --> raw value (SILENT!)
    |
    v
Transport.Success(encodedValue)
```

### Client Request Flow

```
Procedure Call
    |
    v
Transport.send(request)
    |
    +--- Fail --> TransportError
    |
    v
Schema.decodeUnknown(successSchema)
    |
    +--- Fail --> TransportError("Protocol", "Failed to decode success response")
    |
    v
Success Value
```

### Error Type Preservation

| Stage | Error Type Preserved? | Notes |
|-------|----------------------|-------|
| Payload validation | YES | ParseError included as cause |
| Handler error | PARTIAL | If encoding fails, raw error leaks |
| Success encoding | PARTIAL | If encoding fails, raw value leaks |
| Transport errors | YES | Properly typed TransportError |
| Client decoding | YES | Wrapped in TransportError |

---

## 5. Recommendations

### High Priority

#### 1. Fix Silent Encoding Fallbacks

**Current (Line 252):**
```typescript
Effect.orElseSucceed(() => error)
```

**Recommended:**
```typescript
Effect.orElse((encodingError) =>
  Effect.succeed(new Transport.Failure({
    id: request.id,
    error: {
      _tag: "EncodingError",
      originalError: error,
      encodingError,
    },
  }))
)
```

Or at minimum, log the encoding failure:
```typescript
Effect.tapError((encodingError) =>
  Effect.sync(() => console.error("[Server] Error encoding failed:", encodingError))
).pipe(
  Effect.orElseSucceed(() => ({
    _tag: error._tag ?? "UnknownError",
    message: error.message ?? "An error occurred",
  }))
)
```

#### 2. Replace Throw with Effect.fail

**Current (Line 686):**
```typescript
throw new Error(`Unknown procedure type: ${(procedure as any)._tag}`)
```

**Recommended:**
Make this code path unreachable through exhaustive type checking, or use Effect.die for defects:
```typescript
// This should be exhaustive - if we reach here, it's a defect
return Effect.die(new Error(`Unknown procedure type: ${(procedure as any)._tag}`))
```

### Medium Priority

#### 3. Add Structured Error Logging Layer

Create a centralized error logging service:
```typescript
class ServerErrorLog extends Context.Tag("ServerErrorLog")<
  ServerErrorLog,
  {
    readonly logEncodingError: (context: string, original: unknown, error: unknown) => Effect.Effect<void>
    readonly logHandlerError: (tag: string, error: unknown) => Effect.Effect<void>
  }
>() {}
```

#### 4. Improve Stream Payload Error Details

**Current (Line 326-329):**
```typescript
error: { message: "Invalid payload" }
```

**Recommended:**
```typescript
error: { 
  message: "Invalid payload",
  _tag: "PayloadValidationError",
  details: Schema.TreeFormatter.formatError(parseError),
}
```

### Low Priority

#### 5. Replace Console.warn with Effect

**Current (Line 572):**
```typescript
console.warn("invalidate() on unbound client requires ReactivityService in scope...")
```

**Recommended:**
Either throw an error (since this is a programming error) or use Effect.logWarning:
```typescript
Effect.logWarning("invalidate() on unbound client has no effect - use api.provide(layer) first").pipe(
  Effect.runSync
)
```

#### 6. Add Error Aggregation for Reactivity

Consider collecting callback errors and surfacing them:
```typescript
const errors: Error[] = []
for (const callback of callbacksToInvoke) {
  try {
    callback()
  } catch (error) {
    errors.push(error as Error)
  }
}
if (errors.length > 0) {
  console.error(`[Reactivity] ${errors.length} callback errors:`, errors)
}
```

---

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Silent error fallbacks | 3 | HIGH |
| Throw statements | 9 | 2 PROBLEMATIC, 7 ACCEPTABLE |
| Console usage | 2 | 1 PROBLEMATIC, 1 ACCEPTABLE |
| Missing error context | 2 | MEDIUM |

**Overall Assessment:** The codebase follows Effect patterns reasonably well, but has critical silent fallbacks in the encoding pipeline that could cause hard-to-debug issues. The use of `orElseSucceed` for encoding failures is the most significant issue to address.
