# Test Coverage and Quality Analysis

## Summary

- **Total Tests:** 322 passing, 1 skipped
- **Test Files:** 10 files
- **Type Errors:** None (typecheck passes)

## Test Files Inventory

| File | Tests | What It Covers |
|------|-------|----------------|
| `procedure.test.ts` | 24 | Procedure creation, guards, type inference |
| `router.test.ts` | 18 | Router creation, path mapping, hierarchical invalidation |
| `server.test.ts` | 15 | Server.make, Server.handle, Server.handleStream, middleware |
| `client.test.ts` | 24 | Client.make, proxy structure, type inference |
| `transport.test.ts` | 21 | HTTP transport, mock transport, protocol types |
| `middleware.test.ts` | 16 | Middleware.Tag, composition, application to procedures |
| `reactivity.test.ts` | 24 | Subscribe/unsubscribe, invalidation, hierarchical matching |
| `integration.test.ts` | 13 | Server handling, loopback transport, type flow |
| `invalidation.test.ts` | 7 | Path typing for invalidation |
| `e2e/loopback.test.ts` | 14 (+1 skip) | Full client-server communication |

---

## Coverage Matrix

### Source Modules vs Test Coverage

| Module | File | Key Functions | Tested? | Coverage Quality |
|--------|------|---------------|---------|------------------|
| **Procedure** | `src/Procedure/index.ts` | `query`, `mutation`, `stream` | Yes | Good |
| | | `isProcedure`, `isQuery`, `isMutation`, `isStream` | Yes | Good |
| | | `.middleware()` method | Yes | Basic |
| **Router** | `src/Router/index.ts` | `make` | Yes | Good |
| | | `paths`, `get`, `tagOf`, `pathOf` | Yes | Good |
| | | `tagsToInvalidate` | Yes | Good |
| | | `withMiddleware` | Yes | Basic |
| **Server** | `src/Server/index.ts` | `make` | Yes | Good |
| | | `handle` (query/mutation) | Yes | Good |
| | | `handleStream` | Yes | Basic |
| | | `toHttpHandler` | **NO** | Missing |
| | | `middleware` | Yes | Basic |
| | | `isServer` | Yes | Good |
| **Client** | `src/Client/index.ts` | `make` | Yes | Basic |
| | | `provide` | Yes | Basic |
| | | `ClientServiceLive` | Yes | Basic |
| | | React hooks (`useQuery`, `useMutation`, `useStream`) | **NO** | Stubs only |
| | | `runPromise` / `run` methods | **Partial** | Not runtime tested |
| | | `prefetch` | **NO** | Missing |
| **Transport** | `src/Transport/index.ts` | `http` | Yes | Config only, no actual HTTP |
| | | `mock` | Yes | Basic |
| | | `loopback` | Yes | E2E only |
| | | `isTransientError` | Yes | Good |
| | | `generateRequestId` | **NO** | Missing |
| | | Batching config | Yes | Config only |
| **Middleware** | `src/Middleware/index.ts` | `Tag` | Yes | Good |
| | | `implement` | Yes | Basic |
| | | `implementWrap` | **NO** | Missing |
| | | `all` | Yes | Good |
| | | `execute` | **Partial** | Via integration |
| | | Guards | Yes | Good |
| **Reactivity** | `src/Reactivity/index.ts` | `make` | Yes | Good |
| | | `subscribe` / `invalidate` | Yes | Excellent |
| | | `pathsToTags` | Yes | Good |
| | | `shouldInvalidate` | Yes | Good |
| | | Effect-based API | Yes | Good |
| **Result** | `src/Result/index.ts` | Re-export | N/A | Just re-export |

---

## Critical Gaps Identified

### 1. HTTP Transport NOT Actually Tested
**Location:** `src/Transport/index.ts:265-353`

The `Transport.http()` function creates a layer, and tests verify the layer is created, but:
- **No actual HTTP requests are made**
- The `sendHttp` function (lines 278-353) is never called in tests
- Response parsing, timeout handling, error mapping untested

```typescript
// Currently tested (JUST CONFIG):
it("creates a Transport layer from URL", () => {
  const layer = Transport.http("/api/trpc")
  expect(layer).toBeDefined()  // False positive!
})
```

### 2. React Hooks Are Stubs
**Location:** `src/Client/index.ts:720-748`

All React hooks throw "requires React" errors:
```typescript
const createUseQuery = (...) => {
  return (() => {
    throw new Error("useQuery requires React...")
  }) as any
}
```

Tests verify they exist but NOT that they work:
```typescript
it("useQuery exists on query client", () => {
  expect(typeof bound.users.list.useQuery).toBe("function")  // Passes, but useless
})
```

### 3. Stream Handling Has Minimal Testing
**Location:** `test/server.test.ts:200-233`

Only one stream test exists:
```typescript
effectIt.effect("handles stream requests", () => ...)
```

**Missing tests:**
- Stream error propagation
- Stream cancellation
- Multiple chunks
- Stream timeouts
- SSE transport (marked TODO in code)

### 4. Server.toHttpHandler Completely Untested
**Location:** `src/Server/index.ts:377-406`

This HTTP adapter is never called in any test. It handles:
- JSON parsing
- Error handling
- Response formatting

### 5. Middleware.implementWrap Never Tested
**Location:** `src/Middleware/index.ts:228-235`

The wrap-style middleware pattern has no tests despite being documented.

### 6. Client.runPromise / Client.run Not Runtime Tested
**Location:** `src/Client/index.ts:615-641`

These methods exist on procedure clients but are only type-tested, not actually executed through real transports.

---

## Quality Assessment of Existing Tests

### Good Patterns
1. **Type tests with `expectTypeOf`** - Meaningful type inference verification
2. **Effect-based testing** - Uses `@effect/vitest` correctly
3. **E2E suite architecture** - Reusable suite pattern in `test/e2e/suite.ts`
4. **Hierarchical invalidation testing** - Thorough edge cases

### Concerning Patterns

#### False Positive #1: Config-Only Tests
```typescript
// transport.test.ts:54-66
it("accepts batching configuration", () => {
  const layer = Transport.http("/api/trpc", {
    batching: {
      enabled: true,
      window: "10 millis",
      maxSize: 50,
    },
  })
  expect(layer).toBeDefined()  // Always passes!
})
```
This test passes but doesn't verify batching works.

#### False Positive #2: Hook Existence Tests
```typescript
// client.test.ts:261-276
it("useQuery exists on query client", () => {
  expect(typeof bound.users.list.useQuery).toBe("function")
})
```
The function exists but always throws. Test passes but functionality broken.

#### False Positive #3: Mock Transport Tag Conversion
```typescript
// E2E tests use "@test/users/list" tags
// But mock handler uses "users.list" paths
// Transport.mock internally converts - if conversion breaks, tests fail opaquely
```

#### Skipped Test Without TODO
```typescript
// e2e/suite.ts:142
it.skip("mutation persists data", () => ...)
```
Comment says "Requires shared database state" but no tracking issue.

### Potentially Flaky Tests

#### 1. Timing-dependent invalidation
```typescript
// reactivity.test.ts
it("only calls each callback once even with multiple matching tags", () => {
  service.invalidate(["@api/users", "@api/users/list"])
  expect(callback).toHaveBeenCalledTimes(1)
})
```
Relies on synchronous invalidation. If made async, would break.

#### 2. Console error suppression
```typescript
// reactivity.test.ts:171-184
it("continues if a callback throws", () => {
  const cb1 = vi.fn(() => { throw new Error("oops") })
  // Test passes but pollutes stderr with "[Reactivity] Callback error"
})
```
Should mock `console.error` to verify error handling.

---

## Type Test Assessment (`expectTypeOf`)

### Meaningful Type Tests
1. **Procedure type extraction** - `Payload<P>`, `Success<P>`, `Error<P>`
2. **Router path inference** - `Paths<D>` correctly extracts paths
3. **Handler type matching** - Handlers must match procedure types

### Missing Type Tests
1. **Middleware type composition** - `Provides<M>`, `Failure<M>` not tested
2. **Client proxy type** - Deep nesting types not verified
3. **BoundClient type** - `shutdown`, `invalidate` signatures not type-tested

---

## E2E Test Suite Quality

### Strengths
1. **Reusable architecture** - `e2eSuite()` can test any transport
2. **Good coverage of happy paths** - Query, mutation, stream basics
3. **Error path testing** - NotFoundError, ValidationError
4. **Invalidation testing** - Callback triggering

### Weaknesses
1. **Only loopback transport tested** - No HTTP, WebSocket
2. **Middleware test skipped with AuthMiddleware** - Test expects failure but provides layer
3. **Stream test minimal** - Takes only 1 item, doesn't test real streaming
4. **No concurrent request testing** - Batching not verified
5. **No timeout/cancellation testing**

---

## Priority List of Missing Tests

### Critical (Blocking Production Use)
1. **HTTP Transport actual requests** - Mock fetch and verify requests
2. **React hooks with actual React** - Using @testing-library/react
3. **Server.toHttpHandler** - HTTP request/response handling
4. **Middleware.execute with real layers** - Not just integration

### High Priority
5. **Stream error propagation** - Server errors to client
6. **Stream cancellation** - Client-side abort
7. **Transport timeout handling** - AbortController behavior
8. **generateRequestId uniqueness** - Edge cases

### Medium Priority
9. **Middleware.implementWrap** - Wrap-style middleware
10. **Client.runPromise actual execution** - Through real transport
11. **Batching behavior** - Window timing, maxSize limits
12. **Schema decode/encode errors** - Invalid payloads

### Low Priority (Nice to Have)
13. **Console.error mocking** - Clean test output
14. **Concurrent invalidation** - Race conditions
15. **Memory leaks** - Subscription cleanup

---

## Recommendations

### Immediate Actions
1. Add HTTP transport tests with mocked `fetch`
2. Create React test setup with `@testing-library/react`
3. Test `Server.toHttpHandler` with mock request objects
4. Add stream error/cancellation tests

### Test Infrastructure
1. Add coverage reporting (`vitest --coverage`)
2. Create test fixtures module to reduce duplication
3. Add GitHub Actions CI for PRs
4. Consider property-based testing for Schema round-trips

### Documentation
1. Mark stub functions clearly in JSDoc
2. Add test TODO comments with issue links
3. Document which tests are "type-only" vs "runtime"

---

## Conclusion

The test suite has **good architectural foundations** but suffers from:
1. **Config-only tests** that pass without verifying behavior
2. **Missing runtime tests** for critical paths (HTTP, React)
3. **Stub implementations** that tests don't catch

The 322 passing tests give a false sense of confidence. Actual functional coverage is closer to **60%** when accounting for untested code paths.
