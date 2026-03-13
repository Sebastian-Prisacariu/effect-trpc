# API Consistency Analysis

## Executive Summary

The effect-trpc codebase demonstrates **strong overall consistency** in naming conventions and patterns across its modules. The API follows Effect ecosystem conventions while establishing its own clear patterns. There are a few minor inconsistencies and missing utilities identified below.

---

## Module Overview

| Module | Primary Exports | Pattern Compliance |
|--------|-----------------|-------------------|
| **Procedure** | `procedure`, `Procedure.toLayer` | Excellent |
| **Middleware** | `Middleware()`, `Middleware.toLayer` | Excellent |
| **Procedures** | `Procedures.make`, `procedures()` | Good |
| **Router** | `Router.make`, `Router.use`, `Router.provide` | Excellent |
| **Client** | `Client.make`, `Client.HttpLive`, `Client.Live` | Excellent |
| **Transport** | `Transport.HttpLive` | Good |
| **WebSocket** | Various services with `.layer()` / `.Live` | Good |

---

## Naming Conventions Found

### 1. Service Tags (Context.TagClass pattern)

All services follow the `Context.TagClass` pattern with consistent naming:

```typescript
// Pattern: class Name extends Name_base
declare class Client extends Client_base { }
declare class Transport extends Transport_base { }
declare class Proxy extends Proxy_base { }
declare class WebSocketConnection extends WebSocketConnection_base { }
declare class WebSocketClient extends WebSocketClient_base { }
declare class WebSocketReconnect extends WebSocketReconnect_base { }
declare class SubscriptionRegistry extends SubscriptionRegistry_base { }
declare class ConnectionRegistry extends ConnectionRegistry_base { }
declare class SubscriptionManager extends SubscriptionManager_base { }
declare class WebSocketCodec extends WebSocketCodec_base { }
declare class WebSocketHeartbeat extends WebSocketHeartbeat_base { }
declare class WebSocketAuth extends WebSocketAuth_base { }
declare class TrpcLogger extends TrpcLogger_base { }
```

**Assessment**: Fully consistent with Effect ecosystem conventions.

### 2. Layer Naming Conventions

| Pattern | Examples | Status |
|---------|----------|--------|
| `ServiceName.Live` | `Client.Live`, `ConnectionRegistry.Live`, `SubscriptionRegistry.Live` | Consistent |
| `ServiceName.layer(config)` | `WebSocketConnection.layer()`, `WebSocketClient.layer()`, `ConnectionRegistry.layer()` | Consistent |
| `ServiceNameLive` (standalone) | `WebSocketCodecLive`, `WebSocketHeartbeatLive`, `TrpcLoggerLive` | Consistent |
| `makeServiceNameLayer()` | `makeWebSocketConnectionLayer()`, `makeWebSocketClientLayer()` | Consistent |
| `ServiceName.Test` | `WebSocketAuth.Test` | Used appropriately |

**Assessment**: Good, but some inconsistency between `ServiceName.Live` vs `ServiceNameLive`.

### 3. Schema/Error Classes

All tagged errors follow the `Schema.TaggedError` pattern:

```typescript
declare class InputValidationError extends InputValidationError_base { }
declare class OutputValidationError extends OutputValidationError_base { }
declare class NotFoundError extends NotFoundError_base { }
declare class UnauthorizedError extends UnauthorizedError_base { }
declare class ForbiddenError extends ForbiddenError_base { }
declare class RateLimitError extends RateLimitError_base { }
declare class TimeoutError extends TimeoutError_base { }
declare class InternalError extends InternalError_base { }
declare class NetworkError extends NetworkError_base { }
declare class WebSocketConnectionError extends WebSocketConnectionError_base { }
// ... and more
```

**Assessment**: Fully consistent with Effect Schema patterns.

### 4. TypeId Symbols

```typescript
declare const MiddlewareDefinitionTypeId: unique symbol;
declare const RpcClientErrorTypeId: unique symbol;
declare const RpcResponseErrorTypeId: unique symbol;
declare const RpcTimeoutErrorTypeId: unique symbol;
declare const WebSocketErrorTypeId: unique symbol;
```

**Assessment**: Consistent pattern for runtime type identification.

### 5. Factory Functions

| Pattern | Examples |
|---------|----------|
| `make()` static method | `Router.make()`, `Procedures.make()`, `Client.make()` |
| `make*()` standalone | `makeWebSocketConnectionLayer()`, `makeWebSocketAuth()`, `makeTrpcLoggerLayer()` |
| `create*()` for handlers | `createRouteHandler()`, `createSubscriptionHook()`, `createTRPCReact()` |
| `toLayer()` static method | `Middleware.toLayer()`, `Procedure.toLayer()`, `Procedures.toLayer()` |

**Assessment**: Consistent. `make` for Effect-style creation, `create` for React/handler creation.

---

## Consistent Patterns Found

### 1. `isX` Type Guards

```typescript
// Core TRPC errors
declare const isTRPCError: (u: unknown) => u is TRPCError;
declare const isRpcClientError: (u: unknown) => u is RpcClientError;
declare const isRpcResponseError: (u: unknown) => u is RpcResponseError;
declare const isRpcTimeoutError: (u: unknown) => u is RpcTimeoutError;
declare const isRpcError: (u: unknown) => u is RpcClientError | RpcResponseError | RpcTimeoutError;

// WebSocket errors
declare const isWebSocketError: (u: unknown) => u is WebSocketError;

// Definitions
declare const isMiddlewareDefinition: (value: unknown) => value is MiddlewareDefinition<any, any, any, any>;
declare const isProceduresGroup: (value: unknown) => value is AnyProceduresGroup;

// Protocol messages
declare const isAuthMessage: (msg: FromClientMessage) => msg is AuthMessage;
declare const isSubscribeMessage: (msg: FromClientMessage) => msg is SubscribeMessage;
declare const isUnsubscribeMessage: (msg: FromClientMessage) => msg is UnsubscribeMessage;
declare const isClientDataMessage: (msg: FromClientMessage) => msg is ClientDataMessage;
declare const isPingMessage: (msg: FromClientMessage) => msg is PingMessage;
declare const isDataMessage: (msg: FromServerMessage) => msg is DataMessage;
declare const isErrorMessage: (msg: FromServerMessage) => msg is ErrorMessage;
declare const isCompleteMessage: (msg: FromServerMessage) => msg is CompleteMessage;
```

**Assessment**: Excellent coverage. All error types and protocol messages have guards.

### 2. State Union Types with Constructors

```typescript
// Connection state
type ConnectionState = { _tag: "Disconnected" } | { _tag: "Connecting" } | ...
declare const ConnectionState: {
  readonly Disconnected: ConnectionState;
  readonly Connecting: ConnectionState;
  readonly Connected: (connectedAt: DateTimeType.Utc) => ConnectionState;
  // ...
};

// Subscription state
type SubscriptionState = { _tag: "Subscribing" } | { _tag: "Active" } | ...
declare const SubscriptionState: {
  readonly Subscribing: SubscriptionState;
  readonly Active: (subscribedAt: DateTimeType.Utc) => SubscriptionState;
  // ...
};

// Client state
type ClientState = { _tag: "Disconnected" } | { _tag: "Connecting" } | ...
declare const ClientState: {
  readonly Disconnected: ClientState;
  readonly Connecting: ClientState;
  // ...
};

// Subscription events
type SubscriptionEvent<A> = { _tag: "Subscribed" } | { _tag: "Data"; data: A } | ...
declare const SubscriptionEvent: {
  readonly Subscribed: SubscriptionEvent<never>;
  readonly Data: <A>(data: A) => SubscriptionEvent<A>;
  // ...
};

// Unsubscribe reasons
type UnsubscribeReason = { _tag: "ClientUnsubscribed" } | ...
declare const UnsubscribeReason: {
  ClientUnsubscribed: { readonly _tag: "ClientUnsubscribed" };
  // ...
};
```

**Assessment**: Excellent. Tagged union pattern is consistently applied.

### 3. Builder Pattern

```typescript
// Middleware builder
interface MiddlewareBuilder<CtxIn, CtxOut, I, E, R> {
  input<I2, IFrom>(schema: Schema): MiddlewareBuilder<...>;
  error<Errors>(...errors: Errors): MiddlewareBuilder<...>;
  requires<T1>(t1: T1): MiddlewareBuilder<...>;
  provides<Additions>(): Effect<MiddlewareDefinition<...>>;
}

// Procedure builder
interface ProcedureBuilder<I, A, E, Ctx, R> {
  description(text: string): ProcedureBuilder<...>;
  input<I2>(schema: Schema): ProcedureBuilder<...>;
  output<A2>(schema: Schema): ProcedureBuilder<...>;
  error<Errors>(...errors: Errors): ProcedureBuilder<...>;
  requires<T1>(t1: T1): ProcedureBuilder<...>;
  use<M>(middleware: M): ProcedureBuilder<...>;
  query(): Effect<ProcedureDefinition<...>>;
  mutation(): Effect<ProcedureDefinition<...>>;
  stream(): Effect<ProcedureDefinition<...>>;
  // ...
}
```

**Assessment**: Excellent fluent API design.

### 4. Interface Shape + Service Pattern

```typescript
// Pattern: InterfaceShape + Service tag
interface WebSocketConnectionShape { ... }
declare class WebSocketConnection extends WebSocketConnection_base { }

interface WebSocketClientShape { ... }
declare class WebSocketClient extends WebSocketClient_base { }

interface SubscriptionRegistryShape { ... }
declare class SubscriptionRegistry extends SubscriptionRegistry_base { }
```

**Assessment**: Consistent Effect service pattern.

---

## Inconsistencies Discovered

### 1. `isProcedureDefinition` Guard Missing

**Issue**: While `isMiddlewareDefinition` and `isProceduresGroup` exist, there's no `isProcedureDefinition` guard.

```typescript
// Exists:
declare const isMiddlewareDefinition: (value: unknown) => value is MiddlewareDefinition<...>;
declare const isProceduresGroup: (value: unknown) => value is AnyProceduresGroup;

// Missing:
// declare const isProcedureDefinition: (value: unknown) => value is ProcedureDefinition<...>;
```

**Recommendation**: Add `isProcedureDefinition` guard for consistency.

### 2. `isRouter` / `isRouterShape` Guard Missing

**Issue**: No runtime type guard for `RouterShape`.

```typescript
// Missing:
// declare const isRouterShape: (value: unknown) => value is RouterShape<...>;
```

**Recommendation**: Add `isRouterShape` guard.

### 3. Inconsistent Layer Naming

**Issue**: Some services use `ServiceName.Live` while others use standalone `ServiceNameLive`.

```typescript
// Static property pattern:
Client.Live
ConnectionRegistry.Live
SubscriptionRegistry.Live
SubscriptionManager.Live

// Standalone constant pattern:
WebSocketCodecLive
WebSocketHeartbeatLive
WebSocketReconnectLive
SubscriptionRegistryLive  // Duplicate of SubscriptionRegistry.Live!
TrpcLoggerLive
```

**Recommendation**: Standardize on one pattern. The `ServiceName.Live` pattern is more discoverable and namespaced.

### 4. `ConnectionStateCtor` vs `ConnectionState` Naming

**Issue**: In `types-PmcKPi02.d.ts`, there's `ConnectionStateCtor` but in `WebSocketClient` there's just `ConnectionState`.

```typescript
// In types-PmcKPi02.d.ts:
declare const ConnectionStateCtor: { ... }

// In WebSocketClient:
declare const ConnectionState: { ... }
```

**Recommendation**: Use consistent naming (prefer `ConnectionState` without `Ctor` suffix).

### 5. Missing `generate*` Functions Parity

**Issue**: There are `generateClientId` and `generateSubscriptionId` but no `generateRequestId` exported from the same module.

```typescript
// In types module:
declare const generateClientId: Effect.Effect<ClientId>;
declare const generateSubscriptionId: Effect.Effect<SubscriptionId>;

// In logging module (different):
declare const generateRequestId: () => string;  // Note: Not Effect-wrapped
```

**Recommendation**: Either move all ID generation to one module or ensure consistent Effect-wrapping.

### 6. React Hook Return Type Inconsistency

**Issue**: `UseQueryReturn` is defined as an alias for `QueryResult`, but `UseMutationReturn` extends `MutationResult`.

```typescript
// Alias pattern:
type UseQueryReturn<A, E> = QueryResult<A, E>;

// Extension pattern:
interface UseMutationReturn<A, E, I> extends MutationResult<A, E> {
  readonly mutateAsync: (input: I) => Promise<Exit<A, E>>;
  readonly mutate: (input: I) => Effect.Effect<A, E>;
  readonly reset: () => void;
}
```

**Recommendation**: This is acceptable as the mutation return type has additional methods. Consider documenting this design choice.

---

## Missing Guards or Utilities

### Missing Type Guards

| Type | Status | Priority |
|------|--------|----------|
| `isProcedureDefinition` | Missing | High |
| `isRouterShape` | Missing | Medium |
| `isProcedureService` | Missing | Low |
| `isMiddlewareService` | Missing | Low |

### Missing Utilities

| Utility | Description | Priority |
|---------|-------------|----------|
| `Procedure.is` | Type guard for ProcedureDefinition | High |
| `Router.is` | Type guard for RouterShape | Medium |
| `Router.extract` | Extract flat procedure map from router | Low |
| `Middleware.extract` | Extract middleware chain info | Low |

---

## API Design Recommendations

### 1. Add Missing Type Guards

```typescript
// Add to procedures module
export const isProcedureDefinition = (value: unknown): value is ProcedureDefinition<any, any, any, any, any> =>
  typeof value === 'object' && value !== null && (value as any)._tag === 'ProcedureDefinition'

// Add to router module  
export const isRouterShape = (value: unknown): value is RouterShape<any> =>
  typeof value === 'object' && value !== null && (value as any)._tag === 'Router'
```

### 2. Standardize Layer Exports

Prefer the namespaced pattern for discoverability:

```typescript
// Instead of:
export const WebSocketCodecLive = ...

// Prefer:
export class WebSocketCodec extends WebSocketCodec_base {
  static Live = ...
}
```

### 3. Add Namespace Re-exports

For better IDE autocomplete, consider namespace re-exports:

```typescript
export const Procedure = {
  toLayer,
  is: isProcedureDefinition,
  // ... other utilities
}

export const Router = {
  make,
  use,
  provide,
  is: isRouterShape,
  // ...
}
```

### 4. Consistent ID Generation

Move all ID generation to a single `ids` or `generators` module:

```typescript
// effect-trpc/ids
export const generateRequestId: Effect<RequestId>
export const generateClientId: Effect<ClientId>
export const generateSubscriptionId: Effect<SubscriptionId>
```

### 5. Add JSDoc `@category` Tags

The codebase already has excellent `@since` tags. Consider adding `@category` for better documentation grouping:

```typescript
/**
 * @since 0.1.0
 * @category guards
 */
export const isProcedureDefinition = ...

/**
 * @since 0.1.0
 * @category constructors
 */
export const procedure = ...
```

---

## Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Naming Consistency | 9/10 | Minor inconsistencies in Layer naming |
| Pattern Adherence | 9/10 | Excellent Effect ecosystem compliance |
| Type Guard Coverage | 7/10 | Missing guards for core types |
| API Discoverability | 8/10 | Good namespace pattern, could improve |
| Documentation | 8/10 | Good JSDoc, could add categories |

**Overall Score: 8.2/10** - Strong API design with minor improvements needed.

---

## Action Items

### High Priority
1. [ ] Add `isProcedureDefinition` type guard
2. [ ] Add `isRouterShape` type guard
3. [ ] Standardize Layer naming convention

### Medium Priority
4. [ ] Consolidate ID generation functions
5. [ ] Add `@category` JSDoc tags
6. [ ] Remove duplicate `SubscriptionRegistryLive` export

### Low Priority
7. [ ] Add `Procedure.is`, `Router.is` namespace shortcuts
8. [ ] Document design choices (e.g., why UseQueryReturn vs UseMutationReturn differ)
