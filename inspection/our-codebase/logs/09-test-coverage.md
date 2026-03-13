# Test Coverage Analysis

## Summary

**Total Test Files:** 14 (including e2e suite files)
**Test Categories:** Unit, Integration, E2E, Type-level

### Coverage by Module

| Module | Tested | Coverage | Quality |
|--------|--------|----------|---------|
| Procedure | Yes | High | Good |
| Router | Yes | High | Good |
| Middleware | Yes | Medium | Good |
| Server | Yes | High | Good |
| Client | Partial | Low | Weak |
| Transport | Yes | High | Good |
| Reactivity | Yes | High | Good |
| HTTP Adapter | Yes | High | Good |
| Types | Yes | High | Good |
| **React Hooks** | **Minimal** | **Low** | **Weak** |
| **SSR** | **No** | **None** | **N/A** |

---

## Detailed Module Analysis

### 1. Procedure (procedure.test.ts) - 315 lines

**Tested:**
- `Procedure.query()` creation and validation
- `Procedure.mutation()` with invalidates
- `Procedure.stream()` creation
- Type guards: `isProcedure`, `isQuery`, `isMutation`, `isStream`
- Type inference: `Payload`, `Success`, `Error`, `Invalidates`
- Optimistic update configuration
- `@ts-expect-error` validation for required fields

**Not Tested:**
- Pipeable chaining behaviors
- Complex schema compositions
- Middleware attachment (deferred to middleware tests)

**Quality:** Good - comprehensive schema and type testing

---

### 2. Router (router.test.ts) - 311 lines

**Tested:**
- `Router.make()` with flat and nested definitions
- Tag derivation from paths (`@api/users/list`)
- PathMap: `pathToTag`, `tagToPath`, `procedures`
- `Router.paths()` extraction
- `Router.get()` by path
- `Router.tagOf()` for path-to-tag lookup
- `Router.tagsToInvalidate()` hierarchical invalidation
- `getChildPaths()` for prefix queries
- Type inference: `Paths`, `ProcedureAt`
- Mixed procedure types (query, mutation, stream)

**Not Tested:**
- Router merging/composition (not implemented)
- Dynamic route parameters (not implemented)

**Quality:** Good - covers all current functionality

---

### 3. Middleware (middleware.test.ts) - 290 lines

**Tested:**
- `Middleware.Tag()` creation
- `Middleware.implement()` layer creation
- `Middleware.all()` composition with concurrency options
- `Procedure.middleware()` attachment
- `Router.withMiddleware()` group middleware
- `Server.middleware()` server-level middleware
- Guards: `isMiddlewareTag`, `isCombinedMiddleware`, `isApplicable`
- Middleware ordering in arrays

**Not Tested:**
- **Actual middleware execution** (only structure tests)
- Error propagation from middleware
- Context provision to handlers
- Request/response transformation
- Sequential vs concurrent execution behavior

**Quality:** Medium - tests structure but not behavior

---

### 4. Server (server.test.ts) - 334 lines

**Tested:**
- `Server.make()` creation
- `Server.isServer()` guard
- `server.handle()` for queries (with Effect tests)
- `server.handleStream()` for streams (with Effect tests)
- Handler type inference: `HandlerFor`, `Handlers`
- Error handling (NotFoundError, unknown procedures)
- Middleware attachment

**Not Tested:**
- Payload validation errors
- Success/error schema encoding
- Complex dependency injection scenarios
- Stream error mid-stream

**Quality:** Good - core functionality covered

---

### 5. Client (client.test.ts) - 207 lines

**Tested:**
- `Client.make()` proxy structure
- `Client.provide()` bound client creation
- `Client.ClientServiceLive` layer composition
- Type inference: `ProcedurePayload`, `ProcedureSuccess`, `ProcedureError`
- Nested router access

**Not Tested:**
- **`run` Effect execution**
- **`runPromise` execution**
- **`prefetch` behavior**
- **`invalidate()` functionality**
- **`shutdown()` cleanup**
- **Stream client `.stream` method**
- Error handling through transport

**Quality:** Weak - only tests structure, not behavior

---

### 6. Transport (transport.test.ts) - 237 lines

**Tested:**
- `Transport.http()` layer creation with options
- `Transport.mock()` layer creation
- `TransportError` with all reasons (Network, Timeout, Protocol, Closed)
- `isTransientError()` for retry logic
- Protocol types: `TransportRequest`, `Success`, `Failure`, `StreamChunk`, `StreamEnd`
- Schema type guards

**Not Tested:**
- **Actual HTTP communication** (deferred to e2e/http.test.ts)
- Headers propagation
- Timeout behavior
- Retry logic
- Batching (not yet implemented)

**Quality:** Good for type/structure, but no network tests

---

### 7. HTTP Adapter (http-adapter.test.ts) - 311 lines

**Tested:**
- `Server.toHttpHandler()` with Effect tests
- `Server.toFetchHandler()` with async tests
- `Server.toNextApiHandler()` with mock req/res
- Success/failure response encoding
- Headers passthrough
- Invalid JSON handling (400 response)

**Quality:** Good - comprehensive adapter coverage

---

### 8. Reactivity (reactivity.test.ts) - 201 lines

**Tested:**
- `normalizePath()` dot-to-slash conversion
- `shouldInvalidate()` hierarchical matching
- `PathReactivity` service with `@effect/vitest`
- Registration/unregistration with scope
- Reference counting for multiple registrations
- `invalidate()` triggering
- Convenience functions: `register`, `invalidate`, `getRegisteredPaths`

**Quality:** Good - covers path-based reactivity

---

### 9. Integration (integration.test.ts) - 307 lines

**Tested:**
- Server handling with dependencies
- Loopback transport end-to-end
- Type flow: Procedure -> Router -> Server -> Client
- Middleware integration points

**Quality:** Good - validates module interactions

---

### 10. E2E Suite (e2e/suite.ts, fixtures.ts, http.test.ts, loopback.test.ts)

**Tested:**
- Full client-to-server communication
- Query, Mutation, Stream flows
- Error propagation
- Schema round-trip
- Middleware enforcement
- HTTP transport with real Node.js server
- Loopback transport

**Quality:** Excellent - production-realistic scenarios

---

### 11. Types (types.test.ts) - 305 lines

**Tested:**
- All `@ts-expect-error` validations
- Cross-module type flow consistency
- Procedure/Router/Server/Client type alignment

**Quality:** Good - ensures type safety

---

## Critical Gaps

### 1. React Hooks - NO TESTS

**Files:**
- `src/Client/react.ts` (457 lines)

**Completely Untested:**
- `createProvider()` - Provider component
- `createUseQuery()` - useQuery hook
- `createUseMutation()` - useMutation hook  
- `createUseStream()` - useStream hook
- `TrpcContext` - context usage
- Atom integration with `@effect-atom/atom-react`
- Reactivity key generation
- Result state handling (isLoading, isError, isSuccess)
- Refetch functionality
- Mutation lifecycle callbacks (onSuccess, onError, onSettled)
- Stream connection management

**Current Test (client.test.ts):**
```typescript
describe("React hooks", () => {
  it("hooks throw outside React context", () => {
    expect(() => bound.users.list.useQuery()).toThrow()
    expect(() => bound.users.create.useMutation()).toThrow()
  })
})
```
This only tests that hooks throw when used incorrectly - **not that they work correctly**.

**Risk:** High - React integration is a primary use case

---

### 2. SSR Module - NO TESTS

**Files:**
- `src/SSR/index.ts` (209 lines)

**Completely Untested:**
- `dehydrate()` function
- `createPrefetch()` helper
- `Hydrate` component
- `isServer` / `isClient` checks

**Risk:** Medium - SSR is important for Next.js users

---

### 3. Client Imperative API - WEAK TESTS

**Untested:**
- `client.users.list.run` Effect execution
- `client.users.list.runPromise()` Promise execution
- `client.users.create.runPromise(payload)` with payload
- `client.users.watch.stream` stream execution
- `boundClient.invalidate(paths)` functionality
- `boundClient.shutdown()` cleanup

---

### 4. Middleware Execution - WEAK TESTS

**Structure Tested, Behavior Not:**
- Middleware layers are created but never executed
- `Middleware.execute()` is not directly tested
- Error short-circuiting not verified
- Context provision to handlers not verified

---

### 5. Transport Error Scenarios - NO TESTS

**Untested:**
- Network failures during request
- Timeout handling
- Connection closed mid-stream
- Retry logic (when implemented)

---

## Test Quality Assessment

### Strengths

1. **Type-level tests** - Comprehensive `@ts-expect-error` coverage
2. **E2E tests** - Realistic client-server scenarios
3. **Effect tests** - Proper use of `@effect/vitest`
4. **Fixture organization** - Reusable test schemas and helpers
5. **Path/tag mapping** - Thorough coverage of hierarchical paths

### Weaknesses

1. **React testing absent** - Needs `@testing-library/react` tests
2. **No mock injection** - Tests don't verify mock behavior
3. **Happy path bias** - More error scenario tests needed
4. **No performance tests** - No batching/caching benchmarks
5. **No concurrent tests** - Middleware concurrency untested

---

## Recommendations

### Priority 1: React Hook Testing

```typescript
// test/react.test.tsx (new file)
import { renderHook, waitFor } from "@testing-library/react"
import { describe, it, expect } from "vitest"

describe("useQuery", () => {
  it("returns loading state initially", () => {
    const { result } = renderHook(() => 
      api.users.list.useQuery(),
      { wrapper: createWrapper() }
    )
    expect(result.current.isLoading).toBe(true)
  })

  it("returns data on success", async () => {
    // ...
  })

  it("handles errors correctly", async () => {
    // ...
  })
})
```

### Priority 2: SSR Testing

```typescript
// test/ssr.test.ts (new file)
describe("SSR.dehydrate", () => {
  it("serializes query results", () => {
    const state = SSR.dehydrate({ "users.list": [user1, user2] })
    expect(state.queries["users.list"]).toBeDefined()
  })
})

describe("SSR.Hydrate", () => {
  it("restores state on mount", () => {
    // Test with React Testing Library
  })
})
```

### Priority 3: Client Imperative API

```typescript
// Add to client.test.ts
describe("Client.run", () => {
  it.effect("executes query Effect", () =>
    Effect.gen(function* () {
      const bound = api.provide(mockTransport)
      const result = yield* bound.users.list.run
      expect(result).toEqual([...])
    })
  )
})

describe("Client.runPromise", () => {
  it("resolves with data", async () => {
    const bound = api.provide(mockTransport)
    const result = await bound.users.list.runPromise()
    expect(result).toEqual([...])
  })
})
```

### Priority 4: Middleware Execution

```typescript
// Add to middleware.test.ts
describe("Middleware.execute", () => {
  it.effect("runs middleware before handler", () =>
    Effect.gen(function* () {
      let order: string[] = []
      
      const LogMiddleware = Middleware.implement(LogTag, () => {
        order.push("middleware")
        return Effect.succeed(undefined)
      })
      
      // Execute and verify order
    })
  )

  it.effect("short-circuits on middleware failure", () => {
    // Middleware fails, handler should not run
  })
})
```

---

## Coverage Metrics

| Category | Tests | Lines | Coverage Est. |
|----------|-------|-------|---------------|
| Procedure | 25 | 315 | ~95% |
| Router | 20 | 311 | ~90% |
| Middleware | 18 | 290 | ~60% (structure only) |
| Server | 15 | 334 | ~85% |
| Client | 12 | 207 | ~30% |
| Transport | 15 | 237 | ~70% |
| HTTP Adapter | 10 | 311 | ~90% |
| Reactivity | 12 | 201 | ~90% |
| Integration | 8 | 307 | ~85% |
| E2E | 20+ | 700+ | ~90% |
| Types | 15 | 305 | ~95% |
| **React** | 1 | 3 | **~1%** |
| **SSR** | 0 | 0 | **0%** |

**Overall Estimated Coverage: ~65-70%**

**With React/SSR properly tested: ~85-90%**
