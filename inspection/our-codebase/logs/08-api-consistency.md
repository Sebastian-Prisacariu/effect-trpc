# API Consistency Analysis

## Executive Summary

This analysis examines the effect-trpc codebase for API naming consistency, pattern adherence, missing type guards, and overall API surface design. The codebase shows **strong overall consistency** with a few areas that could benefit from alignment.

---

## 1. Naming Conventions Analysis

### 1.1 Constructor Functions

| Module | Pattern | Functions | Assessment |
|--------|---------|-----------|------------|
| Procedure | `query`, `mutation`, `stream` | Direct verbs | Consistent |
| Router | `make` | Effect pattern | Consistent |
| Client | `make` | Effect pattern | Consistent |
| Server | `make` | Effect pattern | Consistent |
| Transport | `http`, `mock`, `make`, `loopback` | Mixed | **Needs review** |
| Middleware | `Tag`, `implement`, `implementWrap`, `all` | Mixed | Partially consistent |
| Reactivity | `make` (internal), `register`, `invalidate` | Actions | Consistent |
| SSR | `dehydrate`, `createPrefetch`, `Hydrate` (component) | Actions/Component | Consistent |

**Issue:** Transport uses inconsistent naming:
- `http()`, `mock()`, `loopback()` - Named transports (factory pattern)
- `make()` - Generic factory (Effect pattern)

**Recommendation:** This is actually **acceptable** - the named factories (`http`, `mock`, `loopback`) are conveniences that call the generic `make()` pattern. This matches Effect's approach (e.g., `Layer.effect`, `Layer.succeed`, `Layer.scoped` vs generic composition).

### 1.2 Type Guard Functions

| Module | Guards Present | Pattern | Status |
|--------|----------------|---------|--------|
| Procedure | `isProcedure`, `isQuery`, `isMutation`, `isStream` | `is{Type}` | **Complete** |
| Router | None | - | **Missing** |
| Client | None | - | **Missing** |
| Server | `isServer` | `is{Type}` | **Partial** |
| Transport | None | - | **Missing** |
| Middleware | `isMiddlewareTag`, `isCombinedMiddleware`, `isApplicable` | `is{Type}` | **Complete** |
| Reactivity | None | - | **N/A** (no branded types) |
| SSR | `isServer`, `isClient` | `is{State}` | Environment checks only |

### 1.3 Type Utility Functions

| Module | Pattern | Examples |
|--------|---------|----------|
| Procedure | `Payload<P>`, `Success<P>`, `Error<P>`, `Invalidates<P>` | Type extractors |
| Router | `Paths<D>`, `ProcedureAt<D, Path>`, `Flatten<D>`, `DefinitionOf<R>` | Type extractors |
| Client | `ClientProxy<D>`, `ProcedureClient<P>` | Type transformers |
| Server | `HandlerFor<P, R>`, `Handlers<D, R>` | Type transformers |
| Transport | `MockHandlers<D>` (internal) | Type transformer |
| Middleware | `Provides<M>`, `Failure<M>` | Type extractors |

**Assessment:** Consistent `{PropertyName}<T>` pattern throughout.

---

## 2. Missing Type Guards

### 2.1 Definitely Missing

```typescript
// Router/index.ts - Should add:
export const isRouter = (u: unknown): u is Router<any> =>
  typeof u === "object" && u !== null && RouterTypeId in u

export const isDefinition = (u: unknown): u is Definition =>
  typeof u === "object" && u !== null && 
  Object.values(u).every(v => isProcedure(v) || isDefinition(v))
```

```typescript
// Client/index.ts - Should add:
export const isClient = (u: unknown): u is Client<any> =>
  typeof u === "object" && u !== null && ClientTypeId in u

export const isBoundClient = (u: unknown): u is BoundClient<any> =>
  isClient(u) && "shutdown" in u
```

```typescript
// Transport/index.ts - Should add:
export const isTransportRequest = (u: unknown): u is TransportRequest =>
  typeof u === "object" && u !== null && 
  "id" in u && "tag" in u && "payload" in u

export const isSuccess = (u: unknown): u is Success =>
  typeof u === "object" && u !== null && 
  "_tag" in u && (u as any)._tag === "Success"

export const isFailure = (u: unknown): u is Failure =>
  typeof u === "object" && u !== null && 
  "_tag" in u && (u as any)._tag === "Failure"

export const isStreamChunk = (u: unknown): u is StreamChunk =>
  typeof u === "object" && u !== null && 
  "_tag" in u && (u as any)._tag === "StreamChunk"

export const isStreamEnd = (u: unknown): u is StreamEnd =>
  typeof u === "object" && u !== null && 
  "_tag" in u && (u as any)._tag === "StreamEnd"

export const isTransportError = (u: unknown): u is TransportError =>
  u instanceof TransportError
```

### 2.2 Currently Using Schema.is() Instead

The codebase uses `Schema.is(Success)` in `Client/index.ts:118`, which is **correct** but could be inconsistent with explicit guards elsewhere.

**Decision Point:** 
- **Option A:** Add explicit `isSuccess`, `isFailure`, etc. guards (consistent API)
- **Option B:** Use `Schema.is()` throughout (leverage Effect Schema)

**Recommendation:** Add thin wrappers for developer convenience:

```typescript
// Transport/index.ts
export const isSuccess = Schema.is(Success)
export const isFailure = Schema.is(Failure)
export const isStreamChunk = Schema.is(StreamChunk)
export const isStreamEnd = Schema.is(StreamEnd)
```

---

## 3. Pattern Consistency Analysis

### 3.1 TypeId Patterns

All modules correctly implement the TypeId pattern:

```typescript
// Consistent pattern across modules
export const ModuleTypeId: unique symbol = Symbol.for("effect-trpc/Module")
export type ModuleTypeId = typeof ModuleTypeId
```

| Module | TypeIds | Status |
|--------|---------|--------|
| Procedure | `ProcedureTypeId`, `QueryTypeId`, `MutationTypeId`, `StreamTypeId` | OK |
| Router | `RouterTypeId` | OK |
| Client | `ClientTypeId` | OK |
| Server | `ServerTypeId` | OK |
| Transport | `TransportTypeId` | OK (unused) |
| Middleware | `MiddlewareTypeId`, `MiddlewareTagTypeId` | OK |

**Note:** `TransportTypeId` is defined but not used. Consider:
1. Adding to `TransportService` interface
2. Or removing unused TypeId

### 3.2 Pipeable Implementation

| Module | Implements Pipeable | Status |
|--------|---------------------|--------|
| Procedure | Yes (via `ProcedureProto`) | OK |
| Router | Yes (via `RouterProto`) | OK |
| Client | No (returns plain object) | **Should add** |
| Server | Yes (inline) | OK |
| Middleware | No (Context.Tag-based) | N/A |

### 3.3 Context.Tag Usage

| Module | Tags | Pattern |
|--------|------|---------|
| Client | `ClientServiceTag` | `Context.Tag()` class |
| Transport | `Transport` | `Context.Tag()` class |
| Reactivity | `PathReactivity` | `Context.Tag()` class |
| Middleware | Via `Middleware.Tag()` factory | Custom factory |

**Assessment:** Consistent use of Effect's `Context.Tag` pattern.

### 3.4 Layer Patterns

| Module | Layer Export | Pattern |
|--------|--------------|---------|
| Client | `ClientServiceLive` | `Layer.effect()` |
| Reactivity | `layer` | `Layer.scoped()` with `.pipe(Layer.provide())` |
| Transport | Functions returning `Layer.Layer` | `Layer.succeed()` |

**Issue:** Naming inconsistency:
- `ClientServiceLive` - `{Name}Live` pattern
- `layer` - lowercase generic

**Recommendation:** Use consistent naming:
- `PathReactivityLive` instead of `layer`
- Or export both: `layer` as alias to `PathReactivityLive`

---

## 4. API Surface Design Analysis

### 4.1 Module Export Categories

Each module should export in this order (Effect convention):

1. **Type IDs** (internal)
2. **Models/Types**
3. **Constructors**
4. **Combinators/Utilities**
5. **Guards**
6. **Type-level utilities**

Current status:

| Module | Order Correct | Notes |
|--------|--------------|-------|
| Procedure | Mostly | Guards after constructors OK |
| Router | Yes | |
| Client | Yes | Missing guards section |
| Server | Yes | |
| Transport | Mostly | Should group guards |
| Middleware | Yes | |
| Reactivity | Yes | |
| SSR | Yes | |

### 4.2 JSDoc Consistency

All modules use consistent JSDoc format:

```typescript
/**
 * Description
 * 
 * @since 1.0.0
 * @category category-name
 * @example
 * ```ts
 * // example code
 * ```
 */
```

**Categories used:**
- `models` - Types/interfaces
- `constructors` - Factory functions
- `guards` - Type guards
- `utilities` - Helper functions
- `type-level` - Type utilities
- `context` - Context.Tag definitions
- `errors` - Error classes
- `layers` - Layer definitions
- `services` - Service definitions
- `execution` - Runtime functions
- `combinators` - Composition functions

### 4.3 Index.ts Re-exports

Main `src/index.ts` exports:
- All modules as namespaces (`export * as Module from...`)
- Convenience type re-exports from `types.ts`

**This is correct Effect-style API design.**

---

## 5. Recommendations

### 5.1 High Priority (API Completeness)

1. **Add missing type guards:**

```typescript
// Router/index.ts
export const isRouter = (u: unknown): u is Router<any> =>
  typeof u === "object" && u !== null && RouterTypeId in u

// Client/index.ts  
export const isClient = (u: unknown): u is Client<any> =>
  typeof u === "object" && u !== null && ClientTypeId in u

// Transport/index.ts - Add Schema.is wrappers
export const isSuccess = Schema.is(Success)
export const isFailure = Schema.is(Failure)
export const isStreamChunk = Schema.is(StreamChunk)
export const isStreamEnd = Schema.is(StreamEnd)
export const isTransportError = (u: unknown): u is TransportError =>
  u instanceof TransportError
```

2. **Consider removing unused TypeId:**
   - `TransportTypeId` is defined but never used in any interface

### 5.2 Medium Priority (Consistency)

1. **Layer naming:**
   - Rename `Reactivity.layer` to `Reactivity.PathReactivityLive`
   - Or add alias: `export { layer as PathReactivityLive }`

2. **Add Pipeable to Client:**

```typescript
// Client/index.ts
const ClientProto = {
  [ClientTypeId]: ClientTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}
```

### 5.3 Low Priority (Nice-to-have)

1. **Transport convenience guards:**
   - `isTransientError` already exists
   - Add `isNetworkError`, `isTimeoutError`, `isProtocolError`

2. **SSR guards:**
   - `isDehydratedState(u: unknown): u is DehydratedState`

---

## 6. Summary Table

| Category | Status | Action Required |
|----------|--------|-----------------|
| Constructor naming | Good | None |
| Type guards | Incomplete | Add 6-8 guards |
| TypeId pattern | Good | Remove unused `TransportTypeId` |
| Pipeable | Good | Add to Client |
| Layer naming | Inconsistent | Rename `layer` |
| JSDoc | Excellent | None |
| Module structure | Excellent | None |
| Type utilities | Excellent | None |

**Overall Assessment:** The API is well-designed and mostly consistent with Effect patterns. The main gaps are missing type guards, which should be straightforward to add.

---

## 7. Complete Missing Guards Implementation

```typescript
// ============================================
// Router/index.ts - Add after utilities section
// ============================================

/**
 * Check if a value is a Router
 * 
 * @since 1.0.0
 * @category guards
 */
export const isRouter = (u: unknown): u is Router<any> =>
  typeof u === "object" && u !== null && RouterTypeId in u

// ============================================
// Client/index.ts - Add guards section
// ============================================

/**
 * Check if a value is a Client
 * 
 * @since 1.0.0
 * @category guards
 */
export const isClient = (u: unknown): u is Client<any> =>
  typeof u === "object" && u !== null && ClientTypeId in u

/**
 * Check if a value is a BoundClient
 * 
 * @since 1.0.0
 * @category guards
 */
export const isBoundClient = (u: unknown): u is BoundClient<any> =>
  isClient(u) && typeof (u as any).shutdown === "function"

// ============================================
// Transport/index.ts - Add after response schemas
// ============================================

/**
 * Check if a response is Success
 * 
 * @since 1.0.0
 * @category guards
 */
export const isSuccess = Schema.is(Success)

/**
 * Check if a response is Failure
 * 
 * @since 1.0.0
 * @category guards
 */
export const isFailure = Schema.is(Failure)

/**
 * Check if a response is StreamChunk
 * 
 * @since 1.0.0
 * @category guards
 */
export const isStreamChunk = Schema.is(StreamChunk)

/**
 * Check if a response is StreamEnd
 * 
 * @since 1.0.0
 * @category guards
 */
export const isStreamEnd = Schema.is(StreamEnd)

/**
 * Check if a value is a TransportError
 * 
 * @since 1.0.0
 * @category guards
 */
export const isTransportError = (u: unknown): u is TransportError =>
  u instanceof TransportError

/**
 * Check if a value is a TransportRequest
 * 
 * @since 1.0.0
 * @category guards
 */
export const isTransportRequest = (u: unknown): u is TransportRequest =>
  typeof u === "object" &&
  u !== null &&
  "id" in u &&
  "tag" in u &&
  "payload" in u
```
