# API Consistency and Naming Conventions Analysis

**Date:** 2024-01-XX  
**Scope:** effect-trpc codebase at `/Users/sebastian/Documents/tRPC-Effect/src`

---

## Executive Summary

The effect-trpc codebase shows **good overall consistency** with Effect library conventions. All modules follow a similar structure, use `make` consistently for constructors, and have comprehensive JSDoc annotations. However, there are several areas that need attention:

1. **Module structure deviates from Effect standard** (no `internal/` separation)
2. **Missing Pipeable implementation** on some types
3. **TypeIds exported but marked `@internal`** (potential conflict)
4. **Inconsistent dual API pattern** (missing data-last versions)
5. **Some missing `@example` annotations** in JSDoc

---

## 1. Module Naming Conventions

### Status: GOOD

All modules use PascalCase naming, consistent with Effect conventions:
- `Client/`
- `Server/`
- `Router/`
- `Procedure/`
- `Transport/`
- `Middleware/`
- `Reactivity/`
- `Result/`

Each module has a single `index.ts` file that serves as both public API and implementation.

### Deviation from Effect Standard

**Issue:** Effect uses `internal/` subdirectories to separate public API from implementation.

```
// Effect standard structure
src/ModuleName/
├── index.ts          # Public API only (re-exports)
└── internal/
    ├── types.ts      # Internal types
    └── impl.ts       # Implementation

// Current structure
src/ModuleName/
└── index.ts          # Everything in one file
```

**Recommendation:** Consider splitting larger modules (Client, Server, Transport) into `index.ts` + `internal/`.

---

## 2. Export Patterns Analysis

### Status: MOSTLY CONSISTENT

#### Main Entry Point (`src/index.ts`)

```typescript
export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Client from "./Client/index.js"
export * as Server from "./Server/index.js"
export * as Transport from "./Transport/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"
export * as Reactivity from "./Reactivity/index.js"
```

All modules are exported as namespaces - **matches Effect pattern**.

#### Secondary Entry Point (`src/server.ts`)

```typescript
export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"
export * as Server from "./Server/index.js"
```

Provides server-only exports - **good separation**.

### Export Counts by Module

| Module | Types | Interfaces | Consts | Classes | Total |
|--------|-------|------------|--------|---------|-------|
| Procedure | 11 | 6 | 8 | 0 | 25 |
| Router | 7 | 4 | 7 | 0 | 18 |
| Client | 12 | 10 | 3 | 1 | 26 |
| Server | 3 | 3 | 4 | 0 | 10 |
| Transport | 6 | 2 | 9 | 6 | 23 |
| Middleware | 5 | 6 | 8 | 0 | 19 |
| Reactivity | 2 | 2 | 7 | 1 | 12 |
| Result | 0 | 0 | 0 | 0 | 0 (re-export) |

---

## 3. Naming Inconsistencies

### Constructor Naming: CONSISTENT

All constructors use `make`:

```typescript
// Procedure/index.ts
export const query = ...    // Creates Query (uses type name as function)
export const mutation = ... // Creates Mutation
export const stream = ...   // Creates Stream

// Router/index.ts
export const make = ...     // Creates Router

// Client/index.ts
export const make = ...     // Creates Client

// Server/index.ts
export const make = ...     // Creates Server

// Transport/index.ts
export const make = ...     // Creates custom Transport
export const http = ...     // Creates HTTP transport
export const mock = ...     // Creates mock transport
export const loopback = ... // Creates loopback transport

// Reactivity/index.ts
export const make = ...     // Creates ReactivityService

// Middleware/index.ts
export const Tag = ...      // Creates MiddlewareTag (non-standard)
export const implement = ...  // Creates implementation Layer
export const implementWrap = ... // Creates wrap implementation Layer
export const all = ...      // Combines middlewares
```

**Issues Found:**

1. **Procedure uses lowercase type names** (`query`, `mutation`, `stream`) while others use `make`
   - This is intentional and follows tRPC convention
   - Consider documenting this decision

2. **Middleware.Tag vs Middleware.make**
   - Uses `Tag` instead of `make`
   - Reason: Creates a Context.Tag, not a full middleware
   - **Recommendation:** Consider renaming to `tag` (lowercase) to match Procedure pattern

3. **Transport specialized constructors**
   - `http`, `mock`, `loopback` are good, descriptive names
   - `make` is generic - **could be renamed to `custom`** for clarity

### Guard Functions: CONSISTENT

All guards follow `is<TypeName>` pattern:

```typescript
// Procedure
isProcedure, isQuery, isMutation, isStream

// Server
isServer

// Middleware
isMiddlewareTag, isCombinedMiddleware, isApplicable

// Transport
isTransientError
```

### Missing Guards

- **Router** - No `isRouter` guard
- **Client** - No `isClient` guard
- **Reactivity** - No guards

---

## 4. JSDoc Coverage and Quality

### Status: EXCELLENT

**All 123 `@since` annotations found across codebase.**  
**All 113 `@category` annotations found.**

### JSDoc Completeness by Module

| Module | Has @since | Has @category | Has @example | Missing Examples |
|--------|------------|---------------|--------------|------------------|
| Procedure | Yes | Yes | Yes | None |
| Router | Yes | Yes | Yes | `get`, `tagOf`, `pathOf` |
| Client | Yes | Yes | Yes | Some internal types |
| Server | Yes | Yes | Yes | `isServer` |
| Transport | Yes | Yes | Yes | `isTransientError`, `generateRequestId` |
| Middleware | Yes | Yes | Yes | `isMiddlewareTag`, `isCombinedMiddleware` |
| Reactivity | Yes | Yes | Yes | `shouldInvalidate` |

### JSDoc Issues Found

1. **Module-level JSDoc missing `@module` on some files**
   - `src/index.ts` has `@example` but no `@module`
   - `src/server.ts` has `@module` - good

2. **Some internal helpers lack documentation**
   - `createProcedureClient` (Client)
   - `buildBoundProxy` (Client)
   - `tagToPath` (Transport)

3. **Category naming variations**
   - Uses: `models`, `constructors`, `utilities`, `guards`, `errors`, `type-level`, `context`, `layers`, `handlers`, `http`, `effects`, `combinators`, `execution`, `middleware`, `services`, `hooks`
   - Effect typically uses: `constructors`, `models`, `combinators`, `refinements`, `getters`, `guards`, `conversions`, `errors`
   - **Recommendation:** Standardize to Effect categories

---

## 5. `@since` Annotations

### Status: PRESENT ON ALL PUBLIC EXPORTS

All public exports have `@since 1.0.0`.

**Issue:** All annotations use `1.0.0` even though the package is not yet released.
- This is acceptable for pre-1.0 development
- Should be updated to actual version upon release

---

## 6. Organization of Exports

### Barrel Files Analysis

**Main entry (`src/index.ts`):**
- Clean namespace re-exports
- Good module-level JSDoc with example

**Server entry (`src/server.ts`):**
- Proper subset for server-only usage
- Has `@module` tag

**Result module (`src/Result/index.ts`):**
- Pure re-export from `@effect-atom/atom/Result`
- Clean and minimal

### Missing Export Patterns

1. **No separate `/client` entry point**
   - Consider `src/client.ts` for client-only exports

2. **No `/react` entry point**
   - React hooks are currently in Client module
   - Consider separation when React implementation is complete

---

## 7. Effect Library Conventions Comparison

### TypeId Naming: CORRECT

```typescript
// Effect pattern
const TypeId: unique symbol = Symbol.for("package/TypeName")
type TypeId = typeof TypeId

// Our pattern - matches!
export const RouterTypeId: unique symbol = Symbol.for("effect-trpc/Router")
export type RouterTypeId = typeof RouterTypeId
```

### Context.Tag Usage: CORRECT

```typescript
// Effect pattern
class MyService extends Context.Tag("@package/MyService")<
  MyService,
  ServiceImpl
>() {}

// Our pattern - matches!
export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}
```

### Schema.TaggedError Usage: CORRECT

```typescript
// Our pattern
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  { ... }
) {}
```

### Schema.TaggedClass Usage: CORRECT

```typescript
// Our pattern
export class Success extends Schema.TaggedClass<Success>()("Success", {
  id: Schema.String,
  value: Schema.Unknown,
}) {}
```

### Deviations from Effect Conventions

1. **No `dual` API pattern**
   - Effect uses `dual()` for data-first and data-last versions
   - Our codebase only provides data-first functions
   - Example: `Router.paths(router)` vs `router.pipe(Router.paths)`

2. **No `flow` or `pipe` compatibility on many functions**
   - Utility functions like `tagsToInvalidate`, `tagOf`, `pathOf` are data-first only

3. **Layer naming**
   - Effect uses `<Name>Live` for implementations
   - We use `ReactivityLive` (correct) but `ClientServiceLive` (correct)
   - Consistent

---

## 8. TypeId Conventions

### Status: FOLLOWS EFFECT PATTERN

All TypeIds follow the convention:

```typescript
/** @internal */
export const <Name>TypeId: unique symbol = Symbol.for("effect-trpc/<Name>")

/** @internal */
export type <Name>TypeId = typeof <Name>TypeId
```

### TypeId Inventory

| Module | TypeId(s) |
|--------|-----------|
| Client | `ClientTypeId` |
| Server | `ServerTypeId` |
| Router | `RouterTypeId` |
| Procedure | `ProcedureTypeId`, `QueryTypeId`, `MutationTypeId`, `StreamTypeId` |
| Transport | `TransportTypeId` |
| Middleware | `MiddlewareTypeId`, `MiddlewareTagTypeId` |
| Reactivity | `ReactivityTypeId` |

### Issue: TypeId Export Conflict

**Problem:** TypeIds are marked `@internal` but are exported publicly.

```typescript
/** @internal */
export const RouterTypeId: unique symbol = ...
```

Effect convention is to:
1. Export TypeId for type checking: `hasProperty(value, TypeId)`
2. Mark as `@internal` to discourage direct use
3. Document that it's for internal use only

**This is acceptable** but could be clearer.

---

## 9. API Surface Inconsistencies

### Procedure Module

**Consistent API:**
- `query(options)` → `Query`
- `mutation(options)` → `Mutation`  
- `stream(options)` → `Stream`
- `isProcedure(u)`, `isQuery(u)`, `isMutation(u)`, `isStream(u)`

**Inconsistency:** Procedure interface has `.middleware()` method but no standalone `withMiddleware` function.

### Router Module

**Consistent API:**
- `make(tag, definition)` → `Router`
- `paths(router)`, `get(router, path)`, `tagOf(router, path)`, `pathOf(router, tag)`, `tagsToInvalidate(router, path)`
- `withMiddleware(middlewares, definition)` → `DefinitionWithMiddleware`

**Missing:** No `isRouter` guard.

### Client Module

**Consistent API:**
- `make(router)` → `Client`
- Client has `.provide(layer)` → `BoundClient`

**Missing:** No `isClient` guard.

### Server Module

**Consistent API:**
- `make(router, handlers)` → `Server`
- `toHttpHandler(server, options)` → HTTP handler function
- `middleware(m)` → Server → Server (curried)
- `isServer(value)`

**Note:** `middleware` uses curried style for pipe compatibility - good!

### Transport Module

**Consistent API:**
- `make(service)` → Layer
- `http(url, options)` → Layer
- `mock(handlers)` → Layer
- `loopback(server)` → Layer
- `isTransientError(error)`, `generateRequestId()`

**Note:** All transport constructors return `Layer.Layer<Transport>` - consistent!

### Middleware Module

**Consistent API:**
- `Tag(id, provides)` → `MiddlewareTag`
- `implement(tag, run)` → Layer
- `implementWrap(tag, wrap)` → Layer
- `all(...middlewares)` → `CombinedMiddleware`
- `execute(middlewares, request, handler)` → Effect
- `isMiddlewareTag(value)`, `isCombinedMiddleware(value)`, `isApplicable(value)`

**Inconsistency:** `Tag` should be lowercase `tag` to match Procedure convention.

### Reactivity Module

**Consistent API:**
- `make()` → `ReactivityService`
- `subscribe(tag, callback)` → Effect
- `invalidate(tags)` → Effect
- `getSubscribedTags` → Effect
- `pathsToTags(rootTag, paths)`, `shouldInvalidate(subscribedTag, invalidatedTag)`
- `ReactivityLive` → Layer

**Missing:** No guards.

---

## 10. Pipe-ability Analysis

### Status: PARTIAL IMPLEMENTATION

#### Types with `.pipe()` Support

| Type | Has Pipeable | Implements `.pipe()` |
|------|--------------|---------------------|
| `Router` | Yes | Yes |
| `Server` | Yes | Yes |
| `Procedure` (Query/Mutation/Stream) | Yes | Yes |
| `Client` | No | No |
| `BoundClient` | No | No |
| `MiddlewareTag` | Inherits from Context.Tag | Yes (via Tag) |
| `CombinedMiddleware` | No | No |

#### Functions That Support Piping

```typescript
// Server.middleware is curried - good for piping
Server.make(router, handlers).pipe(
  Server.middleware(AuthMiddleware)
)
```

#### Missing Pipe Support

1. **Client** - No Pipeable implementation
   - Could add for chaining configuration

2. **CombinedMiddleware** - No Pipeable implementation
   - Lower priority

3. **Most utility functions** - Data-first only
   - `Router.paths(router)` vs `router.pipe(Router.paths)`
   - `Router.tagsToInvalidate(router, path)` vs `router.pipe(Router.tagsToInvalidate(path))`

---

## Recommendations Summary

### High Priority

1. **Add missing guards**
   - `isRouter(value): value is Router<any>`
   - `isClient(value): value is Client<any>`

2. **Standardize category names** to match Effect conventions
   - Replace `type-level` with `types`
   - Replace `services` with `models` or `context`
   - Replace `http` with `constructors` or `adapters`
   - Replace `hooks` with `react` or `models`
   - Replace `effects` with `functions` or `constructors`

3. **Rename `Middleware.Tag` to `Middleware.tag`**
   - Match lowercase convention used by Procedure

### Medium Priority

4. **Add Pipeable to Client**
   - Allows `Client.make(router).pipe(Client.configure(...))`

5. **Add dual API for utility functions**
   - Use `dual()` for `paths`, `tagOf`, `pathOf`, etc.

6. **Split large modules into `internal/`**
   - Client (760 lines)
   - Transport (601 lines)
   - Server (496 lines)

### Low Priority

7. **Add more `@example` JSDoc**
   - Utility functions
   - Guard functions

8. **Create separate entry points**
   - `effect-trpc/client` for client-only
   - `effect-trpc/react` for React integration

---

## Appendix: Full TypeId Listing

```typescript
// Client
Symbol.for("effect-trpc/Client")

// Server
Symbol.for("effect-trpc/Server")

// Router
Symbol.for("effect-trpc/Router")

// Procedure
Symbol.for("effect-trpc/Procedure")
Symbol.for("effect-trpc/Procedure/Query")
Symbol.for("effect-trpc/Procedure/Mutation")
Symbol.for("effect-trpc/Procedure/Stream")

// Transport
Symbol.for("effect-trpc/Transport")

// Middleware
Symbol.for("effect-trpc/Middleware")
Symbol.for("effect-trpc/MiddlewareTag")

// Reactivity
Symbol.for("effect-trpc/Reactivity")
```

All TypeIds use the `effect-trpc/` prefix consistently.

---

## Appendix: Category Usage

```
constructors (10 occurrences)
models (24 occurrences)
utilities (9 occurrences)
guards (8 occurrences)
type-level (10 occurrences)
context (2 occurrences)
layers (2 occurrences)
handlers (1 occurrence)
http (2 occurrences)
effects (3 occurrences)
combinators (1 occurrence)
execution (1 occurrence)
middleware (2 occurrences)
services (2 occurrences)
hooks (6 occurrences)
errors (1 occurrence)
```
