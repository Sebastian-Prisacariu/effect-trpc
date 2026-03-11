# Transport Specification

The Transport system allows swapping how RPC calls are executed — HTTP, mock, in-memory, etc.

---

## Overview

```typescript
import { Transport } from "effect-trpc"

// The Tag (service identifier)
Transport.Transport

// Create HTTP transport layer
Transport.http(url: string): Layer<Transport.Transport>

// Create custom transport layer (type-safe)
Transport.make<R>(handlers: TypedHandlers<R>): Layer<Transport.Transport>
```

---

## Transport.Transport (Tag)

The service tag, following Effect's pattern (`HttpClient.HttpClient`):

```typescript
export namespace Transport {
  export class Transport extends Context.Tag("@effect-trpc/Transport")<
    Transport,
    TransportService
  >() {}
}

// TransportService interface (internally uses Effect RPC's Protocol)
interface TransportService {
  readonly call: <Tag extends string>(
    tag: Tag,
    payload: unknown
  ) => Effect<unknown, RpcClientError>
}
```

---

## Transport.http (Default HTTP Layer)

Creates a Layer that provides `Transport.Transport` using HTTP:

```typescript
export const http = (url: string): Layer<Transport.Transport, never, never>
```

**Usage:**

```typescript
import { Transport } from "effect-trpc"

const httpLayer = Transport.http("/api/trpc")

// In React Provider
<Client.Provider layer={Transport.http("/api/trpc")}>

// In Effect program
program.pipe(Effect.provide(Transport.http("/api/trpc")))
```

**Implementation:**

Internally uses Effect RPC's `layerProtocolHttp`:

```typescript
export const http = (url: string) =>
  layerProtocolHttp({ url }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson)
  )
```

---

## Transport.make (Custom Transport)

Creates a type-safe custom transport. TypeScript enforces all routes are implemented with correct types:

```typescript
export const make = <R extends Router>(
  handlers: {
    [K in RoutePaths<R>]: (
      input: InputOf<R, K>
    ) => Effect<OutputOf<R, K>, ErrorOf<R, K>>
  }
): Layer<Transport.Transport>
```

**Usage:**

```typescript
const mockTransport = Transport.make<typeof appRouter>({
  // TypeScript enforces these match the router definition
  "user.list": () => Effect.succeed([mockUser]),
  "user.byId": ({ id }) => Effect.succeed({ id, name: `User ${id}` }),
  "user.create": (input) => Effect.succeed({ id: "1", ...input }),
  // ❌ TypeScript error if you miss any route
  // ❌ TypeScript error if input/output types don't match
})
```

**Type inference:**

```typescript
// Given this router
const appRouter = Router.make({
  user: Procedure.family("user", {
    list: Procedure.query({ success: Schema.Array(User) }),
    byId: Procedure.query({ payload: Schema.Struct({ id: Schema.String }), success: User }),
  }),
})

// Transport.make infers:
Transport.make<typeof appRouter>({
  "user.list": () => Effect<User[], never>,        // Must return User[]
  "user.byId": ({ id }: { id: string }) => Effect<User, NotFoundError>, // Must accept { id }, return User
})
```

---

## Type Utilities

```typescript
// Extract all route paths from router
type RoutePaths<R> = "user.list" | "user.byId" | "user.create" | ...

// Extract input type for a route
type InputOf<R, K> = K extends "user.byId" ? { id: string } : ...

// Extract output type for a route
type OutputOf<R, K> = K extends "user.list" ? User[] : ...

// Extract error type for a route
type ErrorOf<R, K> = K extends "user.byId" ? NotFoundError : ...
```

---

## Integration with Client

The Client depends on `Transport.Transport`:

```typescript
// Client.make returns Effect that requires Transport
Client.make<AppRouter>()
// ^^ Effect<ApiClient<AppRouter>, never, Transport.Transport>

// Provide transport to resolve
const api = yield* Client.make<AppRouter>().pipe(
  Effect.provide(Transport.http("/api/trpc"))
)

// Or use unsafeMake (no Effect wrapper)
const api = Client.unsafeMake<AppRouter>()
// Methods require Transport in R channel:
api.user.list.run  // Effect<User[], Error, Transport.Transport>
```

---

## React Provider

Provider accepts a Transport layer. **Type is inferred from `api`** — no need to specify `<AppRouter>`:

```typescript
const api = Client.unsafeMake<AppRouter>()

// Production
<api.Provider layer={Transport.http("/api/trpc")}>
  <App />
</api.Provider>

// Testing — type inferred from api!
<api.Provider layer={Transport.make({
  "user.list": () => Effect.succeed([...]),  // TS knows what routes are needed
  "user.byId": ({ id }) => Effect.succeed({...}),
})}>
  <App />  {/* Same components! */}
</api.Provider>

// Pre-defined transport also works
<api.Provider layer={mockTransport}>
  <App />
</api.Provider>
```

Components don't know which transport — they just use `api.user.list.useQuery()`.

---

## Use Cases

### Production (HTTP)

```typescript
<Client.Provider layer={Transport.http("/api/trpc")}>
```

### Unit Tests (Mock specific routes)

```typescript
const testTransport = Transport.make<typeof appRouter>({
  "user.list": () => Effect.succeed([{ id: "1", name: "Test" }]),
  "user.byId": () => Effect.fail(new NotFoundError({ entity: "User", id: "999" })),
  // ... all routes
})

<Client.Provider layer={testTransport}>
```

### Integration Tests (Real handlers, mock DB)

```typescript
const integrationTransport = Transport.fromLayer(
  UserProceduresLive.pipe(
    Layer.provide(MockDatabaseLayer)
  )
)

<Client.Provider layer={integrationTransport}>
```

### Storybook (Predictable data)

```typescript
const storybookTransport = Transport.make<typeof appRouter>({
  "user.list": () => Effect.succeed(storybookUsers),
  // ... predictable mock data for visual testing
})
```

---

## Future: Transport.fromLayer

For integration testing with real handlers:

```typescript
// Run real handlers without HTTP
export const fromLayer = <R>(
  handlers: Layer<AppHandlers>
): Layer<Transport.Transport>

// Usage
const e2eTransport = Transport.fromLayer(
  FullHandlersLive.pipe(Layer.provide(TestDatabaseLayer))
)
```

---

## Summary

| API | Returns | Use Case |
|-----|---------|----------|
| `Transport.Transport` | Tag | Service identifier |
| `Transport.http(url)` | `Layer<Transport.Transport>` | Production HTTP |
| `Transport.make<R>(handlers)` | `Layer<Transport.Transport>` | Mock/test (type-safe) |
| `Transport.fromLayer(handlers)` | `Layer<Transport.Transport>` | Integration tests |
