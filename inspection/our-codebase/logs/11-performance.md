# Performance Analysis: effect-trpc Hot Paths

**Analysis Date:** 2024
**Files Analyzed:** Server, Client, Transport, Router, Procedure, Middleware, Reactivity, React

---

## Executive Summary

This analysis identifies performance bottlenecks in effect-trpc's hot paths. The codebase shows several areas where per-request allocations and schema operations could impact performance under load.

**Key Findings:**
1. **Schema decoding on every request** - No schema caching
2. **New object allocations per request** - MiddlewareRequest, headers wrapper, etc.
3. **Map lookups in handler dispatch** - O(1) but allocates on each access
4. **React hook memoization gaps** - Some atoms recreated unnecessarily
5. **Path normalization on every invalidation** - String operations not cached

---

## 1. Server Module Hot Paths

### 1.1 Request Handling (`Server.handle`)

**Location:** `src/Server/index.ts:239-321`

```typescript
const handle = (request: TransportRequest) => {
  const entry = handlerMap.get(request.tag)  // 1. Map lookup
  
  // 2. NEW ALLOCATION: MiddlewareRequest object
  const middlewareRequest = toMiddlewareRequest(
    request, 
    getProcedureType(procedure),
    {}
  )
  
  // 3. SCHEMA DECODE: Per-request
  return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
    Effect.matchEffect({
      onSuccess: (payload) => {
        // 4. SCHEMA ENCODE on success/error
        return yield* Schema.encode(procedure.successSchema)(value)
      }
    })
  )
}
```

**Issues Identified:**

| Issue | Impact | Location |
|-------|--------|----------|
| Schema decode per request | HIGH | Line 267 |
| Schema encode per response | HIGH | Lines 278-304 |
| New MiddlewareRequest allocation | MEDIUM | Lines 261-265 |
| New headers wrapper allocation | MEDIUM | Lines 229-232 |
| Object spread for context | LOW | Line 264 |

**Recommendation:** Cache schema decoders/encoders per procedure. Effect Schema supports pre-compilation:

```typescript
// In Router.make or Server.make (once at startup)
const cachedDecoders = new Map<string, typeof Schema.decodeUnknown>()

// For each procedure
const decoder = Schema.decodeUnknown(procedure.payloadSchema)
const encoder = Schema.encode(procedure.successSchema)
cachedDecoders.set(tag, { decoder, encoder })
```

### 1.2 `toMiddlewareRequest` Allocation

**Location:** `src/Server/index.ts:219-236`

Every request creates:
1. New `MiddlewareRequest` object
2. New `headers` wrapper object with closures
3. String operations for path conversion

```typescript
const toMiddlewareRequest = (request, procedureType, meta, signal) => ({
  id: request.id,
  tag: request.tag,
  path: tagToPath(request.tag),  // String operation every time
  headers: {
    get: (name) => request.headers[name.toLowerCase()] ?? null,  // Closure
    has: (name) => name.toLowerCase() in request.headers,        // Closure
  },
  // ...
})
```

**Cost per request:** ~5-7 allocations (object + closures + string ops)

### 1.3 Stream Handler Path

**Location:** `src/Server/index.ts:327-417`

Similar allocation pattern, with additional:
- `Stream.unwrap` creates new stream wrapper
- Middleware check on every stream initiation
- Multiple `Stream.map`/`Stream.concat` operations

---

## 2. Client Module Hot Paths

### 2.1 Effect Creation per Call

**Location:** `src/Client/index.ts:616-628`

```typescript
const createRunEffect = (payload: unknown) =>
  Effect.gen(function* () {  // NEW generator function per call
    const service = yield* ClientServiceTag
    return yield* service.send(tag, payload, successSchema, errorSchema)
  })
```

**Issue:** Every `run()` call creates a new generator function and Effect.

**Recommendation:** Pre-create the effect template:

```typescript
// At procedure client creation time (once)
const runEffect = (payload: unknown) => 
  pipe(
    ClientServiceTag,
    Effect.flatMap((service) => 
      service.send(tag, payload, successSchema, errorSchema)
    )
  )
```

### 2.2 Transport Request ID Generation

**Location:** `src/Transport/index.ts:515-516`

```typescript
export const generateRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
```

**Cost:** String concatenation + `Math.random()` + `toString(36)` + `slice()`

This is called for **every request**. Consider:
- Pre-generating IDs in batches
- Using a faster ID generator (monotonic counter + prefix)

### 2.3 ClientService Response Handling

**Location:** `src/Client/index.ts:108-136`

```typescript
send: (tag, payload, successSchema, errorSchema) =>
  Effect.gen(function* () {
    const request = new Transport.TransportRequest({...})  // Allocation
    const response = yield* transport.send(request)
    
    if (Schema.is(Transport.Success)(response)) {  // Type guard (fast)
      return yield* Schema.decodeUnknown(successSchema)(response.value)  // DECODE
    } else {
      const error = yield* Schema.decodeUnknown(errorSchema)(response.error)  // DECODE
      // ...
    }
  })
```

Schema decoding happens on **every response** - success and error paths.

---

## 3. Schema Caching Status

### Current State: NO CACHING

The codebase does **not** cache compiled schemas. Every decode/encode operation:

1. Creates new parse context
2. Traverses schema AST
3. May allocate intermediate structures

**Locations where schemas are used hot:**

| Module | Operation | Line | Frequency |
|--------|-----------|------|-----------|
| Server | `Schema.decodeUnknown(payloadSchema)` | 267 | Per request |
| Server | `Schema.encode(errorSchema)` | 278 | Per error |
| Server | `Schema.encode(successSchema)` | 292 | Per success |
| Client | `Schema.decodeUnknown(successSchema)` | 119 | Per response |
| Client | `Schema.decodeUnknown(errorSchema)` | 127 | Per error |
| Transport | `Schema.decodeUnknown(TransportResponse)` | 311 | Per HTTP response |

### Recommendation: Parser Caching

Effect Schema supports caching via AST compilation. Example pattern:

```typescript
// In Procedure creation
interface ProcedureBase {
  // Add cached parsers
  readonly _payloadDecode: ParseResult.decodeUnknown<...>
  readonly _successEncode: ParseResult.encodeUnknown<...>
  readonly _errorEncode: ParseResult.encodeUnknown<...>
}

// Pre-compile during Procedure.query/mutation/stream
const query = (options) => {
  const self = Object.create(ProcedureProto)
  self._payloadDecode = Schema.decodeUnknown(options.payload ?? Schema.Void)
  self._successEncode = Schema.encode(options.success)
  // ...
}
```

---

## 4. Router Initialization Analysis

### 4.1 `Router.make` Path Building

**Location:** `src/Router/index.ts:169-238`

```typescript
export const make = <D extends Definition>(tag: string, definition: D) => {
  const procedures: TaggedProcedure[] = []           // Allocation
  const pathToTag = new Map<string, string>()        // Allocation
  const tagToPath = new Map<string, string>()        // Allocation
  const proceduresByPath = new Map<string, TaggedProcedure>()  // Allocation
  
  const walk = (def, pathPrefix, tagPrefix) => {
    for (const key of Object.keys(def)) {
      const path = pathPrefix ? `${pathPrefix}.${key}` : key  // String concat
      const procedureTag = `${tagPrefix}/${key}`              // String concat
      // ...
    }
  }
  walk(definition, "", tag)
  // ...
}
```

**Assessment:** This is **startup cost only** - acceptable.

The `pathMap` structure is efficient for lookups at runtime:
- `getChildPaths`: O(n) scan of all paths
- `getChildTags`: O(n) scan

**Potential Optimization:** Pre-compute child path arrays as a tree structure:

```typescript
interface PathMap {
  // Current - O(n) linear scan
  readonly getChildPaths: (prefix: string) => ReadonlyArray<string>
  
  // Better - O(1) lookup
  readonly childIndex: Map<string, ReadonlyArray<string>>
}
```

---

## 5. Middleware Execution

### 5.1 Middleware Chain Execution

**Location:** `src/Middleware/index.ts:356-371`

```typescript
export const execute = (middlewares, request, handler) => {
  // ALLOCATION: Array flatMap
  const flatMiddlewares = middlewares.flatMap((m) =>
    MiddlewareTypeId in m ? (m as CombinedMiddleware<any>).tags : [m]
  )
  
  // ALLOCATION: Array reduce (new effect per middleware)
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler
  )
}
```

**Per-request cost:**
1. `flatMap` creates new array
2. `reduceRight` creates N intermediate Effects (one per middleware)

**Recommendation:** Pre-flatten middleware chains at server creation:

```typescript
// In Server.make
handlerMap.set(tag, {
  handler,
  procedure,
  // Pre-flatten for O(1) access
  flatMiddlewares: middlewares.flatMap(flatten),
})
```

### 5.2 Single Middleware Execution

**Location:** `src/Middleware/index.ts:373-392`

```typescript
const executeOne = (middleware, request, next) =>
  Effect.gen(function* () {  // New generator per middleware
    const impl = yield* middleware
    
    if ("wrap" in impl) {
      return yield* impl.wrap(request, next)
    } else {
      const provided = yield* impl.run(request)
      return yield* next.pipe(Effect.provideService(middleware.provides, provided))
    }
  })
```

Creates a generator function for **each middleware in the chain**.

---

## 6. React Integration Hot Paths

### 6.1 `createUseQuery` Atom Creation

**Location:** `src/Client/react.ts:149-226`

```typescript
const createUseQuery = (tag, procedure) => {
  // Pre-compute reactivity keys (GOOD - once per procedure)
  const reactivityKeys = tagParts.reduce(...)
  
  return function useQuery(payload, options) {
    // useMemo dependency: [ctx.atomRuntime, tag]
    const queryAtom = useMemo(() => {
      const queryEffect = Effect.gen(function* () {  // Closure over payloadRef
        // ...
      })
      
      let atom = ctx.atomRuntime.atom(queryEffect)
      // ...
    }, [ctx.atomRuntime, tag])
    
    // useAtomMount, useAtomRefresh, useAtomValue all called per render
  }
}
```

**Issues:**
1. `payloadRef.current` pattern means Effect is **not** recreated on payload change
   - This is intentional for stability
   - But means stale closure if payload changes without refetch

2. `useAtomValue` is called every render - Effect Atom handles this efficiently

### 6.2 `createUseMutation` Allocations

**Location:** `src/Client/react.ts:255-366`

```typescript
const createUseMutation = (tag, procedure) => {
  return function useMutation(options) {
    // useState for result - React optimized
    const [result, setResult] = useState(Result.initial())
    
    // NEW: mutation function created per render
    const mutationFn = useMemo(() => {
      return ctx.atomRuntime.fn<Payload>()(
        (payload, _get) => Effect.gen(function* () {
          // ...
        }),
        { reactivityKeys: ... }
      )
    }, [ctx.atomRuntime, tag])
    
    // useCallback creates new function identity when deps change
    const mutateAsync = useCallback(async (payload) => {
      // ...
    }, [registry, mutationFn, onSuccess, onError, onSettled])
  }
}
```

**Issue:** `useCallback` depends on `onSuccess, onError, onSettled` - if these are inline functions, new callback every render.

**Recommendation:** Document that callbacks should be stable (wrapped in useCallback by consumer).

---

## 7. Reactivity Module Analysis

### 7.1 Path Normalization

**Location:** `src/Reactivity/index.ts:53-54`

```typescript
export const normalizePath = (path: string): string =>
  path.replace(/\./g, "/")
```

Called on **every** `register()` and `invalidate()` call.

### 7.2 Invalidation Scan

**Location:** `src/Reactivity/index.ts:171-191`

```typescript
invalidate: (paths) => Effect.gen(function* () {
  const registered = yield* Ref.get(registeredPathsRef)  // HashSet to array
  const toInvalidate: string[] = []                      // Allocation
  
  for (const path of paths) {
    const normalized = normalizePath(path)               // String op per path
    
    for (const reg of registered) {                      // O(n) scan
      if (shouldInvalidate(reg, normalized)) {
        toInvalidate.push(reg)
      }
    }
  }
  
  if (toInvalidate.length > 0) {
    const unique = [...new Set(toInvalidate)]            // Dedup allocation
    yield* inner.invalidate(unique)
  }
})
```

**Complexity:** O(P * R) where P = paths to invalidate, R = registered paths

For 100 registered queries and invalidating 5 paths = 500 string comparisons + allocations.

**Recommendation:** Build path tree structure for O(log n) invalidation:

```typescript
interface PathTree {
  children: Map<string, PathTree>
  isRegistered: boolean
}

// Invalidate "users" → find node, collect all descendants
```

---

## 8. Transport Layer Hot Paths

### 8.1 HTTP Request Building

**Location:** `src/Transport/index.ts:247-322`

```typescript
const sendHttp = (url, request, fetchFn, headers, timeout) =>
  Effect.gen(function* () {
    const resolvedHeaders = typeof headers === "function"
      ? yield* Effect.promise(() => Promise.resolve(headers()))
      : headers ?? {}
    
    const controller = new globalThis.AbortController()  // Allocation
    const timeoutId = timeout ? globalThis.setTimeout(...) : undefined
    
    const response = yield* Effect.tryPromise({
      try: () => fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(resolvedHeaders as Record<string, string>),  // Spread
        },
        body: JSON.stringify({  // Serialization
          id: request.id,
          tag: request.tag,
          payload: request.payload,
        }),
        signal: controller.signal,
      }),
      // ...
    })
    
    const json = yield* Effect.tryPromise({
      try: () => response.json(),  // Parsing
      // ...
    })
    
    const decoded = yield* Schema.decodeUnknown(TransportResponse)(json)  // Schema
  })
```

**Per-request allocations:**
1. `AbortController` - required for timeout
2. Headers object spread
3. `JSON.stringify` body object
4. `JSON.parse` response
5. Schema decode

### 8.2 `tagToPath` Utility

**Location:** `src/Transport/index.ts:455-462`

```typescript
const tagToPath = (tag: string): string => {
  const parts = tag.split("/")    // Array allocation
  return parts.slice(1).join(".") // Slice + Join
}
```

Called on **every mock transport request**. Should cache or inline.

---

## 9. Memory Allocation Summary

### Per-Request Allocations (Query)

| Allocation | Module | Avoidable? |
|------------|--------|------------|
| TransportRequest | Client | No |
| MiddlewareRequest | Server | Poolable |
| Headers wrapper | Server | Poolable |
| AbortController | Transport | No |
| Request body object | Transport | No |
| JSON.stringify result | Transport | No |
| JSON.parse result | Transport | No |
| Schema decode context | All | Cache |
| Schema encode context | Server | Cache |
| Effect.gen generators | All | Pattern change |

**Estimated allocations per query:** 15-25 objects

### Per-Invalidation Allocations

| Allocation | Module |
|------------|--------|
| Normalized path strings | Reactivity |
| toInvalidate array | Reactivity |
| Set for deduplication | Reactivity |
| Array from Set | Reactivity |

---

## 10. Recommendations Summary

### High Priority (>10% improvement expected)

1. **Cache schema decoders/encoders per procedure**
   - Pre-compile at Procedure creation
   - Store in procedure object
   - Reuse across all requests

2. **Pre-flatten middleware chains**
   - Do `flatMap` at Server.make, not per-request
   - Store flat array in handler map

3. **Pool/reuse MiddlewareRequest objects**
   - Create pool of request wrappers
   - Reset and reuse per request

### Medium Priority (5-10% improvement expected)

4. **Build path tree for invalidation**
   - O(log n) instead of O(n) lookups
   - Pre-compute at router creation

5. **Pre-compute tagToPath mappings**
   - Store in Router.pathMap
   - Avoid runtime string operations

6. **Use non-generator Effect patterns where possible**
   - `Effect.flatMap` chains instead of `Effect.gen`
   - Reduces closure allocations

### Low Priority (Measurable but minor)

7. **Batch request ID generation**
8. **Cache normalized paths in Reactivity**
9. **Document stable callback patterns for React hooks**

---

## 11. Benchmarking Recommendations

Current benchmark (`benchmarks/generate.ts`) focuses on **TypeScript type performance**, not runtime.

**Recommended runtime benchmarks:**

```typescript
// benchmarks/runtime/query-throughput.ts
// Measure: requests/second for simple query

// benchmarks/runtime/middleware-overhead.ts
// Measure: latency added per middleware

// benchmarks/runtime/schema-decode.ts
// Measure: decode time with/without caching

// benchmarks/runtime/invalidation-scale.ts
// Measure: invalidation time vs registered queries
```

---

## 12. Comparison Notes

### vs. tRPC v10/v11

tRPC uses:
- Zod for validation (similar allocation pattern)
- No middleware flattening (sequential execution)
- Simple request/response - no Effect overhead

### vs. @effect/rpc

@effect/rpc:
- Uses Effect Schema (same base)
- Has request context pooling in some implementations
- Designed for Effect ecosystem (similar patterns)

---

## Conclusion

effect-trpc's performance is reasonable for most applications. The main optimization opportunities are:

1. **Schema caching** - Biggest win, affects every request
2. **Middleware pre-flattening** - Affects apps with multiple middlewares  
3. **Object pooling** - For high-throughput scenarios

These optimizations would bring effect-trpc closer to raw tRPC performance while maintaining the Effect ecosystem benefits.
