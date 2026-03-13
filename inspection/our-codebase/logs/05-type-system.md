# Type System and Exports Analysis

## Summary

The codebase has a well-designed type system with comprehensive exports, but there are a few notable gaps and issues.

---

## 1. Exported Types Inventory

### Main Entry Point (`src/index.ts`)

Exports 8 namespace modules:

| Module | Path |
|--------|------|
| `Procedure` | `./Procedure/index.js` |
| `Router` | `./Router/index.js` |
| `Client` | `./Client/index.js` |
| `Server` | `./Server/index.js` |
| `Transport` | `./Transport/index.js` |
| `Result` | `./Result/index.js` |
| `Middleware` | `./Middleware/index.js` |
| `Reactivity` | `./Reactivity/index.js` |

### Procedure Module (`src/Procedure/index.ts`)

**Types Exported:**
- `ProcedureBase<Payload, Success, Error>` - Base interface
- `Query<Payload, Success, Error>` - Query procedure model
- `Mutation<Payload, Success, Error, Invalidates>` - Mutation model
- `Stream<Payload, Success, Error>` - Stream model  
- `Any` - Union type of all procedures
- `QueryOptions<P, S, E>` - Query constructor options
- `MutationOptions<P, S, E, Paths, Target>` - Mutation constructor options
- `StreamOptions<P, S, E>` - Stream constructor options
- `OptimisticConfig<Target, Payload, Success>` - Optimistic update config
- `AutoComplete<T>` - Autocomplete helper type
- `Payload<P>` - Extract payload type
- `Success<P>` - Extract success type
- `Error<P>` - Extract error type
- `Invalidates<P>` - Extract invalidates array type

**Functions Exported:**
- `query(options)` - Create query procedure
- `mutation(options)` - Create mutation procedure
- `stream(options)` - Create stream procedure
- `isProcedure(u)` - Type guard
- `isQuery(u)` - Type guard
- `isMutation(u)` - Type guard
- `isStream(u)` - Type guard

**Internal (not exported to consumers):**
- `ProcedureTypeId`, `QueryTypeId`, `MutationTypeId`, `StreamTypeId` - Symbol identifiers

### Router Module (`src/Router/index.ts`)

**Types Exported:**
- `Definition` - Nested record of procedures
- `TaggedProcedure` - Procedure with path/tag metadata
- `PathMap` - Path/tag lookup structure
- `Router<D>` - The Router interface
- `Paths<D, Prefix>` - Extract all paths from definition
- `ProcedureAt<D, Path>` - Get procedure at path
- `Flatten<D, Prefix>` - Flatten nested definition
- `DefinitionOf<R>` - Extract definition from router
- `DefinitionWithMiddleware<D>` - Definition wrapped with middleware

**Functions Exported:**
- `make(tag, definition)` - Create router
- `paths(router)` - Get all paths
- `get(router, path)` - Get procedure by path
- `tagOf(router, path)` - Get tag for path
- `pathOf(router, tag)` - Get path for tag
- `tagsToInvalidate(router, path)` - Get all tags to invalidate
- `withMiddleware(middlewares, definition)` - Wrap with middleware

### Client Module (`src/Client/index.ts`)

**Types Exported:**
- `ClientService` - Internal RPC service interface
- `Client<R>` - Full client with Provider
- `BoundClient<R>` - Client with runtime bound
- `ProviderProps` - React Provider props
- `ClientProxy<D>` - Recursive proxy type
- `ProcedureClient<P>` - Client for single procedure
- `QueryClient<P, S, E>` - Query procedure client
- `MutationClient<P, S, E>` - Mutation procedure client
- `StreamClient<P, S, E>` - Stream procedure client
- `UseQueryFn<P, S, E>` - useQuery signature
- `QueryOptions` - Query hook options
- `QueryResult<S, E>` - Query hook result
- `UseMutationFn<P, S, E>` - useMutation signature
- `MutationOptions<S, E>` - Mutation hook options
- `MutationResult<P, S, E>` - Mutation hook result
- `UseStreamFn<P, S, E>` - useStream signature
- `StreamOptions` - Stream hook options
- `StreamResult<S, E>` - Stream hook result
- `Definition` - Re-export from Router

**Services Exported:**
- `ClientServiceTag` - Context.Tag for service injection
- `ClientServiceLive` - Layer implementation

**Functions Exported:**
- `make(router)` - Create client from router

**NOT EXPORTED but used in tests:**
- `ProcedurePayload<P>` - Tests use this but it's not defined!
- `ProcedureSuccess<P>` - Tests use this but it's not defined!
- `ProcedureError<P>` - Tests use this but it's not defined!

### Server Module (`src/Server/index.ts`)

**Types Exported:**
- `HandlerFor<P, R>` - Extract handler type for procedure
- `Handlers<D, R>` - Full handlers structure
- `Server<D, R>` - Server interface
- `HttpHandlerOptions` - HTTP adapter options

**Functions Exported:**
- `make(router, handlers)` - Create server
- `isServer(value)` - Type guard
- `middleware(m)` - Add middleware to server
- `toHttpHandler(server, options)` - Create HTTP handler
- `toFetchHandler(server, layer)` - Create fetch-compatible handler
- `toNextApiHandler(server, layer)` - Create Next.js handler

### Transport Module (`src/Transport/index.ts`)

**Types Exported:**
- `TransportError` - Schema.TaggedError for transport errors
- `Success` - Schema.TaggedClass for success response
- `Failure` - Schema.TaggedClass for failure response
- `StreamChunk` - Schema.TaggedClass for stream chunks
- `StreamEnd` - Schema.TaggedClass for stream end
- `TransportResponse` - Union schema type
- `StreamResponse` - Union schema type
- `TransportRequest` - Schema.Class for requests
- `TransportService` - Service interface
- `Transport` - Context.Tag
- `HttpOptions` - HTTP transport options
- `MockHandlers<D>` - Mock handlers type

**Functions Exported:**
- `http(url, options)` - Create HTTP transport layer
- `mock(handlers)` - Create mock transport layer
- `make(service)` - Create custom transport layer
- `loopback(server)` - Create loopback transport
- `isTransientError(error)` - Check if retryable
- `generateRequestId()` - Generate unique ID

### Middleware Module (`src/Middleware/index.ts`)

**Types Exported:**
- `MiddlewareRequest` - Request context for middleware
- `Headers` - Minimal headers interface
- `MiddlewareConfig<Provides, Failure>` - Config type
- `MiddlewareTag<Self, Provides, Failure>` - Middleware tag
- `MiddlewareImpl<Provides, Failure>` - Implementation interface
- `WrapMiddlewareImpl<Failure>` - Wrap middleware implementation
- `CombinedMiddleware<Tags>` - Combined middlewares
- `Applicable` - Union of applicable middleware
- `Provides<M>` - Extract provides type
- `Failure<M>` - Extract failure type

**Functions Exported:**
- `Tag(id, provides)` - Create middleware tag
- `implement(tag, run)` - Implement providing middleware
- `implementWrap(tag, wrap)` - Implement wrapping middleware
- `all(...tags)` - Combine middlewares
- `execute(middlewares, request, handler)` - Execute middleware chain
- `isMiddlewareTag(value)` - Type guard
- `isCombinedMiddleware(value)` - Type guard
- `isApplicable(value)` - Type guard

### Reactivity Module (`src/Reactivity/index.ts`)

**Types Exported:**
- `InvalidationCallback` - Callback type
- `ReactivityService` - Service interface
- `Reactivity` - Context.Tag

**Functions Exported:**
- `make()` - Create ReactivityService
- `subscribe(tag, callback)` - Effect-based subscribe
- `invalidate(tags)` - Effect-based invalidate
- `getSubscribedTags` - Effect-based getter
- `pathsToTags(rootTag, paths)` - Convert paths to tags
- `shouldInvalidate(subscribedTag, invalidatedTag)` - Check invalidation

**Layers Exported:**
- `ReactivityLive` - Layer implementation

### Result Module (`src/Result/index.ts`)

**Re-exports from @effect-atom/atom/Result:**
- All exports from the atom package

---

## 2. Missing Exports (Types Used in Tests but Not Exported)

### Client Module Missing Helper Types

The tests in `test/types.test.ts` and `test/client.test.ts` use:

```typescript
// test/types.test.ts:163-181
type Payload = Client.ProcedurePayload<typeof router.definition.users.list>
type Success = Client.ProcedureSuccess<typeof router.definition.users.list>
type Err = Client.ProcedureError<typeof router.definition.users.get>
```

**These types are NOT defined in `src/Client/index.ts`!**

The test file expects these helper types, but they don't exist. The proper types to use would be:

```typescript
import { Procedure } from "effect-trpc"

// Should use Procedure-level helpers:
type Payload = Procedure.Payload<typeof procedure>
type Success = Procedure.Success<typeof procedure>
type Error = Procedure.Error<typeof procedure>
```

**Recommendation:** Either:
1. Add these convenience types to Client module:
   ```typescript
   export type ProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>
   export type ProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>
   export type ProcedureError<P extends Procedure.Any> = Procedure.Error<P>
   ```

2. Or update tests to use the existing `Procedure.*` types.

---

## 3. Type Errors in Test Files

### Transport Module Type Error

In `test/transport.test.ts:107-116`:

```typescript
describe("Transport service", () => {
  it("TransportService.send returns Stream of responses", () => {
    type SendFn = Transport.TransportService["send"]
    type Return = ReturnType<SendFn>

    expectTypeOf<Return>().toMatchTypeOf<
      Stream.Stream<Transport.TransportResponse, Transport.TransportError>
    >()
  })
})
```

**This test is INCORRECT.** Looking at `src/Transport/index.ts:162-169`:

```typescript
export interface TransportService {
  readonly send: (
    request: TransportRequest
  ) => Effect.Effect<TransportResponse, TransportError>  // Effect, not Stream!
  
  readonly sendStream: (
    request: TransportRequest
  ) => Stream.Stream<StreamResponse, TransportError>  // This is the Stream
}
```

The `send` method returns `Effect.Effect`, not `Stream.Stream`. The test should be:

```typescript
expectTypeOf<Return>().toMatchTypeOf<
  Effect.Effect<Transport.TransportResponse, Transport.TransportError>
>()
```

### TransportRequest Type Error

In `test/transport.test.ts:159-169`:

```typescript
it("TransportRequest has required fields", () => {
  const request: Transport.TransportRequest = {
    id: "req-1",
    tag: "@api/users/list",
    payload: { filter: "active" },
  }
  // ...
})
```

**Problem:** `TransportRequest` is a Schema.Class, not a plain object interface. You need to use `new Transport.TransportRequest(...)`:

```typescript
const request = new Transport.TransportRequest({
  id: "req-1",
  tag: "@api/users/list",
  payload: { filter: "active" },
})
```

The test might pass at runtime but is technically type-incorrect.

---

## 4. tsconfig.json Analysis

### Current Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "examples", "benchmarks"]
}
```

### Issues

1. **Test files are excluded from type checking!**
   
   The main `tsconfig.json` excludes `test/` directory. This means:
   - `npm run test:types` (`tsc --noEmit`) does NOT check test files
   - Type errors in tests will not be caught by CI/CD
   - The `Client.ProcedurePayload/Success/Error` issue went unnoticed

2. **No separate tsconfig for tests**
   
   The project needs a `tsconfig.test.json` or similar that includes tests:
   
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "rootDir": ".",
       "noEmit": true
     },
     "include": ["src/**/*", "test/**/*"],
     "exclude": ["node_modules", "dist"]
   }
   ```

3. **Missing dependencies in node_modules**
   
   The type checker reports "Cannot find module 'effect'" errors because dependencies aren't installed. Run `pnpm install` or `npm install`.

---

## 5. Internal vs Public API

### Properly Marked as Internal

The codebase correctly uses `@internal` JSDoc tags for:
- Type IDs (`ProcedureTypeId`, `QueryTypeId`, etc.)
- All TypeId types

### Should Consider Internal

Some types may be too implementation-specific for public API:
- `TaggedProcedure` - Could be internal
- `PathMap` - Could be internal, users likely don't need direct access
- `ClientService` - Internal service interface

---

## 6. Recommendations

### Critical (Must Fix)

1. **Add missing Client helper types or fix tests:**
   ```typescript
   // In src/Client/index.ts
   export type ProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>
   export type ProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>  
   export type ProcedureError<P extends Procedure.Any> = Procedure.Error<P>
   ```

2. **Fix transport.test.ts type assertions:**
   - Change `Stream.Stream` expectation to `Effect.Effect` for `send`
   - Use `new Transport.TransportRequest(...)` instead of plain object

3. **Create tsconfig.test.json:**
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "rootDir": ".",
       "noEmit": true
     },
     "include": ["src/**/*", "test/**/*"]
   }
   ```
   
   Update `package.json`:
   ```json
   "scripts": {
     "test:types": "tsc --noEmit -p tsconfig.test.json"
   }
   ```

### Recommended (Should Fix)

4. **Install dependencies:** Run `pnpm install` to resolve "Cannot find module" errors

5. **Export type utilities consistently:**
   - Consider adding `Router.PathsOf<R>` as alias for `Router.Paths<Router.DefinitionOf<R>>`

### Nice to Have

6. **Add docstrings for complex types:**
   - `Flatten<D, Prefix>` could use better documentation
   - `UnionToIntersection<U>` is internal but used in public types

---

## 7. Type Flow Verification

The tests verify these type flows work correctly:

```
Procedure.query({ payload, success, error })
    ↓
Router.make("@tag", { path: procedure })
    ↓
Server.Handlers<typeof router.definition>  ← Handler types match procedures
    ↓
Client.make(router)  ← Proxy mirrors structure
    ↓
api.path.useQuery()  ← Hook returns correct types
```

This is well-designed and the type inference chain is correct.

---

## 8. Summary Table

| Category | Count | Status |
|----------|-------|--------|
| Exported Modules | 8 | Good |
| Exported Types | 60+ | Good |
| Exported Functions | 40+ | Good |
| Missing Exports | 3 | Needs Fix |
| Type Errors in Tests | 2 | Needs Fix |
| tsconfig Issues | 2 | Needs Fix |
| Internal Markers | Consistent | Good |
