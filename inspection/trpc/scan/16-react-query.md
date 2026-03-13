# H16: React Query Integration

## Overview

tRPC provides two React Query integration packages:
1. **`@trpc/react-query`** - Full-featured React hooks integration (legacy approach)
2. **`@trpc/tanstack-react-query`** - Newer options-based approach (recommended)

Both integrate deeply with TanStack Query, generating type-safe hooks and query options from router types.

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         createTRPCReact<AppRouter>()                    │
│                                    │                                    │
│         ┌──────────────────────────┼──────────────────────────┐        │
│         │                          │                          │        │
│         ▼                          ▼                          ▼        │
│   TRPCProvider              Proxy Generator           Hook Factory     │
│   (React Context)           (createRecursiveProxy)    (createRootHooks)│
│         │                          │                          │        │
│         │    ┌─────────────────────┴─────────────────────┐   │        │
│         │    │      DecorateRouterRecord<Router>         │   │        │
│         │    │  Recursively maps procedures to hooks     │   │        │
│         │    └─────────────────────┬─────────────────────┘   │        │
│         │                          │                          │        │
│         ▼                          ▼                          ▼        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │                    trpc.user.getById                          │    │
│   │    .useQuery(input)  .useMutation()  .useInfiniteQuery()     │    │
│   │    .useSuspenseQuery()  .useSubscription()  .queryKey()      │    │
│   └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Hook Generation Pattern

### 1. Root Hooks Factory (`createRootHooks`)

Located at `packages/react-query/src/shared/hooks/createHooksInternal.tsx`

```typescript
export function createRootHooks<TRouter extends AnyRouter, TSSRContext = unknown>(
  config?: CreateTRPCReactOptions<TRouter>
) {
  // Creates all base hooks that get attached to procedures
  return {
    Provider: TRPCProvider,
    createClient,
    useContext,
    useUtils: useContext,
    useQuery,           // Wrapped useQuery from @tanstack/react-query
    usePrefetchQuery,
    useSuspenseQuery,
    useQueries,
    useSuspenseQueries,
    useMutation,
    useSubscription,
    useInfiniteQuery,
    usePrefetchInfiniteQuery,
    useSuspenseInfiniteQuery,
  };
}
```

### 2. Decoration Proxy (`createReactDecoration`)

Located at `packages/react-query/src/shared/proxy/decorationProxy.ts`

```typescript
export function createReactDecoration<TRouter extends AnyRouter, TSSRContext>(
  hooks: CreateReactQueryHooks<TRouter, TSSRContext>
) {
  return createRecursiveProxy(({ path, args }) => {
    const pathCopy = [...path];
    // Last arg is the hook name: 'useQuery', 'useMutation', etc.
    const lastArg = pathCopy.pop()!;

    if (lastArg === 'useMutation') {
      return (hooks as any)[lastArg](pathCopy, ...args);
    }

    if (lastArg === '_def') {
      return { path: pathCopy };
    }

    const [input, ...rest] = args;
    const opts = rest[0] ?? {};
    
    // Call the hook with path, input, and options
    return (hooks as any)[lastArg](pathCopy, input, opts);
  });
}
```

### 3. Type-Safe Hook Types

```typescript
// For queries
export interface ProcedureUseQuery<TDef extends ResolverDef> {
  <TQueryFnData extends TDef['output'], TData = TQueryFnData>(
    input: TDef['input'] | SkipToken,
    opts?: UseTRPCQueryOptions<TQueryFnData, TData, TRPCClientErrorLike<TDef>>
  ): UseTRPCQueryResult<TData, TRPCClientErrorLike<TDef>>;
}

// For mutations
export type DecoratedMutation<TDef extends ResolverDef> = {
  useMutation: <TContext = unknown>(
    opts?: UseTRPCMutationOptions<TDef['input'], TRPCClientErrorLike<TDef>, TDef['output'], TContext>
  ) => UseTRPCMutationResult<TDef['output'], TRPCClientErrorLike<TDef>, TDef['input'], TContext>;
};

// Router record decoration
export type DecorateRouterRecord<TRoot extends AnyRootTypes, TRecord extends RouterRecord> = {
  [TKey in keyof TRecord]: TRecord[TKey] extends AnyProcedure
    ? DecorateProcedure<$Value['_def']['type'], { ... }>
    : TRecord[TKey] extends RouterRecord
      ? DecorateRouterRecord<TRoot, TRecord[TKey]>
      : never;
};
```

## Query Key Generation

### Structure

Located at `packages/react-query/src/internals/getQueryKey.ts`

```typescript
// Query key format
export type TRPCQueryKey = [
  readonly string[],                                    // Path segments
  { input?: unknown; type?: 'query' | 'infinite' }?    // Options
];

// Mutation key format
export type TRPCMutationKey = [readonly string[]];

// Query key generation
export function getQueryKeyInternal(
  path: readonly string[],
  input: unknown,
  type: QueryType
): TRPCQueryKey {
  // Split dot-separated paths
  const splitPath = path.flatMap((part) => part.split('.'));

  // No input, no type = match all (for invalidation)
  if (!input && (!type || type === 'any')) {
    return splitPath.length ? [splitPath] : [];
  }

  // Infinite queries: strip cursor/direction from input
  if (type === 'infinite' && isObject(input) && ('direction' in input || 'cursor' in input)) {
    const { cursor: _, direction: __, ...inputWithoutCursor } = input;
    return [splitPath, { input: inputWithoutCursor, type: 'infinite' }];
  }

  return [
    splitPath,
    {
      ...(input !== undefined && input !== skipToken && { input }),
      ...(type && type !== 'any' && { type }),
    },
  ];
}
```

### Examples

```typescript
// trpc.user.getById.useQuery({ id: '1' })
// Query key: [['user', 'getById'], { input: { id: '1' }, type: 'query' }]

// trpc.posts.list.useInfiniteQuery({ limit: 10 })
// Query key: [['posts', 'list'], { input: { limit: 10 }, type: 'infinite' }]

// trpc.user.update.useMutation()
// Mutation key: [['user', 'update']]

// Path-based invalidation: trpc.user.invalidate()
// Query key: [['user']]  // Matches all user.* queries
```

### Key Prefix Support (New in tanstack-react-query)

```typescript
// With prefix enabled
export type TRPCQueryKeyWithPrefix = [
  prefix: string[],
  path: string[],
  opts?: { input?: unknown; type?: 'query' | 'infinite' }
];

// Without prefix (default)
export type TRPCQueryKeyWithoutPrefix = [
  path: string[],
  opts?: { input?: unknown; type?: 'query' | 'infinite' }
];
```

## useQuery Implementation

```typescript
function useQuery(
  path: readonly string[],
  input: unknown,
  opts?: UseTRPCQueryOptions<unknown, unknown, TError>
): UseTRPCQueryResult<unknown, TError> {
  const context = useContext();
  const { abortOnUnmount, client, ssrState, queryClient, prefetchQuery } = context;
  
  // Generate query key from path and input
  const queryKey = getQueryKeyInternal(path, input, 'query');
  
  // SSR prefetching
  if (typeof window === 'undefined' && ssrState === 'prepass' && ...) {
    void prefetchQuery(queryKey, opts);
  }

  // Wrap TanStack Query's useQuery
  const hook = __useQuery(
    {
      ...ssrOpts,
      queryKey: queryKey,
      queryFn: isInputSkipToken
        ? input
        : async (queryFunctionContext) => {
            const result = await client.query(
              ...getClientArgs(queryKey, actualOpts)
            );
            
            // Handle async iterables (streaming)
            if (isAsyncIterable(result)) {
              return buildQueryFromAsyncIterable(result, queryClient, queryKey);
            }
            return result;
          },
    },
    queryClient
  );

  // Add tRPC metadata
  hook.trpc = useHookResult({ path });
  
  return hook;
}
```

## New Options-Based Approach (`@trpc/tanstack-react-query`)

### Context Setup

```typescript
// New approach: createTRPCContext
export function createTRPCContext<TRouter extends AnyTRPCRouter>(): {
  TRPCProvider: React.FC<{ children; queryClient; trpcClient }>;
  useTRPC: () => TRPCOptionsProxy<TRouter>;
  useTRPCClient: () => TRPCClient<TRouter>;
};

// Usage
const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
```

### Options Proxy Pattern

Instead of hooks directly, returns TanStack Query options:

```typescript
export function createTRPCOptionsProxy<TRouter extends AnyTRPCRouter>(
  opts: TRPCOptionsProxyOptions<TRouter>
): TRPCOptionsProxy<TRouter> {
  return createTRPCRecursiveProxy(({ args, path }) => {
    const utilName = path.pop();  // 'queryOptions', 'mutationOptions', etc.
    
    const contextMap = {
      queryOptions: () => trpcQueryOptions({ input, opts, path, queryKey, query }),
      infiniteQueryOptions: () => trpcInfiniteQueryOptions({ ... }),
      mutationOptions: () => trpcMutationOptions({ ... }),
      subscriptionOptions: () => trpcSubscriptionOptions({ ... }),
      queryKey: () => getQueryKeyInternal({ path, input, type: 'query', prefix }),
      mutationKey: () => getMutationKeyInternal({ path, prefix }),
      pathKey: () => getQueryKeyInternal({ path, type: 'any', prefix }),
      pathFilter: () => ({ ...filters, queryKey: ... }),
    };
    
    return contextMap[utilName]();
  });
}
```

### Usage Pattern

```typescript
// Old approach (hooks)
const { data } = trpc.user.getById.useQuery({ id: '1' });

// New approach (options)
const trpc = useTRPC();
const { data } = useQuery(trpc.user.getById.queryOptions({ id: '1' }));

// Benefits of options approach:
// - Works with TanStack Query's queryOptions/mutationOptions
// - Better composability
// - Works outside React components
// - Server component support
```

## Utils/Context API

### Query Utilities

```typescript
export interface TRPCQueryUtils<TRouter extends AnyRouter> {
  // Query options factories
  queryOptions(path, queryKey, opts): TRPCQueryOptionsOut;
  infiniteQueryOptions(path, queryKey, opts): TRPCInfiniteQueryOptionsOut;
  
  // Direct query operations
  fetchQuery(queryKey, opts): Promise<unknown>;
  fetchInfiniteQuery(queryKey, opts): Promise<InfiniteData>;
  prefetchQuery(queryKey, opts): Promise<void>;
  prefetchInfiniteQuery(queryKey, opts): Promise<void>;
  ensureQueryData(queryKey, opts): Promise<unknown>;
  
  // Cache manipulation
  invalidateQueries(queryKey, filters, options): Promise<void>;
  resetQueries(queryKey, filters, options): Promise<void>;
  refetchQueries(queryKey, filters, options): Promise<void>;
  cancelQuery(queryKey, options): Promise<void>;
  
  // Data access
  setQueryData(queryKey, updater, options): void;
  setQueriesData(queryKey, filters, updater, options): void;
  getQueryData(queryKey): unknown;
  setInfiniteQueryData(queryKey, updater, options): void;
  getInfiniteQueryData(queryKey): InfiniteData | undefined;
  
  // Mutation utilities
  setMutationDefaults(mutationKey, options): void;
  getMutationDefaults(mutationKey): MutationOptions | undefined;
  isMutating(filters): number;
}
```

### Utils Proxy

```typescript
// Provides procedure-specific access to utils
type CreateReactUtils<TRouter, TSSRContext> = {
  client: TRPCClient<TRouter>;
  queryClient: QueryClient;
  // Per-procedure utils
  [procedure]: {
    fetch(input, opts): Promise<Output>;
    prefetch(input, opts): Promise<void>;
    invalidate(input?, filters?, options?): Promise<void>;
    refetch(input?, filters?, options?): Promise<void>;
    cancel(input?, options?): Promise<void>;
    reset(input?, options?): Promise<void>;
    setData(input, updater, options?): void;
    getData(input?): Output | undefined;
    // For infinite queries
    fetchInfinite(input, opts): Promise<InfiniteData>;
    setInfiniteData(input, updater, options?): void;
    getInfiniteData(input?): InfiniteData | undefined;
  };
};
```

## SSR Support

### Server-Side Rendering Pattern

```typescript
function useQuery(...) {
  const { ssrState, queryClient, prefetchQuery } = useContext();
  const queryKey = getQueryKeyInternal(path, input, 'query');

  // During SSR prepass, prefetch queries automatically
  if (
    typeof window === 'undefined' &&     // Server environment
    ssrState === 'prepass' &&            // In prepass phase
    opts?.trpc?.ssr !== false &&         // SSR not disabled
    opts?.enabled !== false &&           // Query enabled
    !queryClient.getQueryCache().find({ queryKey })  // Not already cached
  ) {
    void prefetchQuery(queryKey, opts);
  }

  // Handle SSR error state
  const ssrOpts = useSSRQueryOptionsIfNeeded(queryKey, opts);
  // ...
}

function useSSRQueryOptionsIfNeeded(queryKey, opts) {
  const { queryClient, ssrState } = useContext();
  
  // Prevent retry on mount if query errored during SSR
  return ssrState && ssrState !== 'mounted' &&
    queryClient.getQueryCache().find({ queryKey })?.state.status === 'error'
    ? { retryOnMount: false, ...opts }
    : opts;
}
```

### SSR State Machine

```typescript
type SSRState = 
  | false        // Not using SSR
  | 'prepass'    // Server: collecting queries
  | 'mounting'   // Client: before hydration
  | 'mounted';   // Client: after hydration

// Provider manages SSR state
const TRPCProvider = (props) => {
  const [ssrState, setSSRState] = useState(props.ssrState ?? false);
  
  useEffect(() => {
    // Transition to 'mounted' after hydration
    setSSRState((state) => (state ? 'mounted' : false));
  }, []);
  
  // ...
};
```

## Subscription Hook

```typescript
function useSubscription(
  path: readonly string[],
  input: unknown,
  opts: UseTRPCSubscriptionOptions<unknown, TError>
) {
  const enabled = opts?.enabled ?? input !== skipToken;
  const { client } = useContext();
  
  // Track which result properties are accessed for optimized re-renders
  const [trackedProps] = useState(new Set<keyof $Result>([]));
  
  const reset = useCallback(() => {
    currentSubscriptionRef.current?.unsubscribe();
    
    if (!enabled) {
      updateState(() => ({ ...initialStateIdle, reset }));
      return;
    }
    
    updateState(() => ({ ...initialStateConnecting, reset }));
    
    const subscription = client.subscription(path.join('.'), input, {
      onStarted: () => updateState(prev => ({ ...prev, status: 'pending' })),
      onData: (data) => updateState(prev => ({ ...prev, data, status: 'pending' })),
      onError: (error) => updateState(prev => ({ ...prev, error, status: 'error' })),
      onComplete: () => updateState(prev => ({ ...prev, status: 'idle' })),
      onConnectionStateChange: (result) => { /* ... */ },
    });
    
    currentSubscriptionRef.current = subscription;
  }, [client, queryKey, enabled]);
  
  useEffect(() => {
    reset();
    return () => currentSubscriptionRef.current?.unsubscribe();
  }, [reset]);
  
  return state;
}
```

## Key Design Patterns

### 1. Proxy-Based API Generation
- Uses `createRecursiveProxy` to dynamically handle any procedure path
- Path accumulated until terminal method called (useQuery, useMutation, etc.)

### 2. Query Key Design
- Hierarchical: supports path-based invalidation
- Type-discriminated: separates query vs infinite query keys
- Input-aware: includes input for cache matching

### 3. Hook Result Extension
- Standard TanStack Query results extended with `trpc` metadata
- Provides path information for debugging/tooling

### 4. Options Factory Pattern (New)
- Returns TanStack Query options objects instead of calling hooks
- Better separation of concerns
- Enables server component usage

### 5. Context-Free Operation
- `createTRPCQueryUtils` works without React context
- Enables server-side data fetching
- Supports multiple query clients

## Comparison: Old vs New Approach

| Feature | `@trpc/react-query` | `@trpc/tanstack-react-query` |
|---------|---------------------|------------------------------|
| API Style | Direct hooks | Options factories |
| Usage | `trpc.x.useQuery()` | `useQuery(trpc.x.queryOptions())` |
| Server Components | Limited | Full support |
| Context Dependency | Required | Optional |
| Composability | Hook-based | Options-based |
| Key Prefix | No | Yes |
| Bundle Size | Larger | Smaller |

## Implications for Effect-tRPC

1. **Options-Based API Recommended**: Follow the newer `tanstack-react-query` pattern for better composability with Effect

2. **Query Key Generation**: Reuse the hierarchical key structure for invalidation patterns

3. **Type Generation**: Use `DecorateRouterRecord` pattern for recursive type mapping

4. **Atom Integration**: Could use Effect Atom instead of TanStack Query context

5. **Streaming Support**: Both packages handle async iterables - relevant for Effect Stream
