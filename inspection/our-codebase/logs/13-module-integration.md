# Module Architecture Analysis

**Date:** 2024-03-13
**Focus:** Dependencies, circular dependencies, module boundaries, public API surface

---

## Module Dependency Graph

```
                    ┌─────────────┐
                    │   index.ts  │ (barrel export)
                    │  server.ts  │ (server barrel)
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│    Client     │  │    Server     │  │     SSR       │
│   + react.ts  │  │               │  │               │
└───────┬───────┘  └───────┬───────┘  └───────────────┘
        │                  │                  │
        │      ┌───────────┴───────────┐     │
        │      │                       │     │
        ▼      ▼                       ▼     ▼
┌───────────────┐              ┌───────────────┐
│   Transport   │◄─────────────│   Middleware  │
└───────┬───────┘              └───────────────┘
        │                              │
        └──────────────┬───────────────┘
                       │
                       ▼
               ┌───────────────┐
               │    Router     │
               └───────┬───────┘
                       │
                       ▼
               ┌───────────────┐
               │   Procedure   │
               └───────────────┘
                       │
                       ▼
               ┌───────────────┐
               │   Reactivity  │
               └───────────────┘
                       │
                       ▼
               ┌───────────────┐
               │    Result     │
               └───────────────┘
                       │
                       ▼
         ┌─────────────────────────┐
         │   External Libraries    │
         │ • effect                │
         │ • @effect-atom/atom     │
         │ • @effect/experimental  │
         └─────────────────────────┘
```

---

## Detailed Module Dependencies

### 1. **Procedure** (`src/Procedure/index.ts`)
**Dependencies:**
- `effect/Schema`
- `effect/Pipeable`

**Dependents:**
- Router, Server, Client, Transport, Middleware, types.ts

**Status:** ✅ **Clean leaf module** - no internal dependencies

---

### 2. **Router** (`src/Router/index.ts`)
**Dependencies:**
- `effect/Pipeable`
- `./Procedure/index.js`

**Dependents:**
- Server, Client, Transport (types only), types.ts

**Status:** ✅ **Clean** - minimal dependencies

---

### 3. **Transport** (`src/Transport/index.ts`)
**Dependencies:**
- `effect/Context`, `effect/Effect`, `effect/Layer`, `effect/Stream`, `effect/Schema`, `effect/Duration`, `effect/Ref`, `effect/Deferred`, `effect/Fiber`, `effect/Scope`, `effect/Pipeable`
- `./Router/index.js` (type import only)
- `./Procedure/index.js` (type import only)

**Dependents:**
- Client, Server, SSR (via Client)

**Status:** ✅ **Clean** - only type imports from internal modules

---

### 4. **Middleware** (`src/Middleware/index.ts`)
**Dependencies:**
- `effect/Context`, `effect/Effect`, `effect/Layer`, `effect/Schema`

**Dependents:**
- Server, Client (indirectly via react.ts)

**Status:** ✅ **Clean leaf module** - no internal dependencies

---

### 5. **Reactivity** (`src/Reactivity/index.ts`)
**Dependencies:**
- `effect/Context`, `effect/Effect`, `effect/Layer`, `effect/Scope`, `effect/RcMap`, `effect/Ref`, `effect/HashSet`, `effect/Function`
- `@effect/experimental/Reactivity`

**Dependents:**
- Client, Client/react.ts

**Status:** ✅ **Clean** - wraps external dependency

---

### 6. **Result** (`src/Result/index.ts`)
**Dependencies:**
- `@effect-atom/atom/Result` (re-export)

**Dependents:**
- Client, types.ts

**Status:** ✅ **Clean** - pure re-export

---

### 7. **Server** (`src/Server/index.ts`)
**Dependencies:**
- `effect/Context`, `effect/Effect`, `effect/Layer`, `effect/Pipeable`, `effect/Record`, `effect/Schema`, `effect/Stream`
- `./Router/index.js`
- `./Procedure/index.js`
- `./Transport/index.js`
- `./Middleware/index.js`

**Dependents:**
- Transport (via loopback interface type)

**Status:** ✅ **Clean** - imports only from lower-level modules

---

### 8. **Client** (`src/Client/index.ts`)
**Dependencies:**
- `effect/Context`, `effect/Effect`, `effect/Layer`, `effect/ManagedRuntime`, `effect/Record`, `effect/Schema`, `effect/Stream`, `effect/Scope`
- `./Router/index.js`
- `./Procedure/index.js`
- `./Transport/index.js`
- `./Reactivity/index.js`
- `./react.js` (internal)

**Dependents:**
- SSR, Client/react.ts (circular!)

**Status:** ⚠️ **Circular dependency detected** - see below

---

### 9. **Client/react.ts** (`src/Client/react.ts`)
**Dependencies:**
- `react`
- `effect/Effect`, `effect/Layer`, `effect/Stream`, `effect/Scope`, `effect/Function`
- `@effect-atom/atom-react`
- `@effect/experimental/Reactivity`
- `./Transport/index.js`
- `./Procedure/index.js`
- `./Router/index.js`
- `./index.js` (ClientServiceTag, ClientServiceLive) **← CIRCULAR**

**Status:** ❌ **Circular dependency with Client/index.ts**

---

### 10. **SSR** (`src/SSR/index.ts`)
**Dependencies:**
- `react`
- `@effect-atom/atom-react`

**Dependents:**
- None (top-level)

**Status:** ✅ **Clean** - top-level module

---

### 11. **types.ts** (`src/types.ts`)
**Dependencies:**
- `./Procedure/index.js` (type only)
- `./Router/index.js` (type only)
- `./Transport/index.js` (type only)
- `./Middleware/index.js` (type only)
- `./Reactivity/index.js` (type only)

**Status:** ✅ **Clean** - type-only imports

---

## Circular Dependency Analysis

### ❌ Critical Circular Dependency Found

```
Client/index.ts
    ↓ imports
Client/react.ts
    ↓ imports
Client/index.ts (ClientServiceTag, ClientServiceLive)
```

**Location in code:**
- `src/Client/react.ts:38`:
```typescript
import { ClientServiceTag, ClientServiceLive } from "./index.js"
```

**Impact:**
1. Module initialization order could cause runtime issues
2. Tree-shaking may be impacted
3. Hot module replacement issues in dev

**Recommendation:**
Extract shared types/services to a separate file:

```
Client/
├── index.ts          # Main exports + createProvider
├── react.ts          # React hooks
├── service.ts        # NEW: ClientService, ClientServiceTag, ClientServiceLive
└── types.ts          # NEW: Shared types
```

**Proposed fix:**
```typescript
// src/Client/service.ts
export interface ClientService { ... }
export class ClientServiceTag extends Context.Tag(...) {}
export const ClientServiceLive: Layer.Layer<...> = ...

// src/Client/index.ts
export * from "./service.js"
// ... rest of client

// src/Client/react.ts
import { ClientServiceTag, ClientServiceLive } from "./service.js"
```

---

## Module Boundary Design

### Strengths

1. **Clear Layering:** 
   - Foundation: Procedure, Middleware
   - Core: Router, Transport
   - Integration: Server, Client
   - UI: SSR, react.ts

2. **Type-only imports for cross-cutting concerns:**
   - Transport uses type-only imports from Router/Procedure
   - types.ts uses type-only imports throughout

3. **Single responsibility:**
   - Each module has clear, focused responsibilities
   - Procedure defines shapes, Router composes, Server handles, Client consumes

4. **Clean external dependency boundaries:**
   - Effect dependencies are consistent
   - React is optional (peerDep)
   - @effect-atom/atom is properly isolated to React layer

### Weaknesses

1. **Mixed concerns in Client:**
   - Client/index.ts handles both Effect client AND React Provider creation
   - Should separate vanilla client from React integration

2. **Server has implicit dependency on Transport types:**
   - Server uses `Transport.TransportRequest`, `Transport.TransportResponse`
   - Creates tight coupling between layers

3. **Reactivity wrapping is inconsistent:**
   - Client/react.ts imports `@effect/experimental/Reactivity` directly
   - Should use the PathReactivity wrapper consistently

---

## Public API Surface Analysis

### Entry Points

| Export | Module | Purpose |
|--------|--------|---------|
| `effect-trpc` | index.ts | Full client+server bundle |
| `effect-trpc/server` | server.ts | Server-only bundle |
| `effect-trpc/client` | (missing) | Should exist for client-only |

### Missing Entry Point: `effect-trpc/client`

**Issue:** package.json defines `./client` export but no `src/client.ts` exists!

**Fix needed:**
```typescript
// src/client.ts
export * as Client from "./Client/index.js"
export * as Transport from "./Transport/index.js"
export * as Result from "./Result/index.js"
export * as Reactivity from "./Reactivity/index.js"
export * as SSR from "./SSR/index.js"
```

### Namespace Exports (index.ts)

| Namespace | Exported Items | Notes |
|-----------|---------------|-------|
| `Procedure` | query, mutation, stream, isProcedure, isQuery, isMutation, isStream, types | ✅ Complete |
| `Router` | make, paths, get, tagOf, pathOf, tagsToInvalidate, withMiddleware, types | ✅ Complete |
| `Client` | make, ClientServiceTag, ClientServiceLive, types | ⚠️ Leaks internal ClientServiceTag |
| `Server` | make, toHttpHandler, toFetchHandler, toNextApiHandler, middleware, isServer, types | ✅ Complete |
| `Transport` | http, mock, make, loopback, Transport (tag), TransportError, types | ✅ Complete |
| `Result` | re-export from @effect-atom/atom | ✅ Thin wrapper |
| `Middleware` | Tag, implement, implementWrap, all, execute, types | ✅ Complete |
| `Reactivity` | PathReactivity, register, invalidate, layer, InnerReactivity | ⚠️ Exposes internal InnerReactivity |
| `SSR` | dehydrate, createPrefetch, Hydrate, isServer, isClient | ✅ Complete |

### Convenience Type Exports (types.ts)

| Type | Source | Status |
|------|--------|--------|
| `InferProcedurePayload` | Procedure.Payload | ✅ |
| `InferProcedureSuccess` | Procedure.Success | ✅ |
| `InferProcedureError` | Procedure.Error | ✅ |
| `InferMutationInvalidates` | Procedure.Invalidates | ✅ |
| `InferRouterPaths` | Router.Paths | ✅ |
| `InferRouterDefinition` | Router.DefinitionOf | ✅ |
| `InferRouterProcedure` | Router.ProcedureAt | ✅ |
| `TransportRequest` | Transport.TransportRequest | ✅ |
| `TransportResponse` | Transport.TransportResponse | ✅ |
| `TransportError` | Transport.TransportError | ✅ |
| `MiddlewareRequest` | Middleware.MiddlewareRequest | ✅ |
| `ProcedureType` | Middleware.ProcedureType | ✅ |
| `PathReactivityService` | Reactivity.PathReactivityService | ✅ |

---

## Recommendations

### Critical (Fix Now)

1. **Fix Client ↔ react.ts circular dependency**
   - Extract `ClientService` to `src/Client/service.ts`
   - Both index.ts and react.ts import from service.ts

2. **Create missing `src/client.ts` entry point**
   - package.json references it but file doesn't exist

### High Priority

3. **Hide internal exports from public API**
   - `InnerReactivity` should not be exposed
   - `ClientServiceTag` / `ClientServiceLive` should be internal
   - Consider `@internal` tags and separate internal barrel

4. **Consistent Reactivity usage**
   - Client/react.ts should use PathReactivity, not direct @effect/experimental

### Medium Priority

5. **Separate vanilla Client from React**
   - Move React Provider creation to react.ts
   - Keep Client/index.ts pure Effect
   - Lazy-load React parts

6. **Document module boundaries**
   - Add README.md in src/ describing module relationships
   - Define clear import rules in CLAUDE.md

### Low Priority

7. **Consider monorepo structure**
   - If React becomes heavyweight, split to `effect-trpc-react`
   - Keep core runtime-agnostic

---

## Dependency Version Matrix

| Package | Version | Purpose |
|---------|---------|---------|
| `effect` | ^3.12.0 | Core runtime |
| `@effect-atom/atom` | ^0.5.0 | State management |
| `@effect-atom/atom-react` | ^0.5.0 | React hooks |
| `@effect/experimental` | ^0.58.0 | Reactivity system |
| `@effect/platform` | ^0.70.0 | HTTP (peer) |
| `@effect/rpc` | ^0.73.2 | RPC protocol (peer, unused?) |
| `react` | ^18/19 | UI (optional peer) |

**Note:** `@effect/rpc` is listed as peer dependency but not imported anywhere. Consider removing or documenting planned usage.

---

## Summary

| Metric | Status |
|--------|--------|
| Circular Dependencies | ❌ 1 found (Client ↔ react.ts) |
| Missing Entry Points | ❌ client.ts missing |
| Module Layering | ✅ Good (foundation → core → integration → UI) |
| API Surface Cleanliness | ⚠️ Some internal exports leaked |
| Type-only Import Usage | ✅ Well-used where appropriate |
| External Dependency Isolation | ✅ Good boundaries |

**Overall:** Architecture is sound but needs cleanup of the Client circular dependency and API surface refinement.
