# Hypothesis H1: Schema Encoding Patterns in Effect RPC

## Summary

Effect RPC uses **bidirectional encoding** extensively. Our effect-trpc currently only uses `Schema.decodeUnknown` for incoming data but may be missing `Schema.encode` for outgoing data. This is a significant gap.

## Key Findings

### 1. Effect RPC's Complete Pipeline

Effect RPC has a sophisticated encoding/decoding pipeline with clear separation of concerns:

#### Client Side (RpcClient.ts:670)
```typescript
// ENCODE payload before sending
return Schema.encode(rpc.payloadSchema)(message.payload).pipe(
  Effect.locally(FiberRef.currentContext, entry.context),
  Effect.orDie,
  Effect.flatMap((payload) =>
    send({
      ...message,
      id: String(message.id),
      payload,  // <-- encoded payload
      headers: Object.entries(message.headers)
    }, collector && collector.unsafeClear())
  )
)

// DECODE exit when receiving response (RpcClient.ts:734)
return Schema.decode(Rpc.exitSchema(entry.rpc as any))(message.exit).pipe(
  Effect.locally(FiberRef.currentContext, entry.context),
  Effect.orDie,
  // ...
)
```

#### Server Side (RpcServer.ts:569-574)
```typescript
const getSchemas = (rpc: Rpc.AnyWithProps) => {
  schemas = {
    // DECODE incoming payload
    decode: Schema.decodeUnknown(rpc.payloadSchema as any),
    
    // ENCODE outgoing chunk (for streams)
    encodeChunk: Schema.encodeUnknown(
      Schema.Array(Option.isSome(streamSchemas) ? streamSchemas.value.success : Schema.Any)
    ) as any,
    
    // ENCODE outgoing exit (success/failure)
    encodeExit: Schema.encodeUnknown(Rpc.exitSchema(rpc as any)) as any,
    
    // ENCODE defects
    encodeDefect: Schema.encodeUnknown(rpc.defectSchema) as any,
    context: entry.context
  }
}
```

### 2. Why Bidirectional Encoding Matters

Schema encoding is essential when the `Type` differs from `Encoded`:

```typescript
// Example: Date schema
const DateFromString = Schema.Date  // Type: Date, Encoded: string

// Without encode: Date object sent over wire -> TypeError or invalid JSON
// With encode: Date transformed to ISO string -> valid transport
```

Common cases requiring encoding:
- `Schema.Date` (Date -> string)
- `Schema.DateFromNumber` (Date -> number)  
- Branded types with transformations
- Custom schemas with `Schema.transform`
- `Schema.BigInt` (bigint -> string)
- `Schema.optionalWith` with defaults

### 3. Effect RPC's Exit Schema Pattern

Effect RPC uses a dedicated `exitSchema` for responses (Rpc.ts:745-767):

```typescript
export const exitSchema = <R extends Any>(
  self: R
): Schema.Schema<Exit<R>, ExitEncoded<R>, Context<R>> => {
  const rpc = self as any as AnyWithProps
  const failures = new Set<Schema.Schema.All>([rpc.errorSchema])
  const streamSchemas = RpcSchema.getStreamSchemas(rpc.successSchema.ast)
  if (Option.isSome(streamSchemas)) {
    failures.add(streamSchemas.value.failure)
  }
  for (const middleware of rpc.middlewares) {
    failures.add(middleware.failure)
  }
  const schema = Schema.Exit({
    success: Option.isSome(streamSchemas) ? Schema.Void : rpc.successSchema,
    failure: Schema.Union(...failures),
    defect: rpc.defectSchema
  })
  return schema as any
}
```

This approach:
1. Combines all possible error types into a union
2. Wraps success/failure in an Exit structure
3. Handles defects with a separate schema
4. Caches the result per-RPC for performance

### 4. RpcSchema.Stream for Bidirectional Stream Encoding

RpcSchema.ts:63-93 shows stream schema with both encode and decode:

```typescript
export const Stream = <A extends Schema.Schema.Any, E extends Schema.Schema.All>(
  { failure, success }: {
    readonly failure: E
    readonly success: A
  }
): Stream<A, E> =>
  Object.assign(
    Schema.declare(
      [success, failure],
      {
        decode: (success, failure) =>
          parseStream(
            ParseResult.decodeUnknown(Schema.ChunkFromSelf(success)),
            ParseResult.decodeUnknown(failure)
          ),
        encode: (success, failure) =>
          parseStream(
            ParseResult.encodeUnknown(Schema.ChunkFromSelf(success)),
            ParseResult.encodeUnknown(failure)
          )
      },
      // ...
    ),
    // ...
  )
```

### 5. RpcSerialization Layer

Effect RPC separates serialization from schema encoding (RpcSerialization.ts):

```typescript
export interface Parser {
  readonly decode: (data: Uint8Array | string) => ReadonlyArray<unknown>
  readonly encode: (response: unknown) => Uint8Array | string | undefined
}
```

This handles JSON/NDJSON/MsgPack serialization, which is **separate** from Schema encoding. The flow is:

```
Client sends:
  payload -> Schema.encode -> JSON.stringify -> wire

Server receives:
  wire -> JSON.parse -> Schema.decode -> handler

Server sends:
  result -> Schema.encode -> JSON.stringify -> wire

Client receives:
  wire -> JSON.parse -> Schema.decode -> consumer
```

## Comparison: effect-trpc vs Effect RPC

### Current effect-trpc (Server/index.ts:240-265)

```typescript
// We decode incoming payloads
return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
  Effect.matchEffect({
    onFailure: (cause) => Effect.succeed(new Transport.Failure(...)),
    onSuccess: (payload) => {
      const handlerEffect = (handler(payload) as Effect.Effect<...>).pipe(
        Effect.matchEffect({
          // ERROR: We encode errors but using orElseSucceed fallback
          onFailure: (error) =>
            Schema.encode(procedure.errorSchema)(error).pipe(
              Effect.orElseSucceed(() => error),  // <-- falls back to raw error
              Effect.map((encodedError) => new Transport.Failure(...))
            ),
          // SUCCESS: We encode success but using orElseSucceed fallback
          onSuccess: (value) =>
            Schema.encode(procedure.successSchema)(value).pipe(
              Effect.orElseSucceed(() => value),  // <-- falls back to raw value
              Effect.map((encodedValue) => new Transport.Success(...))
            ),
        })
      )
    },
  })
)
```

### Issues Found

1. **Silent encoding failures**: `Effect.orElseSucceed(() => value)` silently falls back to the raw value if encoding fails. This masks bugs and can send invalid data.

2. **No exit schema**: We don't wrap responses in an Exit structure, losing information about whether failures are errors vs defects.

3. **Client doesn't encode payloads**: Our Client/index.ts sends raw payloads without encoding:
   ```typescript
   // Client sends without encoding
   const request = new Transport.TransportRequest({
     id: Transport.generateRequestId(),
     tag,
     payload,  // <-- raw payload, not encoded!
   })
   ```

4. **Client decodes but doesn't handle encoding context**: Effect RPC uses `Effect.locally(FiberRef.currentContext, entry.context)` to ensure schema context is available during encoding/decoding.

5. **No defect schema**: We don't handle defects (unexpected errors) with proper encoding.

## Recommendations

### High Priority

1. **Add Schema.encode on client before sending**:
   ```typescript
   const send = (tag, payload, successSchema, errorSchema) =>
     Effect.gen(function* () {
       // Get the procedure's payload schema
       const rpc = procedures.get(tag)
       const encodedPayload = yield* Schema.encode(rpc.payloadSchema)(payload)
       
       const request = new Transport.TransportRequest({
         id: Transport.generateRequestId(),
         tag,
         payload: encodedPayload,
       })
       // ...
     })
   ```

2. **Replace orElseSucceed with orDie in server encoding**:
   ```typescript
   // Instead of silent fallback, fail loudly
   Schema.encode(procedure.successSchema)(value).pipe(
     Effect.orDie,  // Encoding failure = bug, should crash
     Effect.map((encodedValue) => new Transport.Success(...))
   )
   ```

3. **Consider Exit schema for responses**:
   ```typescript
   // Create exit schema that combines success, error, and defect
   const responseSchema = Schema.Exit({
     success: procedure.successSchema,
     failure: procedure.errorSchema,
     defect: Schema.Defect,
   })
   ```

### Medium Priority

4. **Cache encoding/decoding functions per procedure**:
   ```typescript
   const schemasCache = new WeakMap<Procedure.Any, {
     decode: (u: unknown) => Effect.Effect<...>,
     encodeSuccess: (u: unknown) => Effect.Effect<...>,
     encodeError: (u: unknown) => Effect.Effect<...>,
   }>()
   ```

5. **Consider stream encoding for StreamChunk responses**:
   ```typescript
   // Instead of raw chunk
   new Transport.StreamChunk({ id, chunk: value })
   
   // Encode the chunk
   const encodedChunk = yield* Schema.encode(procedure.successSchema)(value)
   new Transport.StreamChunk({ id, chunk: encodedChunk })
   ```

### Low Priority

6. **Add schema context propagation** using FiberRef for complex schemas with context requirements.

7. **Consider RpcSerialization-style abstraction** for transport-level encoding (JSON, MsgPack, etc.) separate from Schema encoding.

## Code Examples to Study

| File | Line | Pattern |
|------|------|---------|
| RpcClient.ts | 670 | Client payload encoding |
| RpcClient.ts | 734 | Exit schema decoding |
| RpcServer.ts | 569-574 | Schema cache construction |
| RpcServer.ts | 588-606 | handleEncode helper |
| Rpc.ts | 745-767 | exitSchema factory |
| RpcSchema.ts | 63-93 | Bidirectional stream schema |

## Conclusion

Effect RPC's approach to encoding is more robust than our current implementation:

1. **Symmetric**: Both client and server encode outgoing data and decode incoming data
2. **Explicit**: No silent fallbacks - encoding failures are visible
3. **Structured**: Uses Exit schema to distinguish success/failure/defect
4. **Efficient**: Caches encoders/decoders per procedure
5. **Context-aware**: Propagates schema context during encoding

We should adopt these patterns to ensure type safety across the wire.
