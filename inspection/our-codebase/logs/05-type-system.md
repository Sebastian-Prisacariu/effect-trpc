# Type System Analysis - effect-trpc

**Generated:** 2024-12-XX  
**Focus:** Type exports, test type errors, tsconfig configuration

## Table of Contents

1. [Export Structure](#1-export-structure)
2. [Type Hierarchy](#2-type-hierarchy)
3. [Test Files Analysis](#3-test-files-analysis)
4. [TSConfig Configuration](#4-tsconfig-configuration)
5. [Type Errors & Missing Exports](#5-type-errors--missing-exports)
6. [Recommendations](#6-recommendations)

---

## 1. Export Structure

### Main Entry Point (`src/index.ts`)

```typescript
// Namespace exports (runtime + types)
export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Client from "./Client/index.js"
export * as Server from "./Server/index.js"
export * as Transport from "./Transport/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"
export * as Reactivity from "./Reactivity/index.js"
export * as SSR from "./SSR/index.js"

// Convenience type exports
export type {
  InferProcedurePayload,
  InferProcedureSuccess,
  InferProcedureError,
  InferMutationInvalidates,
  InferRouterPaths,
  InferRouterDefinition,
  InferRouterProcedure,
  TransportRequest,
  TransportResponse,
  TransportError,
  MiddlewareRequest,
  ProcedureType,
  PathReactivityService,
} from "./types.js"
```

### Module Export Summary

| Module | Types Exported | Runtime Exports |
|--------|---------------|-----------------|
| Procedure | `Query`, `Mutation`, `Stream`, `Any`, `Payload`, `Success`, `Error`, `Invalidates`, `AutoComplete`, `QueryTypeId`, `MutationTypeId`, `StreamTypeId`, `ProcedureTypeId`, `ProcedureBase`, `OptimisticConfig`, `QueryOptions`, `MutationOptions`, `StreamOptions` | `query`, `mutation`, `stream`, `isProcedure`, `isQuery`, `isMutation`, `isStream` |
| Router | `Definition`, `Router`, `TaggedProcedure`, `PathMap`, `Paths`, `ProcedureAt`, `Flatten`, `DefinitionOf`, `DefinitionWithMiddleware`, `RouterTypeId` | `make`, `paths`, `get`, `tagOf`, `pathOf`, `tagsToInvalidate`, `withMiddleware` |
| Client | `Client`, `BoundClient`, `ClientProxy`, `ProcedureClient`, `QueryClient`, `MutationClient`, `StreamClient`, `ProviderProps`, `QueryOptions`, `QueryResult`, `MutationOptions`, `MutationResult`, `StreamOptions`, `StreamResult`, `UseQueryFn`, `UseMutationFn`, `UseStreamFn`, `ClientService`, `ClientTypeId` | `make`, `ClientServiceTag`, `ClientServiceLive` |
| Server | `Server`, `Handlers`, `HandlerFor`, `HttpHandlerOptions`, `ServerTypeId` | `make`, `toHttpHandler`, `toFetchHandler`, `toNextApiHandler`, `isServer`, `middleware` |
| Transport | `Transport`, `TransportService`, `TransportRequest`, `TransportResponse`, `StreamResponse`, `TransportError`, `Success`, `Failure`, `StreamChunk`, `StreamEnd`, `HttpOptions`, `MockHandlers`, `TransportTypeId` | `http`, `mock`, `make`, `loopback`, `isTransientError`, `generateRequestId` |
| Middleware | `MiddlewareTag`, `MiddlewareImpl`, `WrapMiddlewareImpl`, `CombinedMiddleware`, `Applicable`, `Provides`, `Failure`, `MiddlewareRequest`, `Headers`, `ProcedureType`, `MiddlewareConfig`, `MiddlewareTypeId`, `MiddlewareTagTypeId` | `Tag`, `implement`, `implementWrap`, `all`, `execute`, `isMiddlewareTag`, `isCombinedMiddleware`, `isApplicable` |
| Reactivity | `PathReactivity`, `PathReactivityService`, `InnerReactivity` | `normalizePath`, `shouldInvalidate`, `make`, `layer`, `register`, `invalidate`, `getRegisteredPaths` |
| Result | Re-exported from `@effect-atom/atom/Result` | (passthrough) |
| SSR | `DehydratedState`, `DehydrateOptions` | `dehydrate`, `Hydrate` |

---

## 2. Type Hierarchy

### Procedure Types

```
Procedure.Any
├── Procedure.Query<Payload, Success, Error>
├── Procedure.Mutation<Payload, Success, Error, Invalidates>
└── Procedure.Stream<Payload, Success, Error>

All extend: ProcedureBase<Payload, Success, Error>
```

### Type Extraction Utilities

```typescript
// From Procedure module
Procedure.Payload<P>    // Extract payload type
Procedure.Success<P>    // Extract success type  
Procedure.Error<P>      // Extract error type
Procedure.Invalidates<M> // Extract invalidates from Mutation

// From Router module  
Router.Paths<D>         // All paths in definition
Router.ProcedureAt<D,P> // Get procedure at path
Router.DefinitionOf<R>  // Extract definition from Router
Router.Flatten<D>       // Flatten to path → procedure record

// Convenience re-exports from types.ts
InferProcedurePayload<P>
InferProcedureSuccess<P>
InferProcedureError<P>
InferMutationInvalidates<P>
InferRouterPaths<R>
InferRouterDefinition<R>
InferRouterProcedure<R,P>
```

### Client Type Structure

```
Client<R>
├── Provider: React.FC<ProviderProps>
├── invalidate: (paths) => void
├── provide: (layer) => BoundClient<R>
└── ...ClientProxy<D>  (spread)

ClientProxy<D>
├── [namespace]: ClientProxy<NestedDefinition>
└── [procedure]: ProcedureClient<P>

ProcedureClient<P>
├── QueryClient<Payload, Success, Error>     // for Query
├── MutationClient<Payload, Success, Error>  // for Mutation
└── StreamClient<Payload, Success, Error>    // for Stream
```

---

## 3. Test Files Analysis

### Test File Inventory

| File | Purpose | Type Tests |
|------|---------|------------|
| `test/types.test.ts` | Type-level tests with `@ts-expect-error` | 15 type assertions |
| `test/procedure.test.ts` | Procedure creation & type inference | 7 type tests |
| `test/router.test.ts` | Router path/procedure extraction | 3 type tests |
| `test/client.test.ts` | Client type inference | 7 type tests |
| `test/server.test.ts` | Handler type extraction | 5 type tests |
| `test/middleware.test.ts` | Middleware composition | 0 explicit type tests |
| `test/transport.test.ts` | Transport protocol types | 1 type test |
| `test/integration.test.ts` | Cross-module type flow | 4 type tests |
| `test/reactivity.test.ts` | Path utilities | 0 explicit type tests |
| `test/http-adapter.test.ts` | HTTP handlers | 0 explicit type tests |
| `test/e2e/*.ts` | End-to-end integration | 0 explicit type tests |

### Type Testing Patterns Used

**1. `@ts-expect-error` for negative tests:**
```typescript
// @ts-expect-error - success is required
Procedure.query({})

// @ts-expect-error - invalidates is required  
Procedure.mutation({ success: User })

// @ts-expect-error - queries don't have invalidates
Procedure.query({ success: User, invalidates: ["something"] })
```

**2. `expectTypeOf` for positive type assertions:**
```typescript
import { expectTypeOf } from "vitest"

type Payload = Procedure.Payload<typeof getUser>
expectTypeOf<Payload>().toEqualTypeOf<{ readonly id: string }>()

type Success = Procedure.Success<typeof listUsers>
expectTypeOf<Success>().toEqualTypeOf<readonly User[]>()
```

**3. Variable assignment for path type checking:**
```typescript
type Paths = Router.Paths<typeof router.definition>
const validPaths: Paths[] = ["users.list", "users.get", "health"]
```

### Test Coverage Gaps

1. **Missing type tests for:**
   - `Client.ProcedurePayload` (tests exist but named inconsistently)
   - `Client.ProcedureSuccess` 
   - `Client.ProcedureError`
   - `Server.StreamHandler` type extraction
   - `Middleware.Provides<M>` and `Middleware.Failure<M>` extractors
   - `Transport.MockHandlers` generic constraints

2. **Unused exported types:**
   - `Procedure.AutoComplete<T>` - not explicitly tested
   - `Router.Flatten<D>` - never used in tests
   - `Middleware.WrapMiddlewareImpl` - only indirectly tested

---

## 4. TSConfig Configuration

### Main `tsconfig.json`

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

### Configuration Analysis

#### Issues:

1. **Test files are excluded from type checking**
   - `"exclude": ["test", ...]` means tests don't get type-checked via `tsc`
   - Tests rely on Vitest's built-in TypeScript handling
   - No separate `tsconfig.test.json` exists

2. **Missing test configuration**
   - Standard Effect repos have `tsconfig.test.json` with:
     ```json
     {
       "extends": "./tsconfig.json",
       "compilerOptions": { "noEmit": true },
       "include": ["test/**/*"]
     }
     ```

3. **`noEmit: true` in main config**
   - Prevents `tsc` from generating `.d.ts` files
   - Build process must use different config or tool (like tsup/unbuild)

4. **`skipLibCheck: true`**
   - Skips type checking of `.d.ts` files from dependencies
   - Acceptable for dev speed, but masks potential type issues

#### Recommendations:

```json
// tsconfig.test.json (NEW FILE)
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

---

## 5. Type Errors & Missing Exports

### Errors Found (with `node_modules` missing)

When running `tsc`, all 200+ errors are "Cannot find module" because dependencies aren't installed:

```
src/Client/index.ts - Cannot find module 'effect/Context'
src/Client/react.ts - Cannot find module 'react'
src/Reactivity/index.ts - Cannot find module '@effect/experimental/Reactivity'
src/Result/index.ts - Cannot find module '@effect-atom/atom/Result'
```

**These are not actual type errors** - they would resolve after `npm install`.

### Potential Type Issues (Code Review)

1. **Client module - redundant type definitions:**
   ```typescript
   // src/Client/index.ts:389-391
   export interface QueryOptions {  // Conflicts with Client.QueryOptions name
     readonly enabled?: boolean
     // ...
   }
   ```
   This `QueryOptions` (hook options) has same name as `Procedure.QueryOptions` (procedure creation options).

2. **Implicit `any` in SSR module:**
   ```typescript
   // src/SSR/index.ts:171
   // ERROR: Binding element 'state' implicitly has an 'any' type
   ({ state, children }: { state: any; children: any })
   ```
   Should use proper props interface.

3. **Missing type exports in `types.ts`:**
   The convenience exports don't include:
   - `ClientService` - useful for typing custom transport tests
   - `ServerTypeId`, `ClientTypeId` - for type guards
   - `Applicable` from Middleware - for typing middleware arrays

### Missing Exports Analysis

**Currently exported from `types.ts`:**
```typescript
export type {
  InferProcedurePayload,
  InferProcedureSuccess,
  InferProcedureError,
  InferMutationInvalidates,
  InferRouterPaths,
  InferRouterDefinition,
  InferRouterProcedure,
  TransportRequest,
  TransportResponse,
  TransportError,
  MiddlewareRequest,
  ProcedureType,
  PathReactivityService,
}
```

**Should also export:**
```typescript
// Client types consumers often need
ClientService,        // For typing mock transports
QueryResult,          // For typing hook returns
MutationResult,       // For typing hook returns  
StreamResult,         // For typing hook returns

// Server types for advanced usage
HandlerFor,           // Type handler functions
Handlers,             // Type full handler objects

// Middleware types
Applicable,           // Union type for middleware
Provides,             // Extract provided service type
Failure as MiddlewareFailure,  // Extract failure type (name conflict)
```

---

## 6. Recommendations

### High Priority

1. **Create `tsconfig.test.json`:**
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "rootDir": ".",
       "noEmit": true,
       "types": ["vitest/globals", "@effect/vitest"]
     },
     "include": ["src/**/*", "test/**/*"]
   }
   ```

2. **Fix SSR implicit any:**
   ```typescript
   // src/SSR/index.ts
   interface HydrateProps {
     state: DehydratedState
     children: React.ReactNode
   }
   
   export const Hydrate: React.FC<HydrateProps> = ({ state, children }) => ...
   ```

3. **Rename conflicting `QueryOptions`:**
   ```typescript
   // Client hook options
   export interface UseQueryOptions { ... }  // was QueryOptions
   
   // Procedure creation options stay as Procedure.QueryOptions
   ```

### Medium Priority

4. **Expand `types.ts` exports:**
   ```typescript
   // Add these exports
   export type { ClientService } from "./Client/index.js"
   export type { HandlerFor, Handlers } from "./Server/index.js"
   export type { Applicable, Provides, Failure as MiddlewareFailure } from "./Middleware/index.js"
   export type { QueryResult, MutationResult, StreamResult } from "./Client/index.js"
   ```

5. **Add type tests for missing utilities:**
   - `Router.Flatten<D>` 
   - `Middleware.Provides<M>`
   - `Transport.MockHandlers<D>`

6. **Add CI type checking step:**
   ```yaml
   # .github/workflows/ci.yml
   - name: Type Check
     run: |
       npx tsc --project tsconfig.json --noEmit
       npx tsc --project tsconfig.test.json --noEmit
   ```

### Low Priority

7. **Consider dtslint for stricter type testing:**
   - Pattern used by Effect core for complex type assertions
   - Better error messages for type inference failures

8. **Document type utilities in JSDoc:**
   - Add `@example` blocks showing common patterns
   - Document covariance/contravariance of type parameters

---

## Summary

The type system is well-designed with proper inference patterns. Key findings:

| Category | Status |
|----------|--------|
| Export structure | Good - namespaced modules |
| Type utilities | Good - comprehensive extractors |
| Test coverage | Fair - some gaps |
| TSConfig | Needs work - missing test config |
| Missing exports | Minor - some convenience types |

The main actionable items are:
1. Add `tsconfig.test.json` for proper test type checking
2. Fix SSR implicit any types  
3. Rename `QueryOptions` to avoid confusion with hook options
4. Expand `types.ts` with commonly-needed types
