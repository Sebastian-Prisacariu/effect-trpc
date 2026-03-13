# Hypothesis H16: React Query Integration

## Summary

tRPC's React Query integration is a sophisticated wrapper that:
1. Uses Proxies extensively to generate type-safe hooks from router definitions
2. Generates deterministic query keys from procedure paths + input
3. Wraps React Query's primitives (`useQuery`, `useMutation`, etc.) with tRPC-specific logic
4. Provides utilities for cache manipulation via `useUtils()`

## Integration Architecture

### Two Package Structure

tRPC has **two** React Query packages:
1. **`@trpc/react-query`** - The "classic" integration with hooks like `trpc.user.get.useQuery()`
2. **`@trpc/tanstack-react-query`** - Newer, more flexible integration using `queryOptions` pattern

### Classic Integration (`@trpc/react-query`)

```
createTRPCReact()
    |
    +-- createRootHooks() --> Creates base hooks (useQuery, useMutation, etc.)
    |
    +-- createHooksInternal() --> Wraps hooks with proxy decoration
    |
    +-- createFlatProxy() --> Final API with Provider, useContext, etc.
```

**File: `createTRPCReact.tsx:508-518`**
```typescript
export function createTRPCReact<TRouter extends AnyRouter, TSSRContext = unknown>(
  opts?: CreateTRPCReactOptions<TRouter>,
): CreateTRPCReact<TRouter, TSSRContext> {
  const hooks = createRootHooks<TRouter, TSSRContext>(opts);
  const proxy = createHooksInternal<TRouter, TSSRContext>(hooks);
  return proxy as any;
}
```

### Proxy-Based Hook Generation

**File: `shared/proxy/decorationProxy.ts:9-35`**
```typescript
export function createReactDecoration<TRouter extends AnyRouter, TSSRContext>(
  hooks: CreateReactQueryHooks<TRouter, TSSRContext>,
) {
  return createRecursiveProxy(({ path, args }) => {
    const pathCopy = [...path];
    const lastArg = pathCopy.pop()!; // e.g., 'useMutation', 'useQuery'

    if (lastArg === 'useMutation') {
      return (hooks as any)[lastArg](pathCopy, ...args);
    }

    if (lastArg === '_def') {
      return { path: pathCopy };
    }

    const [input, ...rest] = args;
    const opts = rest[0] ?? {};
    return (hooks as any)[lastArg](pathCopy, input, opts);
  });
}
```

This enables the ergonomic API:
```typescript
// Access: trpc.user.byId.useQuery({ id: 1 })
// Resolves to: hooks.useQuery(['user', 'byId'], { id: 1 }, opts)
```

## Hook API Design

### Query Hooks

**Core hooks created in `createHooksInternal.tsx`:**

| Hook | Purpose |
|------|---------|
| `useQuery` | Standard data fetching |
| `useSuspenseQuery` | Suspense-compatible query |
| `useInfiniteQuery` | Paginated/cursor-based queries |
| `useSuspenseInfiniteQuery` | Suspense infinite query |
| `usePrefetchQuery` | Prefetch without subscribing |
| `useQueries` | Batch multiple queries |
| `useSuspenseQueries` | Batch suspense queries |

### useQuery Implementation Pattern

**File: `shared/hooks/createHooksInternal.tsx:171-242`**
```typescript
function useQuery(
  path: readonly string[],
  input: unknown,
  opts?: UseTRPCQueryOptions<unknown, unknown, TError>,
): UseTRPCQueryResult<unknown, TError> {
  const context = useContext();
  const { abortOnUnmount, client, ssrState, queryClient, prefetchQuery } = context;
  
  // Generate deterministic query key
  const queryKey = getQueryKeyInternal(path, input, 'query');

  // SSR prepass handling
  if (typeof window === 'undefined' && ssrState === 'prepass' && ...) {
    void prefetchQuery(queryKey, opts as any);
  }

  // Wrap React Query's useQuery
  const hook = __useQuery({
    ...ssrOpts,
    queryKey: queryKey as any,
    queryFn: isInputSkipToken
      ? input
      : async (queryFunctionContext) => {
          // Call tRPC client with abort signal support
          const result = await client.query(
            ...getClientArgs(queryKey, actualOpts),
          );
          
          // Handle async iterables (streaming)
          if (isAsyncIterable(result)) {
            return buildQueryFromAsyncIterable(result, queryClient, queryKey);
          }
          return result;
        },
  }, queryClient);

  // Attach tRPC metadata
  hook.trpc = useHookResult({ path });
  return hook;
}
```

### Mutation Hook

**File: `shared/hooks/createHooksInternal.tsx:320-358`**
```typescript
function useMutation(
  path: readonly string[],
  opts?: UseTRPCMutationOptions<unknown, TError, unknown, unknown>,
): UseTRPCMutationResult<unknown, TError, unknown, unknown> {
  const { client, queryClient } = useContext();
  const mutationKey = getMutationKeyInternal(path);

  const hook = __useMutation({
    ...opts,
    mutationKey: mutationKey,
    mutationFn: (input) => {
      return client.mutation(...getClientArgs([path, { input }], opts));
    },
    onSuccess(...args) {
      // Allow custom success override for cache invalidation
      const originalFn = () => opts?.onSuccess?.(...args) ?? defaultOpts?.onSuccess?.(...args);
      return mutationSuccessOverride({
        originalFn,
        queryClient,
        meta: opts?.meta ?? defaultOpts?.meta ?? {},
      });
    },
  }, queryClient);

  hook.trpc = useHookResult({ path });
  return hook;
}
```

### Subscription Hook

Custom state machine for WebSocket subscriptions:

**File: `shared/hooks/createHooksInternal.tsx:375-522`**
```typescript
function useSubscription(
  path: readonly string[],
  input: unknown,
  opts: UseTRPCSubscriptionOptions<unknown, TError>,
) {
  // State machine: 'idle' | 'connecting' | 'pending' | 'error'
  const [state, setState] = React.useState<$Result>(...);
  
  // Track which properties are accessed for render optimization
  const [trackedProps] = React.useState(new Set<keyof $Result>([]));
  
  const reset = React.useCallback((): void => {
    currentSubscriptionRef.current?.unsubscribe();
    
    const subscription = client.subscription(path.join('.'), input, {
      onStarted: () => { ... },
      onData: (data) => { ... },
      onError: (error) => { ... },
      onComplete: () => { ... },
    });
    
    currentSubscriptionRef.current = subscription;
  }, [...]);

  React.useEffect(() => {
    reset();
    return () => { currentSubscriptionRef.current?.unsubscribe(); };
  }, [reset]);

  return state;
}
```

## Query Key Generation

### Key Structure

**File: `internals/getQueryKey.ts:11-14`**
```typescript
export type TRPCQueryKey = [
  readonly string[],                              // Path segments
  { input?: unknown; type?: Exclude<QueryType, 'any'> }?,  // Optional metadata
];

// Examples:
// ['user', 'byId']                           -- for invalidating all user.byId queries
// [['user', 'byId'], { input: { id: 1 } }]   -- specific query with input
// [['user', 'list'], { type: 'infinite' }]   -- infinite query type
```

### Key Generation Logic

**File: `internals/getQueryKey.ts:28-74`**
```typescript
export function getQueryKeyInternal(
  path: readonly string[],
  input: unknown,
  type: QueryType,
): TRPCQueryKey {
  // Split dot-separated path segments
  const splitPath = path.flatMap((part) => part.split('.'));

  // No input, any type -> minimal key for broad invalidation
  if (!input && (!type || type === 'any')) {
    return splitPath.length ? [splitPath] : ([] as unknown as TRPCQueryKey);
  }

  // Infinite queries: strip cursor/direction from input
  if (type === 'infinite' && isObject(input) && ('direction' in input || 'cursor' in input)) {
    const { cursor: _, direction: __, ...inputWithoutCursorAndDirection } = input;
    return [splitPath, { input: inputWithoutCursorAndDirection, type: 'infinite' }];
  }

  // Standard query with input and type
  return [
    splitPath,
    {
      ...(typeof input !== 'undefined' && input !== skipToken && { input }),
      ...(type && type !== 'any' && { type }),
    },
  ];
}
```

### Why Array-Based Keys?

From the comments in the code:
> "To allow easy interactions with groups of related queries, such as invalidating all queries of a router, we use an array as the path when storing in tanstack query."

This enables:
```typescript
// Invalidate all user queries
queryClient.invalidateQueries({ queryKey: [['user']] });

// Invalidate specific procedure
queryClient.invalidateQueries({ queryKey: [['user', 'byId']] });

// Invalidate specific input
queryClient.invalidateQueries({ queryKey: [['user', 'byId'], { input: { id: 1 } }] });
```

## How Mutations Work

### Mutation Key (simpler than query key)

**File: `internals/getQueryKey.ts:76-78`**
```typescript
export function getMutationKeyInternal(path: readonly string[]) {
  return getQueryKeyInternal(path, undefined, 'any') as TRPCMutationKey;
}

// Result: [['user', 'create']]  -- just the path, no input
```

### Mutation Success Override Pattern

**File: `shared/hooks/createHooksInternal.tsx:87-89`**
```typescript
const mutationSuccessOverride: UseMutationOverride['onSuccess'] =
  config?.overrides?.useMutation?.onSuccess ??
  ((options) => options.originalFn());
```

This allows library consumers to globally intercept mutation success for automatic cache invalidation:
```typescript
createTRPCReact({
  overrides: {
    useMutation: {
      onSuccess: async ({ originalFn, queryClient }) => {
        await originalFn();
        // Global: invalidate all queries after any mutation
        await queryClient.invalidateQueries();
      },
    },
  },
});
```

## Utils Proxy (`useUtils()`)

### Purpose
Provides programmatic access to query cache operations:

**File: `shared/proxy/utilsProxy.ts:64-355`**
```typescript
export type DecorateQueryProcedure<TRoot, TProcedure> = {
  queryOptions: ...;           // Get options object for useQuery
  infiniteQueryOptions: ...;   // Get options for useInfiniteQuery
  fetch: ...;                  // Fetch and cache
  prefetch: ...;               // Prefetch without returning
  ensureData: ...;             // Fetch if not cached
  invalidate: ...;             // Mark stale
  refetch: ...;                // Refetch active queries  
  cancel: ...;                 // Cancel in-flight
  reset: ...;                  // Reset to initial state
  setData: ...;                // Optimistic update
  setQueriesData: ...;         // Batch optimistic update
  setInfiniteData: ...;        // Update infinite query
  getData: ...;                // Read from cache
  getInfiniteData: ...;        // Read infinite data
};

export type DecorateMutationProcedure<TRoot, TProcedure> = {
  setMutationDefaults: ...;    // Set default mutation options
  getMutationDefaults: ...;    // Get default mutation options
  isMutating: ...;             // Count active mutations
};
```

### Utils Implementation

**File: `shared/proxy/utilsProxy.ts:465-517`**
```typescript
function createRecursiveUtilsProxy<TRouter>(context: TRPCQueryUtils<TRouter>) {
  return createRecursiveProxy<CreateQueryUtils<TRouter>>((opts) => {
    const path = [...opts.path];
    const utilName = path.pop() as keyof AnyDecoratedProcedure;
    const args = [...opts.args];
    const input = args.shift();
    const queryType = getQueryType(utilName);
    const queryKey = getQueryKeyInternal(path, input, queryType);

    const contextMap: Record<keyof AnyDecoratedProcedure, () => unknown> = {
      fetch: () => context.fetchQuery(queryKey, ...args),
      prefetch: () => context.prefetchQuery(queryKey, ...args),
      invalidate: () => context.invalidateQueries(queryKey, ...args),
      setData: () => { context.setQueryData(queryKey, args[0], args[1]); },
      getData: () => context.getQueryData(queryKey),
      // ... etc
    };

    return contextMap[utilName]();
  });
}
```

## New `queryOptions` Pattern (tanstack-react-query package)

### Why a New Package?

The newer `@trpc/tanstack-react-query` package provides a more composable API aligned with TanStack Query v5:

**File: `tanstack-react-query/src/internals/createOptionsProxy.ts`**
```typescript
// Instead of hooks, generate options objects
trpc.user.byId.queryOptions({ id: 1 })
// Returns: { queryKey, queryFn, ...options }

// Then use with any React Query hook
useQuery(trpc.user.byId.queryOptions({ id: 1 }))
useSuspenseQuery(trpc.user.byId.queryOptions({ id: 1 }))
```

### Benefits
1. **Decoupled from hooks** - Can use outside React (e.g., loaders, server components)
2. **Composable** - Pass options to any hook
3. **Server Components** - Works with RSC via `createTRPCOptionsProxy({ router, ctx })`

**File: `tanstack-react-query/src/internals/queryOptions.ts:220-265`**
```typescript
export function trpcQueryOptions<TFeatureFlags extends FeatureFlags>(args: {
  input: unknown;
  query: typeof TRPCUntypedClient.prototype.query;
  queryClient: QueryClient | (() => QueryClient);
  path: string[];
  queryKey: TRPCQueryKey<TFeatureFlags['keyPrefix']>;
  opts: AnyTRPCQueryOptionsIn<TFeatureFlags> | undefined;
}): AnyTRPCQueryOptionsOut<TFeatureFlags> {
  const { input, query, path, queryKey, opts } = args;
  
  const queryFn: QueryFunction = async (queryFnContext) => {
    const result = await query(...getClientArgs(queryKey, actualOpts));
    if (isAsyncIterable(result)) {
      return buildQueryFromAsyncIterable(result, queryClient, queryKey);
    }
    return result;
  };

  return Object.assign(
    queryOptions({
      ...opts,
      queryKey: queryKey,
      queryFn: inputIsSkipToken ? skipToken : queryFn,
    }),
    { trpc: createTRPCOptionsResult({ path }) },
  );
}
```

## Patterns We Should Consider Adopting

### 1. Proxy-Based Hook Generation
The recursive proxy pattern is elegant for generating typed APIs from router definitions:
```typescript
createRecursiveProxy(({ path, args }) => {
  const method = path.pop();
  return hooks[method](path, ...args);
});
```

**Applicability**: We can use similar patterns with Effect-Atom to generate `useAtom`, `useAtomValue` hooks from procedure definitions.

### 2. Deterministic Query Keys from Path + Input
The key structure `[path[], { input, type }?]` enables:
- Broad invalidation (by path prefix)
- Specific invalidation (by exact input)
- Type differentiation (query vs infinite)

**Applicability**: Effect-Atom atoms don't use query keys, but we could use path-based atom naming for debugging/devtools.

### 3. Provider Pattern with Context
```typescript
<TRPCProvider client={client} queryClient={queryClient}>
  {children}
</TRPCProvider>
```

**Applicability**: We need a similar provider for Effect-tRPC to:
- Provide the Effect runtime
- Provide RPC client configuration
- Enable SSR state management

### 4. Utils Proxy for Cache Operations
The `useUtils()` pattern gives programmatic cache access:
```typescript
const utils = trpc.useUtils();
await utils.user.byId.invalidate({ id: 1 });
utils.user.byId.setData({ id: 1 }, (old) => ({ ...old, name: 'New' }));
```

**Applicability**: With Effect-Atom, cache operations would be:
```typescript
const userAtom = client.user.byId.atom({ id: 1 });
Atom.invalidate(userAtom);  // Built into atom-core
```

### 5. Mutation Success Override
Global mutation success interception is powerful for automatic invalidation:
```typescript
createTRPCReact({
  overrides: {
    useMutation: {
      onSuccess: async ({ originalFn, queryClient }) => {
        await originalFn();
        await queryClient.invalidateQueries();
      },
    },
  },
});
```

**Applicability**: Effect-tRPC mutations should integrate with atom invalidation patterns.

### 6. SSR State Machine
The `ssrState: 'prepass' | 'mounting' | 'mounted' | false` pattern handles:
- Server-side data prefetching
- Hydration without refetch
- Client mounting detection

**Applicability**: Critical for Effect-tRPC SSR support.

### 7. queryOptions Pattern (Composable)
The newer pattern separates options generation from hook usage:
```typescript
const options = trpc.user.byId.queryOptions({ id: 1 });
useQuery(options);           // In component
prefetchQuery(options);      // In loader
```

**Applicability**: This aligns well with Effect's composable philosophy. We could have:
```typescript
const effect = client.user.byId.effect({ id: 1 });
// Use in component, stream, or loader
```

## Key Differences from Our Approach

| Aspect | tRPC + React Query | Effect-tRPC (planned) |
|--------|-------------------|----------------------|
| State management | React Query cache | Effect-Atom reactive state |
| Data fetching | `queryFn` callbacks | Effect programs |
| Error handling | `TRPCClientError` | Effect typed errors |
| Subscriptions | Custom state machine | Atom subscriptions |
| SSR | Hydration + prefetch | Effect fibers |
| Cache invalidation | Query keys | Atom dependencies |

## Files Analyzed

- `packages/react-query/src/createTRPCReact.tsx`
- `packages/react-query/src/shared/hooks/createHooksInternal.tsx`
- `packages/react-query/src/shared/proxy/decorationProxy.ts`
- `packages/react-query/src/shared/proxy/utilsProxy.ts`
- `packages/react-query/src/internals/getQueryKey.ts`
- `packages/react-query/src/internals/context.tsx`
- `packages/react-query/src/shared/hooks/types.ts`
- `packages/tanstack-react-query/src/internals/createOptionsProxy.ts`
- `packages/tanstack-react-query/src/internals/queryOptions.ts`
- `packages/tanstack-react-query/src/internals/mutationOptions.ts`
- `packages/tanstack-react-query/src/internals/utils.ts`
