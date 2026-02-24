# DECISION-008: Automatic Refetching & Data Freshness

**Date:** 2026-02-24  
**Status:** Accepted  
**Impacts:** React hooks, query options, serialization config, TanStack Query parity

---

## Context

Users coming from tRPC/TanStack Query expect automatic refetching options like:
- `refetchOnWindowFocus`
- `refetchOnReconnect`
- `staleTime` / `gcTime`
- `placeholderData` / `keepPreviousData`

Our current implementation has:
- `enabled` - Conditional query enabling
- `initialData` - Initial data before fetch
- `refetchInterval` - Polling at fixed intervals
- `refetch()` - Manual refetch function
- `staleTime` / `cacheTime` - Defined in interface but NOT implemented

Additionally, the loading state naming doesn't match TanStack Query semantics, causing confusion.

---

## Decision

### 1. Add TanStack Query-Compatible Refetching Options

Match TanStack Query's defaults for familiarity, while providing preset configs for common patterns.

### 2. Fix Loading State Semantics

Align `isLoading` / `isFetching` / `isRefetching` with TanStack Query definitions.

### 3. Add Global Configuration

Allow default query options in `createTRPCReact()`.

### 4. Add Global Serialization Config

Single serialization format configurable globally. Per-procedure-type serialization deferred until custom procedure types are implemented.

---

## API Design

### UseQueryOptions Interface

```typescript
export interface UseQueryOptions<A> {
  // ═══════════════════════════════════════════════════════════════════════════
  // Data Control
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Initial data to use before the first fetch completes. This IS cached. */
  readonly initialData?: A
  
  /** 
   * Placeholder data shown while loading.
   * Unlike initialData, this is NOT cached - it's replaced when real data arrives.
   * Can be a static value or a function receiving previous data.
   */
  readonly placeholderData?: A | ((previousData: A | undefined) => A | undefined)
  
  /** 
   * Keep the previous query result visible while fetching new data.
   * Useful for pagination/filtering where you want to show old data while new loads.
   * Shorthand for `placeholderData: keepPreviousData`
   * @default false
   */
  readonly keepPreviousData?: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // Query Control  
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** Whether the query should execute. @default true */
  readonly enabled?: boolean

  // ═══════════════════════════════════════════════════════════════════════════
  // Timing
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** 
   * How long data is considered fresh (ms).
   * During this time, refetch triggers are ignored.
   * @default 0 (always stale)
   */
  readonly staleTime?: number
  
  /** 
   * How long unused/inactive cache data remains in memory (ms).
   * After this time, unmounted queries are garbage collected.
   * Uses effect-atom's `defaultIdleTTL` under the hood.
   * 
   * **Note:** In v1, gcTime is a GLOBAL setting. Set it via `defaultQueryOptions.gcTime`
   * in `createTRPCReact()`. Per-query gcTime values are ignored - they would require
   * creating separate atoms per gcTime value, which breaks query deduplication.
   * 
   * @default 300_000 (5 minutes)
   */
  readonly gcTime?: number

  // ═══════════════════════════════════════════════════════════════════════════
  // Automatic Refetch Triggers
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** 
   * Refetch when window regains focus (if data is stale).
   * Uses effect-atom's `windowFocusSignal`.
   * @default true
   */
  readonly refetchOnWindowFocus?: boolean
  
  /** 
   * Refetch when browser reconnects to network (if data is stale).
   * @default true
   */
  readonly refetchOnReconnect?: boolean
  
  /** 
   * Refetch when component mounts (if data is stale).
   * - `true`: Refetch if stale
   * - `false`: Never refetch on mount
   * - `'always'`: Always refetch, even if not stale
   * @default true
   */
  readonly refetchOnMount?: boolean | 'always'
  
  /** 
   * Polling interval (ms). Set to 0 or false to disable.
   * @default 0 (disabled)
   */
  readonly refetchInterval?: number | false
  
  /** 
   * Continue polling when window is unfocused.
   * Only relevant when refetchInterval is set.
   * @default false
   */
  readonly refetchIntervalInBackground?: boolean
}
```

### UseQueryReturn Interface (Fixed Loading States)

```typescript
export interface UseQueryReturn<A, E> {
  readonly data: A | undefined
  readonly error: E | undefined
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Loading States (TanStack Query semantics)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /** 
   * True only when loading with NO data (first load).
   * False once we have data, even if refetching.
   */
  readonly isLoading: boolean
  
  /** 
   * True for ANY fetch in progress (initial OR background refetch).
   * Superset of isLoading + isRefetching.
   */
  readonly isFetching: boolean
  
  /** 
   * True when we have cached data AND are fetching fresh data.
   * Useful for showing subtle loading indicators without hiding content.
   */
  readonly isRefetching: boolean
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Other States
  // ═══════════════════════════════════════════════════════════════════════════
  
  readonly isError: boolean
  readonly isSuccess: boolean
  
  /** True when showing placeholder data or keepPreviousData */
  readonly isPlaceholderData: boolean
  
  readonly refetch: () => void
  readonly result: Result<A, E>
}
```

### Loading State Logic

```typescript
// Implementation
const hasData = AtomResult.isSuccess(atomState.result)
const isWaiting = atomState.result.waiting || AtomResult.isInitial(atomState.result)

return {
  // True only when loading with NO data
  isLoading: !hasData && isWaiting,
  
  // True for ANY loading state
  isFetching: isWaiting,
  
  // True when has data AND loading
  isRefetching: hasData && atomState.result.waiting,
  
  // ...
}
```

| State | `isLoading` | `isFetching` | `isRefetching` |
|-------|-------------|--------------|----------------|
| Initial (no data, not fetching) | false | false | false |
| First load (no data, fetching) | **true** | **true** | false |
| Success (has data, not fetching) | false | false | false |
| Background refetch (has data, fetching) | false | **true** | **true** |

---

## Global Configuration

### createTRPCReact Options

```typescript
export interface CreateTRPCReactOptions<TRouter extends Router> {
  readonly url: string
  
  /** Default options for all queries. Per-query options override these. */
  readonly defaultQueryOptions?: Partial<UseQueryOptions<unknown>>
  
  /** Default options for all mutations */
  readonly defaultMutationOptions?: Partial<UseMutationOptions>
  
  /** 
   * Serialization format.
   * @default 'ndjson'
   */
  readonly serialization?: 
    | 'ndjson' 
    | 'json' 
    | 'msgpack'
    | {
        readonly contentType: string
        readonly encode: (value: unknown) => string | Uint8Array
        readonly decode: (data: string | Uint8Array) => unknown
      }
}
```

### Usage Example

```typescript
const trpc = createTRPCReact<AppRouter>({
  url: '/api/trpc',
  
  defaultQueryOptions: {
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchIntervalInBackground: true,
  },
  
  serialization: 'ndjson', // default
})

// Per-query override
const users = trpc.procedures.user.list.useQuery(undefined, {
  staleTime: Infinity,          // Never stale
  refetchOnWindowFocus: false,  // Don't refetch on focus
})
```

---

## Preset Configs (Convenience)

Export commonly-used configurations for different data freshness patterns:

```typescript
// effect-trpc/react
export const queryPresets = {
  /** For data that changes frequently (dashboards, feeds) */
  frequentData: {
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchInterval: 30_000,
  },
  
  /** For semi-stable data (user profiles, settings) */
  semiStableData: {
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  },
  
  /** For stable data (static content, rarely changes) */
  stableData: {
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchInterval: Infinity,
  },
  
  /** For SSG/SSR - disable automatic refetching */
  static: {
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  },
} as const

// Usage
const users = trpc.procedures.user.list.useQuery(undefined, {
  ...queryPresets.semiStableData,
  // Override specific options if needed
})
```

---

## keepPreviousData Implementation

### Current Behavior (Same-Key Refetch)

We already preserve previous data during refetch of the **same query key**:

```typescript
// In refetch()
const previousValue = AtomResult.isSuccess(atomState.result)
  ? atomState.result.value
  : undefined

setAtomState({
  result: AtomResult.waiting(
    previousValue !== undefined
      ? AtomResult.success(previousValue)  // Show previous during refetch
      : AtomResult.initial(),
  ),
})
```

### New: keepPreviousData for Key Changes

For **different query keys** (e.g., pagination), we need to track previous successful data:

```typescript
interface QueryAtomState<A, E> {
  readonly result: AtomResult<A, E>
  readonly lastFetchedAt: number | null
  readonly previousData: A | undefined  // NEW: Track last successful data
}

// In useQuery
const computeDisplayData = (): { data: A | undefined; isPlaceholderData: boolean } => {
  // If we have successful data (not waiting), use it
  if (AtomResult.isSuccess(atomState.result) && !atomState.result.waiting) {
    return { data: atomState.result.value, isPlaceholderData: false }
  }
  
  // If waiting with previous success, show that (same-key refetch)
  if (atomState.result.waiting && AtomResult.isSuccess(atomState.result)) {
    return { data: atomState.result.value, isPlaceholderData: false }
  }
  
  // keepPreviousData: show previous data while loading new key
  if (keepPreviousData && atomState.previousData !== undefined) {
    return { data: atomState.previousData, isPlaceholderData: true }
  }
  
  // placeholderData: compute placeholder
  if (placeholderData !== undefined) {
    const placeholder = typeof placeholderData === 'function'
      ? placeholderData(atomState.previousData)
      : placeholderData
    if (placeholder !== undefined) {
      return { data: placeholder, isPlaceholderData: true }
    }
  }
  
  // initialData as fallback
  if (initialData !== undefined && AtomResult.isInitial(atomState.result)) {
    return { data: initialData, isPlaceholderData: false }
  }
  
  return { data: undefined, isPlaceholderData: false }
}
```

### Helper Function

```typescript
/**
 * Helper to use previous data as placeholder while loading.
 * Pass to `placeholderData` option.
 */
export const keepPreviousData = <T>(previousData: T | undefined): T | undefined => previousData

// Usage
const users = trpc.procedures.user.list.useQuery(
  { page },
  { placeholderData: keepPreviousData }
)
```

---

## Signal Infrastructure

### Window Focus Signal

Use effect-atom's built-in:

```typescript
import { windowFocusSignal } from '@effect-atom/atom'

// In useQuery
React.useEffect(() => {
  if (!refetchOnWindowFocus || !enabled) return
  
  return registry.subscribe(windowFocusSignal, () => {
    if (isStale(atomState.lastFetchedAt, staleTime)) {
      refetch()
    }
  })
}, [refetchOnWindowFocus, enabled, staleTime, refetch])
```

### Network Reconnect Signal

Build our own (effect-atom doesn't have this built-in):

```typescript
// src/react/signals.ts
export const networkReconnectSignal: Atom<number> = Atom.readable((get) => {
  let count = 0
  const update = () => {
    if (navigator.onLine) {
      get.setSelf(++count)
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', update)
    get.addFinalizer(() => window.removeEventListener('online', update))
  }
  return count
})
```

### Stale Time Helper

```typescript
export const isStale = (lastFetchedAt: number | null, staleTime: number): boolean => {
  if (lastFetchedAt === null) return true
  if (staleTime === Infinity) return false
  return Date.now() - lastFetchedAt > staleTime
}
```

---

## Serialization

### Current State

- Client sends `application/x-ndjson`
- Server uses `RpcSerialization.layerNdjson`
- @effect/rpc supports: `json`, `ndjson`, `jsonRpc`, `msgPack`

### Global Serialization Config

```typescript
const trpc = createTRPCReact<AppRouter>({
  url: '/api/trpc',
  
  // Preset
  serialization: 'ndjson',
  
  // OR custom
  serialization: {
    contentType: 'application/json',
    encode: (value) => JSON.stringify(value),
    decode: (text) => JSON.parse(text as string),
  },
})
```

### Per-Procedure-Type Serialization (Future)

Deferred until custom procedure types are implemented. See IDEA in Linear.

---

## Defaults

Match TanStack Query for familiarity:

| Option | Default | Rationale |
|--------|---------|-----------|
| `staleTime` | `0` | Data is immediately stale (conservative) |
| `gcTime` | `300_000` (5 min) | Match TanStack Query |
| `refetchOnWindowFocus` | `true` | Expected by most users |
| `refetchOnReconnect` | `true` | Expected by most users |
| `refetchOnMount` | `true` | Refetch if stale |
| `refetchInterval` | `0` (disabled) | Explicit opt-in |
| `refetchIntervalInBackground` | `false` | Avoid wasted requests |
| `keepPreviousData` | `false` | Explicit opt-in |

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Create `signals.ts` with `networkReconnectSignal` and `isStale` helper
- [ ] Add `isFetching` to return type
- [ ] Fix `isLoading` semantics
- [ ] Implement `staleTime` logic

### Phase 2: Automatic Refetch Triggers
- [ ] Implement `refetchOnWindowFocus`
- [ ] Implement `refetchOnReconnect`
- [ ] Implement `refetchOnMount` with `'always'` option
- [ ] Implement `refetchIntervalInBackground`

### Phase 3: Data Placeholders
- [ ] Add `previousData` tracking to atom state
- [ ] Implement `placeholderData` option
- [ ] Implement `keepPreviousData` option
- [ ] Add `isPlaceholderData` to return type
- [ ] Export `keepPreviousData` helper function

### Phase 4: Global Configuration
- [ ] Add `defaultQueryOptions` to `createTRPCReact`
- [ ] Add `serialization` option
- [ ] Export preset configs (`queryPresets`)

### Phase 5: GC Time
- [x] Wire `gcTime` to effect-atom's `defaultIdleTTL` (global setting only)
- [ ] Add tests for atom disposal

**Note on gcTime implementation:** effect-atom's `setIdleTTL` must be applied at atom creation
time inside the family function. Since our `queryAtomFamily` caches atoms by key, supporting
per-query gcTime would require either:
1. Including gcTime in the key (breaks deduplication for same query with different gcTime)
2. A custom caching layer with "first gcTime wins" semantics

For v1, we use the simpler approach: `gcTime` is set globally via `defaultQueryOptions.gcTime`,
which is passed to `RegistryProvider.defaultIdleTTL`. Query atoms no longer use `Atom.keepAlive`,
so they respect the registry's TTL setting.

---

## Related Decisions

- [DECISION-007: Atom Hierarchy](./DECISION-007-atom-hierarchy.md) — Underlying atom architecture
- [DECISION-003: Cache Invalidation](./DECISION-003-cache-invalidation.md) — Cache invalidation patterns
- [DECISION-004: Custom Procedure Types](./DECISION-004-custom-procedure-types.md) — v2 extension system

---

## Summary

| Feature | TanStack Query | effect-trpc |
|---------|---------------|-------------|
| `staleTime` | Yes | Yes |
| `gcTime` | Yes | Yes (via `setIdleTTL`) |
| `refetchOnWindowFocus` | Yes | Yes (via `windowFocusSignal`) |
| `refetchOnReconnect` | Yes | Yes (custom signal) |
| `refetchOnMount` | Yes | Yes |
| `refetchInterval` | Yes | Yes (already implemented) |
| `refetchIntervalInBackground` | Yes | Yes |
| `placeholderData` | Yes | Yes |
| `keepPreviousData` | Yes | Yes |
| `isLoading` / `isFetching` | Yes | Yes (fixed semantics) |
| Global defaults | Yes | Yes |
| Serialization config | Yes (SuperJSON) | Yes (preset + custom) |
