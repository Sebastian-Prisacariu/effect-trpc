# Server Request Handling Analysis

## Overview

The Server module (`src/Server/index.ts`) is responsible for:
1. Building a handler map from router definitions
2. Decoding incoming requests
3. Executing middleware chains
4. Running handlers
5. Encoding responses

## Request Handling Pipeline (Queries/Mutations)

### `Server.handle()` - Lines 217-282

```
TransportRequest
    ↓
1. Look up handler entry by tag (handlerMap.get)
    ↓
2. Validate procedure type (reject if stream)
    ↓
3. Decode payload (Schema.decodeUnknown)
    ↓
4. Build handler effect with response encoding
    ↓
5. Execute middleware chain (if any)
    ↓
6. Return TransportResponse
```

#### Detailed Flow:

1. **Handler Lookup** (line 220):
   ```typescript
   const entry = handlerMap.get(request.tag)
   ```
   Returns 404-style error if procedure not found.

2. **Stream Check** (lines 231-236):
   ```typescript
   if (isStream) {
     return Effect.succeed(new Transport.Failure({ ... }))
   }
   ```
   Returns error if stream procedure called via `handle()`.

3. **Payload Decoding** (line 240):
   ```typescript
   Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
   ```
   Returns validation error on failure.

4. **Handler Execution** (lines 248-267):
   - Calls user handler with decoded payload
   - On success: encodes via `procedure.successSchema` 
   - On failure: encodes via `procedure.errorSchema`
   - Both use `Effect.orElseSucceed(() => value)` as fallback

5. **Middleware Execution** (lines 270-278):
   ```typescript
   if (middlewares.length > 0) {
     return Middleware.execute(middlewares, middlewareRequest, handlerEffect)
   }
   return handlerEffect
   ```

---

## Stream Handling Pipeline

### `Server.handleStream()` - Lines 285-337

```
TransportRequest
    ↓
1. Look up handler entry by tag
    ↓
2. Validate procedure type (reject if NOT stream)
    ↓
3. Decode payload
    ↓
4. Call handler (returns Stream)
    ↓
5. Map chunks to StreamChunk responses
    ↓
6. Catch errors → Failure
    ↓
7. Concat StreamEnd at end
    ↓
Return Stream<StreamResponse>
```

#### Detailed Flow:

1. **Handler Lookup** (line 289):
   Same pattern as `handle()`.

2. **Non-Stream Check** (lines 299-304):
   ```typescript
   if (!isStream) {
     return Stream.succeed(new Transport.Failure({ ... }))
   }
   ```

3. **Payload Decoding** (lines 331-336):
   ```typescript
   Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
     Effect.map(makeStream),
     Effect.orElseSucceed(() => failureStream)
   )
   ```

4. **Stream Transformation** (lines 309-323):
   ```typescript
   stream.pipe(
     Stream.map((value) => new Transport.StreamChunk({ ... })),
     Stream.catchAll((error) => Stream.succeed(new Transport.Failure({ ... }))),
     Stream.concat(Stream.succeed(new Transport.StreamEnd({ ... })))
   )
   ```

---

## Middleware Application

### Handler Map Building (Lines 160-201)

Middleware is collected at three levels:
1. **Inherited middleware** from parent groups
2. **Group middleware** from `Router.withMiddleware()`
3. **Procedure middleware** from `.middleware()` on procedure

```typescript
const currentMiddlewares = [...inheritedMiddlewares, ...groupMiddlewares]
// ...
handlerMap.set(tag, {
  handler,
  procedure: entry,
  isStream: Procedure.isStream(entry),
  middlewares: [...currentMiddlewares, ...procedureMiddlewares],
})
```

### Middleware Execution (`Middleware.execute()`)

From `src/Middleware/index.ts`, lines 329-344:

```typescript
export const execute = <A, E, R>(
  middlewares: ReadonlyArray<Applicable>,
  request: MiddlewareRequest,
  handler: Effect.Effect<A, E, R>
): Effect.Effect<...> => {
  const flatMiddlewares = middlewares.flatMap((m) =>
    MiddlewareTypeId in m ? (m as CombinedMiddleware<any>).tags : [m]
  )
  
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler
  )
}
```

---

## CRITICAL SECURITY ISSUE: Middleware NOT Applied to Streams

### The Problem

Looking at `handleStream()` (lines 285-337):

```typescript
const handleStream = (
  request: Transport.TransportRequest
): Stream.Stream<Transport.StreamResponse, never, R> => {
  const entry = handlerMap.get(request.tag)
  // ...
  const { handler, procedure, isStream } = entry  // Note: middlewares is UNUSED
  // ...
  const makeStream = (payload: unknown): Stream.Stream<...> => {
    const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
    return stream.pipe(...)
  }
  // ...
}
```

**The `middlewares` from the entry are destructured but NEVER USED.**

Compare to `handle()` (lines 217-282):

```typescript
const { handler, procedure, isStream, middlewares } = entry
// ...
if (middlewares.length > 0) {
  return Middleware.execute(middlewares, middlewareRequest, handlerEffect)
}
```

### Security Implications

1. **Auth bypass**: A stream procedure with `AuthMiddleware` will NOT check authentication
2. **Rate limiting bypass**: Rate limiting middleware won't run for streams
3. **Logging gap**: Logging middleware won't capture stream requests
4. **Context missing**: Middleware that provides `CurrentUser` or similar won't be available

### Example Vulnerable Code

```typescript
// This looks protected...
const adminRouter = Router.withMiddleware([AuthMiddleware, AdminMiddleware], {
  events: Procedure.stream({ success: AdminEvent }),  // But this is NOT protected!
  list: Procedure.query({ success: Schema.Array(Admin) }),  // This IS protected
})
```

---

## Schema Encoding Patterns

### Success Encoding (line 259-262)

```typescript
Schema.encode(procedure.successSchema)(value).pipe(
  Effect.orElseSucceed(() => value),  // Fallback to raw value
  Effect.map((encodedValue) => new Transport.Success({ id, value: encodedValue }))
)
```

### Error Encoding (line 251-256)

```typescript
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.orElseSucceed(() => error),  // Fallback to raw error
  Effect.map((encodedError) => new Transport.Failure({ id, error: encodedError }))
)
```

### Stream Chunk Encoding - MISSING

In `handleStream()`, chunks are sent directly without schema encoding:

```typescript
Stream.map((value): Transport.StreamResponse => 
  new Transport.StreamChunk({
    id: request.id,
    chunk: value,  // Raw value, NOT encoded!
  })
)
```

**This is a second issue**: Stream chunks bypass schema encoding, meaning:
1. Date objects won't be serialized to ISO strings
2. BigInt values won't be converted
3. Custom encode transformations won't run

---

## Server-Level Middleware

### `Server.middleware()` (Lines 577-618)

This wraps the entire `handle()` function:

```typescript
const wrappedHandle = (request): Effect.Effect<...> => {
  // Execute server-level middleware then delegate to original handle
  if (newMiddlewares.length > 0) {
    return Middleware.execute(newMiddlewares, middlewareRequest, server.handle(request))
  }
  return server.handle(request)
}
```

**Note**: Server-level middleware also only wraps `handle()`, NOT `handleStream()`.

---

## Summary of Issues

### Critical

1. **Middleware bypass for streams** - Stream handlers completely skip middleware execution
2. **Schema encoding bypass for streams** - Stream chunks aren't encoded through the success schema

### Medium

3. **No server-level middleware for streams** - `Server.middleware()` only wraps `handle()`
4. **Silent encoding failures** - `Effect.orElseSucceed(() => value)` masks encoding errors

### Recommendations

1. **Apply middleware to streams**: Execute middleware for stream requests, providing context via Effect's service pattern
2. **Encode stream chunks**: Each chunk should go through `Schema.encode(procedure.successSchema)`
3. **Make server middleware apply to both**: `Server.middleware()` should wrap both `handle` and `handleStream`
4. **Consider encoding error handling**: Log or handle encoding failures rather than silently falling back
