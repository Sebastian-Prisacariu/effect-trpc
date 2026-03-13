# Performance Analysis

## Overview

This analysis examines potential performance issues in the effect-trpc codebase, focusing on hot paths, unnecessary allocations, memoization opportunities, and schema compilation caching.

---

## Hot Path Analysis

### 1. Server Request Handling (`Server/index.ts:217-282`)

**Path:** `server.handle()` -> payload decode -> handler execution -> response encode

**Issues Found:**

#### 1.1 Handler Map Lookup - GOOD
```typescript
const entry = handlerMap.get(request.tag)
```
- Uses `Map.get()` which is O(1) - efficient for hot path
- Handler map is built once at server creation time

#### 1.2 Middleware Request Creation - ALLOCATION ON EVERY REQUEST
```typescript
const toMiddlewareRequest = (request: Transport.TransportRequest): Middleware.MiddlewareRequest => ({
  id: request.id,
  tag: request.tag,
  headers: {
    get: (name: string) => request.headers[name.toLowerCase()] ?? null,  // closure allocation
    has: (name: string) => name.toLowerCase() in request.headers,        // closure allocation
  },
  payload: request.payload,
})
```
**Problem:** Creates new closures on every request for `headers.get` and `headers.has`.

**Recommendation:** Pre-compute lowercase headers or use a class-based wrapper:
```typescript
class MiddlewareHeaders implements Middleware.Headers {
  constructor(private readonly headers: Record<string, string>) {}
  get(name: string) { return this.headers[name.toLowerCase()] ?? null }
  has(name: string) { return name.toLowerCase() in this.headers }
}
```

### 2. Schema Operations - CRITICAL PATH

#### 2.1 No Schema Compilation Caching

**Files affected:** Server/index.ts, Client/index.ts, Transport/index.ts

Every request performs:
```typescript
Schema.decodeUnknown(procedure.payloadSchema)(request.payload)
Schema.encode(procedure.successSchema)(value)
Schema.encode(procedure.errorSchema)(error)
```

**Analysis:**
- Effect's `Schema.decodeUnknown` and `Schema.encode` internally compile the schema on first use
- However, the API we're using creates new decoder/encoder functions per call
- Effect's schemas ARE cached internally via WeakMap, so this is NOT as bad as it looks

**Status:** ACCEPTABLE - Effect handles schema compilation caching internally

#### 2.2 Schema.is Guards in Hot Path

```typescript
// Client/index.ts:118, 155, 163
if (Schema.is(Transport.Success)(response)) { ... }
if (Schema.is(Transport.StreamChunk)(response)) { ... }
if (Schema.is(Transport.Failure)(response)) { ... }
```

**Problem:** `Schema.is()` recompiles the guard each time. While Effect caches these, calling `Schema.is()` in a tight loop is suboptimal.

**Recommendation:** Pre-compile guards:
```typescript
// At module level or in service initialization
const isSuccess = Schema.is(Transport.Success)
const isFailure = Schema.is(Transport.Failure)
const isStreamChunk = Schema.is(Transport.StreamChunk)
const isStreamEnd = Schema.is(Transport.StreamEnd)
```

### 3. Client Proxy Building (`Client/index.ts:545-559`)

```typescript
const buildProxy = <Def extends Router.Definition>(
  def: Def,
  pathParts: readonly string[]
): ClientProxy<Def> =>
  Record.map(def, (value, key) => {
    const newPath = [...pathParts, key]  // Array allocation on each key
    const tag = [rootTag, ...newPath].join("/")  // Array + string allocation
    ...
  }) as ClientProxy<Def>
```

**Analysis:**
- This runs only at `Client.make()` time, not on each request
- Acceptable allocation since it's initialization code

**Status:** ACCEPTABLE - One-time initialization cost

### 4. Router Path Map Building (`Router/index.ts:179-207`)

```typescript
const walk = (def: Definition, pathPrefix: string, tagPrefix: string): void => {
  for (const key of Object.keys(def)) {
    const path = pathPrefix ? `${pathPrefix}.${key}` : key  // String allocation
    const procedureTag = `${tagPrefix}/${key}`  // String allocation
    ...
  }
}
```

**Status:** ACCEPTABLE - One-time initialization at router creation

---

## Unnecessary Allocations Found

### 1. CRITICAL: Middleware Request Headers Closure (`Server/index.ts:206-214`)

**Every request allocates:**
- 1 object for MiddlewareRequest
- 2 closures for headers.get/has

**Impact:** High - runs on every single RPC call

### 2. MODERATE: Array Spread in Middleware Chain (`Server/index.ts:180`)

```typescript
const currentMiddlewares = [...inheritedMiddlewares, ...groupMiddlewares]
```

**Analysis:** Only runs during server initialization, not per-request.

**Status:** ACCEPTABLE

### 3. MODERATE: Stream Mapping Closures (`Server/index.ts:309-323`)

```typescript
return stream.pipe(
  Stream.map((value): Transport.StreamResponse => 
    new Transport.StreamChunk({ ... })  // Object allocation per chunk
  ),
  ...
)
```

**Analysis:** Creating response objects is necessary. No optimization possible without protocol changes.

**Status:** ACCEPTABLE - Inherent to streaming

### 4. LOW: Reactivity Callback Sets (`Reactivity/index.ts:162-199`)

```typescript
const callbacksToInvoke = new Set<InvalidationCallback>()
```

**Analysis:** Creates new Set on each invalidation. Since invalidation is infrequent (only after mutations), this is acceptable.

**Status:** ACCEPTABLE

---

## Missing Memoization Opportunities

### 1. Schema Type Guards (`Client/index.ts`, `Transport/index.ts`)

**Current:**
```typescript
if (Schema.is(Transport.Success)(response)) { ... }
```

**Should be:**
```typescript
// Module-level or in lazy init
const isSuccess = Schema.is(Transport.Success)
const isFailure = Schema.is(Transport.Failure)

// Usage
if (isSuccess(response)) { ... }
```

**Impact:** Minor - Effect caches internally, but explicit memoization is cleaner

### 2. Tag Building in Client (`Client/index.ts:551`)

**Current:**
```typescript
const tag = [rootTag, ...newPath].join("/")
```

**Already Optimized:** This only runs at initialization, not per-request. The tag is captured in the closure for `createProcedureClient`.

### 3. Paths to Tags Conversion (`Reactivity/index.ts:279-283`)

```typescript
export const pathsToTags = (
  rootTag: string,
  paths: ReadonlyArray<string>
): ReadonlyArray<string> =>
  paths.map((path) => `${rootTag}/${path.replace(/\./g, "/")}`)
```

**Optimization opportunity:** If the same paths are converted frequently, consider a WeakMap cache keyed on the paths array. However, mutation paths are typically static, so this is low priority.

---

## Schema Compilation Caching Status

### Effect's Built-in Caching

Effect uses WeakMaps internally for schema compilation. Key functions:

1. **`Schema.decode`** / **`Schema.encode`** - Compiled AST is cached
2. **`Schema.is`** - Type guard is cached per schema reference
3. **`Schema.decodeUnknown`** - Same as decode, handles unknown input

### Our Usage Patterns

| Location | Pattern | Cache Status |
|----------|---------|--------------|
| Server.handle | `Schema.decodeUnknown(procedure.payloadSchema)` | CACHED - schema ref stable |
| Server.handle | `Schema.encode(procedure.successSchema)` | CACHED - schema ref stable |
| Client.send | `Schema.decodeUnknown(successSchema)` | CACHED - schema ref stable |
| Transport | `Schema.decodeUnknown(TransportResponse)` | CACHED - module-level schema |

**Conclusion:** Schema caching is working correctly. Effect handles this automatically.

---

## Performance Recommendations

### Priority 1: HIGH IMPACT

#### 1.1 Pre-compile Schema Type Guards

**File:** Create `src/internal/guards.ts`

```typescript
import * as Schema from "effect/Schema"
import * as Transport from "../Transport/index.js"

// Pre-compiled guards for hot path
export const isSuccess = Schema.is(Transport.Success)
export const isFailure = Schema.is(Transport.Failure)
export const isStreamChunk = Schema.is(Transport.StreamChunk)
export const isStreamEnd = Schema.is(Transport.StreamEnd)
```

**Benefit:** Eliminates guard compilation on first use in hot path

#### 1.2 Optimize Middleware Request Headers

**File:** `Server/index.ts`

```typescript
class MiddlewareHeaders {
  private readonly normalized: Record<string, string>
  
  constructor(headers: Record<string, string>) {
    // Pre-normalize all keys to lowercase
    this.normalized = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    )
  }
  
  get(name: string): string | null {
    return this.normalized[name.toLowerCase()] ?? null
  }
  
  has(name: string): boolean {
    return name.toLowerCase() in this.normalized
  }
}
```

**Benefit:** Avoids closure allocation per request, single object reusable

### Priority 2: MEDIUM IMPACT

#### 2.1 Add Request Batching Support

**Current status:** Batching options exist in `HttpOptions` but are not implemented.

**Impact:** Critical for production use - reduces HTTP round trips

#### 2.2 Consider Connection Pooling

For HTTP transport, consider implementing keep-alive connections and connection pooling.

### Priority 3: LOW IMPACT (Future Optimization)

#### 3.1 Lazy Handler Map Building

Currently the handler map is built eagerly at server creation. For very large routers (1000+ procedures), consider lazy building.

**Current impact:** Minimal - most apps have <100 procedures

#### 3.2 Stream Response Object Pooling

For high-throughput streaming, consider pooling `StreamChunk` objects.

**Current impact:** Minimal - JS engines handle small object allocation efficiently

---

## Benchmark Considerations

The project has a benchmark setup at `packages/effect-trpc/benchmark/` comparing effect-trpc with vanilla tRPC. Key observations:

1. **Type-level performance** is being tested (6400 routes)
2. **Runtime benchmarks** are not implemented yet

### Recommended Runtime Benchmarks

1. **Single request latency** - time for one query round trip
2. **Throughput** - requests per second at saturation
3. **Memory allocation** - bytes allocated per request
4. **GC pressure** - GC pauses under load

---

## Summary

| Area | Status | Action Required |
|------|--------|-----------------|
| Schema caching | GOOD | None - Effect handles this |
| Handler lookup | GOOD | O(1) Map lookup |
| Middleware request | NEEDS FIX | Create MiddlewareHeaders class |
| Type guards | COULD IMPROVE | Pre-compile at module level |
| Proxy building | GOOD | One-time initialization |
| Batching | MISSING | Implement HTTP batching |
| Connection pooling | MISSING | Consider for production |

**Overall Assessment:** The codebase has reasonable performance characteristics. The main hot path (request handling) has one allocation issue with middleware headers that should be fixed. Schema handling leverages Effect's internal caching correctly. The most impactful improvement would be implementing HTTP request batching.
