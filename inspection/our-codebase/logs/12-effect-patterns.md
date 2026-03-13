# Effect Patterns Compliance Analysis

## Summary

| Category | Status | Details |
|----------|--------|---------|
| async/await usage | **ACCEPTABLE** | Used at boundary (React hooks, HTTP adapters) |
| try/catch usage | **ACCEPTABLE** | Used at boundary (React hooks, error fallbacks) |
| throw statements | **NEEDS REVIEW** | Some could be Effect.fail |
| Schema.decodeUnknownSync | **COMPLIANT** | Not used anywhere |
| JSON.parse | **COMPLIANT** | Only in docstring example |
| @ts-ignore | **COMPLIANT** | Not used anywhere |
| Service patterns | **EXCELLENT** | Proper Context.Tag usage |
| Layer composition | **EXCELLENT** | Proper Layer patterns |

**Overall: MOSTLY COMPLIANT** - The codebase follows Effect patterns well in the core Effect-based code. Boundary code (React hooks, HTTP adapters) necessarily uses async/await.

---

## Detailed Findings

### 1. async/await Usage

**Location & Context:**

| File | Line | Context | Verdict |
|------|------|---------|---------|
| Server/index.ts:382 | Doc example | Showing user how to use in Express | OK |
| Server/index.ts:462 | `toFetchHandler` | Boundary - must return Promise | OK |
| Server/index.ts:498 | `toNextApiHandler` | Boundary - must return Promise | OK |
| Client/react.ts:157 | `fetchData` callback | React useCallback boundary | OK |
| Client/react.ts:270 | `mutateAsync` callback | React useCallback boundary | OK |

**Analysis:** All async/await usage is at the boundary where Effect must interface with:
- React's callback-based world (useCallback returns sync functions)
- HTTP adapter APIs that require Promise returns

**Verdict:** ACCEPTABLE - These are unavoidable boundaries.

---

### 2. try/catch Usage

**Location & Context:**

| File | Line | Context | Verdict |
|------|------|---------|---------|
| Client/react.ts:164 | fetchData | Wraps runPromiseExit | ACCEPTABLE |
| Client/react.ts:274 | mutateAsync | Wraps runPromise | ACCEPTABLE |
| Client/index.ts:720 | createProvider | React import guard | ACCEPTABLE |
| Client/index.ts:732 | createUseQuery | React import guard | ACCEPTABLE |
| Client/index.ts:745 | createUseMutation | React import guard | ACCEPTABLE |
| Client/index.ts:758 | createUseStream | React import guard | ACCEPTABLE |
| Reactivity/index.ts:193 | invalidate | Callback error isolation | ACCEPTABLE |

**Analysis:**
- **React hooks (react.ts):** Catching errors from `runPromise/runPromiseExit` at the boundary
- **Import guards (index.ts):** Catching dynamic import failures when React isn't available
- **Reactivity:** Isolating callback errors so one failing callback doesn't stop others

**Verdict:** ACCEPTABLE - All try/catch is at boundaries or for defensive programming.

---

### 3. throw Statements

**Location & Context:**

| File | Line | Code | Verdict |
|------|------|------|---------|
| Client/react.ts:56 | `throw new Error("useClientContext must be used within...")` | React convention | ACCEPTABLE |
| Client/react.ts:305 | `throw err` | Re-throwing in mutateAsync | NEEDS REVIEW |
| Client/index.ts:638 | `throw new Error("runPromise requires...")` | Guard for unbound client | ACCEPTABLE |
| Client/index.ts:673 | `throw new Error("runPromise requires...")` | Guard for unbound client | ACCEPTABLE |
| Client/index.ts:686 | `throw new Error("Unknown procedure type...")` | Impossible state guard | ACCEPTABLE |
| Client/index.ts:736 | `throw new Error("useQuery requires React...")` | React availability guard | ACCEPTABLE |
| Client/index.ts:749 | `throw new Error("useMutation requires React...")` | React availability guard | ACCEPTABLE |
| Client/index.ts:762 | `throw new Error("useStream requires React...")` | React availability guard | ACCEPTABLE |

**Analysis:**
- **React context errors:** Standard React pattern for missing providers
- **Runtime guards:** Informative errors for incorrect usage
- **Impossible state:** Guards for exhaustive type checking

**Recommendations:**
1. `Client/react.ts:305` - The re-throw in mutateAsync is fine since it's at the Promise boundary and the error was already set in state.

**Verdict:** ACCEPTABLE - All throws are at boundaries or for impossible states.

---

### 4. Schema.decodeUnknownSync

**Search Result:** Not found anywhere in the codebase.

**Verdict:** COMPLIANT - Uses `Schema.decodeUnknown` (Effect-based) throughout:
- Server/index.ts:240, 332
- Client/index.ts:119, 127, 164
- Transport/index.ts:342

---

### 5. JSON.parse

**Location:**
- Server/index.ts:386 - In a docstring example showing Express usage

**Verdict:** COMPLIANT - Only in documentation, not actual code.

---

### 6. @ts-ignore

**Search Result:** Not found anywhere in the codebase.

**Verdict:** COMPLIANT

---

### 7. Service Patterns (Context.Tag)

**Properly Defined Tags:**

| Service | File | Line | Pattern |
|---------|------|------|---------|
| ClientServiceTag | Client/index.ts | 90 | `class X extends Context.Tag()` |
| Transport | Transport/index.ts | 184 | `class X extends Context.Tag()` |
| Reactivity | Reactivity/index.ts | 115 | `class X extends Context.Tag()` |

**Analysis:**
- All services use the modern `class X extends Context.Tag()` pattern
- Proper service interface definitions
- Clear separation of interface (Tag) and implementation (Layer)

**Verdict:** EXCELLENT

---

### 8. Layer Composition Patterns

**Layer Definitions:**

| Layer | File | Line | Type | Pattern |
|-------|------|------|------|---------|
| ClientServiceLive | Client/index.ts | 102 | Layer.effect | Effect-based service creation |
| http | Transport/index.ts | 272 | Layer.succeed | Pure value layer |
| mock | Transport/index.ts | 431 | Layer.succeed | Pure value layer |
| make | Transport/index.ts | 521 | Layer.succeed | Pure value layer |
| loopback | Transport/index.ts | 581 | Layer.effect | Effect-based layer |
| ReactivityLive | Reactivity/index.ts | 224 | Layer.sync | Sync factory |
| implement | Middleware/index.ts | 209 | Layer.succeed | Middleware layer |
| implementWrap | Middleware/index.ts | 235 | Layer.succeed | Middleware layer |

**Layer Composition Examples:**

```typescript
// Client/react.ts:84-87
const fullLayer = ClientServiceLive.pipe(
  Layer.provideMerge(Reactivity.ReactivityLive),
  Layer.provide(layer)
)
```

```typescript
// Client/index.ts:577
const fullLayer = ClientServiceLive.pipe(Layer.provide(layer))
```

**Analysis:**
- Proper use of `Layer.effect` for services that need Effects to construct
- Proper use of `Layer.succeed` for pure services
- Proper use of `Layer.sync` for synchronous factory functions
- Correct layer composition with `Layer.provide` and `Layer.provideMerge`

**Verdict:** EXCELLENT

---

### 9. Type Assertions (`as`) Analysis

**Total occurrences:** 150+ (mostly import aliases like `import * as X from`)

**Actual type assertions (excluding imports):**

| Category | Count | Files | Verdict |
|----------|-------|-------|---------|
| Import aliases | ~80 | All files | ACCEPTABLE (not assertions) |
| Schema type assertions | ~15 | Various | ACCEPTABLE |
| Handler type assertions | ~10 | Server, Client | ACCEPTABLE |
| React boundary | ~5 | react.ts | ACCEPTABLE |
| Any escape hatches | ~5 | Middleware | NEEDS REVIEW |

**Problematic patterns:**

1. **Middleware/index.ts:352:**
   ```typescript
   const impl = yield* middleware as any as Context.Tag<...>
   ```
   This double cast through `any` is a code smell. Could be improved with proper typing.

2. **Middleware/index.ts:209, 235:**
   ```typescript
   Layer.succeed(tag as any, ...)  as any
   ```
   Double `as any` casts - indicates type system fighting.

**Recommendations:**
- The Middleware module has the most type assertion issues
- Consider using `Schema.decodeUnknown` for some runtime checks instead of `as` casts
- The double-cast patterns in Middleware should be addressed with proper generic constraints

---

## Effect.fn Usage

**Search Result:** Not found in codebase.

**Analysis:** `Effect.fn` is a newer pattern for automatic tracing spans. The codebase uses `Effect.gen` throughout, which is the standard pattern.

**Recommendation:** Consider adopting `Effect.fn` for new code to get automatic tracing, but not a compliance violation.

---

## Error Handling Patterns

**Proper Error Patterns Found:**

1. **TaggedError for domain errors:**
   - `Transport/index.ts:65` - `TransportError extends Schema.TaggedError`

2. **Effect.fail for failures:**
   - `Server/index.ts:223, 232, 291, 300` - Proper Effect.fail usage
   - `Transport/index.ts:439, 463` - Proper Effect.fail usage
   - `Client/index.ts:134, 178` - Proper Effect.fail usage

3. **Effect.tryPromise for external calls:**
   - `Server/index.ts:395` - Wrapping request.json()
   - `Transport/index.ts:295-318, 331-339` - Wrapping fetch

4. **Effect.mapError for error transformation:**
   - Used throughout for proper error mapping

**Verdict:** EXCELLENT error handling patterns.

---

## Summary Table

| Rule | Status | Notes |
|------|--------|-------|
| No async/await | ACCEPTABLE | Only at boundaries |
| No try/catch | ACCEPTABLE | Only at boundaries |
| Never throw | ACCEPTABLE | Only at boundaries/guards |
| No decodeUnknownSync | COMPLIANT | Uses decodeUnknown |
| No JSON.parse | COMPLIANT | Only in docs |
| No @ts-ignore | COMPLIANT | Not found |
| Use Effect.fn | NOT ADOPTED | Uses Effect.gen (valid) |
| Branded types for IDs | NOT IMPLEMENTED | Uses string IDs |
| Context.Tag for services | COMPLIANT | Excellent |
| Rich domain errors | COMPLIANT | TaggedError used |

---

## Recommendations

### High Priority

1. **Middleware Type Safety (Middleware/index.ts:209, 235, 352)**
   - Reduce `as any` usage with proper generic constraints
   - Consider type-safe middleware composition patterns

### Medium Priority

2. **Branded Types for IDs**
   - Consider using `Schema.brand("RequestId")` for request IDs
   - Would improve type safety at compile time

3. **Effect.fn Adoption**
   - For new code, consider `Effect.fn` for automatic tracing spans

### Low Priority

4. **Documentation Updates**
   - The JSON.parse in Server/index.ts:386 example could use Schema.parseJson
   - Update examples to show best practices

---

## Conclusion

The codebase demonstrates **strong Effect.ts compliance**. All apparent "violations" are actually acceptable patterns for:
- React interop (hooks must use async/await at boundaries)
- HTTP adapter interop (must return Promises)
- Error guards (throwing for impossible states)

The main area for improvement is the Middleware module's type assertions, which could be more type-safe with careful generic design.

**Grade: A-** (Excellent Effect patterns with minor type assertion concerns)
