# H2: Streaming with Middleware in Effect RPC

## Executive Summary

**Finding: Effect RPC applies middleware to streams correctly.** The middleware is applied to the Effect that produces the stream, not bypassed. This is architecturally different from how our effect-trpc currently handles streams, and represents the correct pattern we should adopt.

## Key Discovery: How Effect RPC Handles Streaming

### The Critical Code Path

In `RpcServer.ts` (lines 244-265), the server handles both regular requests and streams through the **same middleware chain**:

```typescript
// RpcServer.ts:244-265
const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
const result = entry.handler(request.payload, {
  clientId: client.id,
  headers: request.headers
})

// Handle wrapper options (fork, uninterruptible)
const isWrapper = Rpc.isWrapper(result)
const isFork = isWrapper && result.fork
const isUninterruptible = isWrapper && result.uninterruptible
const streamOrEffect = isWrapper ? result.value : result

// CRITICAL: applyMiddleware wraps BOTH streams AND effects
const handler = applyMiddleware(
  rpc,
  context,
  client.id,
  request.payload,
  request.headers,
  isStream
    ? streamEffect(client, request, streamOrEffect)  // Stream converted to Effect
    : streamOrEffect as Effect.Effect<any>
)
```

### The `applyMiddleware` Function (lines 423-464)

```typescript
const applyMiddleware = <A, E, R>(
  rpc: Rpc.AnyWithProps,
  context: Context.Context<never>,
  clientId: number,
  payload: A,
  headers: Headers.Headers,
  handler: Effect.Effect<A, E, R>
) => {
  if (rpc.middlewares.size === 0) {
    return handler
  }

  const options = {
    rpc,
    payload,
    headers,
    clientId
  }

  for (const tag of rpc.middlewares) {
    if (tag.wrap) {
      // Wrapping middleware: middleware receives `next` and can control execution
      const middleware = Context.unsafeGet(context, tag)
      handler = middleware({ ...options, next: handler as any })
    } else if (tag.optional) {
      // Optional middleware: if it fails, skip it
      const middleware = Context.unsafeGet(context, tag) as RpcMiddleware<any, any>
      const previous = handler
      handler = Effect.matchEffect(middleware(options), {
        onFailure: () => previous,
        onSuccess: tag.provides !== undefined
          ? (value) => Effect.provideService(previous, tag.provides as any, value)
          : (_) => previous
      })
    } else {
      // Standard middleware: runs before handler, can provide context
      const middleware = Context.unsafeGet(context, tag) as RpcMiddleware<any, any>
      handler = tag.provides !== undefined
        ? Effect.provideServiceEffect(handler, tag.provides as any, middleware(options))
        : Effect.zipRight(middleware(options), handler)
    }
  }

  return handler
}
```

## Why This Works: Stream Conversion Pattern

### The `streamEffect` Function (lines 356-403)

Effect RPC converts streams to Effects before middleware application:

```typescript
const streamEffect = (
  client: Client,
  request: Request<Rpcs>,
  stream: Stream.Stream<any, any> | Effect.Effect<Mailbox.ReadonlyMailbox<any, any>, any, Scope.Scope>
) => {
  // Setup ack latch for backpressure
  let latch = client.latches.get(request.id)
  if (supportsAck && !latch) {
    latch = Effect.unsafeMakeLatch(false)
    client.latches.set(request.id, latch)
  }
  
  // Handle Mailbox-based streaming
  if (Effect.isEffect(stream)) {
    let done = false
    return stream.pipe(
      Effect.flatMap((mailbox) =>
        Effect.whileLoop({
          while: () => !done,
          body: constant(Effect.flatMap(mailbox.takeAll, ([chunk, done_]) => {
            done = done_
            if (!Chunk.isNonEmpty(chunk)) return Effect.void
            const write = options.onFromServer({
              _tag: "Chunk",
              clientId: client.id,
              requestId: request.id,
              values: Chunk.toReadonlyArray(chunk)
            })
            if (!latch) return write
            latch.unsafeClose()
            return Effect.zipRight(write, latch.await)
          })),
          step: constVoid
        })
      ),
      Effect.scoped
    )
  }
  
  // Handle Stream-based streaming
  return Stream.runForEachChunk(stream, (chunk) => {
    if (!Chunk.isNonEmpty(chunk)) return Effect.void
    const write = options.onFromServer({
      _tag: "Chunk",
      clientId: client.id,
      requestId: request.id,
      values: Chunk.toReadonlyArray(chunk)
    })
    if (!latch) return write
    latch.unsafeClose()
    return Effect.zipRight(write, latch.await)
  })
}
```

## Architecture Diagram

```
Request Arrives
      |
      v
+---------------------+
| Parse Request       |
+---------------------+
      |
      v
+---------------------+
| Get RPC Handler     |
+---------------------+
      |
      v
+---------------------+
| Call Handler        |  Returns Effect<A> or Stream<A>
+---------------------+
      |
      v
+---------------------+
| Is Stream?          |
+---------------------+
      |           |
      | No        | Yes
      v           v
Effect<A>    streamEffect() -> Effect<void>
      |           |
      +-----------+
            |
            v
+------------------------+
| applyMiddleware()      |  <-- MIDDLEWARE RUNS HERE
| - wrap middlewares     |
| - optional middlewares |
| - standard middlewares |
+------------------------+
            |
            v
+------------------------+
| Execute wrapped Effect |
+------------------------+
            |
            v
+------------------------+
| Send Response/Chunks   |
+------------------------+
```

## Middleware Types in Effect RPC

### 1. Standard Middleware (`tag.wrap === false && tag.optional === false`)

```typescript
// Runs before handler, can provide service to handler
handler = tag.provides !== undefined
  ? Effect.provideServiceEffect(handler, tag.provides as any, middleware(options))
  : Effect.zipRight(middleware(options), handler)
```

Example: Authentication middleware that provides a `User` service.

### 2. Optional Middleware (`tag.optional === true`)

```typescript
// If middleware fails, continue without it
handler = Effect.matchEffect(middleware(options), {
  onFailure: () => previous,
  onSuccess: tag.provides !== undefined
    ? (value) => Effect.provideService(previous, tag.provides as any, value)
    : (_) => previous
})
```

Example: Caching middleware that's nice to have but not required.

### 3. Wrapping Middleware (`tag.wrap === true`)

```typescript
// Middleware receives `next` and controls execution flow
handler = middleware({ ...options, next: handler as any })
```

Example: Timing/logging middleware that needs to wrap the entire execution.

## Security Implications

### Effect RPC is Secure for Streams

1. **Middleware runs on connection setup**: Before any stream data flows, all middleware has executed
2. **Context is propagated**: Services provided by middleware are available throughout stream lifetime
3. **No bypass possible**: The `streamEffect()` function returns an Effect, which is then wrapped by middleware

### Our Current effect-trpc Issue

In our implementation, streams bypass middleware because:

1. We return the Stream directly to tRPC
2. tRPC handles stream iteration outside our middleware chain
3. Middleware only runs for the initial subscription setup, not data flow

## The Fix Pattern for effect-trpc

Following Effect RPC's pattern, we should:

1. **Convert streams to Effects before middleware**
2. **Run middleware on the Effect that manages the stream lifecycle**
3. **Handle stream iteration inside the middleware-wrapped Effect**

### Code Pattern to Adopt

```typescript
// CURRENT (BROKEN): middleware only wraps subscription setup
const handler = applyMiddleware(procedure, () => {
  return Stream.make(1, 2, 3)  // Stream returned directly, bypasses middleware
})

// FIXED (Effect RPC pattern): middleware wraps entire stream lifecycle
const handler = applyMiddleware(procedure, () => {
  const stream = makeStream()
  return Stream.runForEach(stream, (value) => {
    // Each chunk is processed inside the middleware-wrapped Effect
    return sendToClient(value)
  })
})
```

## RpcMiddleware Interface Details

From `RpcMiddleware.ts`:

```typescript
interface RpcMiddleware<Provides, E> {
  (options: {
    readonly clientId: number
    readonly rpc: Rpc.AnyWithProps
    readonly payload: unknown
    readonly headers: Headers
  }): Effect.Effect<Provides, E>
}

interface RpcMiddlewareWrap<Provides, E> {
  (options: {
    readonly clientId: number
    readonly rpc: Rpc.AnyWithProps
    readonly payload: unknown
    readonly headers: Headers
    readonly next: Effect.Effect<SuccessValue, E, Provides>  // <-- KEY: receives next
  }): Effect.Effect<SuccessValue, E>
}
```

### Creating Middleware Tags

```typescript
// Standard middleware that provides a service
class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  {
    provides: UserContext,
    failure: AuthError
  }
) {}

// Wrapping middleware for cross-cutting concerns
class LoggingMiddleware extends RpcMiddleware.Tag<LoggingMiddleware>()(
  "LoggingMiddleware",
  {
    wrap: true  // <-- Gets `next` to wrap execution
  }
) {}
```

## Attaching Middleware to RPCs

Middleware can be attached at multiple levels:

### Per-RPC

```typescript
const getUserRpc = Rpc.make("getUser", {
  payload: { id: Schema.String },
  success: UserSchema
}).middleware(AuthMiddleware)
```

### Per-Group

```typescript
const group = RpcGroup.make(
  Rpc.make("public"),
  Rpc.make("private")
).middleware(AuthMiddleware)  // All RPCs get middleware
```

## Stream Definition in Effect RPC

Streams are declared at the RPC level:

```typescript
const streamRpc = Rpc.make("events", {
  stream: true,  // <-- Marks this as a streaming RPC
  success: EventSchema,
  error: StreamError
})
```

This creates an `RpcSchema.Stream<EventSchema, StreamError>` which:
1. Can be detected by `RpcSchema.isStreamSchema()`
2. Has separate success and failure schemas for proper encoding
3. Integrates with Effect's Stream type

## Summary

| Aspect | Effect RPC | Our effect-trpc |
|--------|------------|-----------------|
| Middleware on streams | Applied to lifecycle Effect | Bypassed |
| Stream handling | `streamEffect()` wraps stream | Direct return |
| Context propagation | Full lifecycle | Setup only |
| Security | Correct | Vulnerable |

## Recommendations

1. **Adopt Effect RPC's pattern**: Convert streams to Effects before middleware
2. **Use `runForEach` or Mailbox pattern**: Control stream iteration inside Effect
3. **Propagate middleware context**: Ensure services are available throughout stream
4. **Consider Effect RPC directly**: For new projects, use Effect RPC instead of tRPC wrapper
