# Module Integration Analysis

## Overview

This analysis examines how modules in effect-trpc integrate and depend on each other, checking for circular dependencies, evaluating module boundary design, and assessing the public API surface.

## Module Structure

```
src/
  index.ts          # Main entry point - re-exports all modules
  server.ts         # Server-only entry point
  Client/
    index.ts        # Client module (777 lines)
    react.ts        # React hooks implementation (462 lines)
  Server/
    index.ts        # Server module (619 lines)
  Router/
    index.ts        # Router module (420 lines)
  Procedure/
    index.ts        # Procedure module (544 lines)
  Middleware/
    index.ts        # Middleware module (400 lines)
  Transport/
    index.ts        # Transport module (601 lines)
  Reactivity/
    index.ts        # Reactivity module (305 lines)
  Result/
    index.ts        # Re-export from @effect-atom/atom (10 lines)
```

## Dependency Graph

```
                     External Dependencies
                            |
    +-------------------------------------------------------+
    |                                                       |
    v                                                       v
+--------+                                          +---------------+
| effect |                                          | @effect-atom  |
| (core) |                                          | /atom/Result  |
+--------+                                          +---------------+
    ^                                                       ^
    |                                                       |
    +--------------------+----------------------------------+
                         |
    +--------------------|------------------------------------+
    |                    v                                    |
    |              +-----------+                              |
    |              | Procedure |  (foundation - no deps)      |
    |              +-----------+                              |
    |                    ^                                    |
    |                    |                                    |
    |    +---------------+----------------+                   |
    |    |               |                |                   |
    |    v               v                v                   |
    | +--------+   +-----------+   +------------+             |
    | | Router |   | Transport |   | Middleware |             |
    | +--------+   | (type-only)|  +------------+             |
    |    ^         +-----------+                              |
    |    |               |                                    |
    |    |    +----------+--------+                           |
    |    |    |                   |                           |
    |    v    v                   v                           |
    | +--------+           +------------+                     |
    | | Server |           | Reactivity | (standalone)        |
    | +--------+           +------------+                     |
    |    ^                       ^                            |
    |    |                       |                            |
    |    +-----------+-----------+                            |
    |                |                                        |
    |                v                                        |
    |           +--------+                                    |
    |           | Client |                                    |
    |           +--------+                                    |
    |                ^                                        |
    |                |                                        |
    |           +--------+                                    |
    |           | react  | (circular import!)                 |
    |           +--------+                                    |
    +---------------------------------------------------------+
```

### Detailed Import Map

| Module | Imports From (Internal) |
|--------|------------------------|
| **Procedure** | None (leaf module) |
| **Router** | Procedure |
| **Middleware** | None (leaf module) |
| **Reactivity** | None (leaf module) |
| **Transport** | Router (type-only), Procedure (type-only) |
| **Server** | Router, Procedure, Transport, Middleware |
| **Client** | Router, Procedure, Transport, Reactivity, react.ts |
| **react.ts** | Transport, Procedure, Router, Reactivity, **Client/index.ts** |
| **Result** | @effect-atom/atom/Result (external) |

## Circular Dependency Check

### Identified Circular Dependency

**Location:** `Client/index.ts` <-> `Client/react.ts`

```
Client/index.ts
  imports from "./react.js":
    - createProvider
    - createUseQuery  
    - createUseMutation
    - createUseStream

Client/react.ts
  imports from "./index.js":
    - ClientServiceTag
    - ClientServiceLive
    - QueryOptions
    - QueryResult
    - MutationOptions
    - MutationResult
    - StreamOptions
    - StreamResult
```

### Circular Dependency Analysis

**Severity:** Medium-High

**Current Mitigation:** The code uses try-catch around the react imports:
```typescript
// Client/index.ts:717-726
const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  try {
    return createProviderImpl(router)
  } catch {
    // React not available - return stub
    return ({ children }) => children as any
  }
}
```

**Problems:**
1. **Module initialization order** depends on JavaScript runtime behavior
2. **Type imports** from `./index.js` in `react.ts` may cause issues during bundling
3. **Tree-shaking** becomes unreliable due to circular references
4. **Testing isolation** is compromised - can't test react.ts without loading index.ts

### Recommendation: Extract Shared Types

Create a shared internal module for types used by both files:

```
Client/
  index.ts           # Main client, imports from internal + react
  react.ts           # React hooks, imports from internal only
  internal/
    types.ts         # ClientServiceTag, options types, result types
    service.ts       # ClientServiceLive
```

## Module Boundary Analysis

### Well-Designed Boundaries

| Module | Grade | Notes |
|--------|-------|-------|
| **Procedure** | A | Pure leaf module, no internal dependencies |
| **Router** | A | Single dependency on Procedure, clear purpose |
| **Middleware** | A | Standalone, clear API |
| **Reactivity** | A | Standalone, no internal dependencies |
| **Transport** | A- | Type-only imports from Router/Procedure |
| **Result** | A | Clean re-export pattern |

### Boundaries Needing Improvement

| Module | Grade | Issues |
|--------|-------|--------|
| **Client** | C+ | Circular dependency with react.ts, too many responsibilities |
| **Server** | B | Many dependencies but justified |
| **react.ts** | C | Circular dependency, should be isolated |

### Client Module Responsibilities (Too Many)

The Client module currently handles:
1. ClientService interface and implementation
2. Client type definitions
3. Hook type definitions (QueryOptions, QueryResult, etc.)
4. Proxy builder logic
5. Bound client logic
6. Provider creation
7. Hook wrappers

**Recommendation:** Split into:
- `Client/types.ts` - All type definitions
- `Client/service.ts` - ClientService implementation
- `Client/proxy.ts` - Proxy building logic  
- `Client/index.ts` - Main exports and composition

## Import/Export Cleanliness

### Public API Surface (index.ts)

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

**Assessment:** Clean namespace-style exports. Each module is isolated under its name.

### Server Entry Point (server.ts)

```typescript
export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"
export * as Server from "./Server/index.js"
```

**Assessment:** Correctly excludes Client, Transport, and Reactivity which are client-side concerns.

### Missing Entry Points

The package.json defines:
- `.` -> index.ts (all modules)
- `./server` -> server.ts (server modules)
- `./client` -> Missing! (no client.ts exists)

**Issue:** The `./client` export path is defined but there's no `src/client.ts` file.

## Architectural Recommendations

### 1. Fix Circular Dependency (Priority: High)

**Option A: Extract Internal Types**
```
src/Client/
  internal/
    types.ts      # ClientServiceTag, QueryOptions, etc.
    service.ts    # ClientServiceLive
  index.ts        # Main exports
  react.ts        # React hooks (imports from internal only)
```

**Option B: Lazy Loading**
```typescript
// Client/index.ts
let createProviderImpl: typeof import("./react.js").createProvider | null = null

const loadReactModule = async () => {
  if (!createProviderImpl) {
    const mod = await import("./react.js")
    createProviderImpl = mod.createProvider
  }
  return createProviderImpl
}
```

### 2. Create Missing Client Entry Point (Priority: Medium)

```typescript
// src/client.ts
export * as Client from "./Client/index.js"
export * as Transport from "./Transport/index.js"
export * as Reactivity from "./Reactivity/index.js"
export * as Result from "./Result/index.js"

// Re-export shared types
export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
```

### 3. Add TypeID Guards Module (Priority: Low)

Currently each module defines its own TypeId symbols. Consider:

```typescript
// src/internal/type-ids.ts
export const ProcedureTypeId = Symbol.for("effect-trpc/Procedure")
export const RouterTypeId = Symbol.for("effect-trpc/Router")
export const ServerTypeId = Symbol.for("effect-trpc/Server")
// ... etc
```

This prevents Symbol.for collision issues if the library is loaded multiple times.

### 4. Consider Effect-Style Internal Modules (Priority: Low)

Effect uses an `internal/` pattern for implementation details:

```
src/
  Procedure/
    index.ts       # Public API only
  internal/
    procedure.ts   # Implementation details
```

Benefits:
- Clear public/private boundary
- Easier to refactor internals
- Smaller public API surface

## Type-Only vs Value Imports

### Good Patterns Found

```typescript
// Transport/index.ts - correctly uses type-only imports
import type * as Router from "../Router/index.js"
import type * as Procedure from "../Procedure/index.js"
```

### Missing Type-Only Annotations

Some imports could be type-only but aren't marked:

```typescript
// Client/index.ts:40
import type * as Scope from "effect/Scope"  // Correct!

// But in react.ts:17
import * as Option from "effect/Option"  // Could be `import type`
```

## Summary

### Strengths
- Clean namespace-based public API
- Most modules have clear single responsibilities
- Good use of Effect patterns (Context.Tag, Layer, etc.)
- Type-only imports where appropriate (mostly)
- Separate server entry point

### Issues to Address

| Priority | Issue | Impact |
|----------|-------|--------|
| High | Circular dependency Client <-> react | Build/bundle reliability |
| Medium | Missing `./client` entry point file | Package export broken |
| Medium | Client module has too many responsibilities | Maintainability |
| Low | TypeId symbols not centralized | Potential collision |
| Low | Some imports could be type-only | Bundle size |

### Module Coupling Score

| Module Pair | Coupling | Assessment |
|-------------|----------|------------|
| Client-react | High (circular) | Needs refactoring |
| Server-Router | Medium | Acceptable |
| Server-Procedure | Medium | Acceptable |
| Server-Transport | Low | Good |
| Router-Procedure | Low | Good |
| All others | None/Minimal | Excellent |

**Overall Grade: B**

The module structure is generally well-designed with clear boundaries, but the circular dependency in the Client module is a significant issue that should be resolved before the library is considered production-ready.
