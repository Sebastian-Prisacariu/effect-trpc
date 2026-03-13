# Effect RPC Error Handling Analysis

## H4: Error encoding patterns

**Key Question:** Our effect-trpc has silent fallbacks when error encoding fails. What does Effect RPC do?

---

## Error Encoding Pipeline

### 1. Server-Side Error Flow

The server has a multi-stage error handling pipeline in `RpcServer.ts`:

```typescript
// Stage 1: Handler execution with cause matching
Effect.matchCauseEffect(
  isUninterruptible ? handler : Effect.interruptible(handler),
  {
    onSuccess: (value) => {
      responded = true
      return options.onFromServer({
        _tag: "Exit",
        clientId: client.id,
        requestId: request.id,
        exit: Exit.succeed(value)
      })
    },
    onFailure: (cause) => {
      responded = true
      if (!disableFatalDefects && Cause.isDie(cause) && !Cause.isInterrupted(cause)) {
        return sendDefect(client, Cause.squash(cause))
      }
      return options.onFromServer({
        _tag: "Exit",
        clientId: client.id,
        requestId: request.id,
        exit: Exit.failCause(cause)
      })
    }
  }
)
```

### 2. Encoding with Fallback to Defect

When encoding succeeds or fails (`RpcServer.ts:588-606`):

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

**Key insight:** When encoding fails, it:
1. Formats the error using `TreeFormatter.formatErrorSync`
2. Sends a defect response
3. Interrupts the request

### 3. Defect Sending with Nested Fallback

```typescript
const sendRequestDefect = (
  client: Client,
  requestId: RequestId,
  encodeDefect: (u: unknown) => Effect.Effect<unknown, ParseError>,
  defect: unknown
) =>
  Effect.catchAllCause(
    encodeDefect(defect).pipe(Effect.flatMap((encodedDefect) =>
      send(client.id, {
        _tag: "Exit",
        requestId: String(requestId),
        exit: {
          _tag: "Failure",
          cause: {
            _tag: "Die",
            defect: encodedDefect
          }
        }
      })
    )),
    (cause) => sendDefect(client, Cause.squash(cause))  // <-- fallback to global defect
  )
```

### 4. Global Defect Handler (Last Resort)

```typescript
const sendDefect = (client: Client, defect: unknown) =>
  Effect.catchAllCause(
    send(client.id, { _tag: "Defect", defect: encodeDefect(defect) }),
    (cause) =>
      Effect.annotateLogs(Effect.logDebug(cause), {
        module: "RpcServer",
        method: "sendDefect"
      })
  )
```

**Critical behavior:** If even defect encoding fails, it **logs the error** rather than silently dropping it.

---

## Error Types and Schemas

### RpcClientError

```typescript
// RpcClientError.ts
export class RpcClientError extends Schema.TaggedError<RpcClientError>(
  "@effect/rpc/RpcClientError"
)("RpcClientError", {
  reason: Schema.Literal("Protocol", "Unknown"),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
}) {}
```

### Response Messages

```typescript
// RpcMessage.ts - Error response types
interface ResponseExitEncoded {
  readonly _tag: "Exit"
  readonly requestId: string
  readonly exit: Schema.ExitEncoded<unknown, unknown, unknown>
}

interface ResponseDefectEncoded {
  readonly _tag: "Defect"
  readonly defect: unknown
}

interface ClientProtocolError {
  readonly _tag: "ClientProtocolError"
  readonly error: RpcClientError
}
```

### Exit Schema Construction

Each RPC has a typed exit schema built from error + middleware failures:

```typescript
// Rpc.ts:745-767
export const exitSchema = <R extends Any>(self: R) => {
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
  return schema
}
```

---

## Encoding Failure Handling - Key Patterns

### 1. Schema.Defect for Serialization Safety

```typescript
// RpcMessage.ts:243-252
const encodeDefect = Schema.encodeSync(Schema.Defect)

export const ResponseDefectEncoded = (input: unknown): ResponseDefectEncoded => ({
  _tag: "Defect",
  defect: encodeDefect(input)
})
```

`Schema.Defect` handles arbitrary unknown values safely, ensuring even non-serializable errors can be encoded.

### 2. Protocol-Level Error Recovery in Serialization

```typescript
// RpcSerialization.ts - Socket protocol
const write = (response: FromServerEncoded) => {
  try {
    const encoded = parser.encode(response)
    if (encoded === undefined) return Effect.void
    return Effect.orDie(writeRaw(encoded))
  } catch (cause) {
    return Effect.orDie(
      writeRaw(parser.encode(ResponseDefectEncoded(cause))!)
    )
  }
}
```

When encoding fails, it wraps the encoding error as a defect.

### 3. Client-Side Defect Decoding

```typescript
// RpcClient.ts:1256
const decodeDefect = Schema.decodeSync(Schema.Defect)

// Used in message handling:
case "Defect": {
  entries.clear()
  return write({ _tag: "Defect", clientId: 0, defect: decodeDefect(message.defect) })
}
```

---

## Comparison with Potential Silent Fallbacks

Effect RPC **never silently drops errors**. Instead:

| Scenario | Effect RPC Behavior |
|----------|-------------------|
| Handler throws | Sends `Exit` with `failCause` |
| Handler defect (die) | Sends `Defect` message |
| Success encoding fails | Sends `Defect` + interrupts request |
| Error encoding fails | Falls back to `sendDefect` with raw error |
| Defect encoding fails | **Logs the error** (annotated with module/method) |
| Protocol error | Sends `ClientProtocolError` to all pending requests |

---

## Recommendations for effect-trpc

### 1. Never Silently Drop Errors

Replace any silent fallbacks with explicit error propagation:

```typescript
// Bad
const encoded = tryEncode(error)
if (!encoded) return // silently drops!

// Good (Effect RPC pattern)
const encoded = pipe(
  encodeError(error),
  Effect.catchAllCause((cause) =>
    sendDefect(TreeFormatter.formatErrorSync(cause))
  )
)
```

### 2. Use Schema.Defect for Safety

Always use `Schema.Defect` for encoding arbitrary errors:

```typescript
const defectSchema = Schema.Defect
const encodeDefect = Schema.encodeSync(defectSchema)
```

### 3. Implement Layered Error Handling

```typescript
// Layer 1: Try to encode typed error
// Layer 2: Fall back to defect message
// Layer 3: Log if defect encoding fails (never silent)
```

### 4. Create Explicit Error Types

Define protocol-level error types like Effect RPC's `RpcClientError`:

```typescript
class TrpcEffectError extends Schema.TaggedError<TrpcEffectError>()(
  "TrpcEffectError",
  {
    reason: Schema.Literal("Protocol", "Encoding", "Unknown"),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }
) {}
```

### 5. Log All Unrecoverable Errors

```typescript
Effect.catchAllCause(
  sendError(error),
  (cause) =>
    Effect.annotateLogs(Effect.logDebug(cause), {
      module: "TrpcEffect",
      method: "sendError"
    })
)
```

---

## Summary

Effect RPC's error handling is **robust and observable**:

1. **No silent failures** - Every error path either propagates or logs
2. **Typed errors** - Uses `Schema.TaggedError` for protocol errors
3. **Defect fallback** - `Schema.Defect` handles arbitrary errors safely
4. **Layered recovery** - Multiple fallback levels with explicit behavior
5. **Observable** - Logs with annotations when all else fails

The key architectural insight: Effect RPC treats encoding failures as **protocol-level defects**, not as something to silently ignore. This ensures developers are always aware of issues rather than having them masked.
