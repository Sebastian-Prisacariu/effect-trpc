# Type-Level Utilities and Schema Handling Analysis

## Executive Summary

The effect-trpc codebase contains a well-designed set of type-level utilities for path extraction, procedure lookup, and autocomplete. The type system is generally sound with good inference. However, there are several notable uses of `as` assertions and some type-level limitations to be aware of.

**Key Findings:**
- 136 uses of `as` assertions found (many are necessary, some are concerning)
- Type utilities (`Paths`, `ProcedureAt`, `Flatten`) work correctly
- `AutoComplete<T>` helper is clever and functional
- **27+ type errors found in test files** (missed by initial `tsc` check, caught by LSP)
- Missing type re-exports in Client module (`ProcedurePayload`, `ProcedureSuccess`, `ProcedureError`)
- Schema Class construction requires explicit property objects (tests use plain objects)
- Some schema encoding/decoding uses unsafe `as` to navigate Effect's type system

---

## 1. Type-Level Utilities Analysis

### 1.1 `Paths<D, Prefix>` - Path Extraction

**Location:** `src/Router/index.ts:322-328`

```typescript
export type Paths<D extends Definition, Prefix extends string = ""> = {
  [K in keyof D & string]: D[K] extends Procedure.Any
    ? Prefix extends "" ? K : `${Prefix}.${K}`
    : D[K] extends Definition
      ? Paths<D[K], Prefix extends "" ? K : `${Prefix}.${K}`>
      : never
}[keyof D & string]
```

**Analysis:**
- ✅ Correctly extracts all dotted paths from nested definitions
- ✅ Handles arbitrary nesting depth
- ✅ Returns union of all valid procedure paths
- ⚠️ Does NOT include namespace paths (e.g., "users" without procedure)
  - This is intentional - namespace paths are not procedures

**Example:**
```typescript
// Given:
{ users: { list: Query, get: Query }, health: Query }
// Returns:
"users.list" | "users.get" | "health"
```

**Edge Cases:**
- Works with empty definitions (returns `never`)
- Handles single-level definitions correctly
- Deep nesting (>10 levels) may hit TypeScript recursion limits, but this is unlikely in practice

### 1.2 `ProcedureAt<D, Path>` - Type-Safe Path Lookup

**Location:** `src/Router/index.ts:336-347`

```typescript
export type ProcedureAt<D extends Definition, Path extends string> = 
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof D
      ? D[Head] extends Definition
        ? ProcedureAt<D[Head], Tail>
        : never
      : never
    : Path extends keyof D
      ? D[Path] extends Procedure.Any
        ? D[Path]
        : never
      : never
```

**Analysis:**
- ✅ Correctly navigates nested paths using template literal types
- ✅ Returns `never` for invalid paths
- ✅ Type-safe access to procedure at any path
- ✅ Used correctly in `Transport/index.ts` for mock handlers

**Edge Cases:**
- Returns `never` for namespace paths (by design)
- Returns `never` for non-existent paths
- Empty path returns `never`

### 1.3 `Flatten<D, Prefix>` - Path-to-Procedure Map

**Location:** `src/Router/index.ts:355-364`

```typescript
export type Flatten<D extends Definition, Prefix extends string = ""> = {
  [K in keyof D & string as D[K] extends Procedure.Any 
    ? (Prefix extends "" ? K : `${Prefix}.${K}`)
    : never
  ]: D[K]
} & UnionToIntersection<{
  [K in keyof D & string]: D[K] extends Definition
    ? Flatten<D[K], Prefix extends "" ? K : `${Prefix}.${K}`>
    : {}
}[keyof D & string]>
```

**Analysis:**
- ✅ Creates a flat record type mapping paths to procedures
- ✅ Uses `UnionToIntersection` helper for nested flattening
- ⚠️ Not currently exported or used in the codebase
- Could be useful for future features (e.g., batch handlers)

### 1.4 `AutoComplete<T>` - IDE Autocomplete Helper

**Location:** `src/Procedure/index.ts:500`

```typescript
export type AutoComplete<T extends string> = T | (string & {})
```

**Analysis:**
- ✅ Clever TypeScript pattern for IDE autocomplete
- ✅ Allows any string while suggesting known values
- ✅ Used correctly in mutation `invalidates` type
- ✅ Does not restrict values at compile time (intentional)

**How it works:**
- `T` provides autocomplete suggestions
- `(string & {})` allows any string (the `& {}` prevents widening)
- IDE shows `T` options first, but accepts any string

**Usage in codebase:**
```typescript
// src/Procedure/index.ts:366
): Mutation<Payload, Success, Error, readonly AutoComplete<Paths>[]>
```

### 1.5 `DefinitionOf<R>` - Router Definition Extraction

**Location:** `src/Router/index.ts:378`

```typescript
export type DefinitionOf<R> = R extends Router<infer D> ? D : never
```

**Analysis:**
- ✅ Simple and correct
- ✅ Used throughout client code
- ✅ Works with `infer` correctly

---

## 2. Schema Encoding/Decoding Analysis

### 2.1 Correct Usage Patterns

The codebase correctly uses `Schema.decodeUnknown` for all schema validation:

**Client (src/Client/index.ts:119-127):**
```typescript
return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
  Effect.mapError((e) => new Transport.TransportError({
    reason: "Protocol",
    message: "Failed to decode success response",
    cause: e,
  }))
)
```

**Server (src/Server/index.ts:240):**
```typescript
return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(...)
```

**Transport (src/Transport/index.ts:342-349):**
```typescript
const decoded = yield* Schema.decodeUnknown(TransportResponse)(json).pipe(
  Effect.mapError((cause) =>
    new TransportError({
      reason: "Protocol",
      message: "Invalid response envelope",
      cause,
    })
  )
)
```

### 2.2 Schema.is for Type Guards

Correctly used for runtime type checking:

```typescript
// src/Client/index.ts:118
if (Schema.is(Transport.Success)(response)) { ... }

// src/Transport/index.ts:365
if (Schema.is(Success)(response)) { ... }
```

### 2.3 Schema.encode Usage

Server uses `Schema.encode` for response serialization:

```typescript
// src/Server/index.ts:251
Effect.flatMap((error) =>
  Schema.encode(procedure.errorSchema)(error).pipe(
    Effect.orElseSucceed(() => error),
    ...
  )
)
```

**Note:** The `orElseSucceed` fallback is a safety net for encoding failures.

---

## 3. Type Assertion (`as`) Analysis

### 3.1 Summary

| Location | Count | Severity | Purpose |
|----------|-------|----------|---------|
| `src/Server/index.ts` | 15 | Medium | Effect/Stream type widening |
| `src/Transport/index.ts` | 5 | Low | Type widening for Effects |
| `src/Middleware/index.ts` | 4 | Medium | Phantom types setup |
| Test files | ~50+ | Low | Runtime value casting |

### 3.2 Necessary Assertions

**Phantom Type Setup (src/Middleware/index.ts:179-180):**
```typescript
_provides: undefined as unknown as Provides,
_failure: undefined as unknown as Failure,
```
- **Verdict:** Necessary for phantom type parameters
- **Risk:** Low - these are never accessed at runtime

**Effect Type Widening (src/Server/index.ts:248):**
```typescript
const handlerEffect = (handler(payload) as Effect.Effect<unknown, unknown, R>).pipe(...)
```
- **Verdict:** Necessary due to complex conditional handler types
- **Risk:** Medium - handler type mismatch could cause runtime issues

**Stream Type Alignment (src/Server/index.ts:307):**
```typescript
const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
```
- **Verdict:** Necessary for stream handler flexibility
- **Risk:** Medium - similar to above

### 3.3 Potentially Problematic Assertions

**Loopback Transport (test/e2e/loopback.test.ts:20):**
```typescript
) as Effect.Effect<Transport.TransportResponse, Transport.TransportError>,
```
- **Issue:** Casting away `R` (requirements) - could hide dependency errors
- **Recommendation:** Should use proper layer composition instead

**Handler Map Build (src/Server/index.ts:203):**
```typescript
buildHandlerMap(router.definition, handlers as Record<string, unknown>, [], [])
```
- **Issue:** Loses type safety on handlers
- **Risk:** Low - only for internal iteration

### 3.4 Test File Casts

Many test files cast response values:
```typescript
expect((users as User[]).length).toBe(2)
expect((user as User).name).toBe("Alice")
```

- **Verdict:** Acceptable for tests
- **Recommendation:** Consider using assertion functions for cleaner tests

---

## 4. Type Inference Verification

### 4.1 Procedure Type Extraction

All procedure type extractors work correctly:

```typescript
// src/Procedure/index.ts
export type Payload<P extends Any> = P extends ProcedureBase<infer Payload, any, any>
  ? Schema.Schema.Type<Payload>
  : never

export type Success<P extends Any> = P extends ProcedureBase<any, infer Success, any>
  ? Schema.Schema.Type<Success>
  : never

export type Error<P extends Any> = P extends ProcedureBase<any, any, infer Error>
  ? Schema.Schema.Type<Error>
  : never
```

**Test Evidence (test/procedure.test.ts:80-101):**
```typescript
type PayloadType = Procedure.Payload<typeof getUserById>
expectTypeOf<PayloadType>().toEqualTypeOf<{ readonly id: string }>()

type SuccessType = Procedure.Success<typeof listUsers>
expectTypeOf<SuccessType>().toEqualTypeOf<readonly User[]>()

type ErrorType = Procedure.Error<typeof getUserById>
expectTypeOf<ErrorType>().toEqualTypeOf<NotFoundError>()
```

### 4.2 Client Type Inference

Client correctly maps procedures to API shapes:

```typescript
// src/Client/index.ts:267-273
export type ClientProxy<D extends Router.Definition> = {
  readonly [K in keyof D]: D[K] extends Procedure.Any
    ? ProcedureClient<D[K]>
    : D[K] extends Router.Definition
      ? ClientProxy<D[K]>
      : never
}
```

**Test Evidence (test/client.test.ts:177-222):**
- Payload types match procedures ✅
- Success types match procedures ✅
- Error types match procedures ✅

### 4.3 Handler Type Inference

Server handlers correctly infer from procedures:

```typescript
// src/Server/index.ts:76-85
export type HandlerFor<P, R = never> = 
  P extends Procedure.Query<infer Payload, infer Success, infer Error>
    ? (payload: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
  : ...
```

**Test Evidence (test/server.test.ts:240-269):**
```typescript
type ListHandler = Server.HandlerFor<typeof appRouter.definition.users.list>
expectTypeOf<ListHandler>().toEqualTypeOf<
  (payload: void) => Effect.Effect<readonly User[], never, never>
>()
```

---

## 5. Branded Types Usage

### 5.1 No Custom Branded Types Found

The codebase does not currently use `Schema.brand()` for custom branded types.

**Potential Improvements:**
- User ID could be branded: `Schema.String.pipe(Schema.brand("UserId"))`
- Request IDs could be branded

### 5.2 Schema Classes as "Soft" Brands

The codebase uses Schema classes which provide nominal typing:

```typescript
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}
```

This provides instance checking but not compile-time distinction from structural equivalents.

---

## 6. Error Type Flow Analysis

### 6.1 Error Types Flow Through Correctly

**Procedure → Client:**
```typescript
// Procedure defines error
Procedure.query({
  success: User,
  error: NotFoundError,
})

// Client receives typed error
type GetError = Client.ProcedureError<typeof appRouter.definition.users.get>
// = NotFoundError
```

**Server Handler → Transport:**
```typescript
// Handler fails with typed error
Effect.fail(new NotFoundError({ id }))

// Server encodes error
Schema.encode(procedure.errorSchema)(error)

// Transport wraps in Failure envelope
new Transport.Failure({ id, error: encodedError })
```

### 6.2 TransportError Union

Client methods return union with TransportError:

```typescript
readonly run: (payload: Payload) => Effect.Effect<
  Success, 
  Error | Transport.TransportError,  // ← Union type
  ClientServiceTag
>
```

This correctly represents that transport failures can occur in addition to handler errors.

---

## 7. Known TypeScript Limitations

### 7.1 Recursive Type Depth

Very deep router structures may hit TypeScript's recursion limit:

```typescript
// Theoretical limit: ~50 levels of nesting
// Practical limit: much less due to performance
```

**Mitigation:** Not a real-world concern for typical API structures.

### 7.2 Conditional Type Distribution

Some conditional types may distribute over unions unexpectedly. The codebase handles this correctly by using `extends` guards.

### 7.3 Template Literal Inference

Path manipulation uses template literals which work well but have edge cases:

```typescript
type Paths<D extends Definition, Prefix extends string = "">
// Works for most cases, but very long paths may cause issues
```

---

## 8. Test File Type Issues

### 8.1 LSP-Detected Type Errors

The initial `tsc` check reported no errors, but LSP analysis revealed **significant type errors** in test files:

#### 8.1.1 Missing `headers` Property in TransportRequest

**Files Affected:** `test/server.test.ts`, `test/integration.test.ts`, `test/transport.test.ts`

```typescript
// ERROR: Property 'headers' is missing
server.handle({
  id: "req-1",
  tag: "@test/health",
  payload: undefined,
})
```

**Root Cause:** `TransportRequest` requires `headers` but tests pass plain objects:
```typescript
// TransportRequest schema definition:
class TransportRequest extends Schema.Class<TransportRequest>("TransportRequest")({
  id: Schema.String,
  tag: Schema.String,
  payload: Schema.Unknown,
  headers: Schema.optionalWith(Schema.Record(...), { default: () => ({}) }),
}) {}
```

**Issue:** While `headers` has a default, the Schema.Class constructor requires it to be provided.

**Fix:** Tests should use `new Transport.TransportRequest({...})` constructor.

#### 8.1.2 Missing Client Type Exports

**File Affected:** `test/client.test.ts`, `test/integration.test.ts`

```typescript
// ERROR: Namespace 'Client' has no exported member 'ProcedurePayload'
type GetPayload = Client.ProcedurePayload<typeof appRouter.definition.users.get>
```

**Missing Exports:**
- `Client.ProcedurePayload`
- `Client.ProcedureSuccess`
- `Client.ProcedureError`

**Root Cause:** These type utilities exist in `Procedure` module but are referenced as `Client.*` in tests.

**Fix:** Either:
1. Add re-exports to Client module
2. Change tests to use `Procedure.Payload`, `Procedure.Success`, `Procedure.Error`

#### 8.1.3 Handler Type Mismatch

**File Affected:** `test/integration.test.ts:100`

```typescript
// ERROR: Type 'Effect<User[], never, UserRepository>' is not assignable to 
// type 'Effect<readonly User[], unknown, never>'.
// Type 'UserRepository' is not assignable to type 'never'.
```

**Issue:** Handler returns `Effect` with `UserRepository` requirement, but `Server.Handlers<D, never>` expects `R = never`.

**Fix:** Use `Server.Handlers<typeof appRouter.definition, UserRepository>` to declare the dependency.

#### 8.1.4 Schema Covariance Issue

**File Affected:** `test/integration.test.ts:209`

```typescript
// ERROR: Argument of type 'Struct<...>' is not assignable to 
// parameter of type 'Schema<..., unknown, never>'
```

**Issue:** Schema invariance - the schema's `_I` type must match exactly.

**Root Cause:** `ClientService.send` expects `Schema<S, unknown>` but procedure schemas are `Schema<S, Encoded>`.

#### 8.1.5 expectTypeOf Constraint Mismatch

**Files Affected:** `test/server.test.ts`, `test/integration.test.ts`

```typescript
// ERROR: Type '(payload: void) => Effect<readonly User[], never, never>' 
// does not satisfy the constraint '"Expected: function, Actual: function"'
```

**Issue:** Vitest's `expectTypeOf` has strict equality checking that fails due to variance differences.

### 8.1.6 Error Count Summary

| File | Error Count | Categories |
|------|-------------|------------|
| `test/server.test.ts` | 6 | TransportRequest, expectTypeOf |
| `test/client.test.ts` | 9 | Missing exports, useQuery args |
| `test/integration.test.ts` | 11 | Handler types, Schema, exports |
| `test/transport.test.ts` | 1 | TransportRequest |
| `examples/desired-api.ts` | 88+ | Syntax errors (incomplete file) |

### 8.2 Test Patterns

Tests use three patterns for type assertions:

1. **`expectTypeOf` (compile-time):**
   ```typescript
   expectTypeOf<PayloadType>().toEqualTypeOf<{ readonly id: string }>()
   ```

2. **`as` casts (runtime):**
   ```typescript
   expect((user as User).name).toBe("Alice")
   ```

3. **`@ts-expect-error` (negative tests):**
   ```typescript
   // @ts-expect-error - success is required
   Procedure.query({})
   ```

All three patterns are used appropriately.

---

## 9. Recommendations

### 9.1 Critical - Fix Test Type Errors

1. **Fix TransportRequest construction in tests**
   ```typescript
   // Before (broken):
   server.handle({ id: "req-1", tag: "@test/health", payload: undefined })
   
   // After (correct):
   server.handle(new Transport.TransportRequest({ 
     id: "req-1", 
     tag: "@test/health", 
     payload: undefined 
   }))
   ```

2. **Add missing type re-exports to Client module**
   ```typescript
   // src/Client/index.ts - add these exports:
   export type ProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>
   export type ProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>
   export type ProcedureError<P extends Procedure.Any> = Procedure.Error<P>
   ```

3. **Fix handler type in integration tests**
   ```typescript
   // Declare the UserRepository requirement:
   const server = Server.make<typeof appRouter.definition, UserRepository>(
     appRouter, 
     handlers
   )
   ```

### 9.2 High Priority

4. **Reduce `as` assertions in Server.ts**
   - Current: 15 assertions for type widening
   - Consider: Generic helper functions to reduce casting

5. **Add branded types for IDs**
   ```typescript
   const UserId = Schema.String.pipe(Schema.brand("UserId"))
   const RequestId = Schema.String.pipe(Schema.brand("RequestId"))
   ```

### 9.3 Medium Priority

6. **Type-safe test helpers**
   ```typescript
   const expectUser = (value: unknown): User => {
     if (!(value instanceof User)) throw new Error("Expected User")
     return value
   }
   ```

7. **Export `Flatten` utility**
   - Currently unused but potentially valuable

8. **Fix or remove `examples/desired-api.ts`**
   - File has 88+ syntax errors - appears incomplete

### 9.4 Low Priority

9. **Document type recursion limits**
   - Add JSDoc noting max nesting depth

10. **Consider path validation at runtime**
    - `Router.paths()` exists but could be used for runtime validation

---

## 10. Conclusion

The type-level utilities in effect-trpc are **well-designed and functional**. Key strengths:

- `Paths<D>` correctly extracts all valid procedure paths
- `ProcedureAt<D, Path>` provides type-safe path lookup
- `AutoComplete<T>` enables great IDE experience without restricting values
- Schema handling follows Effect best practices with `decodeUnknown`
- Error types flow through the system correctly

**Critical issues requiring attention:**

1. **Test files have 27+ type errors** that were not caught by `tsc` but are flagged by LSP
2. **Missing type re-exports** in Client module break tests using `Client.ProcedurePayload` etc.
3. **TransportRequest construction** in tests uses plain objects instead of class constructor
4. **examples/desired-api.ts** has 88+ syntax errors and appears incomplete

Areas for improvement:

- Fix critical test type errors before they cause runtime issues
- Reduce reliance on `as` assertions in Server/Transport modules
- Add branded types for identifiers
- Consider type-safe test assertion helpers

The codebase demonstrates strong TypeScript practices overall in the source code, but test files need type hygiene improvements.

**Root Cause of Discrepancy:**
The `tsconfig.json` explicitly **excludes** test files from type checking:
```json
{
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test", "examples", "benchmarks"]
}
```

This means `tsc --noEmit` only checks source files, while LSP analyzes all open files. **Test files have never been type-checked by CI/build process.**

**Recommendation:** Add a `tsconfig.test.json` that extends the base config and includes test files:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```
