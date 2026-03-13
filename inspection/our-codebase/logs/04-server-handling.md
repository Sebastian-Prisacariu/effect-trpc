# Server Handling and Middleware Execution Analysis

## Overview

This document provides a comprehensive analysis of the Server module, including handler registration, request handling, middleware execution, and the HTTP adapter.

---

## 1. Server.make() - Handler Registration

**Location:** `src/Server/index.ts:148-349`

### How It Works

The `Server.make()` function creates a server from a router and handlers:

```typescript
export const make = <D extends Router.Definition, R = never>(
  router: Router.Router<D>,
  handlers: Handlers<D, R>
): Server<D, R>
```

### Handler Map Construction

The server builds an internal `handlerMap` that maps procedure tags to their handlers:

```typescript
const handlerMap = new Map<string, {
  handler: (payload: unknown) => Effect.Effect<unknown, unknown, R> | Stream.Stream<unknown, unknown, R>
  procedure: Procedure.Any
  isStream: boolean
  middlewares: ReadonlyArray<Middleware.Applicable>
}>()
```

### Handler Map Building Process (Lines 160-201)

1. **Walk the definition tree** recursively
2. **Detect middleware-wrapped groups** via `Router.withMiddleware`
3. **Inherit middlewares** from parent groups
4. **Build the full tag** (e.g., `@test/users/list`)
5. **Store handler with accumulated middlewares**

```typescript
const buildHandlerMap = (
  def: Router.Definition,
  handlerDef: Record<string, unknown>,
  pathParts: readonly string[],
  inheritedMiddlewares: ReadonlyArray<Middleware.Applicable>
): void => {
  for (const key of Object.keys(def)) {
    let entry = def[key]
    const handler = handlerDef[key]
    const newPath = [...pathParts, key]
    const tag = [router.tag, ...newPath].join("/")
    
    // Check for middleware-wrapped groups
    let groupMiddlewares: ReadonlyArray<Middleware.Applicable> = []
    if (typeof entry === "object" && entry !== null && "definition" in entry && "middlewares" in entry) {
      const wrapped = entry as Router.DefinitionWithMiddleware<Router.Definition>
      groupMiddlewares = wrapped.middlewares as ReadonlyArray<Middleware.Applicable>
      entry = wrapped.definition
    }
    
    const currentMiddlewares = [...inheritedMiddlewares, ...groupMiddlewares]
    
    if (Procedure.isProcedure(entry)) {
      // Add procedure's own middlewares
      const procedureMiddlewares = entry.middlewares as ReadonlyArray<Middleware.Applicable>
      handlerMap.set(tag, {
        handler: handler as (payload: unknown) => Effect.Effect<unknown, unknown, R>,
        procedure: entry,
        isStream: Procedure.isStream(entry),
        middlewares: [...currentMiddlewares, ...procedureMiddlewares],
      })
    } else {
      // Nested definition - recurse
      buildHandlerMap(entry, handler, newPath, currentMiddlewares)
    }
  }
}
```

### Middleware Accumulation Order

Middlewares are accumulated in this order (outer to inner):
1. **Inherited middlewares** (from parent groups)
2. **Group middlewares** (from `Router.withMiddleware`)
3. **Procedure middlewares** (from `procedure.middleware()`)

**Finding:** The middleware accumulation is correct - parent middlewares run before child middlewares.

---

## 2. Server.handle() - Request Flow Analysis

**Location:** `src/Server/index.ts:217-282`

### Request Flow Steps

1. **Lookup handler** by tag in `handlerMap`
2. **Return error** if procedure not found
3. **Check procedure type** (reject streams in handle())
4. **Convert to MiddlewareRequest**
5. **Decode payload** with procedure's schema
6. **Execute handler** with middleware chain
7. **Encode response** (success or error)

### Detailed Flow

```typescript
const handle = (request: TransportRequest): Effect.Effect<TransportResponse, never, R> => {
  const entry = handlerMap.get(request.tag)
  
  // Step 1: Unknown procedure check
  if (!entry) {
    return Effect.succeed(new Transport.Failure({
      id: request.id,
      error: { message: `Unknown procedure: ${request.tag}` },
    }))
  }
  
  const { handler, procedure, isStream, middlewares } = entry
  
  // Step 2: Stream procedure guard
  if (isStream) {
    return Effect.succeed(new Transport.Failure({
      id: request.id,
      error: { message: `Use handleStream for streaming procedures: ${request.tag}` },
    }))
  }
  
  const middlewareRequest = toMiddlewareRequest(request)
  
  // Step 3: Payload validation
  return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
    Effect.matchEffect({
      onFailure: (cause) => Effect.succeed(new Transport.Failure({
        id: request.id,
        error: { message: "Invalid payload", cause },
      })),
      onSuccess: (payload) => {
        // Step 4: Handler execution with response encoding
        const handlerEffect = (handler(payload) as Effect.Effect<unknown, unknown, R>).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Schema.encode(procedure.errorSchema)(error).pipe(
                Effect.orElseSucceed(() => error),
                Effect.map((encodedError) => new Transport.Failure({
                  id: request.id,
                  error: encodedError,
                }))
              ),
            onSuccess: (value) =>
              Schema.encode(procedure.successSchema)(value).pipe(
                Effect.orElseSucceed(() => value),
                Effect.map((encodedValue) => new Transport.Success({
                  id: request.id,
                  value: encodedValue,
                }))
              ),
          })
        )
        
        // Step 5: Execute middleware chain
        if (middlewares.length > 0) {
          return Middleware.execute(middlewares, middlewareRequest, handlerEffect)
        }
        
        return handlerEffect
      },
    })
  )
}
```

### Issues Found

#### Issue 1: Middleware Execution Position (MAJOR BUG)

**Problem:** Middleware is executed AFTER payload decoding, not before.

This means:
- Middleware cannot reject requests before payload parsing
- Middleware cannot transform or validate payloads
- A malformed payload will cause decoding errors even if auth middleware would have rejected the request

**Expected flow:**
1. Convert to MiddlewareRequest
2. **Execute middleware chain**
3. Decode payload
4. Execute handler

**Actual flow:**
1. Convert to MiddlewareRequest  
2. Decode payload
3. Execute handler (wrapped by middleware)

**Impact:** Auth middleware runs, but only wraps the handler - it cannot prevent payload decoding errors from being exposed.

#### Issue 2: Error Schema Encoding Fallback

**Code (lines 251-256):**
```typescript
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.orElseSucceed(() => error),  // Falls back to raw error
  ...
)
```

**Problem:** If error encoding fails, the raw error object is sent. This could:
- Leak internal error details
- Send non-serializable objects
- Cause JSON.stringify issues downstream

**Recommendation:** Should fail or wrap in a sanitized error instead of silently falling back.

#### Issue 3: Success Schema Encoding Fallback

Same issue as above - if success encoding fails, the raw value is sent.

---

## 3. Server.handleStream() - Streaming Analysis

**Location:** `src/Server/index.ts:285-337`

### Stream Flow

```typescript
const handleStream = (request: TransportRequest): Stream.Stream<StreamResponse, never, R> => {
  const entry = handlerMap.get(request.tag)
  
  if (!entry) {
    return Stream.succeed(new Transport.Failure({ ... }))
  }
  
  const { handler, procedure, isStream } = entry
  
  if (!isStream) {
    return Stream.succeed(new Transport.Failure({
      id: request.id,
      error: { message: `Use handle for non-streaming procedures: ${request.tag}` },
    }))
  }
  
  const makeStream = (payload: unknown): Stream.Stream<StreamResponse, never, R> => {
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
  
  return Stream.unwrap(
    Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      Effect.map(makeStream),
      Effect.orElseSucceed(() => failureStream)
    )
  )
}
```

### Issues Found

#### Issue 4: No Middleware Execution in handleStream (MAJOR BUG)

**Problem:** `handleStream()` completely ignores the `middlewares` array!

```typescript
const { handler, procedure, isStream } = entry  // middlewares is destructured but NOT USED
```

**Impact:** 
- Auth middleware doesn't run for streams
- Logging middleware doesn't run for streams
- All cross-cutting concerns are bypassed for stream procedures

**Fix Required:** Add middleware execution similar to `handle()`:
```typescript
if (middlewares.length > 0) {
  return Stream.unwrap(
    Middleware.execute(middlewares, middlewareRequest, Effect.succeed(makeStream(payload)))
  )
}
```

#### Issue 5: Stream Chunks Not Encoded

**Problem:** Stream chunks are not encoded with `successSchema`:

```typescript
Stream.map((value): Transport.StreamResponse => 
  new Transport.StreamChunk({ id: request.id, chunk: value })  // Raw value, no encoding!
)
```

Compare to `handle()` which encodes success values:
```typescript
Schema.encode(procedure.successSchema)(value)
```

**Impact:** Stream responses may contain non-serializable values or leak internal representations.

#### Issue 6: Stream Errors Not Encoded

**Problem:** Stream errors are not encoded with `errorSchema`:

```typescript
Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
  Stream.succeed(new Transport.Failure({ id: request.id, error }))  // Raw error!
)
```

---

## 4. Middleware Execution Chain

**Location:** `src/Middleware/index.ts:329-365`

### Middleware.execute()

```typescript
export const execute = <A, E, R>(
  middlewares: ReadonlyArray<Applicable>,
  request: MiddlewareRequest,
  handler: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure<typeof middlewares[number]>, R | Provides<typeof middlewares[number]>> => {
  // Flatten combined middlewares
  const flatMiddlewares = middlewares.flatMap((m) =>
    MiddlewareTypeId in m ? (m as CombinedMiddleware<any>).tags : [m]
  )
  
  // Execute from outermost to innermost (reduceRight)
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler as Effect.Effect<A, any, any>
  )
}
```

### executeOne() - The Core Middleware Dispatcher

```typescript
const executeOne = <A, E, R, Provides, Failure>(
  middleware: MiddlewareTag<any, Provides, Failure>,
  request: MiddlewareRequest,
  next: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure, R> =>
  Effect.gen(function* () {
    const impl = yield* middleware as any as Context.Tag<any, MiddlewareImpl<Provides, Failure> | WrapMiddlewareImpl<Failure>>
    
    if ("wrap" in impl) {
      // Wrap middleware - wraps the handler execution
      return yield* (impl as WrapMiddlewareImpl<Failure>).wrap(request, next)
    } else {
      // Provides middleware - runs first, then provides service to handler
      const provided = yield* (impl as MiddlewareImpl<Provides, Failure>).run(request)
      return yield* next.pipe(
        Effect.provideService(middleware.provides, provided)
      ) as Effect.Effect<A, E, R>
    }
  }) as Effect.Effect<A, E | Failure, R>
```

### Two Middleware Types

1. **Provides Middleware (`MiddlewareImpl<Provides, Failure>`):**
   - Has `run(request)` method
   - Returns the value to provide (e.g., CurrentUser)
   - Value is provided to handler via `Effect.provideService`

2. **Wrap Middleware (`WrapMiddlewareImpl<Failure>`):**
   - Has `wrap(request, next)` method
   - Wraps the entire handler execution
   - Can modify response, add timing, etc.

### Execution Order Verification

The use of `reduceRight` means:
- First middleware in array wraps outermost
- Last middleware in array wraps innermost (closest to handler)

**Example:**
```typescript
[AuthMiddleware, LoggingMiddleware, RateLimitMiddleware]
```

Execution order:
1. AuthMiddleware starts
2. LoggingMiddleware starts
3. RateLimitMiddleware starts
4. Handler executes
5. RateLimitMiddleware ends
6. LoggingMiddleware ends
7. AuthMiddleware ends

**Finding:** Execution order is correct for typical middleware patterns.

---

## 5. Server.middleware() - Server-Level Middleware

**Location:** `src/Server/index.ts:454-496`

### How It Works

```typescript
export const middleware = <M extends Middleware.Applicable>(m: M) => <D extends Router.Definition, R>(
  server: Server<D, R>
): Server<D, R> => {
  const newMiddlewares = [...server.middlewares, m] as ReadonlyArray<Middleware.Applicable>
  
  const wrappedHandle = (request: TransportRequest): Effect.Effect<TransportResponse, never, R> => {
    const middlewareRequest = toMiddlewareRequest(request)
    
    if (newMiddlewares.length > 0) {
      return Middleware.execute(
        newMiddlewares,
        middlewareRequest,
        server.handle(request)  // Original handle is wrapped
      ) as Effect.Effect<TransportResponse, never, R>
    }
    
    return server.handle(request)
  }
  
  return {
    ...server,
    middlewares: newMiddlewares,
    handle: wrappedHandle,
    pipe() { ... },
  }
}
```

### Issues Found

#### Issue 7: Double Middleware Execution

**Problem:** Server-level middleware wraps `server.handle()`, which itself executes procedure/group middlewares.

If you have:
- Server middleware: `[ServerAuth]`
- Procedure middleware: `[ProcAuth]`

The execution becomes:
1. ServerAuth runs
2. Procedure payload decoding
3. ProcAuth runs
4. Handler

But ServerAuth wraps the ENTIRE handle call, including its own middleware execution.

**This is actually correct behavior** - server middleware runs before procedure middleware.

#### Issue 8: handleStream Not Wrapped

**Problem:** `Server.middleware()` only wraps `handle`, not `handleStream`:

```typescript
return {
  ...server,
  middlewares: newMiddlewares,
  handle: wrappedHandle,    // Wrapped
  // handleStream: NOT wrapped!
  pipe() { ... },
}
```

Combined with Issue 4 (handleStream ignores middlewares), this means server-level middleware also doesn't run for streams.

---

## 6. HTTP Adapter (toHttpHandler)

**Location:** `src/Server/index.ts:377-406`

### Implementation

```typescript
export const toHttpHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  _options?: HttpHandlerOptions
): (request: HttpRequest) => Effect.Effect<HttpResponse, never, R> => {
  return (request: HttpRequest) =>
    Effect.tryPromise({
      try: () => request.json(),
      catch: () => ({ id: "", tag: "", payload: undefined }),
    }).pipe(
      Effect.flatMap((body) => {
        const transportRequest = new Transport.TransportRequest({
          id: (body as any).id ?? Transport.generateRequestId(),
          tag: (body as any).tag ?? "",
          payload: (body as any).payload,
        })
        
        return server.handle(transportRequest)
      }),
      Effect.map((response) => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      })),
      Effect.catchAll(() => Effect.succeed({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid request" }),
      }))
    ) as Effect.Effect<HttpResponse, never, R>
}
```

### Issues Found

#### Issue 9: JSON Parse Failure Swallowed

**Problem:** If `request.json()` fails, it returns an object with empty strings:

```typescript
catch: () => ({ id: "", tag: "", payload: undefined }),
```

This empty request then goes through `server.handle()` and fails with "Unknown procedure: " which is confusing.

**Better approach:** Return a proper error response immediately:
```typescript
catch: (cause) => Effect.fail(new Transport.TransportError({
  reason: "Protocol",
  message: "Invalid JSON body",
  cause,
}))
```

#### Issue 10: No Headers Forwarded

**Problem:** HTTP request headers are not forwarded to the TransportRequest:

```typescript
const transportRequest = new Transport.TransportRequest({
  id: (body as any).id ?? Transport.generateRequestId(),
  tag: (body as any).tag ?? "",
  payload: (body as any).payload,
  // headers: NOT set!
})
```

**Impact:** Middleware cannot access HTTP headers (e.g., Authorization header).

**Fix:**
```typescript
headers: Object.fromEntries(request.headers.entries()),
```

But note: `HttpRequest` interface doesn't expose headers currently.

#### Issue 11: Always Returns 200

**Problem:** All responses return HTTP 200, even errors:

```typescript
Effect.map((response) => ({
  status: 200,  // Always 200!
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(response),
})),
```

**Consideration:** This is actually common for RPC protocols (errors in body, not status code), but may want to return 500 for internal errors or 401 for auth failures.

#### Issue 12: Stream Handling Missing

**Problem:** `toHttpHandler` only handles `server.handle()`, not `server.handleStream()`.

For streaming, you'd typically need:
- Different endpoint or parameter
- SSE (Server-Sent Events) response format
- Keep-alive handling

---

## 7. Nested Router Handling

### Analysis

Nested routers are handled correctly in `buildHandlerMap`:

```typescript
// Router.make("@api", {
//   users: { list: ... },  // Nested
//   health: ...,           // Top-level
// })

// Results in:
// "@api/users/list" → handler
// "@api/health" → handler
```

### Middleware Inheritance in Nested Routers

```typescript
const appRouter = Router.make("@api", {
  admin: Router.withMiddleware([AdminAuth], {
    settings: Router.withMiddleware([SuperAdminAuth], {
      dangerous: dangerousProcedure
    })
  })
})
```

Results in `dangerous` having middlewares: `[AdminAuth, SuperAdminAuth]`

**Finding:** Middleware inheritance works correctly for deeply nested structures.

### Issue Found

#### Issue 13: DefinitionWithMiddleware Not Traversed in Router.make()

**Location:** `src/Router/index.ts:169-238`

**Problem:** `Router.make()` doesn't unwrap `DefinitionWithMiddleware` when walking the tree:

```typescript
const walk = (def: Definition, pathPrefix: string, tagPrefix: string): void => {
  for (const key of Object.keys(def)) {
    const value = def[key]
    // ... 
    if (Procedure.isProcedure(value)) {
      // Handle procedure
    } else {
      // It's a nested definition, recurse
      walk(value, path, procedureTag)  // Doesn't unwrap DefinitionWithMiddleware!
    }
  }
}
```

But `Server.make()` does unwrap it:
```typescript
if (typeof entry === "object" && entry !== null && "definition" in entry && "middlewares" in entry) {
  const wrapped = entry as Router.DefinitionWithMiddleware<Router.Definition>
  groupMiddlewares = wrapped.middlewares
  entry = wrapped.definition
}
```

**Impact:** Router's `procedures` array and `pathMap` won't include procedures inside `withMiddleware` groups.

**This is a BUG** - but only affects Router utilities, not Server handling.

---

## 8. Payload Validation

### Schema Decoding

Payload is decoded using Effect's Schema:

```typescript
Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
```

### Validation Error Response

```typescript
onFailure: (cause) => Effect.succeed(new Transport.Failure({
  id: request.id,
  error: { message: "Invalid payload", cause },
}))
```

### Issues

#### Issue 14: Cause Contains Full ParseError

**Problem:** The `cause` contains the full `Schema.ParseError` which may include:
- Full schema structure
- Expected types
- Transformation details

This could be a security/information disclosure issue.

**Recommendation:** Sanitize to just the error messages:
```typescript
error: {
  message: "Invalid payload",
  issues: cause.errors.map(e => e.message),
}
```

---

## 9. Success/Failure Response Encoding

### Success Encoding

```typescript
Schema.encode(procedure.successSchema)(value).pipe(
  Effect.orElseSucceed(() => value),  // Falls back to raw value
  Effect.map((encodedValue) => new Transport.Success({
    id: request.id,
    value: encodedValue,
  }))
)
```

### Failure Encoding

```typescript
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.orElseSucceed(() => error),  // Falls back to raw error
  Effect.map((encodedError) => new Transport.Failure({
    id: request.id,
    error: encodedError,
  }))
)
```

### Issues (previously noted)

- Fallback to raw values on encoding failure
- No logging/warning when encoding fails
- Potentially non-serializable values sent to client

---

## 10. Summary of Issues Found

### Critical (Must Fix)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 4 | No middleware execution in handleStream | Server:285-337 | Auth bypassed for streams |
| 8 | Server.middleware() doesn't wrap handleStream | Server:454-496 | Server middleware bypassed for streams |

### Major (Should Fix)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 1 | Middleware runs after payload decoding | Server:240-281 | Can't reject malformed requests early |
| 5 | Stream chunks not encoded | Server:309-313 | Non-serializable data sent |
| 6 | Stream errors not encoded | Server:316-319 | Raw errors exposed |
| 10 | HTTP headers not forwarded | Server:386-392 | Middleware can't access auth headers |

### Minor (Consider Fixing)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| 2 | Error encoding fallback | Server:251-256 | Raw errors on encoding failure |
| 3 | Success encoding fallback | Server:259-265 | Raw values on encoding failure |
| 9 | JSON parse failure swallowed | Server:382-384 | Confusing error message |
| 11 | Always returns HTTP 200 | Server:395-399 | Standard but may want flexibility |
| 12 | No stream handling in HTTP | Server:377-406 | Streams not usable via HTTP |
| 13 | Router.make doesn't unwrap withMiddleware | Router:179-205 | Router utilities incomplete |
| 14 | Full ParseError in response | Server:242-245 | Information disclosure |

---

## 11. Recommendations

### Priority 1: Fix Stream Middleware

```typescript
// In handleStream, add middleware execution:
const handleStream = (request: TransportRequest): Stream.Stream<StreamResponse, never, R> => {
  const entry = handlerMap.get(request.tag)
  
  if (!entry) { ... }
  
  const { handler, procedure, isStream, middlewares } = entry
  
  if (!isStream) { ... }
  
  const middlewareRequest = toMiddlewareRequest(request)
  
  // Add middleware execution
  return Stream.unwrap(
    Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      Effect.flatMap((payload) => {
        const streamEffect = Effect.succeed(makeStream(payload))
        
        if (middlewares.length > 0) {
          return Middleware.execute(middlewares, middlewareRequest, streamEffect)
        }
        
        return streamEffect
      }),
      Effect.orElseSucceed(() => failureStream)
    )
  )
}
```

### Priority 2: Encode Stream Responses

```typescript
Stream.mapEffect((value) =>
  Schema.encode(procedure.successSchema)(value).pipe(
    Effect.map((encoded) => new Transport.StreamChunk({ id: request.id, chunk: encoded })),
    Effect.orElseSucceed(() => new Transport.StreamChunk({ id: request.id, chunk: value }))
  )
)
```

### Priority 3: Forward HTTP Headers

Update `HttpRequest` interface and `toHttpHandler`:
```typescript
interface HttpRequest {
  readonly json: () => Promise<unknown>
  readonly headers: Headers  // Add this
}
```

### Priority 4: Consider Early Middleware Execution

Move middleware execution before payload decoding if middleware should be able to reject requests before parsing:

```typescript
const handle = (request: TransportRequest): Effect.Effect<TransportResponse, never, R> => {
  const entry = handlerMap.get(request.tag)
  if (!entry) { ... }
  
  const middlewareRequest = toMiddlewareRequest(request)
  
  // Execute middleware first
  const handlerWithMiddleware = middlewares.length > 0
    ? Middleware.execute(middlewares, middlewareRequest, executeHandler())
    : executeHandler()
  
  return handlerWithMiddleware
  
  function executeHandler() {
    return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      // ... rest of handler logic
    )
  }
}
```
