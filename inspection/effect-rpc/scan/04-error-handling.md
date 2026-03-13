# Effect RPC Error Handling Analysis

## Overview

This document analyzes the error handling architecture in `@effect/rpc`, examining error encoding, propagation patterns, and contrasting them with our effect-trpc silent fallback patterns.

---

## 1. Error Type Architecture

### RpcClientError (`RpcClientError.ts`)

The primary client-side error type:

```typescript
// Line 22-26
export class RpcClientError extends Schema.TaggedError<RpcClientError>(
  "@effect/rpc/RpcClientError"
)("RpcClientError", {
  reason: Schema.Literal("Protocol", "Unknown"),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
}) {
  readonly [TypeId]: TypeId = TypeId
}
```

**Key Properties:**
- Uses `Schema.TaggedError` for automatic serialization
- `reason` discriminates between protocol errors and unknown failures
- `cause` uses `Schema.Defect` for safe serialization of arbitrary errors

### Middleware Failure Types (`RpcMiddleware.ts`)

Middleware errors are schema-defined and propagate through the type system:

```typescript
// Line 145-155
export type FailureSchema<Options> = Options extends
  { readonly failure: Schema.Schema.All; readonly optional?: false } ? Options["failure"]
  : typeof Schema.Never

export type Failure<Options> = Options extends
  { readonly failure: Schema.Schema<infer _A, infer _I, infer _R>; readonly optional?: false } ? _A
  : never
```

**Key Design:**
- Each middleware declares its failure schema
- Optional middleware failures collapse to `never`
- Type system tracks all possible failure types

---

## 2. Error Encoding Pipeline

### Server-Side (`RpcServer.ts`)

#### Stage 1: Request Handling with Exit Encoding

```typescript
// Line 267-292 - Core request handling
let effect = Effect.matchCauseEffect(
  isUninterruptible ? handler : Effect.interruptible(handler),
  {
    onSuccess: (value) => {
      responded = true
      return options.onFromServer({
        _tag: "Exit",
        clientId: client.id,
        requestId: request.id,
        exit: Exit.succeed(value as any)
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

**Key Design Decisions:**
1. **Exit-based encoding** - Uses `Exit.succeed` / `Exit.failCause` to preserve full error information
2. **Cause preservation** - `Cause` carries full error context, including interruption and parallel failures
3. **Fatal defect handling** - Option to propagate defects separately via `sendDefect`

#### Stage 2: Schema Encoding with Explicit Error Handling

```typescript
// Line 588-606 - Encoding with proper error propagation
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

**Critical Difference from effect-trpc:**
- No silent `orElseSucceed` - encoding failures are explicitly handled
- Uses `TreeFormatter.formatErrorSync` to convert parse errors to readable format
- Interrupts the request on encoding failure (clean termination)

#### Stage 3: Defect Handling

```typescript
// Line 405-415 - Server defect handling
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

**Key Design:**
- Defects are propagated as a distinct message type
- Client connection management is synchronized with defect handling

### Client-Side (`RpcClient.ts`)

#### Response Decoding

```typescript
// Line 729-740 - Exit decoding on client
case "Exit": {
  const requestId = RequestId(message.requestId)
  const entry = entries.get(requestId)
  if (!entry) return Effect.void
  entries.delete(requestId)
  return Schema.decode(Rpc.exitSchema(entry.rpc as any))(message.exit).pipe(
    Effect.locally(FiberRef.currentContext, entry.context),
    Effect.orDie,  // <-- Decoding failures become defects
    Effect.matchCauseEffect({
      onSuccess: (exit) => write({ _tag: "Exit", clientId: 0, requestId, exit }),
      onFailure: (cause) => write({ _tag: "Exit", clientId: 0, requestId, exit: Exit.failCause(cause) })
    })
  )
}
```

**Key Observations:**
1. Uses `Effect.orDie` for decoding - schema mismatches are treated as defects
2. Preserves cause structure through transformation
3. No silent fallbacks - failures propagate properly

#### Defect Handling

```typescript
// Line 743-745 - Client-side defect handling
case "Defect": {
  entries.clear()
  return write({ _tag: "Defect", clientId: 0, defect: decodeDefect(message.defect) })
}
```

**Key Design:**
- Defects clear all pending entries (connection is considered compromised)
- Defect is decoded using `Schema.Defect` for safe handling

---

## 3. Middleware Error Propagation

### Server Middleware Application (`RpcServer.ts`)

```typescript
// Line 423-464 - Middleware error handling
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

  for (const tag of rpc.middlewares) {
    if (tag.wrap) {
      // Wrapping middleware gets full control
      const middleware = Context.unsafeGet(context, tag)
      handler = middleware({ ...options, next: handler as any })
    } else if (tag.optional) {
      // Optional middleware - failure falls back to previous
      const middleware = Context.unsafeGet(context, tag) as RpcMiddleware<any, any>
      const previous = handler
      handler = Effect.matchEffect(middleware(options), {
        onFailure: () => previous,  // Fallback on failure
        onSuccess: tag.provides !== undefined
          ? (value) => Effect.provideService(previous, tag.provides as any, value)
          : (_) => previous
      })
    } else {
      // Required middleware - failure propagates
      const middleware = Context.unsafeGet(context, tag) as RpcMiddleware<any, any>
      handler = tag.provides !== undefined
        ? Effect.provideServiceEffect(handler, tag.provides as any, middleware(options))
        : Effect.zipRight(middleware(options), handler)
    }
  }
  return handler
}
```

**Key Design:**
1. **Optional middleware** - Failures fall back to handler without middleware (explicit)
2. **Required middleware** - Failures propagate (no silent swallowing)
3. **Wrap middleware** - Full control over error handling (Effect composition)

---

## 4. Message Types for Errors (`RpcMessage.ts`)

### Server Response Types

```typescript
// Response types
export type FromServer<A extends Rpc.Any> =
  | ResponseChunk<A>
  | ResponseExit<A>      // Success or typed failure
  | ResponseDefect       // Untyped defect
  | ClientEnd            // Connection cleanup

// Encoded response types
export type FromServerEncoded =
  | ResponseChunkEncoded
  | ResponseExitEncoded
  | ResponseDefectEncoded
  | Pong
  | ClientProtocolError  // Client-side protocol errors
```

**Key Design:**
- `ResponseExit` carries `Exit<Success, Error>` - full Effect error semantics
- `ResponseDefect` is a separate type for untyped failures
- `ClientProtocolError` distinguishes protocol-level issues

### Defect Encoding

```typescript
// Line 243-252 - Safe defect encoding
const encodeDefect = Schema.encodeSync(Schema.Defect)

export const ResponseDefectEncoded = (input: unknown): ResponseDefectEncoded => ({
  _tag: "Defect",
  defect: encodeDefect(input)
})
```

**Key Design:**
- Uses `Schema.Defect` which safely serializes arbitrary values
- Encoding is synchronous (defects shouldn't fail to encode)

---

## 5. Socket/Transport Error Handling (`RpcClient.ts`)

### Protocol Error Propagation

```typescript
// Line 959-1019 - Socket error handling
yield* socket.runRaw((message) => {
  try {
    const responses = parser.decode(message) as Array<FromServerEncoded>
    // ...handle responses
  } catch (defect) {
    return writeResponse({
      _tag: "ClientProtocolError",
      error: new RpcClientError({
        reason: "Protocol",
        message: "Error decoding message",
        cause: Cause.fail(defect)
      })
    })
  }
}, { onOpen: clearCurrentError }).pipe(
  Effect.tapErrorCause((cause) => {
    const error = Cause.failureOption(cause)
    if (
      options?.retryTransientErrors && Option.isSome(error) &&
      (error.value.reason === "Open" || error.value.reason === "OpenTimeout")
    ) {
      return Effect.void
    }
    currentError = new RpcClientError({
      reason: "Protocol",
      message: "Error in socket",
      cause: Cause.squash(cause)
    })
    return writeResponse({
      _tag: "ClientProtocolError",
      error: currentError
    })
  }),
  Effect.retry(options?.retrySchedule ?? defaultRetrySchedule)
)
```

**Key Design:**
1. **Try/catch only at serialization boundary** - Protocol parsing
2. **Explicit error propagation** via `ClientProtocolError` message
3. **Transient error retry** - Socket open failures can be retried
4. **Error state tracking** - `currentError` prevents sending on broken connection

---

## 6. Comparison with effect-trpc

### effect-trpc Silent Fallbacks (from our codebase)

```typescript
// Server/index.ts:252 - PROBLEMATIC
onFailure: (error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.orElseSucceed(() => error),  // Silent fallback!
    Effect.map((encodedError) => new Transport.Failure({...}))
  )
```

### Effect RPC Approach

```typescript
// RpcServer.ts:599-605 - EXPLICIT
Effect.catchAllCause((cause) => {
  client.schemas.delete(requestId)
  const defect = Cause.squash(Cause.map(cause, TreeFormatter.formatErrorSync))
  return Effect.zipRight(
    sendRequestDefect(client, requestId, encodeDefect, defect),
    server.write(client.id, { _tag: "Interrupt", requestId, interruptors: [] })
  )
})
```

**Key Differences:**
| Aspect | effect-trpc | Effect RPC |
|--------|-------------|------------|
| Encoding failure | Silent fallback to raw value | Sends defect + interrupts request |
| Error visibility | Hidden | Explicit via separate message type |
| Type safety | Compromised (raw error sent) | Preserved (`Schema.Defect` encoding) |
| Client impact | May fail to decode | Receives clear defect signal |

---

## 7. Exit Schema Construction (`Rpc.ts`)

Effect RPC constructs typed Exit schemas per-RPC:

```typescript
// Line 745-767 - Exit schema construction
export const exitSchema = <R extends Any>(
  self: R
): Schema.Schema<Exit<R>, ExitEncoded<R>, Context<R>> => {
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
    failures.add(middleware.failure)  // Include middleware failures!
  }
  const schema = Schema.Exit({
    success: Option.isSome(streamSchemas) ? Schema.Void : rpc.successSchema,
    failure: Schema.Union(...failures),  // Union of all error types
    defect: rpc.defectSchema
  })
  exitSchemaCache.set(self, schema)
  return schema as any
}
```

**Key Design:**
1. **Cached per-RPC** - Avoids repeated schema construction
2. **Collects all failure types** - Handler errors + stream errors + middleware errors
3. **Schema.Union** - Type-safe union of all possible errors
4. **Custom defect schema** - Configurable serialization

---

## 8. Key Patterns Summary

### What Effect RPC Does Right

1. **Exit-based error propagation** - Full Effect error semantics preserved
2. **Separate defect channel** - Defects don't corrupt typed error channel
3. **Explicit encoding failure handling** - No silent fallbacks
4. **Type-safe middleware errors** - Failures tracked in type system
5. **Cause preservation** - Interruption and parallel failures handled
6. **Schema.Defect for safe serialization** - Arbitrary values safely encoded

### What effect-trpc Should Change

1. **Replace `orElseSucceed` with explicit defect handling**
   - Send encoding errors as separate message type
   - Don't silently use raw values

2. **Add Exit-based response type**
   - Current `Success | Failure` loses Effect error semantics
   - Should be `Exit<Success, Error>` with separate defect channel

3. **Propagate encoding errors**
   - Current: Silent fallback to raw value
   - Should: Send `EncodingError` or interrupt request

4. **Distinguish protocol vs domain errors**
   - Current: Everything in `TransportError`
   - Should: Separate `ProtocolError` vs `DomainError`

---

## 9. Recommendations for effect-trpc

### High Priority

#### 1. Add Exit-based Response Type

```typescript
// Instead of:
export class Success extends Schema.Class<Success>()("Success", {...}) {}
export class Failure extends Schema.Class<Failure>()("Failure", {...}) {}

// Use:
export type Response<A extends Rpc.Any> =
  | ResponseExit<A>
  | ResponseDefect
```

#### 2. Handle Encoding Failures Explicitly

```typescript
// Instead of:
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.orElseSucceed(() => error)  // Silent!
)

// Use:
Schema.encode(procedure.errorSchema)(error).pipe(
  Effect.catchAll((encodeError) =>
    sendDefect(request.id, {
      _tag: "EncodingError",
      original: error,
      encodeError: TreeFormatter.formatErrorSync(encodeError)
    })
  )
)
```

#### 3. Add Defect Message Type

```typescript
export interface ResponseDefect {
  readonly _tag: "Defect"
  readonly requestId: string
  readonly defect: unknown  // Encoded via Schema.Defect
}
```

### Medium Priority

#### 4. Track Middleware Errors in Types

```typescript
// Each middleware declares its failure type
class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  { failure: AuthError }  // Type-tracked!
) {}
```

#### 5. Use Cause for Full Error Context

```typescript
// Server sends:
exit: Exit.failCause(cause)  // Preserves full context

// Client receives:
Effect.matchCauseEffect(exit, {...})  // Can inspect Cause
```

---

## Summary

Effect RPC takes a fundamentally different approach to error handling:

| Aspect | effect-trpc | Effect RPC |
|--------|-------------|------------|
| Error model | `Success | Failure` | `Exit<Success, Error>` + Defect |
| Encoding failures | Silent fallback | Explicit defect propagation |
| Error types | Single `TransportError` | Domain + Protocol + Defect |
| Middleware errors | Not tracked | Type-safe via `failure` schema |
| Cause preservation | Lost | Full Effect semantics |
| Schema mismatches | Silent corruption | Explicit defect |

**Key Takeaway:** Effect RPC's error handling is more verbose but never loses information. The explicit defect channel and Exit-based responses preserve full Effect error semantics, while effect-trpc's silent fallbacks can cause hard-to-debug issues.
