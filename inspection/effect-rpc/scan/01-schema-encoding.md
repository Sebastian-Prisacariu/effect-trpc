# Effect RPC Schema Encoding Patterns

## Overview

Effect RPC uses a sophisticated schema encoding/decoding system with proper error propagation. This document analyzes how Effect RPC handles encoding failures and compares it to the current `orElseSucceed` fallback pattern in effect-trpc.

## Key Finding: Effect RPC Does NOT Use `orElseSucceed`

Effect RPC propagates encoding errors as defects, ensuring failures are visible rather than silently swallowed.

---

## 1. Server-Side Encoding Pattern

### Location: `RpcServer.ts:588-606`

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

**Key observations:**
1. **No fallback**: Encoding failures are caught and converted to defects
2. **Error formatting**: Uses `TreeFormatter.formatErrorSync` for readable error messages
3. **Client notification**: Sends defect to client AND interrupts the request
4. **Request cleanup**: Deletes schema entry to prevent memory leaks

### Encoding Flow

```
Handler Result
    |
    v
[Schema.encode] -----> Success: Send encoded response
    |
    v (ParseError)
[catchAllCause]
    |
    v
[sendRequestDefect] --> Client receives defect with formatted message
    |
    v
[server.write(Interrupt)] --> Request terminated
```

---

## 2. Schema Setup Pattern

### Location: `RpcServer.ts:563-580`

```typescript
const getSchemas = (rpc: Rpc.AnyWithProps) => {
  let schemas = schemasCache.get(rpc)
  if (!schemas) {
    const entry = context.unsafeMap.get(rpc.key) as Rpc.Handler<Rpcs["_tag"]>
    const streamSchemas = RpcSchema.getStreamSchemas(rpc.successSchema.ast)
    schemas = {
      decode: Schema.decodeUnknown(rpc.payloadSchema as any),
      encodeChunk: Schema.encodeUnknown(
        Schema.Array(Option.isSome(streamSchemas) ? streamSchemas.value.success : Schema.Any)
      ) as any,
      encodeExit: Schema.encodeUnknown(Rpc.exitSchema(rpc as any)) as any,
      encodeDefect: Schema.encodeUnknown(rpc.defectSchema) as any,
      context: entry.context
    }
    schemasCache.set(rpc, schemas)
  }
  return schemas
}
```

**Key observations:**
1. **Cached schemas**: Performance optimization with WeakMap
2. **Separate encoders**: Different encoders for chunks, exits, and defects
3. **Custom defect schema**: Each RPC can define its own defect encoding via `rpc.defectSchema`

---

## 3. Defect Encoding & Transmission

### Location: `RpcServer.ts:608-641`

```typescript
const encodeDefect = Schema.encodeSync(Schema.Defect)

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
    (cause) => sendDefect(client, Cause.squash(cause))
  )

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

**Two-tier defect handling:**
1. **Request-level defect**: Wrapped in Exit with Die cause (per-request)
2. **Connection-level defect**: Broadcasted as Defect message (affects all requests)

---

## 4. Payload Decoding Pattern

### Location: `RpcServer.ts:673-696`

```typescript
return Effect.matchEffect(
  Effect.provide(schemas.decode(request.payload), schemas.context),
  {
    onFailure: (error) =>
      sendRequestDefect(client, requestId, schemas.encodeDefect, TreeFormatter.formatErrorSync(error)),
    onSuccess: (payload) => {
      client.schemas.set(
        requestId,
        supportsTransferables ?
          { ...schemas, collector: Transferable.unsafeMakeCollector() } :
          schemas
      )
      return server.write(clientId, {
        ...request,
        id: requestId,
        payload,
        headers: Headers.fromInput(request.headers)
      } as any)
    }
  }
)
```

**Key observations:**
1. **Immediate error propagation**: Decode failures become defects
2. **Human-readable errors**: Uses `TreeFormatter.formatErrorSync`
3. **No silent failures**: Client always receives notification

---

## 5. Client-Side Pattern

### Location: `RpcClient.ts:713-741`

```typescript
case "Exit": {
  const requestId = RequestId(message.requestId)
  const entry = entries.get(requestId)
  if (!entry) return Effect.void
  entries.delete(requestId)
  return Schema.decode(Rpc.exitSchema(entry.rpc as any))(message.exit).pipe(
    Effect.locally(FiberRef.currentContext, entry.context),
    Effect.orDie,  // <-- Decode failures die
    Effect.matchCauseEffect({
      onSuccess: (exit) => write({ _tag: "Exit", clientId: 0, requestId, exit }),
      onFailure: (cause) => write({ _tag: "Exit", clientId: 0, requestId, exit: Exit.failCause(cause) })
    })
  ) as Effect.Effect<void>
}
```

**Key observations:**
1. **`Effect.orDie`**: Decode failures become defects (die)
2. **Cause propagation**: Even decoding failures reach the caller

---

## 6. Comparison with effect-trpc

### Current effect-trpc Pattern (Server/index.ts:249-265)

```typescript
onFailure: (error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.orElseSucceed(() => error),  // <-- Fallback!
    Effect.map((encodedError) => new Transport.Failure({
      id: request.id,
      error: encodedError,
    }))
  ),
onSuccess: (value) =>
  Schema.encode(procedure.successSchema)(value).pipe(
    Effect.orElseSucceed(() => value),  // <-- Fallback!
    Effect.map((encodedValue) => new Transport.Success({
      id: request.id,
      value: encodedValue,
    }))
  ),
```

### Problems with `orElseSucceed`:

| Issue | Description |
|-------|-------------|
| **Silent failures** | Encoding errors are swallowed |
| **Type unsafety** | Raw value may not be JSON-serializable |
| **Hidden bugs** | Schema mismatches go unnoticed |
| **Client confusion** | May receive undecodable data |

---

## 7. Recommendations

### 7.1 Replace `orElseSucceed` with Defect Pattern

```typescript
// BEFORE (effect-trpc)
Schema.encode(procedure.successSchema)(value).pipe(
  Effect.orElseSucceed(() => value),  // BAD: silent failure
  Effect.map((v) => new Transport.Success({ id, value: v }))
)

// AFTER (Effect RPC pattern)
Schema.encode(procedure.successSchema)(value).pipe(
  Effect.catchAllCause((cause) =>
    Effect.succeed(new Transport.Failure({
      id,
      error: {
        _tag: "EncodingError",
        message: TreeFormatter.formatErrorSync(Cause.squash(cause)),
      },
    }))
  ),
  Effect.map((v) => new Transport.Success({ id, value: v }))
)
```

### 7.2 Add Defect Schema Support

Allow procedures to define custom defect encoding:

```typescript
const myProcedure = Procedure.query({
  payload: MyPayload,
  success: MySuccess,
  error: MyError,
  defect: Schema.Struct({  // New field
    message: Schema.String,
    stack: Schema.optional(Schema.String),
  }),
})
```

### 7.3 Use `Schema.Defect` for Unknown Errors

```typescript
import { Schema } from "effect"

// Schema.Defect handles circular references, functions, etc.
const encodeDefect = Schema.encodeSync(Schema.Defect)

const sendDefect = (error: unknown) =>
  Effect.succeed(new Transport.Failure({
    id,
    error: { _tag: "Defect", defect: encodeDefect(error) },
  }))
```

### 7.4 Separate Exit Encoding for Streams

Effect RPC has distinct exit schemas for streams vs effects:

```typescript
// For effects: Schema.Exit({ success, failure, defect })
// For streams: void success (stream ended), but failures can occur

const exitSchema = Rpc.exitSchema(rpc)  // Computed per-RPC
```

---

## 8. Implementation Priority

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| **High** | Replace `orElseSucceed` with error propagation | Low | Prevents silent failures |
| **Medium** | Add `TreeFormatter` for readable errors | Low | Better debugging |
| **Medium** | Add defect schema support | Medium | Custom error serialization |
| **Low** | Cache compiled schemas | Low | Performance optimization |

---

## 9. Code References

| File | Lines | Description |
|------|-------|-------------|
| `RpcServer.ts` | 588-606 | `handleEncode` - main encoding error handler |
| `RpcServer.ts` | 608-641 | `sendRequestDefect` / `sendDefect` - defect transmission |
| `RpcServer.ts` | 563-580 | `getSchemas` - schema caching |
| `RpcClient.ts` | 713-741 | Client-side exit decoding |
| `RpcMessage.ts` | 243-252 | `ResponseDefectEncoded` - defect message format |
| `Rpc.ts` | 739-767 | `exitSchema` - exit schema construction |
