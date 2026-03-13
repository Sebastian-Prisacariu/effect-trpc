# Test Coverage Analysis

## Executive Summary

**Overall Coverage Assessment: GOOD with significant gaps**

The test suite covers most module APIs comprehensively but has critical gaps in:
1. **React hooks integration** - Hooks only tested for "throws outside context"
2. **Actual middleware execution** - Only structural tests, no execution verification
3. **Error propagation paths** - Schema decode errors largely untested
4. **Client.run/runPromise** - Imperative API not tested with actual effects

---

## Coverage Summary by Module

### 1. Procedure Module
**File:** `src/Procedure/index.ts` (544 lines)
**Test:** `test/procedure.test.ts` (315 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `query()` constructor | Yes | Good |
| `mutation()` constructor | Yes | Good |
| `stream()` constructor | Yes | Good |
| Type inference (Payload, Success, Error) | Yes | Good |
| Guards (isProcedure, isQuery, etc.) | Yes | Good |
| `.middleware()` chaining | Yes | Good |
| Optimistic update config | Yes | Partial |
| `@ts-expect-error` compile checks | Yes | Good |
| `.pipe()` pipeability | Yes | Weak (only checks existence) |

**Untested:**
- Procedure middleware actually affecting execution
- Optimistic update `reconcile` function execution
- AutoComplete type utility (compile-time only)

---

### 2. Router Module  
**File:** `src/Router/index.ts` (implied from usage)
**Test:** `test/router.test.ts` (311 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `Router.make()` | Yes | Good |
| Auto-derived tags | Yes | Good |
| Nested definitions | Yes | Good |
| Path mapping (pathToTag, tagToPath) | Yes | Good |
| `Router.get()` | Yes | Good |
| `Router.paths()` | Yes | Good |
| `Router.tagOf()` | Yes | Good |
| Hierarchical invalidation paths | Yes | Good |
| `Router.withMiddleware()` | Yes | Partial |
| Mixed procedure types | Yes | Good |

**Untested:**
- Router with multiple levels of `withMiddleware` nesting
- Very deep nesting (5+ levels)
- Edge cases: empty definition, single procedure

---

### 3. Client Module
**File:** `src/Client/index.ts` (777 lines)
**Test:** `test/client.test.ts` (207 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `Client.make()` structure | Yes | Good |
| `Client.provide()` | Yes | Partial |
| `ClientServiceLive` layer | Yes | Weak |
| Type inference (ProcedurePayload, etc.) | Yes | Good |
| Nested client access | Yes | Good |
| React hooks throw outside context | Yes | Good |
| `run` Effect | No | Missing |
| `runPromise` | No | Missing |
| `prefetch` | No | Missing |
| `invalidate` method | No | Missing |
| `BoundClient.shutdown()` | No | Missing |

**Critical Gap:** The imperative API (`run`, `runPromise`, `prefetch`) is completely untested. These are core features for vanilla JS usage.

---

### 4. Client React Module
**File:** `src/Client/react.ts` (462 lines)
**Test:** Indirectly in `test/client.test.ts` (only throws check)

| Feature | Covered | Quality |
|---------|---------|---------|
| `createProvider` | No | Missing |
| `useClientContext` | No | Missing |
| `createUseQuery` | No | Missing |
| `createUseMutation` | No | Missing |
| `createUseStream` | No | Missing |
| Refetch interval | No | Missing |
| Stale time | No | Missing |
| Mutation callbacks (onSuccess, etc.) | No | Missing |
| Stream abort/restart | No | Missing |

**Critical Gap:** All React functionality is untested. The only test verifies hooks throw when used outside Provider, which is not meaningful coverage.

---

### 5. Server Module
**File:** `src/Server/index.ts` (619 lines)
**Test:** `test/server.test.ts` (334 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `Server.make()` | Yes | Good |
| `Server.handle()` query | Yes | Good |
| `Server.handle()` with payload | Yes | Good |
| `Server.handle()` errors | Yes | Good |
| `Server.handle()` unknown procedure | Yes | Good |
| `Server.handleStream()` | Yes | Good |
| `Server.isServer()` | Yes | Good |
| `Server.middleware()` | Yes | Partial |
| Handler type inference | Yes | Good |
| `Server.toHttpHandler()` | Yes | Good |
| `Server.toFetchHandler()` | Yes | Good |
| `Server.toNextApiHandler()` | Yes | Good |

**Gaps:**
- Middleware actually executing and providing context
- Invalid payload decode errors (tested but shallow)
- Batch handling (not implemented in HTTP adapter yet)

---

### 6. Transport Module
**File:** `src/Transport/index.ts` (601 lines)
**Test:** `test/transport.test.ts` (248 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `Transport.http()` config options | Yes | Good |
| `Transport.mock()` | Yes | Good |
| `TransportError` | Yes | Good |
| `isTransientError` | Yes | Good |
| Response envelope types | Yes | Good |
| Schema type guards | Yes | Good |
| `Transport.loopback()` | No | Missing |
| Actual HTTP requests | No | Missing |
| Batching logic | No | Missing |
| Timeout handling | No | Missing |
| Custom fetch | No | Missing |
| Stream HTTP transport | No | Missing (TODO in source) |

**Critical Gap:** `Transport.loopback()` is used extensively in e2e tests but has no dedicated unit tests. The HTTP transport's actual request/response cycle is untested (would require mocking fetch).

---

### 7. Middleware Module
**File:** `src/Middleware/index.ts` (400 lines)
**Test:** `test/middleware.test.ts` (290 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `Middleware.Tag()` | Yes | Good |
| `Middleware.implement()` | Yes | Weak |
| `Middleware.implementWrap()` | No | Missing |
| `Middleware.all()` combining | Yes | Good |
| Concurrency options | Yes | Good |
| Guards | Yes | Good |
| Procedure.middleware() | Yes | Good |
| Router.withMiddleware() | Yes | Good |
| Server.middleware() | Yes | Good |
| `Middleware.execute()` | No | Missing |
| Actual middleware providing Context | No | Missing |
| Middleware failure short-circuiting | No | Missing |

**Critical Gap:** While middleware structure is well-tested, actual execution is not. The `execute()` function that runs middleware chains is never tested directly.

---

### 8. Reactivity Module
**File:** `src/Reactivity/index.ts` (305 lines)
**Test:** `test/reactivity.test.ts` (288 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `Reactivity.make()` | Yes | Good |
| `subscribe()` | Yes | Good |
| `unsubscribe()` | Yes | Good |
| Multiple callbacks per tag | Yes | Good |
| `invalidate()` exact match | Yes | Good |
| `invalidate()` hierarchical | Yes | Good |
| `invalidate()` reverse hierarchical | Yes | Good |
| `invalidate()` multiple tags | Yes | Good |
| Only invokes each callback once | Yes | Good |
| Error resilience | Yes | Good |
| `pathsToTags()` | Yes | Good |
| `shouldInvalidate()` | Yes | Good |
| Effect-based API | Yes | Good |
| `ReactivityLive` layer | Yes | Good |

**Excellent coverage** - This is the best-tested module.

---

### 9. HTTP Adapter Tests
**File:** `test/http-adapter.test.ts` (311 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `toHttpHandler` success | Yes | Good |
| `toHttpHandler` data | Yes | Good |
| `toHttpHandler` errors | Yes | Good |
| `toHttpHandler` unknown procedure | Yes | Good |
| `toHttpHandler` headers passing | Yes | Good |
| `toHttpHandler` invalid JSON | Yes | Good |
| `toFetchHandler` | Yes | Good |
| `toNextApiHandler` | Yes | Good |

**Good coverage** of HTTP adapters.

---

### 10. Integration Tests
**File:** `test/integration.test.ts` (307 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| Server ↔ loopback transport | Yes | Good |
| Type flow across modules | Yes | Good |
| Middleware application | Yes | Partial |
| Error handling through stack | Yes | Good |

---

### 11. E2E Test Suite
**Files:** `test/e2e/suite.ts`, `test/e2e/fixtures.ts`, `test/e2e/loopback.test.ts`

| Feature | Covered | Quality |
|---------|---------|---------|
| Client → Server roundtrip | Yes | Good |
| Query success | Yes | Good |
| Query with payload | Yes | Good |
| Query errors | Yes | Good |
| Mutation success | Yes | Good |
| Mutation validation error | Yes | Good |
| Stream chunks | Yes | Partial |
| Stream errors | Yes | Good |
| Middleware blocking (no auth) | Yes | Good |
| Invalidation callbacks | Yes | Good |
| Schema round-trip | Yes | Good |

**Good coverage** for happy paths. Some edge cases missing.

---

### 12. Type-Level Tests
**File:** `test/types.test.ts` (305 lines)

| Feature | Covered | Quality |
|---------|---------|---------|
| `@ts-expect-error` for invalid usage | Yes | Good |
| Type extraction utilities | Yes | Good |
| Cross-module type flow | Yes | Good |

**Excellent** compile-time type safety tests.

---

## Critical Untested Paths

### 1. React Hooks (HIGH PRIORITY)
**Impact:** All React users would encounter untested code
**Risk:** Bugs in useQuery/useMutation/useStream state management
**Recommendation:** Add React testing library tests or at minimum unit tests with mocked React

### 2. Client.run/runPromise/prefetch (HIGH PRIORITY)
**Impact:** Vanilla JS users rely entirely on this API
**Risk:** Runtime errors when running Effects
**Recommendation:** Add integration tests that actually run effects through the client

### 3. Middleware.execute() Chain (HIGH PRIORITY)
**Impact:** Authentication, authorization, logging all use this
**Risk:** Middleware order issues, context not provided correctly
**Recommendation:** Add tests that verify:
- Context is provided to handlers
- Multiple middlewares execute in order
- Failures short-circuit

### 4. Transport.loopback() (MEDIUM PRIORITY)
**Impact:** Used in all e2e tests
**Risk:** Silent test environment issues
**Recommendation:** Add dedicated unit tests

### 5. Schema Decode Error Paths (MEDIUM PRIORITY)
**Impact:** Malformed API responses
**Risk:** Unclear error messages to users
**Recommendation:** Test decode failures for payloads, success responses, error responses

---

## Weak/Meaningless Tests

### 1. `test/client.test.ts:202-206` - Hooks Throw Outside Context
```typescript
it("hooks throw outside React context", () => {
  expect(() => bound.users.list.useQuery()).toThrow()
  expect(() => bound.users.create.useMutation()).toThrow()
})
```
**Problem:** Only verifies hooks throw, not that they work correctly when inside context. This is barely more than a smoke test.

### 2. `test/middleware.test.ts:69-82` - Implement Creates Layer
```typescript
it("creates a Layer from implementation", () => {
  const AuthLive = Middleware.implement(AuthMiddleware, (request) =>
    Effect.gen(function* () {
      // ...
    })
  )
  expect(Layer.isLayer(AuthLive)).toBe(true)
})
```
**Problem:** Only checks that a Layer is created, not that the middleware actually runs or provides the correct service.

### 3. `test/server.test.ts:286-294` - Middleware Placeholder
```typescript
it("adds middleware to server", () => {
  const middleware = {} as any // Placeholder middleware
  const server = Server.make(appRouter, handlers).pipe(
    Server.middleware(middleware)
  )
  expect(server.middlewares).toContain(middleware)
})
```
**Problem:** Uses `{} as any` as middleware. This doesn't test actual middleware behavior.

### 4. `test/procedure.test.ts:113-120` - Pipeable Check
```typescript
it("is pipeable", () => {
  const listUsers = Procedure.query({ success: Schema.Array(User) })
  expect(typeof listUsers.pipe).toBe("function")
})
```
**Problem:** Only checks `.pipe` exists, not that piping works correctly.

---

## Test Quality Assessment

| Module | Coverage | Depth | Edge Cases | Integration |
|--------|----------|-------|------------|-------------|
| Procedure | Good | Medium | Partial | Good |
| Router | Good | Good | Partial | Good |
| Client | Partial | Weak | Poor | Partial |
| Client/react | None | None | None | None |
| Server | Good | Good | Partial | Good |
| Transport | Partial | Medium | Poor | Good (e2e) |
| Middleware | Structural | Weak | None | Partial |
| Reactivity | Excellent | Excellent | Good | Good |
| HTTP Adapter | Good | Good | Partial | Good |

---

## Priority Recommendations for New Tests

### P0 - Critical (Blocks production use)
1. **Client imperative API**: `run`, `runPromise`, `prefetch` with actual Effect execution
2. **Middleware execution**: Verify context is provided, chain executes correctly
3. **React hooks**: Use React Testing Library or enzyme to test hooks properly

### P1 - High (Significant user impact)
4. **Schema decode errors**: Test all paths that decode payloads/responses
5. **Transport.loopback()**: Dedicated unit tests
6. **Middleware failure short-circuit**: Verify early return on middleware failure

### P2 - Medium (Edge cases)
7. **Empty router definitions**
8. **Very deep nesting** (5+ levels)
9. **Concurrent middleware execution** (with `concurrency: "unbounded"`)
10. **Mutation invalidation actually triggering refetch**

### P3 - Nice to have
11. **HTTP transport with mocked fetch**
12. **Batching logic** (when implemented)
13. **Stream abort handling in React**
14. **Memory leak tests for long-running subscriptions**

---

## Code Coverage Estimation

Based on line counts and functionality analysis:

| Module | Estimated Line Coverage | Branch Coverage |
|--------|------------------------|-----------------|
| Procedure | ~85% | ~70% |
| Router | ~80% | ~75% |
| Client | ~45% | ~30% |
| Client/react | ~5% | ~0% |
| Server | ~75% | ~65% |
| Transport | ~50% | ~40% |
| Middleware | ~60% | ~35% |
| Reactivity | ~95% | ~90% |

**Overall Estimated Coverage: ~60%**

---

## Summary

The test suite is well-structured with good patterns but has critical gaps:

1. **React integration is essentially untested** - Major gap for React users
2. **Middleware execution is structural only** - Auth could silently fail
3. **Client imperative API untested** - Vanilla JS users affected
4. **Transport implementation details untested** - HTTP/batching/streams

The Reactivity module is exemplary - other modules should follow its thorough testing approach.
