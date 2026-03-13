# Effect Patterns Compliance Analysis

**Analyzed:** 2026-03-13
**Scope:** effect-trpc codebase (`/Users/sebastian/Documents/tRPC-Effect`)

## Summary

| Rule | Status | Details |
|------|--------|---------|
| No async/await | **PARTIAL VIOLATION** | Found in examples/benchmarks, acceptable in docs |
| No try/catch | **VIOLATION** | 2 occurrences in source code |
| Never throw | **VIOLATION** | 6 occurrences in source code |
| No decodeUnknownSync | **PASS** | None found |
| Use Effect.fn | **NOT USED** | Missing tracing spans |
| Branded types for IDs | **NOT USED** | Request IDs are plain strings |
| Context.Tag usage | **GOOD** | Correctly used throughout |
| No JSON.parse | **PASS** | None found directly |
| No @ts-ignore | **PASS** | None found |
| Avoid `as` assertions | **PARTIAL** | Heavy use but necessary for type inference |

---

## 1. Async/Await Usage

### Violations Found
**Location:** `examples/desired-api.ts:246-260`
```typescript
async function fetchUsers() {
  const users = await vanillaApi.users.list.runPromise()
}
async function UsersPage() {
  await vanillaApi.users.list.prefetch()
}
```

**Assessment:** These are in example files demonstrating how the API would be used from outside Effect contexts (e.g., Next.js Server Components). This is **acceptable** for documentation purposes - the `runPromise()` method intentionally provides an async escape hatch.

### Also Found
- `test/transport.test.ts:44-46` - Testing async headers function (intentional API feature)
- `packages/effect-trpc/benchmark/` - Vanilla tRPC comparison benchmarks (intentional)

**Verdict:** **ACCEPTABLE** - async/await usage is isolated to:
1. Example/documentation code showing vanilla JS interop
2. Tests for async header functions (a valid transport feature)
3. Benchmark comparisons with vanilla tRPC

---

## 2. Try/Catch Usage

### VIOLATION at `src/Reactivity/index.ts:193-198`
```typescript
for (const callback of callbacksToInvoke) {
  try {
    callback()
  } catch (error) {
    // Don't let one callback error stop others
    console.error("[Reactivity] Callback error:", error)
  }
}
```

**Issue:** Callbacks are synchronous user-provided functions. Error handling is done with try/catch instead of Effect patterns.

**Recommendation:** Convert to Effect-based error handling:
```typescript
// Option 1: Wrap callbacks in Effect.try
for (const callback of callbacksToInvoke) {
  Effect.try({
    try: () => callback(),
    catch: (error) => new ReactivityCallbackError({ cause: error })
  }).pipe(
    Effect.catchAll((e) => Effect.logError("[Reactivity] Callback error:", e))
  )
}

// Option 2: Since this is a sync-only service, use Effect.runSync with fallback
Effect.runSync(
  Effect.forEach(Array.from(callbacksToInvoke), (cb) =>
    Effect.try({ try: () => cb(), catch: identity }).pipe(
      Effect.catchAll((e) => Effect.logError("[Reactivity]", e))
    ),
    { discard: true }
  )
)
```

### Also Found
- `benchmarks/generate.ts:244` - Benchmark script (not production code, acceptable)

---

## 3. Throw Statements

### VIOLATION at `src/Client/index.ts:637,672`
```typescript
runPromise: runtime
  ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
  : () => { throw new Error("runPromise requires a bound runtime. Use api.provide(layer) first.") },
```

**Issue:** Throwing errors for unbound client usage instead of returning Effect with proper error types.

**Current pattern:**
```typescript
throw new Error("runPromise requires a bound runtime...")
```

**Recommendation:** Since `runPromise` returns a `Promise`, we can't return an Effect. However, the throw could be avoided:
```typescript
// Option 1: Reject the promise instead of throwing
runPromise: runtime
  ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
  : () => Promise.reject(new UnboundClientError({ message: "..." })),

// Option 2: Make the type conditional to prevent calling on unbound clients
// This requires API redesign
```

### VIOLATION at `src/Client/index.ts:685`
```typescript
throw new Error(`Unknown procedure type: ${(procedure as any)._tag}`)
```

**Issue:** This is a programming error (shouldn't happen at runtime if types are correct). Could use `absurd` pattern.

**Recommendation:**
```typescript
import { absurd } from "effect/Function"
// At the call site, use exhaustive type checking instead
```

### VIOLATION at `src/Client/index.ts:726,736,746`
```typescript
throw new Error("useQuery requires React...")
throw new Error("useMutation requires React...")
throw new Error("useStream requires React...")
```

**Issue:** These are stub implementations for React hooks.

**Assessment:** These are placeholders for React hooks that will be implemented separately. The throws indicate missing React integration, which is expected during development.

---

## 4. Schema.decodeUnknownSync Usage

**Status:** **PASS** - No `decodeUnknownSync` found anywhere in the codebase.

All schema decoding correctly uses `Schema.decodeUnknown()`:

- `src/Transport/index.ts:342` - HTTP response decoding
- `src/Server/index.ts:240,332` - Payload decoding
- `src/Client/index.ts:119,127,156,164` - Response/error decoding

**Good pattern observed:**
```typescript
const decoded = yield* Schema.decodeUnknown(TransportResponse)(json).pipe(
  Effect.mapError((cause) =>
    new TransportError({
      reason: "Protocol",
      message: "Invalid response envelope",
      cause,
    })
  )
)
```

---

## 5. Effect.fn Usage for Tracing

**Status:** **NOT USED** - No `Effect.fn` found in the codebase.

**Current pattern:** Functions return Effects directly:
```typescript
const sendHttp = (url: string, request: TransportRequest, ...): Effect.Effect<...> =>
  Effect.gen(function* () { ... })
```

**Recommended pattern:**
```typescript
const sendHttp = Effect.fn("Transport.sendHttp")(
  (url: string, request: TransportRequest, ...) =>
    Effect.gen(function* () { ... })
)
```

**Impact:** Missing automatic span tracing for debugging and observability.

**Recommendation:** Add `Effect.fn` wrapper to key functions:
- `Transport.sendHttp`
- `Server.handle`
- `Server.handleStream`
- `Client.send`
- `Middleware.execute`

---

## 6. Branded Types for IDs

**Status:** **NOT USED**

**Current pattern:**
```typescript
export class TransportRequest extends Schema.Class<TransportRequest>("TransportRequest")({
  id: Schema.String,  // Plain string
  tag: Schema.String,
  payload: Schema.Unknown,
})
```

**Recommended pattern:**
```typescript
const RequestId = Schema.String.pipe(Schema.brand("RequestId"))
type RequestId = Schema.Schema.Type<typeof RequestId>

export class TransportRequest extends Schema.Class<TransportRequest>("TransportRequest")({
  id: RequestId,
  tag: Schema.String,
  payload: Schema.Unknown,
})
```

**Impact:** Cannot distinguish request IDs from other strings at type level.

---

## 7. Context.Tag Usage

**Status:** **GOOD** - Correct pattern used throughout.

**Examples of good usage:**

```typescript
// src/Transport/index.ts:184
export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}

// src/Reactivity/index.ts:115
export class Reactivity extends Context.Tag("@effect-trpc/Reactivity")<
  Reactivity,
  ReactivityService
>() {}

// src/Client/index.ts:90
export class ClientServiceTag extends Context.Tag("@effect-trpc/ClientService")<
  ClientServiceTag,
  ClientService
>() {}
```

All services properly use `Context.Tag` to separate interface from implementation.

---

## 8. JSON.parse Usage

**Status:** **PASS** - No direct `JSON.parse` found.

The codebase uses `response.json()` from fetch (returns Promise), which is acceptable. For structured parsing, Schema decoding is used:
```typescript
const json = yield* Effect.tryPromise({
  try: () => response.json(),
  catch: (cause) => new TransportError({ ... })
})
const decoded = yield* Schema.decodeUnknown(TransportResponse)(json)
```

---

## 9. @ts-ignore Usage

**Status:** **PASS** - None found.

---

## 10. Type Assertions (`as`)

**Status:** **HEAVY USE** - But mostly necessary for complex type inference.

### Acceptable Uses

**Type inference limitations:**
```typescript
// src/Server/index.ts:248 - Handler return type
const handlerEffect = (handler(payload) as Effect.Effect<unknown, unknown, R>)

// src/Middleware/index.ts:352 - Generic middleware execution
const impl = yield* middleware as any as Context.Tag<any, MiddlewareImpl<...>>
```

These are necessary due to TypeScript's limitations with complex recursive types and Effect's generic type parameters.

**Test file assertions:**
```typescript
// test/e2e/suite.ts - Type assertions in tests for result inspection
expect((users as User[]).length).toBe(2)
```

### Concerning Uses

```typescript
// src/Server/index.ts:388-390
id: (body as any).id ?? Transport.generateRequestId(),
tag: (body as any).tag ?? "",
payload: (body as any).payload,
```

**Issue:** Using `as any` to access properties without validation.

**Recommendation:** Use Schema.decodeUnknown:
```typescript
const RequestBody = Schema.Struct({
  id: Schema.optional(Schema.String),
  tag: Schema.optional(Schema.String),
  payload: Schema.Unknown,
})
const body = yield* Schema.decodeUnknown(RequestBody)(rawBody)
```

---

## 11. Layer Usage

**Status:** **GOOD** - Proper Layer patterns used.

**Examples:**
```typescript
// src/Transport/index.ts
export const http = (...): Layer.Layer<Transport, never, never> => {
  return Layer.succeed(Transport, { ... })
}

// src/Client/index.ts
export const ClientServiceLive: Layer.Layer<ClientServiceTag, never, Transport.Transport> = 
  Layer.effect(ClientServiceTag, Effect.gen(function* () { ... }))

// src/Reactivity/index.ts
export const ReactivityLive: Layer.Layer<Reactivity> = 
  Layer.sync(Reactivity, make)
```

---

## 12. Resource Management (acquireRelease)

**Status:** **NOT USED** - No `Effect.acquireRelease` found.

**Assessment:** The codebase currently doesn't have long-lived resources that require cleanup. However, for future streaming/WebSocket transports, proper resource management will be needed:

```typescript
// Future WebSocket transport should use:
const wsTransport = Effect.acquireRelease(
  Effect.sync(() => new WebSocket(url)),
  (ws) => Effect.sync(() => ws.close())
)
```

---

## 13. Error Modeling

**Status:** **GOOD** - Schema.TaggedError used throughout.

**Examples:**
```typescript
// src/Transport/index.ts:65
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

// Test fixtures show proper domain error modeling
class NotFoundError extends Schema.TaggedError<NotFoundError>("NotFoundError")({
  entity: Schema.String,
  id: Schema.String,
})
```

### Missing Pattern from CLAUDE.md

The CLAUDE.md recommends a `message` getter pattern:
```typescript
class MyError extends Schema.TaggedError<MyError>()(
  'MyError',
  {
    module: Schema.String,
    method: Schema.String,
    description: Schema.optional(Schema.String),
  }
) {
  get message(): string {
    return `${this.module}.${this.method}: ${this.description ?? 'Failed'}`
  }
}
```

**Current TransportError doesn't follow this pattern.** Consider adding:
```typescript
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {
  get message(): string {
    return `Transport.${this.reason}: ${this.message}`
  }
}
```

---

## Recommendations Summary

### High Priority

1. **Remove throw statements in Client** (`src/Client/index.ts:637,672,685,726,736,746`)
   - Replace with `Promise.reject()` or proper Effect error types
   - Consider compile-time prevention for unbound client calls

2. **Replace try/catch in Reactivity** (`src/Reactivity/index.ts:193`)
   - Use `Effect.try` or `Effect.forEach` with error recovery

3. **Add Effect.fn for tracing** - Wrap key functions for observability

### Medium Priority

4. **Add branded types for IDs**
   - `RequestId` for transport request IDs
   - Consider `ProcedureTag` branded type

5. **Improve HTTP handler body parsing** (`src/Server/index.ts:388-390`)
   - Use Schema.decodeUnknown instead of `as any`

6. **Add message getter to errors** following CLAUDE.md pattern

### Low Priority

7. **Prepare for acquireRelease** when implementing WebSocket transport

8. **Document acceptable `as` assertion patterns** for team consistency

---

## Good Patterns to Preserve

1. **Context.Tag usage** - All services properly separated
2. **Schema.decodeUnknown** - No sync decoding anywhere
3. **Layer composition** - Clean dependency injection
4. **Schema.TaggedError** - Domain errors properly typed
5. **No JSON.parse** - Using proper Effect patterns
6. **No @ts-ignore** - Types are properly handled
