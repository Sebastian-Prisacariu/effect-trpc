# Effect RPC Streaming Middleware Analysis

## Summary

**Effect RPC runs middleware ONCE at stream initialization**, not per-chunk. This matches tRPC's behavior for streaming procedures.

## Key Findings

### 1. Middleware Application Point

Location: `RpcServer.ts:256-265`

Middleware is applied once when the handler result is created, before stream execution begins:

```typescript
const handler = applyMiddleware(
  rpc,
  context,
  client.id,
  request.payload,
  request.headers,
  isStream
    ? streamEffect(client, request, streamOrEffect)
    : streamOrEffect as Effect.Effect<any>
)
```

The `applyMiddleware` function wraps the entire handler (Effect or Stream) with middleware - it doesn't intercept individual stream emissions.

### 2. Stream Detection Logic

Location: `RpcServer.ts:244`

Effect RPC detects if an RPC returns a stream by checking the schema:

```typescript
const isStream = RpcSchema.isStreamSchema(rpc.successSchema)
```

From `RpcSchema.ts:23-24`:

```typescript
export const isStreamSchema = (schema: Schema.Schema.All): schema is Stream<any, any> =>
  schema.ast.annotations[AST.SchemaIdAnnotationId] === StreamSchemaId
```

### 3. Middleware Implementation Patterns

Location: `RpcServer.ts:423-464`

Effect RPC supports three middleware patterns:

#### Pattern A: Wrap Middleware (runs handler inside middleware scope)

```typescript
if (tag.wrap) {
  const middleware = Context.unsafeGet(context, tag)
  handler = middleware({ ...options, next: handler as any })
}
```

The `RpcMiddlewareWrap` interface shows this provides `next`:

```typescript
// RpcMiddleware.ts:43-51
interface RpcMiddlewareWrap<Provides, E> {
  (options: {
    readonly clientId: number
    readonly rpc: Rpc.AnyWithProps
    readonly payload: unknown
    readonly headers: Headers
    readonly next: Effect.Effect<SuccessValue, E, Provides>
  }): Effect.Effect<SuccessValue, E>
}
```

**For streams**: The `next` is the entire stream execution Effect, so the wrapper runs once around the full stream lifecycle.

#### Pattern B: Optional Middleware (attempt, fallback if fails)

```typescript
else if (tag.optional) {
  const middleware = Context.unsafeGet(context, tag) as RpcMiddleware<any, any>
  handler = Effect.matchEffect(middleware(options), {
    onFailure: () => previous,  // Use previous handler on failure
    onSuccess: tag.provides !== undefined
      ? (value) => Effect.provideService(previous, tag.provides as any, value)
      : (_) => previous
  })
}
```

#### Pattern C: Required Middleware (must succeed before handler)

```typescript
else {
  const middleware = Context.unsafeGet(context, tag) as RpcMiddleware<any, any>
  handler = tag.provides !== undefined
    ? Effect.provideServiceEffect(handler, tag.provides as any, middleware(options))
    : Effect.zipRight(middleware(options), handler)
}
```

### 4. Stream Chunk Handling (Post-Middleware)

Location: `RpcServer.ts:356-403`

After middleware runs, streaming is handled by `streamEffect`:

```typescript
const streamEffect = (
  client: Client,
  request: Request<Rpcs>,
  stream: Stream.Stream<any, any> | Effect.Effect<Mailbox.ReadonlyMailbox<any, any>, any, Scope.Scope>
) => {
  // ...latch setup for backpressure...
  
  if (Effect.isEffect(stream)) {
    // Mailbox-based streaming
    return stream.pipe(
      Effect.flatMap((mailbox) =>
        Effect.whileLoop({
          while: () => !done,
          body: constant(Effect.flatMap(mailbox.takeAll, ([chunk, done_]) => {
            done = done_
            // Send chunk to client
          })),
          step: constVoid
        })
      ),
      Effect.scoped
    )
  }
  
  // Stream-based streaming
  return Stream.runForEachChunk(stream, (chunk) => {
    // Send chunk to client
  })
}
```

**Middleware does NOT wrap individual chunk emissions** - it wraps the entire stream execution.

### 5. Service Provision in Streams

Location: `RpcServer.ts:322-327`

The handler context (including middleware-provided services) is captured and used for the entire stream:

```typescript
const runtime = Runtime.make({
  context: Context.merge(entry.context, requestFiber.currentContext),
  fiberRefs: requestFiber.getFiberRefs(),
  runtimeFlags: RuntimeFlags.disable(Runtime.defaultRuntime.runtimeFlags, RuntimeFlags.Interruption)
})
const fiber = Runtime.runFork(runtime, effect)
```

Services provided by middleware are available throughout stream execution, not just at initialization.

## Middleware Lifecycle for Streams

```
Request arrives
    │
    ▼
┌─────────────────────────────┐
│  applyMiddleware() runs     │  ← Middleware executes ONCE
│  - auth checks              │
│  - service provision        │
│  - wrapping                 │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│  Stream handler executes    │  ← Context available
│  with provided context      │
└─────────────────────────────┘
    │
    ▼
┌─────────────────────────────┐
│  Chunks emitted via         │  ← No middleware per-chunk
│  streamEffect()             │
└─────────────────────────────┘
    │
    ▼
Stream completes/errors
```

## Comparison with tRPC

| Aspect | tRPC | Effect RPC |
|--------|------|------------|
| Middleware timing | Once at stream start | Once at stream start |
| Context provision | Via `ctx` | Via Effect services |
| Per-chunk middleware | Not supported | Not supported |
| Cleanup on stream end | Via `ctx.signal` | Via Scope finalization |

## Streaming RPC Definition

Location: `Rpc.ts:645-696`

Streaming RPCs are defined with `stream: true`:

```typescript
export const make = <
  const Tag extends string,
  Payload extends Schema.Schema.Any | Schema.Struct.Fields = typeof Schema.Void,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never,
  const Stream extends boolean = false
>(tag: Tag, options?: {
  readonly payload?: Payload
  readonly success?: Success
  readonly error?: Error
  readonly stream?: Stream  // ← Enables streaming
  readonly defect?: Schema.Schema<unknown, any>
  readonly primaryKey?: ...
})
```

This creates an `RpcSchema.Stream<Success, Error>` as the success schema.

## Handler Return Types for Streams

Location: `Rpc.ts:489-511`

Stream handlers can return either:

1. **Stream directly**: `Stream<A, E, R>`
2. **Effect returning Mailbox**: `Effect<ReadonlyMailbox<A, E>, E, R | Scope>`

```typescript
export type ResultFrom<R extends Any, Context> = R extends Rpc<...>
  ? [_Success] extends [RpcSchema.Stream<infer _SA, infer _SE>] ?
      | Stream<_SA["Type"], _SE["Type"] | _Error["Type"], Context>
      | Effect<
          ReadonlyMailbox<_SA["Type"], _SE["Type"] | _Error["Type"]>,
          _SE["Type"] | Schema.Schema.Type<_Error>,
          Context
        > :
    Effect<_Success["Type"], _Error["Type"], Context>
  : never
```

## Implication for effect-trpc

1. **Match tRPC behavior**: Middleware running once for streams is consistent with tRPC's design
2. **Service availability**: Effect's service pattern means auth/context is automatically available throughout stream
3. **No per-chunk overhead**: No repeated auth checks per chunk (efficient for high-frequency streams)
4. **Cleanup via Scope**: Effect's Scope handles resource cleanup when stream ends

## Code References

- Middleware application: `RpcServer.ts:423-464`
- Stream detection: `RpcServer.ts:244`
- Stream execution: `RpcServer.ts:356-403`
- Stream schema definition: `RpcSchema.ts:48-93`
- Handler result types: `Rpc.ts:489-511`
- Middleware types: `RpcMiddleware.ts:30-51`
