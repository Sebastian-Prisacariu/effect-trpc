# Configuration Options Analysis

## Overview

This analysis covers all configuration interfaces, their implementation status, and recommendations for the configuration API.

---

## 1. Configuration Interfaces

### Transport Configuration (HttpOptions)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `headers` | `HeadersInit \| (() => HeadersInit \| Promise<HeadersInit>)` | `{}` | **IMPLEMENTED** | Supports static and dynamic headers |
| `timeout` | `Duration.DurationInput` | `30000ms` | **IMPLEMENTED** | Applied to fetch requests |
| `fetch` | `typeof globalThis.fetch` | `globalThis.fetch` | **IMPLEMENTED** | Custom fetch implementation |
| `batching.enabled` | `boolean` | `true` (documented) | **IGNORED** | Defined but never read |
| `batching.window` | `Duration.DurationInput` | `0` (documented) | **IGNORED** | Defined but never read |
| `batching.maxSize` | `number` | `50` (documented) | **IGNORED** | Defined but never read |
| `batching.queries` | `boolean` | `true` (documented) | **IGNORED** | Defined but never read |
| `batching.mutations` | `boolean` | `false` (documented) | **IGNORED** | Defined but never read |

**Location:** `src/Transport/index.ts:199-244`

---

### Client Query Options (QueryOptions)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `enabled` | `boolean` | `true` (implied) | **STUBBED** | Hook stub, not implemented |
| `refetchInterval` | `number` | none | **STUBBED** | Hook stub, not implemented |
| `staleTime` | `number` | none | **STUBBED** | Hook stub, not implemented |

**Location:** `src/Client/index.ts:399-403`

---

### Client Mutation Options (MutationOptions)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `onSuccess` | `(data: Success) => void` | none | **STUBBED** | Hook stub, not implemented |
| `onError` | `(error: Error) => void` | none | **STUBBED** | Hook stub, not implemented |
| `onSettled` | `() => void` | none | **STUBBED** | Hook stub, not implemented |

**Location:** `src/Client/index.ts:436-440`

---

### Client Stream Options (StreamOptions)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `enabled` | `boolean` | `true` (implied) | **STUBBED** | Hook stub, not implemented |

**Location:** `src/Client/index.ts:475-477`

---

### Server HTTP Handler Options (HttpHandlerOptions)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `path` | `string` | `"/rpc"` (documented) | **IGNORED** | Defined but never used |

**Location:** `src/Server/index.ts:361-366`

---

### Middleware Configuration (CombinedMiddleware)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `concurrency` | `"sequential" \| "unbounded" \| number` | `"sequential"` | **PARTIALLY IMPLEMENTED** | Stored but not enforced during execution |

**Location:** `src/Middleware/index.ts:247-251, 267-281`

---

### Procedure Options

#### QueryOptions (Procedure creation)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `payload` | `Schema` | `Schema.Void` | **IMPLEMENTED** | |
| `success` | `Schema` | Required | **IMPLEMENTED** | |
| `error` | `Schema` | `Schema.Never` | **IMPLEMENTED** | |

#### MutationOptions (Procedure creation)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `payload` | `Schema` | `Schema.Void` | **IMPLEMENTED** | |
| `success` | `Schema` | Required | **IMPLEMENTED** | |
| `error` | `Schema` | `Schema.Never` | **IMPLEMENTED** | |
| `invalidates` | `string[]` | Required | **IMPLEMENTED** | |
| `optimistic.target` | `string` | none | **STUBBED** | Defined, stored, but React hooks not implemented |
| `optimistic.reducer` | `function` | none | **STUBBED** | Defined, stored, but React hooks not implemented |
| `optimistic.reconcile` | `function` | none | **STUBBED** | Defined, stored, but React hooks not implemented |

#### StreamOptions (Procedure creation)

| Option | Type | Default | Status | Notes |
|--------|------|---------|--------|-------|
| `payload` | `Schema` | `Schema.Void` | **IMPLEMENTED** | |
| `success` | `Schema` | Required | **IMPLEMENTED** | |
| `error` | `Schema` | `Schema.Never` | **IMPLEMENTED** | |

**Location:** `src/Procedure/index.ts:214-233, 280-327, 384-403`

---

## 2. Hardcoded Values That Need Exposure

| Location | Value | Current | Recommendation |
|----------|-------|---------|----------------|
| `Transport/index.ts:270` | HTTP timeout | `30000ms` | Already configurable via `timeout` option |
| `Server/index.ts:396` | HTTP success status | `200` | Should be configurable for REST semantics |
| `Server/index.ts:401` | HTTP error status | `400` | Should be configurable for REST semantics |
| `Middleware/index.ts:279` | Middleware concurrency | `"sequential"` | Stored but not enforced |
| `Reactivity/index.ts:197` | Error handling | `console.error` | Should have configurable error handler |

---

## 3. Missing Configuration Points

### Transport Layer

1. **Retry configuration** - No retry policy for transient errors
   - `retry.maxAttempts`: number
   - `retry.delay`: Duration
   - `retry.backoff`: "linear" | "exponential"
   - `retry.shouldRetry`: (error: TransportError) => boolean

2. **Request deduplication** - No deduplication of identical in-flight requests
   - `deduplication.enabled`: boolean
   - `deduplication.window`: Duration

3. **Connection pooling** - No connection management
   - `maxConnections`: number
   - `keepAlive`: boolean | Duration

4. **Compression** - No compression configuration
   - `compression.enabled`: boolean
   - `compression.threshold`: number (bytes)

### Server Layer

1. **HTTP configuration**
   - `cors.enabled`: boolean
   - `cors.origins`: string[]
   - `bodyLimit`: number (bytes)
   - `responseHeaders`: Record<string, string>

2. **Error serialization**
   - `errorMode`: "full" | "safe" (hide stack traces)
   - `includeStackTrace`: boolean

3. **Logging**
   - `logger`: Logger interface
   - `logLevel`: "debug" | "info" | "warn" | "error"

### Client Layer

1. **Global query options**
   - `defaultStaleTime`: Duration
   - `defaultCacheTime`: Duration
   - `defaultRetry`: number

2. **Global mutation options**
   - `defaultOnError`: (error: unknown) => void
   - `throwOnError`: boolean

3. **Devtools**
   - `devtools.enabled`: boolean
   - `devtools.position`: "top-left" | "top-right" | etc.

### Reactivity Layer

1. **Error handling**
   - `onCallbackError`: (error: unknown, tag: string) => void

2. **Debouncing**
   - `invalidationDebounce`: Duration

---

## 4. Configuration API Recommendations

### Current Pattern (Good)
```typescript
// Transport
Transport.http("/api", {
  timeout: Duration.seconds(30),
  headers: { "X-API-Key": "..." },
})
```

### Recommended Additions

#### 1. Global Client Configuration
```typescript
const api = Client.make(appRouter, {
  // Query defaults
  queries: {
    staleTime: Duration.seconds(30),
    cacheTime: Duration.minutes(5),
    retry: 3,
    refetchOnWindowFocus: true,
  },
  // Mutation defaults  
  mutations: {
    onError: (error) => toast.error(error.message),
    throwOnError: false,
  },
  // Devtools
  devtools: {
    enabled: process.env.NODE_ENV === "development",
  },
})
```

#### 2. Server Configuration
```typescript
const server = Server.make(appRouter, handlers, {
  http: {
    path: "/rpc",
    cors: {
      enabled: true,
      origins: ["https://example.com"],
    },
    errorMode: "safe", // Don't expose stack traces
  },
  logging: {
    enabled: true,
    logger: customLogger,
  },
})
```

#### 3. Transport with Retry
```typescript
Transport.http("/api", {
  timeout: Duration.seconds(30),
  retry: {
    maxAttempts: 3,
    delay: Duration.millis(100),
    backoff: "exponential",
    shouldRetry: Transport.isTransientError,
  },
  batching: {
    enabled: true,
    window: Duration.millis(10),
    maxSize: 50,
  },
})
```

---

## 5. Configuration Flow Analysis

### Current Flow

```
User Config → Transport.http() → Layer.succeed() → TransportService
                    ↓
              options.timeout → sendHttp()
              options.headers → sendHttp()
              options.fetch → sendHttp()
              options.batching → DROPPED (never read)
```

### Issues

1. **Batching config is accepted but ignored** - The type accepts batching options but the implementation never uses them.

2. **HttpHandlerOptions.path is ignored** - Server accepts `path` option but never uses it.

3. **Middleware concurrency is stored but not enforced** - `Middleware.all()` accepts concurrency but `execute()` always runs sequentially.

4. **No config validation** - Invalid configurations are silently accepted.

---

## 6. Implementation Priority

### High Priority (API promises these work)

1. **Implement batching** - The API documents it as working
2. **Implement HttpHandlerOptions.path** - Used in examples
3. **Enforce middleware concurrency** - API accepts but ignores

### Medium Priority (Important for production use)

4. **Add retry configuration** - Critical for reliability
5. **Add request deduplication** - Prevents redundant requests
6. **Add proper error logging config** - Better debugging

### Low Priority (Nice to have)

7. **Add compression config** - Performance optimization
8. **Add connection pooling** - Performance optimization
9. **Add devtools integration** - Developer experience

---

## 7. Summary Table

| Category | Defined | Implemented | Ignored | Stubbed |
|----------|---------|-------------|---------|---------|
| Transport | 9 | 4 | 5 | 0 |
| Client Hooks | 9 | 0 | 0 | 9 |
| Server HTTP | 1 | 0 | 1 | 0 |
| Middleware | 1 | 0 | 1* | 0 |
| Procedure | 12 | 9 | 0 | 3 |
| **Total** | **32** | **13** | **7** | **12** |

*Partially implemented - stored but not enforced

**Key Finding:** ~40% of configuration options are implemented, ~22% are ignored (defined but not used), and ~38% are stubbed (waiting for React implementation).

---

## 8. Recommendations

### Immediate Actions

1. **Remove or implement batching config** - Currently misleading
2. **Remove or implement HttpHandlerOptions.path** - Currently misleading  
3. **Document what's implemented** - Mark stubs clearly in docs

### Before v1.0

1. **Implement full batching support** - This is a key tRPC feature
2. **Add retry/timeout configuration** - Production requirement
3. **Add proper React hooks** - Core functionality
4. **Add configuration validation** - Fail fast on bad config

### API Design Principles

1. **Only expose what works** - Remove unused config options
2. **Provide sensible defaults** - Make simple cases trivial
3. **Allow full customization** - Make complex cases possible
4. **Validate at construction** - Fail early, not at runtime
