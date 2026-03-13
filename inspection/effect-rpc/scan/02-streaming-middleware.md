# Effect RPC: Streaming with Middleware Analysis

## Summary

**Effect RPC correctly applies middleware to streams.** Our effect-trpc implementation bypasses middleware for streams, creating a security vulnerability.

## Effect RPC Implementation

### Key Finding: `applyMiddleware` Called for Both Streams and Effects

In `RpcServer.ts:218-264`, the `handleRequest` function:

```typescript
const handleRequest = (...) => {
  const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
  const result = entry.handler(request.payload, { clientId, headers })
  
  // ... wrapper handling
  
  const handler = applyMiddleware(
    rpc,
    context,
    client.id,
    request.payload,
    request.headers,
    isStream
      ? streamEffect(client, request, streamOrEffect)  // Stream case
      : streamOrEffect as Effect.Effect<any>            // Effect case
  )
  // ...
}
```

The `applyMiddleware` function wraps **both** Effect and Stream handlers in middleware before execution.

### `applyMiddleware` Implementation (Lines 423-464)

```typescript
const applyMiddleware = <A, E, R>(
  rpc: Rpc.AnyWithProps,
  context: Context.Context<never>,
  clientId: number,
  payload: A,
  headers: Headers.Headers,
  handler: Effect.Effect<A, E, R>  // <- Already Effect, even for streams
) => {
  if (rpc.middlewares.size === 0) return handler

  const options = { rpc, payload, headers, clientId }

  for (const tag of rpc.middlewares) {
    if (tag.wrap) {
      // Wrap middleware wraps entire execution
      const middleware = Context.unsafeGet(context, tag)
      handler = middleware({ ...options, next: handler as any })
    } else if (tag.optional) {
      // Optional middleware with graceful degradation
      const middleware = Context.unsafeGet(context, tag)
      const previous = handler
      handler = Effect.matchEffect(middleware(options), {
        onFailure: () => previous,
        onSuccess: tag.provides !== undefined
          ? (value) => Effect.provideService(previous, tag.provides, value)
          : (_) => previous
      })
    } else {
      // Required middleware that provides a service
      const middleware = Context.unsafeGet(context, tag)
      handler = tag.provides !== undefined
        ? Effect.provideServiceEffect(handler, tag.provides, middleware(options))
        : Effect.zipRight(middleware(options), handler)
    }
  }
  return handler
}
```

### Stream Handling: Converted to Effect First

The `streamEffect` function (lines 356-403) converts `Stream` to `Effect<void>` that processes chunks:

```typescript
const streamEffect = (client, request, stream) => {
  // Converts stream consumption to an Effect
  // This Effect is then wrapped with middleware via applyMiddleware
  if (Effect.isEffect(stream)) {
    return stream.pipe(
      Effect.flatMap((mailbox) => /* chunk processing */),
      Effect.scoped
    )
  }
  return Stream.runForEachChunk(stream, (chunk) => /* send chunk */)
}
```

**The middleware wraps the entire stream lifecycle**, not individual chunks.

## Our Implementation Problem

In `src/Server/index.ts:285-337`:

```typescript
const handleStream = (request) => {
  const { handler, procedure, isStream } = entry
  
  if (!isStream) {
    return Stream.succeed(/* error */)
  }
  
  const makeStream = (payload) => {
    const stream = handler(payload) as Stream.Stream<...>
    return stream.pipe(
      Stream.map((value) => /* chunk */),
      Stream.catchAll(/* error handling */),
      Stream.concat(/* end */)
    )
  }
  
  // NO MIDDLEWARE EXECUTION HERE!
  // Compare to handle() which calls Middleware.execute()
  return Stream.unwrap(
    Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      Effect.map(makeStream),
      Effect.orElseSucceed(() => failureStream)
    )
  )
}
```

**Security Issue:** `handleStream` never calls `Middleware.execute()`, unlike `handle()` which does (line 270-276).

## Security Implications

| Scenario | Effect RPC | Our Implementation |
|----------|------------|-------------------|
| Auth middleware on subscription | Runs before stream starts | **BYPASSED** |
| Rate limiting | Applied to stream | **BYPASSED** |
| Logging/audit | Wraps stream execution | **BYPASSED** |
| Service injection | Provided to handler | **BYPASSED** |

### Attack Vector

```typescript
// Attacker can bypass auth by calling stream procedures directly
const protectedStream = Procedure.stream({...}).middleware(AuthMiddleware)

// This should require auth, but doesn't in our implementation
client.protectedStream.subscribe()  // No middleware runs!
```

## Fix Recommendations

### Option 1: Wrap Stream in Effect (Effect RPC Pattern)

Convert stream consumption to an Effect that can be wrapped with middleware:

```typescript
const handleStream = (request) => {
  const middlewareRequest = toMiddlewareRequest(request)
  
  // Convert stream to Effect-wrapped stream
  const makeProtectedStream = (payload) => {
    const stream = handler(payload) as Stream.Stream<...>
    
    // Wrap stream start in middleware-protected Effect
    const streamEffect = Effect.gen(function* () {
      // Middleware runs HERE, before stream starts
      yield* Stream.runForEach(stream, (chunk) => {
        // Send chunk to client
      })
    })
    
    // Execute middleware chain around stream lifecycle
    return Middleware.execute(middlewares, middlewareRequest, streamEffect)
  }
  
  return Stream.unwrap(
    Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      Effect.flatMap(makeProtectedStream)
    )
  )
}
```

### Option 2: Execute Middleware Before Stream

Run middleware as a gate before stream consumption:

```typescript
const handleStream = (request) => {
  const middlewareRequest = toMiddlewareRequest(request)
  
  // Create middleware gate Effect
  const middlewareGate = middlewares.length > 0
    ? Middleware.execute(middlewares, middlewareRequest, Effect.void)
    : Effect.void
  
  return Stream.unwrap(
    Effect.gen(function* () {
      // Run middleware first (auth, rate limit, etc.)
      yield* middlewareGate
      
      // Only after middleware passes, create stream
      const payload = yield* Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
      return makeStream(payload)
    }).pipe(
      Effect.orElseSucceed(() => failureStream)
    )
  )
}
```

### Option 3: Full Effect RPC Pattern

Match Effect RPC exactly by returning Effect from handlers:

```typescript
// Handler returns Effect<Mailbox> instead of Stream
type StreamHandler = (payload) => Effect.Effect<
  Mailbox.ReadonlyMailbox<Chunk, Error>,
  Error,
  R
>

// Then applyMiddleware wraps the entire Effect
```

## Recommendation

**Option 2** (Execute Middleware Before Stream) is the simplest fix:
- Minimal refactoring
- Clear security boundary
- Matches user expectations (auth runs before any data flows)

However, **Option 1** provides more complete middleware support (e.g., timing entire stream lifecycle).

## References

- Effect RPC: `packages/rpc/src/RpcServer.ts:256-264` (middleware application)
- Effect RPC: `packages/rpc/src/RpcServer.ts:423-464` (applyMiddleware function)
- Effect RPC: `packages/rpc/src/RpcServer.ts:356-403` (streamEffect conversion)
- Our code: `src/Server/index.ts:285-337` (vulnerable handleStream)
