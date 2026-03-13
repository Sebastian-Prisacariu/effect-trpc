# Effect RPC Error Handling Analysis

## Response Format: Exit-Based (Not Success/Failure Envelopes)

Effect RPC uses **Effect's Exit type** for response encoding, not custom Success/Failure envelopes.

### Wire Format (ResponseExitEncoded)

```typescript
// RpcMessage.ts:208-212
interface ResponseExitEncoded {
  readonly _tag: "Exit"
  readonly requestId: string
  readonly exit: Schema.ExitEncoded<unknown, unknown, unknown>
}
```

The `exit` field uses Effect's standard `Schema.ExitEncoded`:

```typescript
// Effect's Schema.ExitEncoded structure
type ExitEncoded<A, E, Defect> = 
  | { _tag: "Success"; value: A }
  | { _tag: "Failure"; cause: CauseEncoded<E, Defect> }
```

### Response Message Types

```typescript
// RpcMessage.ts:148-163
type FromServer<A> =
  | ResponseChunk<A>    // Stream chunks
  | ResponseExit<A>     // Final result (Exit)
  | ResponseDefect      // Unrecoverable error
  | ClientEnd           // Client disconnected

type FromServerEncoded =
  | ResponseChunkEncoded
  | ResponseExitEncoded
  | ResponseDefectEncoded
  | Pong
  | ClientProtocolError
```

## Error Categories

### 1. Expected Errors (Typed in Rpc Definition)

Defined via `error` schema on Rpc:

```typescript
const myRpc = Rpc.make("myRpc", {
  payload: { id: Schema.String },
  success: Schema.String,
  error: MyCustomError  // <-- Expected errors
})
```

Errors propagate through Exit's Cause:

```typescript
// RpcServer.ts:279-290
onFailure: (cause) => {
  responded = true
  if (!disableFatalDefects && Cause.isDie(cause) && !Cause.isInterrupted(cause)) {
    return sendDefect(client, Cause.squash(cause))
  }
  return options.onFromServer({
    _tag: "Exit",
    clientId: client.id,
    requestId: request.id,
    exit: Exit.failCause(cause)  // Full Cause preserved
  })
}
```

### 2. Defects (Unexpected/Fatal Errors)

Sent as separate message type:

```typescript
// RpcMessage.ts:238-262
interface ResponseDefectEncoded {
  readonly _tag: "Defect"
  readonly defect: unknown  // Schema.Defect encoded
}
```

Defect handling in server:

```typescript
// RpcServer.ts:405-415
const sendDefect = (client: Client, defect: unknown) =>
  Effect.suspend(() => {
    const shouldEnd = client.ended && client.fibers.size === 0
    const write = options.onFromServer({
      _tag: "Defect",
      clientId: client.id,
      defect
    })
    if (!shouldEnd) return write
    return Effect.zipRight(write, endClient(client))
  })
```

### 3. Protocol Errors (Client-Side)

```typescript
// RpcClientError.ts:22-26
class RpcClientError extends Schema.TaggedError<RpcClientError>(
  "@effect/rpc/RpcClientError"
)("RpcClientError", {
  reason: Schema.Literal("Protocol", "Unknown"),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
})
```

Sent to client via:

```typescript
// RpcMessage.ts:218-221
interface ClientProtocolError {
  readonly _tag: "ClientProtocolError"
  readonly error: RpcClientError
}
```

### 4. Middleware Errors

Middleware failures are typed and included in error schema:

```typescript
// Rpc.ts:264-271
type ErrorSchema<R> = R extends Rpc<...> 
  ? _Error | _Middleware  // Middleware errors included
  : never
```

## Exit Schema Construction

Dynamic schema based on Rpc definition:

```typescript
// Rpc.ts:745-767
export const exitSchema = <R extends Any>(self: R) => {
  const rpc = self as any as AnyWithProps
  const failures = new Set<Schema.Schema.All>([rpc.errorSchema])
  
  // Include stream errors if applicable
  const streamSchemas = RpcSchema.getStreamSchemas(rpc.successSchema.ast)
  if (Option.isSome(streamSchemas)) {
    failures.add(streamSchemas.value.failure)
  }
  
  // Include middleware errors
  for (const middleware of rpc.middlewares) {
    failures.add(middleware.failure)
  }
  
  const schema = Schema.Exit({
    success: Option.isSome(streamSchemas) ? Schema.Void : rpc.successSchema,
    failure: Schema.Union(...failures),
    defect: rpc.defectSchema
  })
  
  return schema
}
```

## Key Differences from Success/Failure Envelopes

| Aspect | Success/Failure Envelope | Effect RPC (Exit) |
|--------|-------------------------|-------------------|
| Success | `{ success: true, data }` | `{ _tag: "Success", value }` |
| Error | `{ success: false, error }` | `{ _tag: "Failure", cause }` |
| Cause preservation | No | Yes (full Cause tree) |
| Interruption | Not modeled | `Cause.interrupt` |
| Defects | Flattened to error | `Cause.die` + separate Defect message |
| Multiple errors | No | `Cause.parallel`, `Cause.sequential` |

## Cause Structure in Failures

Effect's Cause enables rich error composition:

```typescript
type CauseEncoded<E, Defect> =
  | { _tag: "Empty" }
  | { _tag: "Fail"; error: E }
  | { _tag: "Die"; defect: Defect }
  | { _tag: "Interrupt"; fiberId: FiberIdEncoded }
  | { _tag: "Sequential"; left: CauseEncoded; right: CauseEncoded }
  | { _tag: "Parallel"; left: CauseEncoded; right: CauseEncoded }
```

## Client-Side Decoding

```typescript
// RpcClient.ts:729-741
case "Exit": {
  const requestId = RequestId(message.requestId)
  const entry = entries.get(requestId)
  if (!entry) return Effect.void
  entries.delete(requestId)
  return Schema.decode(Rpc.exitSchema(entry.rpc))(message.exit).pipe(
    Effect.locally(FiberRef.currentContext, entry.context),
    Effect.orDie,
    Effect.matchCauseEffect({
      onSuccess: (exit) => write({ _tag: "Exit", clientId: 0, requestId, exit }),
      onFailure: (cause) => write({ _tag: "Exit", clientId: 0, requestId, exit: Exit.failCause(cause) })
    })
  )
}
```

## Recommendations for effect-trpc

1. **Use Exit type** instead of custom envelopes for Effect compatibility
2. **Preserve Cause** for interruption/parallel error handling
3. **Separate Defect channel** for fatal errors that clear all pending requests
4. **Schema-based encoding** using `Schema.Exit` for type-safe serialization
5. **RpcClientError** for protocol-level errors distinct from business errors
