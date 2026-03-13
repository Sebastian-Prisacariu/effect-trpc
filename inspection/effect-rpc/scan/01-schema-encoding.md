# Schema Encoding Error Handling in Effect RPC

## Overview

Effect RPC has a **comprehensive, typed encoding error handling system**. Encoding failures are **never silently returned as raw values**. Instead, they are either:

1. **Propagated as defects** (via `Effect.orDie`)
2. **Converted to typed RpcClientError/defect messages**
3. **Handled through the cause system** with proper cleanup

## Key Encoding Patterns

### 1. Client-Side Payload Encoding (RpcClient.ts:670-681)

```typescript
// Client encodes payload before sending
return Schema.encode(rpc.payloadSchema)(message.payload).pipe(
  Effect.locally(FiberRef.currentContext, entry.context),
  Effect.orDie,  // <-- Encoding errors become defects (will crash)
  Effect.flatMap((payload) =>
    send({
      ...message,
      id: String(message.id),
      payload,
      headers: Object.entries(message.headers)
    }, collector && collector.unsafeClear())
  )
) as Effect.Effect<void, RpcClientError>
```

**Pattern**: `Effect.orDie` - encoding failures kill the fiber

### 2. Server-Side Response Encoding (RpcServer.ts:588-606)

```typescript
const handleEncode = <A, R>(
  client: Client,
  requestId: RequestId,
  encodeDefect: (u: unknown) => Effect.Effect<unknown, ParseError>,
  collector: Transferable.CollectorService | undefined,
  effect: Effect.Effect<A, ParseError, R>,
  onSuccess: (a: A) => FromServerEncoded
) =>
  (collector ? Effect.provideService(effect, Transferable.Collector, collector) : effect).pipe(
    Effect.flatMap((a) => send(client.id, onSuccess(a), collector && collector.unsafeClear())),
    Effect.catchAllCause((cause) => {
      client.schemas.delete(requestId)
      const defect = Cause.squash(Cause.map(cause, TreeFormatter.formatErrorSync))
      return Effect.zipRight(
        sendRequestDefect(client, requestId, encodeDefect, defect),
        server.write(client.id, { _tag: "Interrupt", requestId, interruptors: [] })
      )
    })
  )
```

**Pattern**: 
- Catch ALL causes (including encoding failures)
- Format errors with `TreeFormatter.formatErrorSync`
- Send defect message to client
- Interrupt the request

### 3. Decoding Incoming Requests (RpcServer.ts:673-696)

```typescript
return Effect.matchEffect(
  Effect.provide(schemas.decode(request.payload), schemas.context),
  {
    onFailure: (error) =>
      sendRequestDefect(client, requestId, schemas.encodeDefect, TreeFormatter.formatErrorSync(error)),
    onSuccess: (payload) => {
      client.schemas.set(requestId, supportsTransferables ? {...schemas, collector: ...} : schemas)
      return server.write(clientId, {...request, id: requestId, payload, headers: Headers.fromInput(request.headers)} as any)
    }
  }
)
```

**Pattern**: Decode failures -> formatted defect sent to client

### 4. Stream Schema Parsing (RpcSchema.ts:97-120)

```typescript
const parseStream = <A, E, RA, RE>(
  decodeSuccess: (u: Chunk<unknown>, overrideOptions?: AST.ParseOptions) => Effect.Effect<Chunk<A>, ParseResult.ParseIssue, RA>,
  decodeFailure: (u: unknown, overrideOptions?: AST.ParseOptions) => Effect.Effect<E, ParseResult.ParseIssue, RE>
) =>
(u: unknown, options: AST.ParseOptions, ast: AST.AST) =>
  Effect.flatMap(
    Effect.context<RA | RE>(),
    (context) => {
      if (!isStream(u)) return Effect.fail(new ParseResult.Type(ast, u))
      return Effect.succeed(u.pipe(
        Stream_.mapChunksEffect((value) => decodeSuccess(value, options)),
        Stream_.catchAll((error) => {
          if (ParseResult.isParseError(error)) return Stream_.die(error)  // <-- Parse errors die
          return Effect.matchEffect(decodeFailure(error, options), {
            onFailure: Effect.die,   // <-- Failures die
            onSuccess: Effect.fail   // <-- Success becomes typed error
          })
        }),
        Stream_.provideContext(context)
      ))
    }
  )
```

**Pattern**: Parse errors in streams become `die` (fiber-killing defects)

## Error Types

### RpcClientError (RpcClientError.ts:22-31)

```typescript
export class RpcClientError extends Schema.TaggedError<RpcClientError>("@effect/rpc/RpcClientError")("RpcClientError", {
  reason: Schema.Literal("Protocol", "Unknown"),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
}) {
  readonly [TypeId]: TypeId = TypeId
}
```

Used for:
- Protocol errors (decoding failures, transport errors)
- Unknown errors (unexpected conditions)

### Defect Messages (RpcMessage.ts, RpcSerialization.ts)

```typescript
interface ResponseDefectEncoded {
  readonly _tag: "Defect"
  readonly defect: unknown
}
```

Sent when:
- Server encounters unhandled error
- Encoding fails
- Schema validation fails

## Serialization Layer Error Handling (RpcSerialization.ts)

### JSON-RPC Error Encoding (lines 292-324)

```typescript
case "Exit":
  return {
    jsonrpc: "2.0",
    id: response.requestId ? Number(response.requestId) : undefined,
    result: response.exit._tag === "Success" ? response.exit.value : undefined,
    error: response.exit._tag === "Failure" ?
      {
        _tag: "Cause",
        code: response.exit.cause._tag === "Fail" && hasProperty(response.exit.cause.error, "code")
          ? Number(response.exit.cause.error.code) : 0,
        message: response.exit.cause._tag === "Fail" && hasProperty(response.exit.cause.error, "message")
          ? response.exit.cause.error.message
          : JSON.stringify(response.exit.cause),
        data: response.exit.cause
      } :
      undefined
  }
case "Defect":
  return {
    jsonrpc: "2.0",
    id: jsonRpcInternalError,  // -32603
    error: {
      _tag: "Defect",
      code: 1,
      message: "A defect occurred",
      data: response.defect
    }
  }
```

**Pattern**: Full cause data preserved in `data` field

## Schema Usage Patterns

### Exit Schema with Defect Support (Rpc.ts:745-767)

```typescript
export const exitSchema = <R extends Any>(self: R): Schema.Schema<Exit<R>, ExitEncoded<R>, Context<R>> => {
  if (exitSchemaCache.has(self)) {
    return exitSchemaCache.get(self) as any
  }
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
    defect: rpc.defectSchema  // <-- Custom defect schema!
  })
  exitSchemaCache.set(self, schema)
  return schema as any
}
```

**Key**: Each RPC can define its own `defectSchema` for encoding unexpected errors.

## Comparison with effect-trpc Silent Failures

### effect-trpc Problem

```typescript
// Hypothetical effect-trpc pattern
const encoded = Schema.encodeUnknownSync(schema)(value)
// If this throws, raw value might be returned
```

### Effect RPC Solution

1. **Never use sync encoding for wire data** - always Effect-based
2. **All encoding paths have explicit error handlers**
3. **Errors become typed defect messages**
4. **Cause system preserves full error context**

## Critical Differences

| Aspect | Effect RPC | Silent Failure Pattern |
|--------|-----------|------------------------|
| Encoding errors | `Effect.orDie` or caught | Raw value returned |
| Error visibility | RpcClientError / Defect | No error indication |
| Type safety | Preserved through Exit | Lost |
| Debugging | Full cause chain | Hidden |
| Client notification | Explicit defect message | None |

## Recommendations for effect-trpc

1. **Use `Effect.orDie`** for encoding that should never fail
2. **Use `Effect.catchAllCause`** to handle encoding failures
3. **Send typed error responses** when encoding fails
4. **Never silently return raw values**
5. **Format errors** with `TreeFormatter.formatErrorSync`
6. **Support custom defect schemas** per procedure

## Code Patterns to Adopt

### Safe Encoding Pattern

```typescript
const encodeResponse = <A>(schema: Schema.Schema<A>, value: A) =>
  Schema.encode(schema)(value).pipe(
    Effect.catchAllCause((cause) =>
      Effect.succeed({
        _tag: "EncodingError" as const,
        cause: Cause.squash(cause),
        formatted: TreeFormatter.formatErrorSync(Cause.squash(cause))
      })
    )
  )
```

### Response Encoding with Fallback

```typescript
const sendResponse = (client: Client, response: Response) =>
  encodeResponse(responseSchema, response).pipe(
    Effect.flatMap((encoded) => 
      encoded._tag === "EncodingError"
        ? sendDefect(client, encoded.formatted)
        : send(client, encoded)
    )
  )
```
