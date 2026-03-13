# Module Integration Analysis

**Date:** 2026-03-13  
**Focus:** Module dependencies, layer composition, context flow, integration points

---

## 1. Dependency Graph

### Module Import Dependencies

```
                           ┌─────────────┐
                           │   index.ts  │  (Public API)
                           └──────┬──────┘
                                  │
       ┌──────────────────────────┼──────────────────────────────┐
       │         │         │      │      │         │             │
       ▼         ▼         ▼      ▼      ▼         ▼             ▼
┌──────────┐ ┌───────┐ ┌──────┐ ┌────┐ ┌────────┐ ┌──────────┐ ┌────────┐
│Procedure │ │Router │ │Client│ │Srv │ │Transprt│ │Reactivity│ │Middlewr│
└─────┬────┘ └───┬───┘ └──┬───┘ └─┬──┘ └────┬───┘ └────┬─────┘ └────┬───┘
      │          │        │       │         │          │            │
      │          ▼        │       │         │          │            │
      └────────►[R]───────┤       │         │          │            │
               needs      │       │         │          │            │
               Procedure  │       │         │          │            │
                          │       │         │          │            │
                          ▼       ▼         │          │            │
                        [C]◄────[S]         │          │            │
                        needs   needs       │          │            │
                        Router  Router      │          │            │
                        Procedure Procedure │          │            │
                        Transport Transport │          │            │
                        Reactivity Middlewr │          │            │
                                            │          │            │
                                            ▼          ▼            │
                                          [C]◄───────[R]            │
                                          needs      (optional)     │
                                          Transport                 │
                                                                    │
                                                                    ▼
                                                                 [S],[C]
                                                                 use MW
```

### Detailed Import Map

| Module     | Imports From                                          |
|------------|-------------------------------------------------------|
| Procedure  | `effect/Schema`, `effect/Pipeable` (no internal deps) |
| Router     | `Procedure`                                           |
| Transport  | `Router` (types only), `Procedure` (types only)       |
| Client     | `Router`, `Procedure`, `Transport`, `Reactivity`      |
| Server     | `Router`, `Procedure`, `Transport`, `Middleware`      |
| Middleware | `effect/Context`, `effect/Effect` (no internal deps)  |
| Reactivity | (no internal deps)                                    |
| Result     | `@effect-atom/atom/Result` (external re-export)       |

### Dependency Order (Bottom-up)

```
Level 0: Procedure, Middleware, Reactivity, Result (leaf nodes)
Level 1: Router (depends on Procedure)
Level 2: Transport (depends on Router, Procedure - types only)
Level 3: Client (depends on Router, Procedure, Transport, Reactivity)
Level 3: Server (depends on Router, Procedure, Transport, Middleware)
```

---

## 2. Circular Dependency Analysis

**Result: NO CIRCULAR DEPENDENCIES FOUND**

The module structure follows a clean DAG (Directed Acyclic Graph):

```
Procedure ◄───── Router ◄───── Client
    ▲              ▲             │
    │              │             │
    └──────────────┴─────────────┘
                   │
                Server
                   │
    Middleware ────┘
```

Each module only imports from modules at lower levels:
- `Procedure` imports nothing internal
- `Router` imports `Procedure` (Level 0)
- `Client`/`Server` import `Router` + Level 0 modules (Level 2)

---

## 3. Layer Composition Analysis

### Service Tag Definitions

| Service Tag                    | Module     | Interface               |
|--------------------------------|------------|-------------------------|
| `@effect-trpc/Transport`       | Transport  | `TransportService`      |
| `@effect-trpc/Reactivity`      | Reactivity | `ReactivityService`     |
| `@effect-trpc/ClientService`   | Client     | `ClientService`         |

### Layer Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                      User Application                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Client.ClientServiceLive                                    │
│  ─────────────────────────                                   │
│  Provides: ClientServiceTag                                  │
│  Requires: Transport                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Transport.http() / Transport.loopback() / Transport.mock() │
│  ────────────────────────────────────────────────────────── │
│  Provides: Transport                                         │
│  Requires: (none) or Server for loopback                     │
└─────────────────────────────────────────────────────────────┘
```

### Optional Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Reactivity.ReactivityLive                                   │
│  ──────────────────────────                                  │
│  Provides: Reactivity                                        │
│  Requires: (none)                                            │
│  Status: OPTIONAL - Client checks with Effect.serviceOption  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Middleware.implement(MiddlewareTag, ...)                    │
│  ─────────────────────────────────────────                   │
│  Provides: MiddlewareTag                                     │
│  Requires: (none)                                            │
│  Status: OPTIONAL - Only needed if middleware is applied     │
└─────────────────────────────────────────────────────────────┘
```

### Layer Composition Pattern (Correct)

```typescript
// Full client stack
const ClientLayer = Client.ClientServiceLive.pipe(
  Layer.provide(Transport.http("/api")),
  Layer.provide(Reactivity.ReactivityLive)  // Optional
)

// Server doesn't need layers - uses Effect context directly
const server = Server.make(router, handlers)
```

---

## 4. Context Flow Analysis

### Client-Side Context Flow

```
┌───────────────────────────────────────────────────────────────────┐
│ api.users.list.run()                                              │
│     │                                                             │
│     ▼                                                             │
│ Effect.gen {                                                      │
│   clientService = yield* ClientServiceTag  ◄── from ClientLayer  │
│   response = yield* clientService.send(tag, payload, schemas)    │
│ }                                                                 │
│     │                                                             │
│     ▼                                                             │
│ ClientService.send() {                                            │
│   transport = yield* Transport.Transport  ◄── from TransportLayer│
│   response = yield* transport.send(request)                      │
│ }                                                                 │
│     │                                                             │
│     ▼                                                             │
│ ClientService.invalidate() {                                      │
│   reactivity = yield* Effect.serviceOption(Reactivity) ◄── OPTL  │
│   reactivity.value?.invalidate(tags)                             │
│ }                                                                 │
└───────────────────────────────────────────────────────────────────┘
```

### Server-Side Context Flow

```
┌───────────────────────────────────────────────────────────────────┐
│ server.handle(request)                                            │
│     │                                                             │
│     ▼                                                             │
│ Find handler by tag                                               │
│     │                                                             │
│     ▼                                                             │
│ Middleware.execute(middlewares, request, handlerEffect)           │
│     │                                                             │
│     ▼                                                             │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ For each middleware:                                        │   │
│ │   impl = yield* MiddlewareTag  ◄── Must be provided by user │   │
│ │   if ("wrap" in impl):                                      │   │
│ │     yield* impl.wrap(request, next)                         │   │
│ │   else:                                                     │   │
│ │     provided = yield* impl.run(request)                     │   │
│ │     yield* next.pipe(Effect.provideService(tag, provided))  │   │
│ └────────────────────────────────────────────────────────────┘   │
│     │                                                             │
│     ▼                                                             │
│ handler(payload) {                                                │
│   db = yield* Database  ◄── User-provided service                │
│   currentUser = yield* CurrentUser  ◄── Provided by middleware   │
│ }                                                                 │
└───────────────────────────────────────────────────────────────────┘
```

### Context Verification

| Context Path              | Required By   | Provided By           | Status |
|---------------------------|---------------|-----------------------|--------|
| ClientServiceTag          | Client.run()  | ClientServiceLive     | OK     |
| Transport                 | ClientService | Transport.http/mock   | OK     |
| Reactivity                | ClientService | ReactivityLive        | OPTL   |
| MiddlewareTag             | Server.handle | Middleware.implement  | OPTL   |
| User services (DB, etc)   | Server handlers| User-provided Layer  | USER   |

---

## 5. Client ↔ Server Loopback Analysis

### Loopback Transport Implementation

```typescript
// From Transport/index.ts:575-601
export const loopback = <D extends Definition, R>(
  server: {
    readonly handle: (request: TransportRequest) => Effect.Effect<TransportResponse, never, R>
    readonly handleStream: (request: TransportRequest) => Stream.Stream<StreamResponse, never, R>
  }
): Layer.Layer<Transport, never, R>
```

### Integration Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                                     │
├────────────────────────────────────────────────────────────────────────┤
│  api.users.list.runPromise()                                           │
│      │                                                                 │
│      ▼                                                                 │
│  ClientService.send("@api/users/list", payload, schemas)               │
│      │                                                                 │
│      ▼                                                                 │
│  transport.send(TransportRequest)  ◄── uses loopback                   │
│                                                                        │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
                              │ DIRECT CALL (no HTTP)
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                         SERVER SIDE                                     │
├────────────────────────────────────────────────────────────────────────┤
│  server.handle(request)                                                 │
│      │                                                                 │
│      ▼                                                                 │
│  Lookup handler by tag                                                 │
│      │                                                                 │
│      ▼                                                                 │
│  Decode payload with Schema                                            │
│      │                                                                 │
│      ▼                                                                 │
│  Execute middleware chain                                              │
│      │                                                                 │
│      ▼                                                                 │
│  handler(decodedPayload)  ◄── User handler with R dependencies        │
│      │                                                                 │
│      ▼                                                                 │
│  Encode response with Schema                                           │
│      │                                                                 │
│      ▼                                                                 │
│  Return Success({ id, value }) or Failure({ id, error })               │
│                                                                        │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │
                              │ TransportResponse
                              │
┌─────────────────────────────▼──────────────────────────────────────────┐
│                         CLIENT SIDE                                     │
├────────────────────────────────────────────────────────────────────────┤
│  Decode response.value with successSchema                              │
│  OR                                                                    │
│  Decode response.error with errorSchema → Effect.fail()                │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Integration Gap: Layer Provision

The loopback test reveals a subtle integration pattern:

```typescript
// From test/e2e/loopback.test.ts:14-31
const LoopbackTransportLayer = Layer.succeed(
  Transport.Transport,
  {
    send: (request: Transport.TransportRequest) => 
      testServer.handle(request).pipe(
        Effect.provide(TestDatabaseLive)  // <-- Server deps provided HERE
      ),
    sendStream: (request: Transport.TransportRequest) => 
      Stream.unwrap(
        Effect.provide(
          Effect.succeed(testServer.handleStream(request)),
          TestDatabaseLive
        )
      ).pipe(
        Stream.provideLayer(TestDatabaseLive)
      ),
  }
)
```

**Finding:** Server dependencies (`R`) must be provided at the transport layer when using loopback. This works but requires manual wiring.

---

## 6. Transport ↔ Client Connection Analysis

### Connection Points

1. **ClientServiceLive requires Transport** (Client/index.ts:101)
   ```typescript
   export const ClientServiceLive: Layer.Layer<ClientServiceTag, never, Transport.Transport> = 
     Layer.effect(ClientServiceTag, Effect.gen(function* () {
       const transport = yield* Transport.Transport  // <-- Connection
       return { send, sendStream, invalidate }
     }))
   ```

2. **Client.provide() creates full stack** (Client/index.ts:574-576)
   ```typescript
   provide: (layer: Layer.Layer<Transport.Transport>): BoundClient<...> => {
     const fullLayer = ClientServiceLive.pipe(Layer.provide(layer))
     const runtime = ManagedRuntime.make(fullLayer)
     // ...
   }
   ```

### Type Flow

```
Transport.Transport (service tag)
        │
        ▼
TransportService {
  send: (TransportRequest) => Effect<TransportResponse, TransportError>
  sendStream: (TransportRequest) => Stream<StreamResponse, TransportError>
}
        │
        ▼
ClientService {
  send: (tag, payload, schemas) => Effect<S, E | TransportError>
  sendStream: (tag, payload, schemas) => Stream<S, E | TransportError>
  invalidate: (tags) => Effect<void>
}
        │
        ▼
ProcedureClient {
  run: Effect<Success, Error | TransportError, ClientServiceTag>
  runPromise: () => Promise<Success>
  useQuery/useMutation/useStream: React hooks (stubs)
}
```

---

## 7. Reactivity ↔ Client Integration

### Integration Points

1. **Client uses Reactivity optionally** (Client/index.ts:186-192)
   ```typescript
   invalidate: (tags) =>
     Effect.gen(function* () {
       const reactivity = yield* Effect.serviceOption(Reactivity.Reactivity)
       if (reactivity._tag === "Some") {
         reactivity.value.invalidate(tags)
       }
     })
   ```

2. **Mutations auto-invalidate** (Client/index.ts:652-662)
   ```typescript
   // In createProcedureClient for mutations
   if (invalidatePaths.length > 0) {
     const tags = Reactivity.pathsToTags(rootTag, invalidatePaths)
     yield* service.invalidate(tags)
   }
   ```

### Integration Gap: React Hooks Not Connected

```typescript
// Client/index.ts:720-728 - STUB
const createUseQuery = <P extends Procedure.Query<any, any, any>>(
  tag: string,
  procedure: P
): UseQueryFn<any, any, any> => {
  return (() => {
    throw new Error("useQuery requires React. Use inside a component wrapped by <api.Provider>")
  }) as any
}
```

**Finding:** React hooks are stubs. The Reactivity system is implemented but not connected to actual React components.

---

## 8. Middleware ↔ Server Integration

### Integration Points

1. **Server.make builds handler map with middlewares** (Server/index.ts:160-201)
   ```typescript
   const buildHandlerMap = (def, handlerDef, pathParts, inheritedMiddlewares) => {
     // Check for Router.withMiddleware wrapper
     if ("definition" in entry && "middlewares" in entry) {
       groupMiddlewares = wrapped.middlewares
     }
     // Collect procedure's own middlewares
     procedureMiddlewares = entry.middlewares
     // Store combined
     handlerMap.set(tag, {
       handler, procedure, isStream,
       middlewares: [...currentMiddlewares, ...procedureMiddlewares]
     })
   }
   ```

2. **Server.handle executes middleware chain** (Server/index.ts:270-276)
   ```typescript
   if (middlewares.length > 0) {
     return Middleware.execute(
       middlewares,
       middlewareRequest,
       handlerEffect
     )
   }
   ```

3. **Server.middleware adds server-level middleware** (Server/index.ts:454-495)
   ```typescript
   export const middleware = <M extends Middleware.Applicable>(m: M) => 
     <D extends Definition, R>(server: Server<D, R>): Server<D, R> => {
       const newMiddlewares = [...server.middlewares, m]
       // Wrap handle to execute server-level middleware first
     }
   ```

### Middleware Execution Order

```
┌────────────────────────────────────────────────────────────────────────┐
│                      MIDDLEWARE CHAIN                                   │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Server-level middlewares (outermost)                                  │
│       ▼                                                                │
│  Group-level middlewares (Router.withMiddleware)                       │
│       ▼                                                                │
│  Procedure-level middlewares (procedure.middleware())                  │
│       ▼                                                                │
│  Handler execution (innermost)                                         │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Router → Client/Server Flow

### Router Provides

1. **Procedure definitions with schemas**
2. **Path-to-tag mapping** (`pathMap`)
3. **Tagged procedure list** (`procedures`)

### Client Usage

```typescript
// Client/index.ts:538-558
export const make = <D extends Definition>(router: Router<D>) => {
  const rootTag = router.tag
  
  const buildProxy = (def, pathParts) =>
    Record.map(def, (value, key) => {
      const tag = [rootTag, ...newPath].join("/")
      if (Procedure.isProcedure(value)) {
        return createProcedureClient(tag, value, null)
      }
      return buildProxy(value, newPath)  // Recurse
    })
}
```

### Server Usage

```typescript
// Server/index.ts:160-201
const buildHandlerMap = (def, handlerDef, pathParts, middlewares) => {
  for (const key of Object.keys(def)) {
    const tag = [router.tag, ...newPath].join("/")
    if (Procedure.isProcedure(entry)) {
      handlerMap.set(tag, { handler, procedure, middlewares })
    } else {
      buildHandlerMap(entry, handler, newPath, middlewares)  // Recurse
    }
  }
}
```

### Type Sharing

```
Router<D extends Definition>
     │
     ├──► Client.make(router) → Client<Router<D>> & ClientProxy<D>
     │         │
     │         └──► Type inference flows through D
     │
     └──► Server.make(router, handlers: Handlers<D, R>) → Server<D, R>
               │
               └──► Handler types derived from D
```

---

## 10. Orphaned Code Paths Analysis

### Potentially Orphaned Code

| Code                                    | Location              | Status      | Notes                          |
|-----------------------------------------|-----------------------|-------------|--------------------------------|
| `createProvider`                        | Client/index.ts:708   | STUB        | Returns noop React component   |
| `createUseQuery`                        | Client/index.ts:720   | STUB        | Throws, not implemented        |
| `createUseMutation`                     | Client/index.ts:730   | STUB        | Throws, not implemented        |
| `createUseStream`                       | Client/index.ts:740   | STUB        | Throws, not implemented        |
| `Client.invalidate` (unbound)           | Client/index.ts:566   | PARTIAL     | Only logs warning              |
| `QueryClient.prefetch`                  | Client/index.ts:638   | UNTESTED    | No test coverage found         |
| `Server.toHttpHandler`                  | Server/index.ts:377   | INCOMPLETE  | Basic, no SSE support          |

### Dead Code

| Code                                    | Location              | Reason                         |
|-----------------------------------------|-----------------------|--------------------------------|
| `HashMap`, `HashSet`, `Option` imports  | Reactivity/index.ts   | Imported but unused            |
| `Ref` import                            | Reactivity/index.ts   | Imported but unused            |

### Underutilized Code

| Code                                    | Used In               | Missing Usage                  |
|-----------------------------------------|-----------------------|--------------------------------|
| `OptimisticConfig`                      | Procedure/index.ts    | No runtime implementation      |
| `Procedure.Stream`                      | Tests only            | No real SSE implementation     |
| `Transport batching options`            | Transport/index.ts    | Documented but not implemented |

---

## 11. Integration Gaps Summary

### Critical Gaps

1. **React Integration Missing**
   - React hooks are stubs
   - Provider component is noop
   - Reactivity not connected to React

2. **SSE/Streaming Incomplete**
   - `sendHttpStream` just converts single response
   - No actual EventSource implementation

3. **HTTP Handler Basic**
   - No streaming support
   - No batching implementation
   - No header forwarding

### Moderate Gaps

4. **Optimistic Updates Not Implemented**
   - `OptimisticConfig` defined but not used
   - No rollback mechanism

5. **Batching Not Implemented**
   - Options exist but code just does single requests

6. **Server Dependencies Require Manual Wiring**
   - Loopback transport needs explicit `Effect.provide()`

### Minor Gaps

7. **Some Unused Imports**
   - Effect imports in Reactivity module

8. **Missing Type Exports**
   - `ProcedurePayload`, `ProcedureSuccess` referenced in tests but not exported

---

## 12. Recommendations

### For Better Coupling

1. **Create Transport.scoped() pattern**
   ```typescript
   // Auto-provide server deps for loopback
   export const loopbackScoped = <D, R>(
     server: Server<D, R>,
     deps: Layer.Layer<R>
   ): Layer.Layer<Transport> =>
     loopback(server).pipe(Layer.provide(deps))
   ```

2. **Unify request ID generation**
   - Currently `Transport.generateRequestId()` used but could be centralized

3. **Add type-level validation for invalidation paths**
   ```typescript
   // Client.invalidate should verify paths exist in router
   readonly invalidate: <P extends Router.Paths<D>[]>(paths: P) => void
   ```

4. **Create ServerLayer helper**
   ```typescript
   // Server.toLayer() that properly types R requirements
   export const toLayer = <D, R>(
     server: Server<D, R>
   ): Layer.Layer<ServerService, never, R>
   ```

### For Missing Features

5. **Implement React Provider properly**
   - Use `@effect-atom/atom-react`
   - Connect ManagedRuntime to React context

6. **Implement actual SSE transport**
   - Use EventSource or fetch with readable streams
   - Add reconnection logic

7. **Add batching implementation**
   - Use `Ref` for request queue
   - Use `Deferred` for responses
   - Add debounce/window logic

---

## 13. Module Coupling Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              PUBLIC API                                     │
│                              index.ts                                       │
│   ┌──────────┬──────────┬────────┬────────┬───────────┬──────────┬──────┐  │
│   │Procedure │  Router  │ Client │ Server │ Transport │Reactivity│Result│  │
│   └────┬─────┴────┬─────┴───┬────┴───┬────┴─────┬─────┴────┬─────┴──────┘  │
│        │          │         │        │          │          │               │
└────────│──────────│─────────│────────│──────────│──────────│───────────────┘
         │          │         │        │          │          │
         │          │         │        │          │          │
    ┌────▼────┐ ┌───▼───┐ ┌───▼───┐ ┌──▼──┐ ┌────▼────┐ ┌───▼─────┐
    │Procedure│◄┤Router │◄┤Client │ │Srvr │◄┤Transport│ │Reactvty │
    │         │ │       │ │       │ │     │ │         │ │         │
    │ schemas │ │ paths │ │ proxy │ │hndlr│ │ http    │ │subscribe│
    │ guards  │ │ tags  │ │ hooks │ │ mw  │ │ mock    │ │invalidte│
    │         │ │       │ │ effect│ │     │ │ loopbck │ │         │
    └────┬────┘ └───────┘ └───┬───┘ └──┬──┘ └────┬────┘ └────┬────┘
         │                    │        │         │           │
         │                    │        │         │           │
         │       ┌────────────┴────────┴─────────┴───────────┘
         │       │
         ▼       ▼
    ┌────────────────┐
    │   Middleware   │
    │                │
    │ Tag, implement │
    │ all, execute   │
    └────────────────┘
```

**Legend:**
- `◄` indicates import dependency
- Arrows flow from dependent to dependency

---

## Conclusion

The module integration is **well-structured with no circular dependencies**. The primary gaps are in:

1. **React integration** (stubs only)
2. **Streaming/SSE** (minimal implementation)
3. **Some typed connections** (invalidation paths, server layer)

The loopback transport demonstrates proper Client ↔ Server communication, validating the core integration architecture. Layer composition works correctly but requires manual dependency provision for server-side services.
