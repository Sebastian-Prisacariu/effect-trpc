# H16: React Query Integration

## Overview

tRPC provides a deeply integrated React Query adapter via `@trpc/react-query`. The integration uses proxy-based hook generation to provide type-safe access to all procedures while wrapping TanStack Query's hooks with automatic query key management and tRPC-specific features.

## Architecture

### Entry Point: `createTRPCReact`

```typescript
// packages/react-query/src/createTRPCReact.tsx
export function createTRPCReact<TRouter extends AnyRouter, TSSRContext = unknown>(
  opts?: CreateTRPCReactOptions<TRouter>,
): CreateTRPCReact<TRouter, TSSRContext> {
  const hooks = createRootHooks<TRouter, TSSRContext>(opts);
  const proxy = createHooksInternal<TRouter, TSSRContext>(hooks);
  return proxy as any;
}
```

This creates a fully-typed proxy object where each procedure path maps to React Query hooks.

### Configuration Options

```typescript
interface CreateTRPCReactOptions<_TRouter extends AnyRouter> {
  // Override mutation success handling (for optimistic updates)
  overrides?: { useMutation?: Partial<UseMutationOverride>; };
  // Abort in-flight queries when component unmounts
  abortOnUnmount?: boolean;
  // Custom React context (for multiple tRPC instances)
  context?: any;
}
```

---

## Hook Generation

### Proxy-Based Decoration

The magic happens through recursive proxies that transform procedure paths into hooks:

```typescript
// packages/react-query/src/shared/proxy/decorationProxy.ts
export function createReactDecoration<TRouter extends AnyRouter, TSSRContext>(
  hooks: CreateReactQueryHooks<TRouter, TSSRContext>
) {
  return createRecursiveProxy(({ path, args }) => {
    const pathCopy = [...path];
    // Last path segment is the hook name (useQuery, useMutation, etc.)
    const lastArg = pathCopy.pop()!;

    if (lastArg === 'useMutation') {
      return (hooks as any)[lastArg](pathCopy, ...args);
    }

    // For _def, return path info for getQueryKey
    if (lastArg === '_def') {
      return { path: pathCopy };
    }

    // For queries: extract input and options
    const [input, ...rest] = args;
    const opts = rest[0] ?? {};

    return (hooks as any)[lastArg](pathCopy, input, opts);
  });
}
```

### Generated Hook Types per Procedure Type

Each procedure type gets different hooks:

```typescript
// For Query procedures
type DecoratedQuery<TDef> = {
  useQuery: ProcedureUseQuery<TDef>;
  useSuspenseQuery: ...;
  usePrefetchQuery: ...;
  // If input has cursor, also includes:
  useInfiniteQuery?: ...;
  useSuspenseInfiniteQuery?: ...;
  usePrefetchInfiniteQuery?: ...;
}

// For Mutation procedures
type DecoratedMutation<TDef> = {
  useMutation: <TContext>(opts?) => UseTRPCMutationResult<...>;
}

// For Subscription procedures
type DecoratedSubscription<TDef> = {
  useSubscription: ProcedureUseSubscription<TDef>;
}
```

---

## Query Key System

### Query Key Structure

```typescript
// packages/react-query/src/internals/getQueryKey.ts

// TRPCQueryKey is a tuple: [path[], options?]
export type TRPCQueryKey = [
  readonly string[],
  { input?: unknown; type?: Exclude<QueryType, 'any'> }?,
];

export type TRPCMutationKey = [readonly string[]];

export type QueryType = 'any' | 'infinite' | 'query';
```

### Key Construction

```typescript
export function getQueryKeyInternal(
  path: readonly string[],
  input: unknown,
  type: QueryType,
): TRPCQueryKey {
  // Split dot-separated paths: ['user.list'] -> ['user', 'list']
  const splitPath = path.flatMap((part) => part.split('.'));

  // Empty queries: just the path
  if (!input && (!type || type === 'any')) {
    return splitPath.length ? [splitPath] : ([] as unknown as TRPCQueryKey);
  }

  // Infinite queries: strip cursor/direction from input
  if (type === 'infinite' && isObject(input) && 
      ('direction' in input || 'cursor' in input)) {
    const { cursor: _, direction: __, ...inputWithoutCursorAndDirection } = input;
    return [splitPath, { input: inputWithoutCursorAndDirection, type: 'infinite' }];
  }

  // Regular queries with input
  return [
    splitPath,
    {
      ...(typeof input !== 'undefined' && input !== skipToken && { input }),
      ...(type && type !== 'any' && { type }),
    },
  ];
}
```

### Key Examples

```typescript
// trpc.user.list.useQuery() 
// -> [['user', 'list']]

// trpc.user.byId.useQuery({ id: 1 })
// -> [['user', 'byId'], { input: { id: 1 } }]

// trpc.user.list.useInfiniteQuery({ limit: 10, cursor: 5 })
// -> [['user', 'list'], { input: { limit: 10 }, type: 'infinite' }]

// trpc.user.update.useMutation() (mutation key)
// -> [['user', 'update']]
```

### Query Key Utilities

```typescript
// Extract query key from decorated procedure
export function getQueryKey<TProcedureOrRouter>(
  procedureOrRouter: TProcedureOrRouter,
  ..._params: GetParams<TProcedureOrRouter>
) {
  const [input, type] = _params;
  // Access hidden _def path
  const path = procedureOrRouter._def().path as string[];
  return getQueryKeyInternal(path, input, type ?? 'any');
}

// For mutations
export function getMutationKey<TProcedure>(procedure: TProcedure) {
  const path = procedure._def().path as string[];
  return getMutationKeyInternal(path);
}
```

---

## Core Hook Implementation

### useQuery Implementation

```typescript
// packages/react-query/src/shared/hooks/createHooksInternal.tsx

function useQuery(
  path: readonly string[],
  input: unknown,
  opts?: UseTRPCQueryOptions<unknown, unknown, TError>,
): UseTRPCQueryResult<unknown, TError> {
  const context = useContext();
  const { abortOnUnmount, client, ssrState, queryClient, prefetchQuery } = context;
  
  // Build query key
  const queryKey = getQueryKeyInternal(path, input, 'query');
  const defaultOpts = queryClient.getQueryDefaults(queryKey);
  const isInputSkipToken = input === skipToken;

  // SSR prepass: prefetch if not in cache
  if (typeof window === 'undefined' && ssrState === 'prepass' &&
      opts?.trpc?.ssr !== false &&
      (opts?.enabled ?? defaultOpts?.enabled) !== false &&
      !isInputSkipToken &&
      !queryClient.getQueryCache().find({ queryKey })) {
    void prefetchQuery(queryKey, opts as any);
  }

  // Handle SSR error retry
  const ssrOpts = useSSRQueryOptionsIfNeeded(queryKey, {
    ...defaultOpts,
    ...opts,
  });

  // Abort on unmount handling
  const shouldAbortOnUnmount = opts?.trpc?.abortOnUnmount ?? 
                                config?.abortOnUnmount ?? 
                                abortOnUnmount;

  // Call TanStack Query's useQuery
  const hook = __useQuery({
    ...ssrOpts,
    queryKey: queryKey as any,
    queryFn: isInputSkipToken ? input : async (queryFunctionContext) => {
      const actualOpts = {
        ...ssrOpts,
        trpc: {
          ...ssrOpts?.trpc,
          ...(shouldAbortOnUnmount
            ? { signal: queryFunctionContext.signal }
            : { signal: null }),
        },
      };

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

### useMutation Implementation

```typescript
function useMutation(
  path: readonly string[],
  opts?: UseTRPCMutationOptions<unknown, TError, unknown, unknown>,
): UseTRPCMutationResult<unknown, TError, unknown, unknown> {
  const { client, queryClient } = useContext();
  const mutationKey = getMutationKeyInternal(path);

  const defaultOpts = queryClient.defaultMutationOptions(
    queryClient.getMutationDefaults(mutationKey),
  );

  const hook = __useMutation({
    ...opts,
    mutationKey: mutationKey,
    mutationFn: (input) => {
      return client.mutation(...getClientArgs([path, { input }], opts));
    },
    onSuccess(...args) {
      const originalFn = () =>
        opts?.onSuccess?.(...args) ?? defaultOpts?.onSuccess?.(...args);

      // Allow global mutation override (for optimistic updates)
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

---

## Provider System

### TRPCProvider

```typescript
const TRPCProvider: TRPCProvider<TRouter, TSSRContext> = (props) => {
  const { abortOnUnmount = false, queryClient, ssrContext } = props;
  const [ssrState, setSSRState] = React.useState<SSRState>(
    props.ssrState ?? false,
  );

  const client: TRPCUntypedClient<TRouter> =
    props.client instanceof TRPCUntypedClient
      ? props.client
      : getUntypedClient(props.client);

  // Create utility functions for the context
  const fns = React.useMemo(
    () => createUtilityFunctions({ client, queryClient }),
    [client, queryClient],
  );

  const contextValue = React.useMemo<ProviderContext>(
    () => ({
      abortOnUnmount,
      queryClient,
      client,
      ssrContext: ssrContext ?? null,
      ssrState,
      ...fns,
    }),
    [abortOnUnmount, client, fns, queryClient, ssrContext, ssrState],
  );

  // Track SSR mount state
  React.useEffect(() => {
    setSSRState((state) => (state ? 'mounted' : false));
  }, []);

  return (
    <Context.Provider value={contextValue}>
      {props.children}
    </Context.Provider>
  );
};
```

---

## Utils API (useUtils / useContext)

### Decorated Utils Proxy

```typescript
// packages/react-query/src/shared/proxy/utilsProxy.ts

type DecorateQueryProcedure<TRoot, TProcedure> = {
  // TanStack Query options helpers
  queryOptions(...): TRPCQueryOptionsOut;
  infiniteQueryOptions(...): TRPCInfiniteQueryOptionsOut;
  
  // Direct QueryClient operations
  fetch(input, opts?): Promise<Output>;
  fetchInfinite(input, opts?): Promise<InfiniteData>;
  prefetch(input, opts?): Promise<void>;
  prefetchInfinite(input, opts?): Promise<void>;
  ensureData(input, opts?): Promise<Output>;
  
  // Cache manipulation
  invalidate(input?, filters?, options?): Promise<void>;
  refetch(input?, filters?, options?): Promise<void>;
  cancel(input?, options?): Promise<void>;
  reset(input?, options?): Promise<void>;
  
  // Data access
  setData(input, updater, options?): void;
  setQueriesData(input, filters, updater, options?): void;
  setInfiniteData(input, updater, options?): void;
  getData(input?): Output | undefined;
  getInfiniteData(input?): InfiniteData | undefined;
};

type DecorateMutationProcedure<TRoot, TProcedure> = {
  setMutationDefaults(options): void;
  getMutationDefaults(): MutationOptions | undefined;
  isMutating(): number;
};
```

### Utils Proxy Implementation

```typescript
function createRecursiveUtilsProxy<TRouter>(context: TRPCQueryUtils<TRouter>) {
  return createRecursiveProxy<CreateQueryUtils<TRouter>>((opts) => {
    const path = [...opts.path];
    const utilName = path.pop() as keyof AnyDecoratedProcedure;
    const args = [...opts.args];
    const input = args.shift();
    
    // Determine query type based on method name
    const queryType = getQueryType(utilName);
    const queryKey = getQueryKeyInternal(path, input, queryType);

    // Map util names to context methods
    const contextMap: Record<keyof AnyDecoratedProcedure, () => unknown> = {
      queryOptions: () => context.queryOptions(path, queryKey, ...args),
      infiniteQueryOptions: () => context.infiniteQueryOptions(path, queryKey, args[0]),
      fetch: () => context.fetchQuery(queryKey, ...args),
      fetchInfinite: () => context.fetchInfiniteQuery(queryKey, args[0]),
      prefetch: () => context.prefetchQuery(queryKey, ...args),
      prefetchInfinite: () => context.prefetchInfiniteQuery(queryKey, args[0]),
      ensureData: () => context.ensureQueryData(queryKey, ...args),
      invalidate: () => context.invalidateQueries(queryKey, ...args),
      reset: () => context.resetQueries(queryKey, ...args),
      refetch: () => context.refetchQueries(queryKey, ...args),
      cancel: () => context.cancelQuery(queryKey, ...args),
      setData: () => context.setQueryData(queryKey, args[0], args[1]),
      setQueriesData: () => context.setQueriesData(queryKey, args[0], args[1], args[2]),
      setInfiniteData: () => context.setInfiniteQueryData(queryKey, args[0], args[1]),
      getData: () => context.getQueryData(queryKey),
      getInfiniteData: () => context.getInfiniteQueryData(queryKey),
      // Mutations
      setMutationDefaults: () => context.setMutationDefaults(getMutationKeyInternal(path), input),
      getMutationDefaults: () => context.getMutationDefaults(getMutationKeyInternal(path)),
      isMutating: () => context.isMutating({ mutationKey: getMutationKeyInternal(path) }),
    };

    return contextMap[utilName]();
  });
}
```

---

## useQueries Support

### Type-Safe Batched Queries

```typescript
// packages/react-query/src/internals/useQueries.ts

export type TRPCUseQueries<TRouter extends AnyRouter> = <
  TQueryOptions extends UseQueryOptionsForUseQueries<any, any, any, any>[],
  TCombinedResult = QueriesResults<TQueryOptions>,
>(
  queriesCallback: (
    t: UseQueriesProcedureRecord<
      TRouter['_def']['_config']['$types'],
      TRouter['_def']['record']
    >,
  ) => readonly [...QueriesOptions<TQueryOptions>],
  options?: {
    combine?: (results: QueriesResults<TQueryOptions>) => TCombinedResult;
  },
) => TCombinedResult;
```

Usage:

```typescript
const results = trpc.useQueries((t) => [
  t.user.byId({ id: 1 }),
  t.user.byId({ id: 2 }),
  t.post.list({ limit: 10 }),
]);
```

---

## SSR Support

### SSR State Machine

```typescript
type SSRState = 'mounted' | 'mounting' | 'prepass' | false;
```

States:
- `false` - SSR disabled
- `prepass` - Server: collecting queries to prefetch
- `mounting` - Client: hydrating from SSR data
- `mounted` - Client: fully interactive

### SSR Error Handling

```typescript
function useSSRQueryOptionsIfNeeded<TOptions extends { retryOnMount?: boolean }>(
  queryKey: TRPCQueryKey, 
  opts: TOptions
): TOptions {
  const { queryClient, ssrState } = useContext();
  
  // Don't retry on mount if SSR returned an error
  return ssrState &&
    ssrState !== 'mounted' &&
    queryClient.getQueryCache().find({ queryKey })?.state.status === 'error'
    ? { retryOnMount: false, ...opts }
    : opts;
}
```

---

## Subscription Handling

### Subscription Result States

```typescript
type TRPCSubscriptionResult<TOutput, TError> =
  | TRPCSubscriptionIdleResult<TOutput>      // Not started
  | TRPCSubscriptionConnectingResult<TOutput, TError>  // Connecting
  | TRPCSubscriptionPendingResult<TOutput>   // Connected, receiving data
  | TRPCSubscriptionErrorResult<TOutput, TError>;  // Error state
```

### Subscription Implementation

```typescript
function useSubscription(
  path: readonly string[],
  input: unknown,
  opts: UseTRPCSubscriptionOptions<unknown, TError>,
) {
  const enabled = opts?.enabled ?? input !== skipToken;
  const queryKey = hashKey(getQueryKeyInternal(path, input, 'any'));
  const { client } = useContext();

  // Track which result properties are being accessed for optimization
  const [trackedProps] = React.useState(new Set<keyof $Result>([]));
  
  const reset = React.useCallback((): void => {
    currentSubscriptionRef.current?.unsubscribe();

    if (!enabled) {
      updateState(() => ({ ...initialStateIdle, reset }));
      return;
    }
    
    updateState(() => ({ ...initialStateConnecting, reset }));
    
    const subscription = client.subscription(
      path.join('.'),
      input ?? undefined,
      {
        onStarted: () => {
          optsRef.current.onStarted?.();
          updateState((prev) => ({ ...prev, status: 'pending', error: null }));
        },
        onData: (data) => {
          optsRef.current.onData?.(data);
          updateState((prev) => ({ ...prev, status: 'pending', data, error: null }));
        },
        onError: (error) => {
          optsRef.current.onError?.(error);
          updateState((prev) => ({ ...prev, status: 'error', error }));
        },
        onConnectionStateChange: (result) => { /* ... */ },
        onComplete: () => {
          optsRef.current.onComplete?.();
          updateState((prev) => ({ ...prev, status: 'idle', error: null, data: undefined }));
        },
      },
    );

    currentSubscriptionRef.current = subscription;
  }, [client, queryKey, enabled, updateState]);

  React.useEffect(() => {
    reset();
    return () => { currentSubscriptionRef.current?.unsubscribe(); };
  }, [reset]);

  return state;
}
```

---

## Advanced Features

### Query Options Helper

For use outside components (e.g., in loaders):

```typescript
// trpc.user.byId.queryOptions({ id: 1 })
// Returns: { queryKey, queryFn, ... } compatible with useQuery/prefetchQuery

const queryOptions = trpc.user.byId.queryOptions({ id: 1 });
await queryClient.prefetchQuery(queryOptions);
```

### skipToken Support

Conditional fetching using TanStack Query's skipToken:

```typescript
import { skipToken } from '@tanstack/react-query';

// Won't fetch until userId is defined
trpc.user.byId.useQuery(userId ? { id: userId } : skipToken);
```

### Abort on Unmount

```typescript
// Global setting
const trpc = createTRPCReact<AppRouter>({ abortOnUnmount: true });

// Per-query override
trpc.user.list.useQuery(undefined, {
  trpc: { abortOnUnmount: false }
});
```

---

## Comparison: tRPC React Query vs Effect-tRPC

| Aspect | tRPC React Query | Effect-tRPC Target |
|--------|------------------|-------------------|
| State Primitive | React Query cache | @effect-atom/atom |
| Query Keys | `[path[], {input, type}]` | Similar structure |
| Hook Generation | Proxy-based | Proxy-based |
| SSR | Built-in | Effect runtime |
| Streaming | AsyncIterable support | Effect Stream |
| Error Handling | TRPCClientError | Effect failures |
| Subscriptions | Custom state machine | Effect Stream |

---

## Key Design Patterns

### 1. Proxy-Based Hook Generation
All hooks are generated dynamically via `createRecursiveProxy`, allowing any procedure path to automatically have the correct hooks.

### 2. Query Key Determinism
Query keys are deterministically derived from `[path, input, type]` ensuring cache hits work correctly.

### 3. Separation of Concerns
- `createRootHooks` - Core hook implementations
- `createReactDecoration` - Proxy for procedure -> hook mapping
- `createUtilityFunctions` - QueryClient operations
- `createRecursiveUtilsProxy` - Utils proxy for procedure -> util mapping

### 4. Composable Options
Options flow: `queryClient.getQueryDefaults` -> user options -> SSR overrides -> tRPC-specific options

### 5. Context-Based DI
The `TRPCProvider` provides all dependencies via React context, allowing hooks to remain pure.

---

## Summary

tRPC's React Query integration is a sophisticated proxy-based system that:

1. **Generates typed hooks** from router definitions using recursive proxies
2. **Manages query keys** with a deterministic `[path, input, type]` structure
3. **Wraps TanStack Query** hooks with tRPC-specific features (SSR, abort, streaming)
4. **Provides utils API** for direct cache manipulation with the same type safety
5. **Supports advanced patterns** like batched queries, subscriptions, and skipToken

For effect-trpc, the key insight is that this pattern can be adapted to use @effect-atom/atom instead of React Query, while maintaining the same proxy-based hook generation and type inference approach.
