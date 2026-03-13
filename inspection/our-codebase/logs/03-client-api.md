# Client API Analysis

## Summary

The Client module provides a proxy-based API for consuming procedures defined in a Router. It supports both React hooks and vanilla Effect/Promise usage patterns through a bound vs unbound client design.

## Architecture Overview

```
                      ┌─────────────────────┐
                      │   Client.make(R)    │
                      │   Creates Unbound   │
                      │   Client + Proxy    │
                      └─────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
      ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
      │   .Provider   │ │  .invalidate  │ │   .provide()  │
      │  (React FC)   │ │  (warns only) │ │  → BoundClient│
      └───────────────┘ └───────────────┘ └───────┬───────┘
                                                  │
                                    ┌─────────────┼─────────────┐
                                    │             │             │
                                    ▼             ▼             ▼
                            ┌───────────┐ ┌───────────┐ ┌───────────┐
                            │ .run      │ │.runPromise│ │.invalidate│
                            │ (Effect)  │ │ (Promise) │ │ (actual)  │
                            └───────────┘ └───────────┘ └───────────┘
```

## Core Components

### 1. ClientService (Internal Service)

**Location:** `src/Client/index.ts:66-93`

The internal Effect service that handles RPC communication:

```typescript
interface ClientService {
  readonly send: <S, E>(
    tag: string,
    payload: unknown,
    successSchema: Schema.Schema<S, unknown>,
    errorSchema: Schema.Schema<E, unknown>
  ) => Effect.Effect<S, E | Transport.TransportError>
  
  readonly sendStream: <S, E>(...) => Stream.Stream<S, E | Transport.TransportError>
  
  readonly invalidate: (tags: readonly string[]) => Effect.Effect<void>
}
```

**Strengths:**
- Clean separation between RPC protocol and transport
- Schema-driven encoding/decoding
- Stream support built-in

**Issues:**
- `invalidate` silently does nothing if Reactivity service not in scope (line 188-192)

### 2. Client Types

#### Unbound Client (`Client<R>`)

**Location:** `src/Client/index.ts:209-226`

```typescript
interface Client<R extends Router.Router<Router.Definition>> {
  readonly Provider: React.FC<ProviderProps>
  readonly invalidate: (paths: readonly Router.Paths<...>[]) => void
  readonly provide: (layer: Layer<Transport.Transport>) => BoundClient<R>
}
```

- Has React Provider component
- `invalidate()` only warns when called - **does not work without Provider**
- `provide()` creates a BoundClient with working invalidation

#### Bound Client (`BoundClient<R>`)

**Location:** `src/Client/index.ts:234-248`

```typescript
type BoundClient<R> = ClientProxy<...> & {
  readonly invalidate: (paths: readonly Router.Paths<...>[]) => void
  readonly shutdown: () => Promise<void>
}
```

- Created via `api.provide(layer)`
- Has working `invalidate()` (uses ManagedRuntime)
- Requires manual `shutdown()` cleanup

### 3. Proxy Pattern

**Location:** `src/Client/index.ts:545-558`

```typescript
const buildProxy = <Def extends Definition>(
  def: Def,
  pathParts: readonly string[]
): ClientProxy<Def> =>
  Record.map(def, (value, key) => {
    if (Procedure.isProcedure(value)) {
      return createProcedureClient(tag, value, null)
    }
    return buildProxy(value as Router.Definition, newPath)
  }) as ClientProxy<Def>
```

**Analysis:**
- Uses `Record.map` from Effect to recursively build proxy structure
- Matches router definition shape exactly
- Tags constructed from rootTag + path parts joined with "/"
- Example: `@api` + `users` + `list` → `@api/users/list`

**Type Safety:**
- `ClientProxy<D>` properly maps Definition → ProcedureClient types
- Conditional types distinguish Query/Mutation/Stream clients

### 4. Procedure Clients

#### QueryClient

**Location:** `src/Client/index.ts:308-334`

```typescript
interface QueryClient<Payload, Success, Error> {
  readonly useQuery: UseQueryFn<Payload, Success, Error>
  readonly run: Payload extends void
    ? Effect.Effect<Success, Error | TransportError, ClientServiceTag>
    : (payload: Payload) => Effect.Effect<...>
  readonly runPromise: (payload?: Payload) => Promise<Success>
  readonly prefetch: (payload?: Payload) => Effect.Effect<void, ...>
}
```

**Void Payload Handling:** Uses conditional types to omit payload parameter when `void`.

#### MutationClient

**Location:** `src/Client/index.ts:342-357`

```typescript
interface MutationClient<Payload, Success, Error> {
  readonly useMutation: UseMutationFn<...>
  readonly run: (payload: Payload) => Effect.Effect<...>
  readonly runPromise: (payload: Payload) => Promise<Success>
}
```

**Invalidation:** Handled in `createProcedureClient` (line 652-666) - converts paths to tags using `Reactivity.pathsToTags`.

#### StreamClient

**Location:** `src/Client/index.ts:365-377`

```typescript
interface StreamClient<Payload, Success, Error> {
  readonly useStream: UseStreamFn<...>
  readonly stream: Payload extends void
    ? Stream.Stream<Success, Error | TransportError, ClientServiceTag>
    : (payload: Payload) => Stream.Stream<...>
}
```

## Type Exports

### Currently Exported

| Export | Type | Purpose |
|--------|------|---------|
| `ClientTypeId` | symbol | Type branding |
| `Client<R>` | interface | Unbound client type |
| `BoundClient<R>` | type | Bound client type |
| `ClientProxy<D>` | type | Recursive proxy type |
| `ProcedureClient<P>` | type | Generic procedure client |
| `QueryClient<P,S,E>` | interface | Query-specific client |
| `MutationClient<P,S,E>` | interface | Mutation-specific client |
| `StreamClient<P,S,E>` | interface | Stream-specific client |
| `QueryOptions` | interface | useQuery options |
| `QueryResult<S,E>` | interface | useQuery return type |
| `MutationOptions<S,E>` | interface | useMutation options |
| `MutationResult<P,S,E>` | interface | useMutation return type |
| `StreamOptions` | interface | useStream options |
| `StreamResult<S,E>` | interface | useStream return type |
| `ClientService` | interface | Internal service interface |
| `ClientServiceTag` | class | Context.Tag for DI |
| `ClientServiceLive` | Layer | Service implementation |
| `ProviderProps` | interface | Provider component props |
| `make` | function | Constructor |
| `Definition` | re-export | From Router module |

### Missing Exports (Tests Expect)

| Expected Export | Status | Severity |
|-----------------|--------|----------|
| `ProcedurePayload<P>` | **MISSING** | High |
| `ProcedureSuccess<P>` | **MISSING** | High |
| `ProcedureError<P>` | **MISSING** | High |

**Evidence:** Tests in `test/client.test.ts` (lines 128-151) and `test/types.test.ts` (lines 163-181) use these types.

**Current Workaround:** Use `Procedure.Payload`, `Procedure.Success`, `Procedure.Error` directly instead of `Client.ProcedurePayload`.

## Invalidation Implementation

### Current Status: Partially Implemented

#### What Works

1. **Declarative Invalidation on Mutations:**
   ```typescript
   Procedure.mutation({
     success: User,
     invalidates: ["users"],  // Works!
   })
   ```
   - Paths converted to tags in `createProcedureClient` (line 660-662)
   - Uses `Reactivity.pathsToTags(rootTag, invalidatePaths)`

2. **BoundClient.invalidate():**
   ```typescript
   const api = Client.make(router).provide(Transport.http("/api"))
   api.invalidate(["users.list"])  // Works - has runtime
   ```

3. **React Hooks Auto-Subscribe:**
   - `useQuery` subscribes to tag for refetch (line 196-201 in react.ts)
   - Mutations trigger invalidation after success (line 279-283 in react.ts)

#### What Doesn't Work

1. **Unbound Client.invalidate():**
   ```typescript
   const api = Client.make(router)
   api.invalidate(["users"])  // Just warns! No effect!
   ```
   - Line 567-573: Only logs a warning
   - No runtime available to run Effect

2. **ClientService.invalidate() without Reactivity:**
   ```typescript
   // In ClientServiceLive
   invalidate: (tags) =>
     Effect.gen(function* () {
       const reactivity = yield* Effect.serviceOption(Reactivity.Reactivity)
       if (reactivity._tag === "Some") {
         reactivity.value.invalidate(tags)
       }
       // Silent failure if Reactivity not in scope!
     }),
   ```

### Reactivity Service Integration

**Location:** `src/Reactivity/index.ts`

The Reactivity module provides:
- `subscribe(tag, callback)` → unsubscribe function
- `invalidate(tags)` → triggers all matching callbacks
- Hierarchical matching: invalidating `@api/users` also invalidates `@api/users/list`

**Provider Integration:** In `react.ts` line 84-95:
```typescript
const fullLayer = ClientServiceLive.pipe(
  Layer.provideMerge(Reactivity.ReactivityLive),
  Layer.provide(layer)
)
const runtime = ManagedRuntime.make(fullLayer)
const reactivity = Reactivity.make()  // Creates separate instance!
```

**Issue:** Two separate Reactivity instances are created - one in the Layer (for ClientService), one directly (for React context). They're not connected!

## Issues Summary

### Critical

| Issue | Location | Impact |
|-------|----------|--------|
| Missing type exports: `ProcedurePayload`, `ProcedureSuccess`, `ProcedureError` | `src/Client/index.ts` | Tests fail, poor DX |
| Dual Reactivity instances in Provider | `src/Client/react.ts:89` | Invalidation may not propagate between hooks and ClientService |

### High

| Issue | Location | Impact |
|-------|----------|--------|
| Unbound `invalidate()` is no-op | `src/Client/index.ts:567-573` | Confusing API - method exists but doesn't work |
| Silent failure when Reactivity missing | `src/Client/index.ts:188-192` | Hard to debug invalidation issues |
| Stream abort not implemented | `src/Client/react.ts:433-435` | Cannot cancel running streams |

### Medium

| Issue | Location | Impact |
|-------|----------|--------|
| `runPromise` throws if unbound | `src/Client/index.ts:639, 673` | Runtime error instead of type error |
| No prefetch implementation for BoundClient | `src/Client/index.ts` | Feature gap |
| `staleTime` option unused | `src/Client/react.ts:148` | Dead code |

### Low

| Issue | Location | Impact |
|-------|----------|--------|
| React types declared globally | `src/Client/index.ts:500-506` | Type pollution |
| No JSDoc on hook options | `src/Client/index.ts:399-403` | Missing documentation |

## Recommendations

### 1. Add Missing Type Exports (Critical)

```typescript
// Add to src/Client/index.ts

/**
 * Extract payload type from a procedure
 * @since 1.0.0
 * @category type-level
 */
export type ProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>

/**
 * Extract success type from a procedure
 * @since 1.0.0
 * @category type-level
 */
export type ProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>

/**
 * Extract error type from a procedure
 * @since 1.0.0
 * @category type-level
 */
export type ProcedureError<P extends Procedure.Any> = Procedure.Error<P>
```

### 2. Fix Reactivity Instance Split (Critical)

```typescript
// In createProvider
const fullLayer = ClientServiceLive.pipe(
  Layer.provideMerge(Reactivity.ReactivityLive),
  Layer.provide(layer)
)
const runtime = ManagedRuntime.make(fullLayer)

// Get the same reactivity instance from the runtime
const reactivity = await runtime.runPromise(Reactivity.Reactivity)
```

### 3. Make Unbound invalidate() Type-Safe (High)

Either:
- Remove `invalidate` from unbound Client interface
- Or make it require explicit Reactivity dependency

### 4. Add Stream Cancellation (High)

Use Effect Fiber to properly track and interrupt running streams:

```typescript
const fiberRef = useRef<Fiber.RuntimeFiber<void, Error> | null>(null)

// In useEffect
const fiber = runtime.runFork(effect)
fiberRef.current = fiber

// In cleanup
if (fiberRef.current) {
  Effect.runPromise(Fiber.interrupt(fiberRef.current))
}
```

## Proxy Pattern Strengths

1. **Zero-cost abstraction**: Proxy built at initialization, not runtime
2. **Full type inference**: TypeScript knows exact shape
3. **Matches Router structure**: `api.users.list` mirrors `router.definition.users.list`
4. **Lazy procedure client creation**: Only creates what's accessed

## Comparison to tRPC

| Feature | effect-trpc | tRPC v11 |
|---------|-------------|----------|
| Proxy-based API | Yes | Yes |
| Type inference | Router → Client | Router → Client |
| React hooks | Built-in | @tanstack/react-query adapter |
| Invalidation | Tag-based with hierarchy | QueryClient invalidation |
| Bound vs Unbound | Explicit split | Implicit via caller |
| Effect integration | Native | None |
