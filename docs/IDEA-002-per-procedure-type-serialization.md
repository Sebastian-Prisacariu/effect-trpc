# IDEA-002: Per-Procedure-Type Serialization with Procedure.make()

**Date:** 2026-02-24  
**Status:** Idea (needs discussion before implementation)  
**Related:** DECISION-004 (Custom Procedure Types), DECISION-008 (Automatic Refetching)

---

## Key Takeaway

**The important part of this idea is `Procedure.make()` for defining custom procedure types.** Per-procedure-type serialization is a nice-to-have that comes naturally once custom procedure types exist. The built-in types (query, mutation, stream, chat, subscription) with global NDJSON serialization are sufficient for the foreseeable future.

---

## Context

When discussing automatic refetching (DECISION-008), we considered per-procedure-type serialization. Currently we use global NDJSON serialization for everything.

---

## Idea

Allow different serialization formats per procedure type:

| Procedure Type | Current | Could Use |
|----------------|---------|-----------|
| Query | NDJSON | NDJSON (for batching) |
| Mutation | NDJSON | NDJSON |
| Stream | NDJSON | SSE format, MessagePack for binary |
| Subscription | WebSocket codec | Already separate |
| Custom types | N/A | User-defined serialization |

---

## Observations

### WebSocket Already Does This

We already have `WebSocketCodec` for subscriptions, proving the pattern works:

```typescript
// src/ws/server/WebSocketCodec.ts
export class WebSocketCodec extends Context.Tag("@effect-trpc/WebSocketCodec")<
  WebSocketCodec,
  WebSocketCodecImpl
>() {}
```

This could be extended to custom procedure types.

### API Naming

Following our `[domain].[action]` naming pattern, the API should be:

```typescript
// Instead of:
const binaryStream = defineProcedureType({ ... })

// Use:
const binaryStream = Procedure.make({
  name: 'binaryStream',
  transport: 'http-stream',
  serialization: 'msgpack',
  // ...
})
```

This aligns with:
- `Effect.gen()`, `Effect.succeed()`, etc.
- `Schema.make()` 
- `Atom.make()`

---

## Proposed API

```typescript
import { Procedure } from 'effect-trpc'

// Define a custom procedure type with custom serialization
const binaryStream = Procedure.make({
  name: 'binaryStream',
  transport: 'http-stream',
  serialization: {
    contentType: 'application/msgpack',
    encode: (value) => msgpack.encode(value),
    decode: (data) => msgpack.decode(data),
  },
  // Other options like timeout, retry, etc.
})

// Use it in a router
const mediaRouter = Router.make({
  routes: {
    videoChunks: binaryStream
      .input(Schema.Struct({ videoId: Schema.String }))
      .output(Schema.Uint8Array)
      .handler(/* ... */),
  },
})
```

---

## Questions to Decide

1. **Should we pursue this?** What are the real use cases beyond the built-in types?

2. **Does `Procedure.make()` fit our naming conventions?** Or should it be `Procedure.define()`, `Procedure.type()`, etc.?

3. **How does this interact with @effect/rpc's architecture?** @effect/rpc uses a single `RpcSerialization` layer. Per-procedure serialization would require:
   - Content-type negotiation
   - Per-request codec selection
   - Possibly custom RPC server handling

4. **Priority relative to other features?** Is this needed before:
   - SSR/RSC helpers
   - Better DevTools
   - Other requested features

---

## Implementation Considerations

### Leveraging WebSocketCodec Pattern

The WebSocket subscription system already uses a separate codec:

```typescript
// Current WebSocket codec
const WebSocketCodecLive = WebSocketCodec.Default  // NDJSON codec

// Could extend to custom procedures
const BinaryStreamCodecLive = Procedure.codec({
  contentType: 'application/msgpack',
  encode: (value) => msgpack.encode(value),
  decode: (data) => msgpack.decode(data),
})
```

### Server-Side Routing

The server would need to:
1. Check the procedure type
2. Select the appropriate codec
3. Set the correct Content-Type header

```typescript
// Pseudo-code
const handleRequest = (req: Request, procedureMeta: ProcedureMeta) => {
  const codec = procedureMeta.serialization ?? globalSerialization
  const decoded = codec.decode(req.body)
  const result = await runProcedure(decoded)
  return new Response(codec.encode(result), {
    headers: { 'Content-Type': codec.contentType }
  })
}
```

---

## Alternatives Considered

### 1. Keep Global Serialization Only

**Pros:**
- Simpler implementation
- Consistent behavior
- Effect Schema handles most type transformations

**Cons:**
- Can't optimize for specific use cases (binary streams, etc.)
- Less flexible than tRPC with SuperJSON

### 2. Per-Request Serialization Negotiation

Like HTTP Accept headers, let the client specify desired format.

**Pros:**
- Maximum flexibility
**Cons:**
- Complex negotiation logic
- Harder to predict behavior

### 3. Separate Endpoints per Serialization

Different URL paths for different formats: `/api/trpc/json`, `/api/trpc/msgpack`

**Pros:**
- Clear separation
**Cons:**
- URL pollution
- Doesn't solve per-procedure needs

---

## Next Steps

1. Gather real use cases from potential users
2. Prototype `Procedure.make()` API
3. Investigate @effect/rpc extension points
4. Decide on priority vs other features

---

## Related Documents

- [DECISION-004: Custom Procedure Types](./DECISION-004-custom-procedure-types.md)
- [DECISION-008: Automatic Refetching](./DECISION-008-automatic-refetching.md)
