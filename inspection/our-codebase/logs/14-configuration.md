# Configuration Analysis

Deep analysis of effect-trpc's configuration/options interfaces and their actual usage.

## Overview

effect-trpc defines **13 distinct configuration interfaces** across its modules. This analysis examines what's declared vs. what's actually used in the implementation.

---

## 1. Server Module (`Server/index.ts`)

### HttpHandlerOptions

```typescript
export interface HttpHandlerOptions {
  readonly path?: string  // Base path for RPC endpoint (default: "/rpc")
}
```

**Status: DECLARED BUT IGNORED**

| Option | Declared | Used | Notes |
|--------|----------|------|-------|
| `path` | Yes | **NO** | Never accessed in `toHttpHandler()` or other HTTP handlers |

**Evidence:**
```typescript
// Line 470-473: Options parameter received but never used
export const toHttpHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  _options?: HttpHandlerOptions  // <-- Prefixed with underscore, ignored
): (request: HttpRequest) => Effect.Effect<HttpResponse, never, R> => {
```

**Impact:** Users cannot configure the base path for RPC endpoints.

---

## 2. Transport Module (`Transport/index.ts`)

### HttpOptions

```typescript
export interface HttpOptions {
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  readonly timeout?: Duration.DurationInput
  readonly fetch?: typeof globalThis.fetch
}
```

**Status: FULLY IMPLEMENTED**

| Option | Declared | Used | Default |
|--------|----------|------|---------|
| `headers` | Yes | Yes | `{}` |
| `timeout` | Yes | Yes | `30000ms` |
| `fetch` | Yes | Yes | `globalThis.fetch` |

**Evidence:**
```typescript
// Line 238-244: All options actually used
const fetchFn = options?.fetch ?? globalThis.fetch
const timeout = options?.timeout ? Duration.toMillis(options.timeout) : 30000

return Layer.succeed(Transport, {
  send: (request) => sendHttp(url, request, fetchFn, options?.headers, timeout),
  sendStream: (request) => sendHttpStream(url, request, fetchFn, options?.headers),
})
```

**Note:** Batching is planned but not implemented (documented in `/plans/batching.md`).

---

## 3. Middleware Module (`Middleware/index.ts`)

### MiddlewareConfig

```typescript
export interface MiddlewareConfig<Provides, Failure> {
  readonly provides: Context.Tag<any, Provides>
  readonly failure?: Schema.Schema<Failure, any>
}
```

**Status: NOT DIRECTLY USED**

This interface is documented but the actual `Tag` constructor uses a different signature:

```typescript
// Actual usage pattern:
export const Tag = <Provides, Failure = never>(
  id: string,
  provides: Context.Tag<any, Provides>
): MiddlewareTag<any, Provides, Failure>
```

**Analysis:** The `MiddlewareConfig` interface appears to be documentation-only. The `failure` schema is a type parameter, not a runtime value passed to the tag constructor.

### CombinedMiddleware Options

```typescript
// Via Middleware.all()
{ concurrency?: "sequential" | "unbounded" | number }
```

**Status: DECLARED, STORED, BUT NOT USED**

| Option | Declared | Stored | Actually Used |
|--------|----------|--------|---------------|
| `concurrency` | Yes | Yes | **NO** |

**Evidence:**
```typescript
// Line 294-308: concurrency is stored but...
export const all = <Tags extends ReadonlyArray<MiddlewareTag<any, any, any>>>(
  ...args: [...Tags] | [...Tags, { concurrency?: "sequential" | "unbounded" | number }]
): CombinedMiddleware<Tags> => {
  // ...
  return {
    [MiddlewareTypeId]: MiddlewareTypeId,
    tags,
    concurrency: options.concurrency ?? "sequential",  // Stored!
  }
}

// Line 356-371: But execute() ignores it!
export const execute = <A, E, R>(
  middlewares: ReadonlyArray<Applicable>,
  request: MiddlewareRequest,
  handler: Effect.Effect<A, E, R>
): Effect.Effect<...> => {
  const flatMiddlewares = middlewares.flatMap((m) =>
    MiddlewareTypeId in m ? (m as CombinedMiddleware<any>).tags : [m]
  )
  
  // Always executes sequentially via reduceRight!
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler as Effect.Effect<A, any, any>
  )
}
```

**Impact:** Users cannot parallelize independent middleware execution.

---

## 4. SSR Module (`SSR/index.ts`)

### DehydrateOptions

```typescript
export interface DehydrateOptions {
  readonly includeErrors?: boolean  // Whether to include failed queries (default: false)
}
```

**Status: DECLARED BUT IGNORED**

| Option | Declared | Used | Notes |
|--------|----------|------|-------|
| `includeErrors` | Yes | **NO** | Never accessed in `dehydrate()` |

**Evidence:**
```typescript
// Line 101-107: Options parameter ignored
export const dehydrate = (
  queries: Record<string, unknown>,
  _options?: DehydrateOptions  // <-- Underscore prefix
): DehydratedState => ({
  queries,
  timestamp: Date.now(),
})
```

---

## 5. Client Module (`Client/index.ts`)

### QueryOptions

```typescript
export interface QueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly staleTime?: number
}
```

**Status: PARTIALLY IMPLEMENTED**

| Option | Declared | Used | Notes |
|--------|----------|------|-------|
| `enabled` | Yes | Yes | Works |
| `refetchInterval` | Yes | **NO** | Declared but never used in React hooks |
| `staleTime` | Yes | **NO** | Declared but never used |

**Evidence (react.ts):**
```typescript
// Line 162-164: Only enabled is destructured
return function useQuery(
  payload?: Payload,
  options: UseQueryOptions = {}
): UseQueryResult<Success, Error> {
  const { enabled = true, suspense = false } = options
  // refetchInterval and staleTime never accessed!
```

### MutationOptions

```typescript
export interface MutationOptions<Success, Error> {
  readonly onSuccess?: (data: Success) => void
  readonly onError?: (error: Error) => void
  readonly onSettled?: () => void
}
```

**Status: FULLY IMPLEMENTED**

All callbacks are properly wired in `react.ts:261-335`.

### StreamOptions

```typescript
export interface StreamOptions {
  readonly enabled?: boolean
}
```

**Status: FULLY IMPLEMENTED**

---

## 6. Procedure Module (`Procedure/index.ts`)

### QueryOptions

```typescript
export interface QueryOptions<Payload, Success, Error> {
  readonly payload?: Payload
  readonly success: Success
  readonly error?: Error
}
```

**Status: FULLY IMPLEMENTED**

### MutationOptions

```typescript
export interface MutationOptions<Payload, Success, Error, Paths, Target> {
  readonly payload?: Payload
  readonly success: Success
  readonly error?: Error
  readonly invalidates: readonly AutoComplete<Paths>[]
  readonly optimistic?: OptimisticConfig<Target, ...>
}
```

**Status: PARTIALLY IMPLEMENTED**

| Option | Declared | Used | Notes |
|--------|----------|------|-------|
| `payload` | Yes | Yes | Works |
| `success` | Yes | Yes | Works |
| `error` | Yes | Yes | Works |
| `invalidates` | Yes | Yes | Works (stored, triggers invalidation) |
| `optimistic` | Yes | **STORED ONLY** | Never executed |

**Evidence:**
```typescript
// Procedure/index.ts Line 367-375: optimistic is stored
self.optimistic = options.optimistic

// BUT nowhere in the codebase is optimistic.reducer or optimistic.reconcile called!
```

**Impact:** Optimistic updates are defined but never applied.

### StreamOptions

```typescript
export interface StreamOptions<Payload, Success, Error> {
  readonly payload?: Payload
  readonly success: Success
  readonly error?: Error
}
```

**Status: FULLY IMPLEMENTED**

---

## 7. React Module (`Client/react.ts`)

### UseQueryOptions

```typescript
export interface UseQueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly suspense?: boolean
}
```

**Status: PARTIALLY IMPLEMENTED**

| Option | Declared | Used | Notes |
|--------|----------|------|-------|
| `enabled` | Yes | Yes | Works |
| `refetchInterval` | Yes | **NO** | Never implemented |
| `suspense` | Yes | Yes | Controls useAtomSuspense vs useAtomValue |

### UseMutationOptions

```typescript
export interface UseMutationOptions<Success, Error> {
  readonly onSuccess?: (data: Success) => void
  readonly onError?: (error: Error) => void
  readonly onSettled?: () => void
}
```

**Status: FULLY IMPLEMENTED**

### UseStreamOptions

```typescript
export interface UseStreamOptions {
  readonly enabled?: boolean
}
```

**Status: FULLY IMPLEMENTED**

---

## Summary Table

| Module | Interface | Total Options | Implemented | Ignored |
|--------|-----------|---------------|-------------|---------|
| Server | `HttpHandlerOptions` | 1 | 0 (0%) | 1 |
| Transport | `HttpOptions` | 3 | 3 (100%) | 0 |
| Middleware | `CombinedMiddleware` | 1 | 0 (0%) | 1 |
| SSR | `DehydrateOptions` | 1 | 0 (0%) | 1 |
| Client | `QueryOptions` | 3 | 1 (33%) | 2 |
| Client | `MutationOptions` | 3 | 3 (100%) | 0 |
| Client | `StreamOptions` | 1 | 1 (100%) | 0 |
| Procedure | `MutationOptions` | 5 | 4 (80%) | 1 |
| React | `UseQueryOptions` | 3 | 2 (67%) | 1 |

**Overall: 21 total options, 14 implemented (67%), 7 ignored (33%)**

---

## Default Values

| Option | Default | Location |
|--------|---------|----------|
| `Transport.HttpOptions.timeout` | `30000` (30s) | Transport/index.ts:239 |
| `Transport.HttpOptions.headers` | `{}` | Transport/index.ts:256-257 |
| `Middleware.all().concurrency` | `"sequential"` | Middleware/index.ts:306 |
| `QueryOptions.enabled` | `true` | Client/react.ts:164 |
| `UseQueryOptions.suspense` | `false` | Client/react.ts:164 |
| `StreamOptions.enabled` | `true` | Client/react.ts:398 |
| `Procedure.query.payload` | `Schema.Void` | Procedure/index.ts:268 |
| `Procedure.query.error` | `Schema.Never` | Procedure/index.ts:270 |

---

## Recommendations

### Critical (Must Fix)

1. **Implement `optimistic` updates** - The feature is advertised in the API but never executed. Either implement or remove.

2. **Implement or remove `refetchInterval`** - Commonly expected behavior for queries.

3. **Implement or remove `staleTime`** - Core caching behavior that users will expect.

### High Priority

4. **Implement `concurrency` for middleware** - The option is stored but Effect's `Effect.all({ concurrency })` pattern is never used.

5. **Implement `HttpHandlerOptions.path`** - Or remove the interface if paths are handled differently.

### Medium Priority

6. **Implement `DehydrateOptions.includeErrors`** - Currently all errors are silently excluded.

### Code Cleanup

7. **Remove underscore prefixes** - Parameters like `_options` should either be used or the interface simplified.

8. **Document "planned" vs "implemented"** - Use `@experimental` or `@internal` JSDoc tags for unimplemented options.

---

## Configuration Flow

```
User Config → Procedure Options → Router → Server → HTTP Handler
                                            ↓
                                    Transport Options → Network
                                            ↓
                                    Middleware Options → Execution
```

Most configuration happens at the **Procedure level** (schemas, invalidation) and **Transport level** (HTTP options). Server and middleware configuration is minimal.

---

## Missing Configuration (Feature Gaps)

Compared to tRPC v11, effect-trpc lacks configuration for:

1. **Batching** - Link-level batching configuration
2. **SSE options** - Ping interval, reconnection settings
3. **Retry policies** - Automatic retry configuration
4. **Request deduplication** - Configurable deduplication windows
5. **Transformer configuration** - Custom serialization (uses Schema instead)
6. **Context factories** - Per-request context creation

Most of these are either "planned" or handled differently via Effect patterns (e.g., retry via `Effect.retry`).
