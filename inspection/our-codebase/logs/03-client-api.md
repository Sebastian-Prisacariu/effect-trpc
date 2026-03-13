# Client API Structure and Implementation Analysis

**Date:** 2024-01-XX  
**File:** `/Users/sebastian/Documents/tRPC-Effect/src/Client/index.ts`

---

## Overview

The Client module provides a type-safe RPC client that mirrors the Router structure through recursive proxy objects. It supports both React hooks (planned) and vanilla/imperative usage through a "BoundClient" pattern.

---

## 1. Client.make() Function and Proxy Creation

### Implementation Analysis

```typescript
export const make = <D extends Router.Definition>(
  router: Router.Router<D>
): Client<Router.Router<D>> & ClientProxy<D> => {
  const rootTag = router.tag
  
  const buildProxy = <Def extends Router.Definition>(
    def: Def,
    pathParts: readonly string[]
  ): ClientProxy<Def> =>
    Record.map(def, (value, key) => {
      const newPath = [...pathParts, key]
      const tag = [rootTag, ...newPath].join("/")
      
      if (Procedure.isProcedure(value)) {
        return createProcedureClient(tag, value, null)
      }
      return buildProxy(value as Router.Definition, newPath)
    }) as ClientProxy<Def>
  
  const proxy = buildProxy(router.definition, [])
  // ...
}
```

### Proxy Structure

The proxy is built using `Record.map` which recursively walks the router definition:

1. For each key in the definition:
   - Build the tag: `rootTag + "/" + path.join("/")`
   - If value is a `Procedure`, create a `ProcedureClient`
   - If value is a nested definition, recurse

### Tag Construction

Tags are constructed as: `@rootTag/path/to/procedure`

Example: `@api/users/list` for path `users.list`

**Potential Issue:** Tag construction uses "/" as separator while paths use ".". The conversion happens correctly in `buildProxy`, but `invalidate` paths also need conversion through `Router.tagsToInvalidate()`.

---

## 2. BoundClient vs Unbound Client

### Unbound Client (from `Client.make()`)

```typescript
export interface Client<R extends Router.Router<Router.Definition>> {
  readonly [ClientTypeId]: ClientTypeId
  readonly Provider: React.FC<ProviderProps>
  readonly invalidate: (paths: readonly Router.Paths<Router.DefinitionOf<R>>[]) => void
  readonly provide: (layer: Layer.Layer<Transport.Transport>) => BoundClient<R>
}
```

**Unbound characteristics:**
- Has `Provider` for React usage
- `invalidate()` method prints warning and requires ReactivityService in scope
- `runPromise()` throws `Error("runPromise requires a bound runtime")`
- `run` property returns an Effect requiring `ClientServiceTag`

### BoundClient (from `api.provide(layer)`)

```typescript
export type BoundClient<R extends Router.Router<Router.Definition>> = 
  & ClientProxy<Router.DefinitionOf<R>>
  & {
    readonly [ClientTypeId]: ClientTypeId
    readonly invalidate: (paths: readonly Router.Paths<Router.DefinitionOf<R>>[]) => void
    readonly shutdown: () => Promise<void>
  }
```

**BoundClient characteristics:**
- Has `ManagedRuntime` internally
- `runPromise()` actually executes via runtime
- `invalidate()` works through the runtime
- `shutdown()` disposes the runtime

### Implementation Detail

```typescript
provide: (layer: Layer.Layer<Transport.Transport>): BoundClient<Router.Router<D>> => {
  const fullLayer = ClientServiceLive.pipe(Layer.provide(layer))
  const runtime = ManagedRuntime.make(fullLayer)
  
  const boundProxy = buildBoundProxy(router.definition, [], rootTag, runtime)
  
  return {
    [ClientTypeId]: ClientTypeId,
    ...boundProxy,
    invalidate: (paths) => {
      const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
      runtime.runPromise(
        Effect.gen(function* () {
          const service = yield* ClientServiceTag
          yield* service.invalidate(tags)
        })
      )
    },
    shutdown: () => runtime.dispose(),
  }
}
```

---

## 3. Procedure Types (Query, Mutation, Stream)

### QueryClient

```typescript
export interface QueryClient<Payload, Success, Error> {
  readonly useQuery: UseQueryFn<Payload, Success, Error>
  readonly run: Payload extends void
    ? Effect.Effect<Success, Error | Transport.TransportError, ClientServiceTag>
    : (payload: Payload) => Effect.Effect<...>
  readonly runPromise: Payload extends void
    ? () => Promise<Success>
    : (payload: Payload) => Promise<Success>
  readonly prefetch: Payload extends void
    ? Effect.Effect<void, ...>
    : (payload: Payload) => Effect.Effect<void, ...>
}
```

**Implementation correctness:**
- `run` correctly returns Effect with `ClientServiceTag` requirement
- `runPromise` correctly uses runtime when bound
- Conditional types handle void payload correctly

### MutationClient

```typescript
export interface MutationClient<Payload, Success, Error> {
  readonly useMutation: UseMutationFn<Payload, Success, Error>
  readonly run: (payload: Payload) => Effect.Effect<Success, Error | Transport.TransportError, ClientServiceTag>
  readonly runPromise: (payload: Payload) => Promise<Success>
}
```

**Mutation always requires payload** - no conditional type for void payload.

**Implementation includes auto-invalidation:**
```typescript
const createMutationEffect = (payload: unknown) =>
  Effect.gen(function* () {
    const service = yield* ClientServiceTag
    const result = yield* service.send(tag, payload, successSchema, errorSchema)
    
    // Invalidate on success
    if (invalidatePaths.length > 0) {
      const tags = Reactivity.pathsToTags(rootTag, invalidatePaths)
      yield* service.invalidate(tags)
    }
    
    return result
  })
```

### StreamClient

```typescript
export interface StreamClient<Payload, Success, Error> {
  readonly useStream: UseStreamFn<Payload, Success, Error>
  readonly stream: Payload extends void
    ? Stream.Stream<Success, Error | Transport.TransportError, ClientServiceTag>
    : (payload: Payload) => Stream.Stream<...>
}
```

**Note:** StreamClient has no `runPromise` equivalent - streams must be consumed as Effect streams.

---

## 4. runPromise Error Handling

### Current Implementation

```typescript
runPromise: runtime
  ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
  : () => { throw new Error("runPromise requires a bound runtime. Use api.provide(layer) first.") }
```

### Error Type Propagation

**Issue Found:** The Promise from `runPromise` doesn't carry error type information at runtime.

```typescript
// Client type says:
readonly runPromise: Payload extends void
  ? () => Promise<Success>
  : (payload: Payload) => Promise<Success>
```

The Promise is typed as `Promise<Success>`, but errors are thrown as:
1. **Transport errors** - Network, Timeout, Protocol, Closed
2. **Procedure errors** - Typed errors from the procedure's error schema

**At runtime:**
- `Effect.runPromise` will throw a `Cause.defect` containing the error
- For Effect errors (`E` channel), they become uncaught promise rejections
- The error type information is lost at the Promise boundary

**Recommendation:** Consider adding `runPromiseExit` that returns `Exit<Success, Error>` or document that errors should be caught and decoded.

---

## 5. invalidate() Method Analysis

### Unbound Client Invalidation

```typescript
invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  console.warn("invalidate() on unbound client requires ReactivityService in scope...")
}
```

**Bug Found:** This method does nothing useful! It computes tags but never calls invalidate.

### BoundClient Invalidation

```typescript
invalidate: (paths: readonly string[]) => {
  const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
  runtime.runPromise(
    Effect.gen(function* () {
      const service = yield* ClientServiceTag
      yield* service.invalidate(tags)
    })
  )
}
```

**Implementation issues:**
1. The `runtime.runPromise` returns a Promise but it's not awaited or returned
2. Fire-and-forget pattern - errors are silently swallowed
3. No way to know when invalidation completes

### ClientService.invalidate

```typescript
invalidate: (tags) =>
  Effect.gen(function* () {
    const reactivity = yield* Effect.serviceOption(Reactivity.Reactivity)
    if (reactivity._tag === "Some") {
      reactivity.value.invalidate(tags)
    }
  }),
```

**Issue:** If ReactivityService is not provided, invalidation silently does nothing.

### Recommendation

Change invalidate to return a Promise or log a warning when Reactivity is not available.

---

## 6. prefetch Method Analysis

### Implementation

```typescript
prefetch: Schema.is(Schema.Void)(payloadSchema)
  ? createRunEffect(undefined).pipe(Effect.asVoid)
  : (payload: unknown) => createRunEffect(payload).pipe(Effect.asVoid),
```

**Analysis:**
- `prefetch` runs the query effect but discards the result with `Effect.asVoid`
- Returns `Effect.Effect<void, Error | TransportError, ClientServiceTag>`
- Actually makes the network call (populating cache)

**Correctness:** The implementation is correct but doesn't cache results automatically. It relies on the caller to:
1. Run the prefetch effect
2. Hope that React hooks/caching layer reuses the response

**Missing:** There's no cache layer implementation. `prefetch` just runs the query and throws away the result.

---

## 7. TypeScript Type Inference Issues

### Missing Type Exports

Tests use these types that should be exported from Client:
```typescript
type ListPayload = Client.ProcedurePayload<typeof appRouter.definition.users.list>
type ListSuccess = Client.ProcedureSuccess<typeof appRouter.definition.users.list>
type CreateError = Client.ProcedureError<typeof appRouter.definition.users.create>
```

**But Client doesn't export these!** The tests work because:
1. Vitest's `expectTypeOf` works at compile time
2. TypeScript can infer them, but they should be explicitly exported

**Recommendation:** Add explicit type exports:
```typescript
export type ProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>
export type ProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>
export type ProcedureError<P extends Procedure.Any> = Procedure.Error<P>
```

### ProcedureClient Type Inference

The `ProcedureClient` type correctly extracts types from procedures:

```typescript
export type ProcedureClient<P extends Procedure.Any> = 
  P extends Procedure.Query<infer Payload, infer Success, infer Error>
    ? QueryClient<
        Schema.Schema.Type<Payload>,
        Schema.Schema.Type<Success>,
        Schema.Schema.Type<Error>
      >
    : P extends Procedure.Mutation<infer Payload, infer Success, infer Error, any>
      ? MutationClient<...>
      : P extends Procedure.Stream<...>
        ? StreamClient<...>
        : never
```

**Correctly handles:**
- `Schema.Schema.Type<Payload>` extracts the runtime type
- `infer` correctly pulls generic parameters
- Conditional types provide proper narrowing

### Void Payload Conditional Types

```typescript
readonly run: Payload extends void
  ? Effect.Effect<Success, Error | Transport.TransportError, ClientServiceTag>
  : (payload: Payload) => Effect.Effect<...>
```

**Issue:** `Schema.Void` type is `void`, but the conditional `Payload extends void` works correctly because `Schema.Schema.Type<typeof Schema.Void>` is `void`.

---

## 8. ClientService and ClientServiceLive Layer

### ClientServiceTag

```typescript
export class ClientServiceTag extends Context.Tag("@effect-trpc/ClientService")<
  ClientServiceTag,
  ClientService
>() {}
```

### ClientServiceLive Layer

```typescript
export const ClientServiceLive: Layer.Layer<ClientServiceTag, never, Transport.Transport> = 
  Layer.effect(
    ClientServiceTag,
    Effect.gen(function* () {
      const transport = yield* Transport.Transport
      return { send, sendStream, invalidate }
    })
  )
```

**Dependency:** Requires `Transport.Transport` to be provided.

### send Implementation

```typescript
send: (tag, payload, successSchema, errorSchema) =>
  Effect.gen(function* () {
    const request = new Transport.TransportRequest({
      id: Transport.generateRequestId(),
      tag,
      payload,
    })
    
    const response = yield* transport.send(request)
    
    if (Schema.is(Transport.Success)(response)) {
      return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
        Effect.mapError((e) => new Transport.TransportError({
          reason: "Protocol",
          message: "Failed to decode success response",
          cause: e,
        }))
      )
    } else {
      const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(...)
      return yield* Effect.fail(error)
    }
  })
```

**Correctly handles:**
- Request ID generation
- Success/Failure discrimination
- Schema decoding of response
- Error mapping to TransportError for decode failures

---

## 9. Client-Side Schema Decoding

### Success Path

```typescript
if (Schema.is(Transport.Success)(response)) {
  return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
    Effect.mapError((e) => new Transport.TransportError({
      reason: "Protocol",
      message: "Failed to decode success response",
      cause: e,
    }))
  )
}
```

**Analysis:**
- Uses `Schema.decodeUnknown` (correct - doesn't throw)
- Wraps decode errors in `TransportError` with "Protocol" reason
- `response.value` is `Schema.Unknown` type at transport level

### Error Path

```typescript
const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
  Effect.mapError((e) => new Transport.TransportError({
    reason: "Protocol",
    message: "Failed to decode error response",
    cause: e,
  }))
)
return yield* Effect.fail(error)
```

**Analysis:**
- Decodes error using procedure's error schema
- If error schema decode fails, wraps in TransportError
- Successfully decoded errors are properly typed

### Stream Decoding

```typescript
Stream.mapEffect((response): Effect.Effect<S, E | Transport.TransportError> => {
  if (Schema.is(Transport.StreamChunk)(response)) {
    return Schema.decodeUnknown(successSchema)(response.chunk).pipe(...)
  } else if (Schema.is(Transport.Failure)(response)) {
    return Schema.decodeUnknown(errorSchema)(response.error).pipe(
      Effect.flatMap((err) => Effect.fail(err as E)),
      Effect.mapError((e) => ...)
    )
  }
  // Should not reach here
  return Effect.fail(new Transport.TransportError({...}))
})
```

**Issue:** The `as E` cast is needed because TypeScript can't narrow through the decode. This is correct but not ideal.

---

## 10. Tag Construction Analysis

### Tag Format

Tags follow the pattern: `@rootTag/path/segments`

- Router tag: `@api`
- Path: `users.list`
- Full tag: `@api/users/list`

### Tag Construction in Proxy

```typescript
const buildProxy = <Def extends Router.Definition>(
  def: Def,
  pathParts: readonly string[]
): ClientProxy<Def> =>
  Record.map(def, (value, key) => {
    const newPath = [...pathParts, key]
    const tag = [rootTag, ...newPath].join("/")  // <-- Tag built here
    ...
  })
```

### Path to Tag Conversion (Reactivity)

```typescript
export const pathsToTags = (
  rootTag: string,
  paths: ReadonlyArray<string>
): ReadonlyArray<string> =>
  paths.map((path) => `${rootTag}/${path.replace(/\./g, "/")}`)
```

**Correctness:** Converts `users.list` to `@api/users/list` correctly.

### Tag to Path Conversion (Transport/Mock)

```typescript
const tagToPath = (tag: string): string => {
  const parts = tag.split("/")
  return parts.slice(1).join(".")
}
```

**Correctness:** Converts `@api/users/list` to `users.list` correctly.

---

## Summary of Issues Found

### Bugs

1. **Unbound `invalidate()` does nothing** - Computes tags but never invalidates
2. **Bound `invalidate()` fire-and-forget** - Doesn't return Promise, errors swallowed
3. **`prefetch` doesn't cache** - Runs query but discards result

### Missing Features

1. **No `ProcedurePayload/Success/Error` type exports** - Tests use them but they're not exported
2. **No `runPromiseExit`** - Can't handle errors properly with Promises
3. **No caching layer** - prefetch runs but doesn't populate any cache
4. **React hooks are stubs** - `useQuery`, `useMutation`, `useStream` throw

### Type Issues

1. **`as E` cast in stream error handling** - Works but not ideal
2. **Promise error types lost** - `runPromise` returns `Promise<Success>` but can throw `Error | TransportError`

### Runtime vs Compile-time Mismatches

1. **Unbound client has methods that throw at runtime** - `runPromise` exists but throws
2. **Hook stubs exist but throw** - Type says they exist, runtime throws

---

## Recommendations

1. **Export type helpers from Client module:**
   ```typescript
   export type ProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>
   export type ProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>
   export type ProcedureError<P extends Procedure.Any> = Procedure.Error<P>
   ```

2. **Fix unbound `invalidate`** - Either remove it or make it work with optional Reactivity

3. **Return Promise from `invalidate`:**
   ```typescript
   invalidate: async (paths) => {
     const tags = paths.flatMap(...)
     await runtime.runPromise(Effect.gen(function* () {
       const service = yield* ClientServiceTag
       yield* service.invalidate(tags)
     }))
   }
   ```

4. **Add `runPromiseExit` method** for proper error handling:
   ```typescript
   readonly runPromiseExit: Payload extends void
     ? () => Promise<Exit<Success, Error | TransportError>>
     : (payload: Payload) => Promise<Exit<Success, Error | TransportError>>
   ```

5. **Implement React hooks** or document they're not ready

6. **Add caching layer** for prefetch to be useful

---

## Appendix: LSP Type Errors Found

### Missing Type Exports (test/client.test.ts)

```
ERROR [177:31] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedurePayload'.
ERROR [185:30] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedurePayload'.
ERROR [192:31] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedureSuccess'.
ERROR [199:28] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedureError'.
ERROR [206:33] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedurePayload'.
ERROR [213:33] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedureSuccess'.
ERROR [220:31] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedureError'.
ERROR [237:31] Namespace '"/Users/sebastian/Documents/tRPC-Effect/src/Client/index"' has no exported member 'ProcedureSuccess'.
```

**Confirmed:** The tests use `Client.ProcedurePayload`, `Client.ProcedureSuccess`, and `Client.ProcedureError` but these are NOT exported from the Client module. Tests pass due to vitest's typecheck working differently.

### TransportRequest Missing Headers (multiple test files)

```
ERROR [142:45] Argument of type '{ id: string; tag: string; payload: undefined; }' is not assignable to parameter of type 'TransportRequest'.
  Property 'headers' is missing in type '{ id: string; tag: string; payload: undefined; }' but required in type 'TransportRequest'.
```

**Issue:** TransportRequest requires `headers` but many tests create plain objects without it. The Schema has a default: `Schema.optionalWith(Schema.Record({...}), { default: () => ({}) })` but constructing plain objects bypasses the Schema transformation.

**Fix needed in tests:** Use `new Transport.TransportRequest({...})` instead of plain objects, or add `headers: {}` to test objects.

### Handler Type Inference Mismatch (test/integration.test.ts)

```
ERROR [100:39] Argument of type '{ users: { list: () => Effect.Effect<User[], never, UserRepository>; ... }' 
  is not assignable to parameter of type 'Handlers<..., never>'.
  Type 'Effect<User[], never, UserRepository>' is not assignable to type 'Effect<readonly User[], unknown, never>'.
    Type 'UserRepository' is not assignable to type 'never'.
```

**Issue:** `Handlers` type expects `R = never` (no requirements), but handlers depend on `UserRepository`. The handlers should be typed as `Handlers<..., UserRepository>`.

### Schema Type Constraints (test/integration.test.ts)

```
ERROR [209:9] Argument of type 'Struct<{ status: typeof String$; }>' is not assignable to parameter of type 'Schema<{ readonly status: string; }, unknown, never>'.
```

**Issue:** The schema types need `Encoded = unknown` constraint but `Struct<...>` has specific encoded type. This is a stricter TypeScript mode issue.

---

## Test Execution vs Type Checking

Despite these LSP errors, `npm run test` passes (322 tests). This happens because:

1. **Vitest typecheck mode** may be more lenient
2. **Runtime tests** don't care about these type issues
3. **Some tests are runtime-only** - they test behavior, not types

The LSP errors reveal real issues that should be fixed for proper TypeScript strictness.
