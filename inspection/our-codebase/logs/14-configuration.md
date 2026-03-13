# Configuration and Options Analysis

## Overview

This document analyzes configuration handling across the effect-trpc codebase, examining all options interfaces, their usage patterns, default value handling, and validation approaches.

---

## All Configuration Interfaces Found

### 1. Server Module (`src/Server/index.ts`)

#### `HttpHandlerOptions` (Line 361)
```typescript
export interface HttpHandlerOptions {
  /**
   * Base path for the RPC endpoint (default: "/rpc")
   */
  readonly path?: string
}
```

**Status**: UNUSED/FAKE CONFIGURATION

The `path` option is accepted but completely ignored in `toHttpHandler`:
```typescript
export const toHttpHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  _options?: HttpHandlerOptions  // <-- Parameter prefixed with _ (unused)
): (request: HttpRequest) => Effect.Effect<HttpResponse, never, R> => {
  return (request: HttpRequest) =>
    // ... path is never used
}
```

**Evidence**: The underscore prefix `_options` is a convention indicating intentionally unused parameter.

---

### 2. Transport Module (`src/Transport/index.ts`)

#### `HttpOptions` (Line 199)
```typescript
export interface HttpOptions {
  /**
   * Request headers (static or dynamic)
   */
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  
  /**
   * Request timeout
   */
  readonly timeout?: Duration.DurationInput
  
  /**
   * Batching configuration
   */
  readonly batching?: {
    readonly enabled?: boolean      // default: true for queries
    readonly window?: Duration.DurationInput  // default: 0 = microtask
    readonly maxSize?: number       // default: 50
    readonly queries?: boolean      // default: true
    readonly mutations?: boolean    // default: false
  }
  
  /**
   * Custom fetch implementation
   */
  readonly fetch?: typeof globalThis.fetch
}
```

**Status**: PARTIALLY USED

| Option | Used | Evidence |
|--------|------|----------|
| `headers` | YES | Used in `sendHttp()` at line 286-288 |
| `timeout` | YES | Used at line 270, 291-293 |
| `fetch` | YES | Used at line 269, 273-274 |
| `batching.enabled` | NO | Not implemented |
| `batching.window` | NO | Not implemented |
| `batching.maxSize` | NO | Not implemented |
| `batching.queries` | NO | Not implemented |
| `batching.mutations` | NO | Not implemented |

**Critical Issue**: The entire `batching` configuration is documented but never implemented. The test at `test/transport.test.ts:54-66` passes because it only verifies the layer is created, not that batching works.

---

### 3. Client Module (`src/Client/index.ts`)

#### `QueryOptions` (Line 399)
```typescript
export interface QueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly staleTime?: number
}
```

**Status**: PARTIALLY USED

| Option | Used | Evidence |
|--------|------|----------|
| `enabled` | YES | Used in `react.ts:148, 159, 191, 205` |
| `refetchInterval` | YES | Used in `react.ts:148, 204-209` |
| `staleTime` | NO | Extracted at line 148 but never used |

**Issue**: `staleTime` is documented and accepted but has no implementation.

#### `MutationOptions<Success, Error>` (Line 436)
```typescript
export interface MutationOptions<Success, Error> {
  readonly onSuccess?: (data: Success) => void
  readonly onError?: (error: Error) => void
  readonly onSettled?: () => void
}
```

**Status**: FULLY USED

All callbacks are used in `react.ts:262, 293-294, 302-304`.

#### `StreamOptions` (Line 476)
```typescript
export interface StreamOptions {
  readonly enabled?: boolean
}
```

**Status**: FULLY USED

Used in `react.ts:384, 395`.

---

### 4. Procedure Module (`src/Procedure/index.ts`)

#### `OptimisticConfig<Target, Payload, Success>` (Line 124)
```typescript
export interface OptimisticConfig<in out Target, in Payload, in Success> {
  readonly target: string
  readonly reducer: (current: Target, payload: Payload) => Target
  readonly reconcile?: (current: Target, payload: Payload, result: Success) => Target
}
```

**Status**: ACCEPTED BUT NOT IMPLEMENTED

The config is stored on mutations (line 374) but never executed. No optimistic update logic exists in the client.

#### `QueryOptions<Payload, Success, Error>` (Line 214)
```typescript
export interface QueryOptions<
  Payload extends Schema.Schema.Any,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All
> {
  readonly payload?: Payload
  readonly success: Success
  readonly error?: Error
}
```

**Status**: FULLY USED

Used in `query()` constructor (line 258-272).

#### `MutationOptions<Payload, Success, Error, Paths, Target>` (Line 280)
```typescript
export interface MutationOptions<...> {
  readonly payload?: Payload
  readonly success: Success
  readonly error?: Error
  readonly invalidates: readonly AutoComplete<Paths>[]
  readonly optimistic?: OptimisticConfig<Target, ...>
}
```

**Status**: MOSTLY USED

| Option | Used | Evidence |
|--------|------|----------|
| `payload` | YES | Line 370 |
| `success` | YES | Line 371 |
| `error` | YES | Line 372 |
| `invalidates` | YES | Line 373, used in Client |
| `optimistic` | STORED ONLY | Line 374, no execution |

#### `StreamOptions<Payload, Success, Error>` (Line 384)
```typescript
export interface StreamOptions<
  Payload extends Schema.Schema.Any,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All
> {
  readonly payload?: Payload
  readonly success: Success
  readonly error?: Error
}
```

**Status**: FULLY USED

Used in `stream()` constructor (line 426-440).

---

### 5. Middleware Module (`src/Middleware/index.ts`)

#### `MiddlewareConfig<Provides, Failure>` (Line 103)
```typescript
export interface MiddlewareConfig<Provides, Failure> {
  readonly provides: Context.Tag<any, Provides>
  readonly failure?: Schema.Schema<Failure, any>
}
```

**Status**: TYPE-ONLY

This interface is defined but not used in actual construction. The `Tag` function at line 172 takes separate parameters instead of a config object:
```typescript
export const Tag = <Provides, Failure = never>(
  id: string,
  provides: Context.Tag<any, Provides>
): MiddlewareTag<any, Provides, Failure>
```

The `failure` field is never actually accepted.

---

## Default Value Handling

### Explicit Defaults (Good)

| Location | Option | Default | Implementation |
|----------|--------|---------|----------------|
| `Procedure.query` | `payload` | `Schema.Void` | `options.payload ?? Schema.Void` |
| `Procedure.query` | `error` | `Schema.Never` | `options.error ?? Schema.Never` |
| `Procedure.mutation` | `payload` | `Schema.Void` | `options.payload ?? Schema.Void` |
| `Procedure.mutation` | `error` | `Schema.Never` | `options.error ?? Schema.Never` |
| `Procedure.stream` | `payload` | `Schema.Void` | `options.payload ?? Schema.Void` |
| `Procedure.stream` | `error` | `Schema.Never` | `options.error ?? Schema.Never` |
| `Transport.http` | `fetch` | `globalThis.fetch` | `options?.fetch ?? globalThis.fetch` |
| `Transport.http` | `timeout` | `30000ms` | `options?.timeout ? Duration.toMillis(...) : 30000` |
| `react.ts useQuery` | `enabled` | `true` | `const { enabled = true, ... } = options` |
| `react.ts useStream` | `enabled` | `true` | `const { enabled = true } = options` |

### Documented But Not Implemented Defaults

| Location | Option | Documented Default | Actual |
|----------|--------|-------------------|--------|
| `HttpOptions.batching.enabled` | `true for queries` | Not implemented |
| `HttpOptions.batching.window` | `0 = microtask` | Not implemented |
| `HttpOptions.batching.maxSize` | `50` | Not implemented |
| `HttpOptions.batching.queries` | `true` | Not implemented |
| `HttpOptions.batching.mutations` | `false` | Not implemented |
| `HttpHandlerOptions.path` | `"/rpc"` | Completely ignored |

---

## Configuration Validation

### Current State: NO VALIDATION

None of the configuration interfaces include runtime validation:

1. **No Schema validation** - Options are not validated against schemas
2. **No type guards** - No runtime checks for invalid option combinations
3. **No error messages** - Invalid options silently ignored

### Example Issues

```typescript
// This silently ignores invalid batching config
Transport.http("/api", {
  batching: {
    enabled: "yes",      // Should be boolean
    maxSize: -100,       // Should be positive
    window: "invalid",   // Should be Duration
  }
})

// This silently ignores path
Server.toHttpHandler(server, { path: "/custom" })  // path ignored
```

---

## Summary Tables

### Options Usage Summary

| Interface | Total Options | Used | Partially Used | Unused |
|-----------|--------------|------|----------------|--------|
| `HttpHandlerOptions` | 1 | 0 | 0 | 1 |
| `HttpOptions` | 7 | 3 | 0 | 4 (batching.*) |
| `QueryOptions` (Client) | 3 | 2 | 0 | 1 (staleTime) |
| `MutationOptions` (Client) | 3 | 3 | 0 | 0 |
| `StreamOptions` (Client) | 1 | 1 | 0 | 0 |
| `OptimisticConfig` | 3 | 0 | 0 | 3 (stored only) |
| `MiddlewareConfig` | 2 | 1 | 0 | 1 (failure) |

### Severity Classification

| Issue | Severity | Impact |
|-------|----------|--------|
| `batching` not implemented | HIGH | Users expect batching to work per docs |
| `HttpHandlerOptions.path` ignored | MEDIUM | Misleading API |
| `staleTime` not implemented | MEDIUM | React users expect caching |
| `optimistic` not implemented | HIGH | Feature advertised but doesn't work |
| `MiddlewareConfig.failure` unused | LOW | Type-only, no runtime impact |
| No validation | MEDIUM | Silent failures |

---

## Recommendations

### Priority 1: Remove or Implement Fake Config

**Option A: Remove unimplemented options** (Recommended for MVP)
```typescript
// Remove from HttpOptions:
// - batching (entire object)

// Remove from HttpHandlerOptions:
// - path (or implement it)

// Remove from QueryOptions:
// - staleTime

// Remove from MutationOptions/OptimisticConfig:
// - optimistic (entire feature)
```

**Option B: Implement the features** (Future)
- Batching requires significant work (request batching, response correlation)
- Optimistic updates need client-side cache management

### Priority 2: Clean Up Type-Only Interfaces

Remove `MiddlewareConfig` interface if not used, or update `Middleware.Tag` to accept a config object.

### Priority 3: Add Runtime Validation

```typescript
// Example with Schema validation
export const http = (
  url: string,
  options?: HttpOptions
): Layer.Layer<Transport, never, never> => {
  // Validate options
  if (options?.timeout !== undefined) {
    const ms = Duration.toMillis(options.timeout)
    if (ms <= 0) {
      throw new Error("timeout must be positive")
    }
  }
  // ...
}
```

### Priority 4: Document Actual Behavior

Update JSDoc to reflect what actually works:
```typescript
/**
 * HTTP transport configuration
 * 
 * @since 1.0.0
 * @category models
 */
export interface HttpOptions {
  /**
   * Request headers (static or dynamic)
   */
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  
  /**
   * Request timeout (default: 30 seconds)
   */
  readonly timeout?: Duration.DurationInput
  
  /**
   * Custom fetch implementation
   */
  readonly fetch?: typeof globalThis.fetch
  
  // REMOVED: batching (not implemented)
}
```

---

## Code Smell Indicators

1. **Underscore-prefixed parameters**: `_options` in `toHttpHandler` - clear sign of unused
2. **Destructured but unused**: `staleTime` extracted from options but never referenced
3. **Stored but not executed**: `optimistic` config saved on mutation but no execution code
4. **Test coverage gaps**: Tests verify "options accepted" not "options work"

---

## Files Requiring Changes

| File | Change Needed |
|------|---------------|
| `src/Transport/index.ts` | Remove `batching` from `HttpOptions` |
| `src/Server/index.ts` | Remove `path` from `HttpHandlerOptions` or implement |
| `src/Client/index.ts` | Remove `staleTime` from `QueryOptions` |
| `src/Procedure/index.ts` | Remove `optimistic` or mark as `@experimental` |
| `src/Middleware/index.ts` | Clean up `MiddlewareConfig` |
| `test/transport.test.ts` | Remove batching tests until implemented |

---

## Conclusion

The codebase has a significant gap between documented configuration and actual implementation. Approximately 40% of configuration options are either completely unused or only partially implemented. This creates a misleading API where users configure features that don't work.

**Immediate action**: Remove unimplemented options to align documentation with reality.

**Future work**: Implement batching and optimistic updates as separate feature additions with proper tests.
