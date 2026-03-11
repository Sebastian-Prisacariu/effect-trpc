/**
 * @module effect-trpc/client
 * 
 * React client using Effect Atom for state management.
 */

import { Atom, Result, useAtomValue } from "@effect-atom/atom-react"
import { RpcClient, RpcSerialization } from "@effect/rpc"
import type { Rpc, RpcGroup } from "@effect/rpc"
import { FetchHttpClient } from "@effect/platform"
import { Effect, Layer, Schema } from "effect"
import * as React from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientConfig<TGroup extends RpcGroup.Any> {
  /**
   * URL of the RPC endpoint.
   */
  readonly url: string
  
  /**
   * Invalidation rules: which queries to refetch when a mutation completes.
   */
  readonly invalidates?: InvalidationRules<TGroup>
  
  /**
   * Serialization format (must match server).
   */
  readonly serialization?: "ndjson" | "json"
}

type InvalidationRules<TGroup> = Partial<Record<string, ReadonlyArray<string>>>

/**
 * Query hook result.
 */
export interface UseQueryResult<O, E> {
  /**
   * The Result containing loading/success/error state.
   */
  readonly result: Result.Result<O, E>
  
  /**
   * Refetch the query.
   */
  readonly refetch: () => void
  
  /**
   * Convenience accessors.
   */
  readonly data: O | undefined
  readonly error: E | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
}

/**
 * Mutation hook result.
 */
export interface UseMutationResult<I, O, E> {
  /**
   * The Result containing loading/success/error state.
   */
  readonly result: Result.Result<O, E>
  
  /**
   * Execute the mutation (fire and forget).
   */
  readonly mutate: (input: I) => void
  
  /**
   * Execute the mutation and return a promise.
   */
  readonly mutateAsync: (input: I) => Promise<O>
  
  /**
   * Reset to initial state.
   */
  readonly reset: () => void
  
  /**
   * Convenience accessors.
   */
  readonly data: O | undefined
  readonly error: E | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Extract RPC types from group
// ─────────────────────────────────────────────────────────────────────────────

type ExtractRpcInput<T> = T extends Rpc.Rpc<infer _Tag, infer I, infer _O, infer _E>
  ? I
  : never

type ExtractRpcOutput<T> = T extends Rpc.Rpc<infer _Tag, infer _I, infer O, infer _E>
  ? O
  : never

type ExtractRpcError<T> = T extends Rpc.Rpc<infer _Tag, infer _I, infer _O, infer E>
  ? E
  : never

// ─────────────────────────────────────────────────────────────────────────────
// Client API Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query API for a single RPC.
 */
interface QueryApi<I, O, E> {
  /**
   * React hook for this query.
   */
  useQuery: I extends void 
    ? () => UseQueryResult<O, E>
    : (input: I) => UseQueryResult<O, E>
  
  /**
   * The underlying atom (for advanced use).
   */
  atom: (input: I) => Atom.Atom<Result.Result<O, E>>
  
  /**
   * Execute query imperatively.
   */
  query: (input: I) => Effect.Effect<O, E>
}

/**
 * Mutation API for a single RPC.
 */
interface MutationApi<I, O, E> {
  /**
   * React hook for this mutation.
   */
  useMutation: () => UseMutationResult<I, O, E>
  
  /**
   * Execute mutation imperatively.
   */
  mutate: (input: I) => Effect.Effect<O, E>
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context for the API client.
 */
interface ApiContextValue {
  readonly invalidate: (keys: ReadonlyArray<string>) => void
}

const ApiContext = React.createContext<ApiContextValue | null>(null)

/**
 * Create a typed API client from an RPC group.
 * 
 * @example
 * ```ts
 * import { createClient } from "effect-trpc/client"
 * import { UserRpcs } from "./procedures"
 * 
 * export const api = createClient(UserRpcs, {
 *   url: "/api/rpc",
 *   invalidates: {
 *     create: ["list"],
 *     delete: ["list", "byId"],
 *   },
 * })
 * 
 * // In components:
 * const { result, refetch } = api.list.useQuery()
 * const { mutate } = api.create.useMutation()
 * ```
 */
export function createClient<TGroup extends RpcGroup.Any>(
  group: TGroup,
  config: ClientConfig<TGroup>
) {
  const { url, invalidates = {}, serialization = "ndjson" } = config
  
  // Set up the RPC client protocol layer
  const ProtocolLayer = RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide([
      FetchHttpClient.layer,
      serialization === "ndjson"
        ? RpcSerialization.layerNdjson
        : RpcSerialization.layerJson,
    ])
  )
  
  // Create runtime atom for the client
  const runtimeAtom = Atom.runtime(ProtocolLayer)
  
  // Registry for query atoms (for invalidation)
  const queryAtoms = new Map<string, Set<Atom.Atom<any>>>()
  
  // Invalidation function
  const invalidateQueries = (keys: ReadonlyArray<string>) => {
    for (const key of keys) {
      const atoms = queryAtoms.get(key)
      if (atoms) {
        for (const atom of atoms) {
          // Trigger rebuild by touching the atom
          // This will re-run the effect
          Atom.invalidate(atom)
        }
      }
    }
  }
  
  // Build the client API object
  const api: Record<string, QueryApi<any, any, any> | MutationApi<any, any, any>> = {}
  
  // Iterate over RPCs in the group
  // Note: This is a simplified version. In production, you'd introspect the group properly.
  const rpcs = (group as any)._rpcs as ReadonlyArray<Rpc.Rpc<string, any, any, any>>
  
  for (const rpc of rpcs) {
    const name = rpc._tag
    const isMutation = name.toLowerCase().includes("create") 
      || name.toLowerCase().includes("update")
      || name.toLowerCase().includes("delete")
    
    if (isMutation) {
      // Mutation API
      api[name] = createMutationApi(rpc, {
        runtimeAtom,
        group,
        invalidates: (invalidates as any)[name] ?? [],
        invalidateQueries,
      })
    } else {
      // Query API
      api[name] = createQueryApi(rpc, {
        runtimeAtom,
        group,
        queryAtoms,
        name,
      })
    }
  }
  
  // Provider component
  const Provider = ({ children }: { children: React.ReactNode }) => {
    const contextValue: ApiContextValue = {
      invalidate: invalidateQueries,
    }
    
    return React.createElement(
      ApiContext.Provider,
      { value: contextValue },
      children
    )
  }
  
  return {
    ...api,
    Provider,
  } as ClientApi<TGroup> & { Provider: React.FC<{ children: React.ReactNode }> }
}

// ─────────────────────────────────────────────────────────────────────────────
// Query API Factory
// ─────────────────────────────────────────────────────────────────────────────

interface QueryApiConfig {
  runtimeAtom: any
  group: RpcGroup.Any
  queryAtoms: Map<string, Set<Atom.Atom<any>>>
  name: string
}

function createQueryApi<I, O, E>(
  rpc: Rpc.Rpc<string, I, O, E>,
  config: QueryApiConfig
): QueryApi<I, O, E> {
  const { runtimeAtom, group, queryAtoms, name } = config
  
  // Factory for creating query atoms with input
  const makeAtom = (input: I) => {
    const queryAtom = runtimeAtom.atom(
      Effect.gen(function* () {
        const client = yield* RpcClient.make(group)
        return yield* (client as any)[name](input ?? {})
      })
    )
    
    // Register for invalidation
    if (!queryAtoms.has(name)) {
      queryAtoms.set(name, new Set())
    }
    queryAtoms.get(name)!.add(queryAtom)
    
    return queryAtom
  }
  
  // Cache of atoms by input
  const atomCache = new Map<string, Atom.Atom<Result.Result<O, E>>>()
  
  const getAtom = (input: I) => {
    const key = JSON.stringify(input ?? {})
    if (!atomCache.has(key)) {
      atomCache.set(key, makeAtom(input))
    }
    return atomCache.get(key)!
  }
  
  return {
    useQuery: ((input?: I) => {
      const atom = React.useMemo(() => getAtom(input as I), [JSON.stringify(input)])
      const result = useAtomValue(atom)
      
      return {
        result,
        refetch: () => Atom.invalidate(atom),
        data: Result.isSuccess(result) ? result.value : undefined,
        error: Result.isFailure(result) ? result.cause : undefined,
        isLoading: Result.isWaiting(result),
        isSuccess: Result.isSuccess(result),
        isError: Result.isFailure(result),
      }
    }) as any,
    
    atom: getAtom,
    
    query: (input: I) =>
      Effect.gen(function* () {
        const client = yield* RpcClient.make(group)
        return yield* (client as any)[name](input ?? {})
      }).pipe(Effect.provide(runtimeAtom.layer)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutation API Factory
// ─────────────────────────────────────────────────────────────────────────────

interface MutationApiConfig {
  runtimeAtom: any
  group: RpcGroup.Any
  invalidates: ReadonlyArray<string>
  invalidateQueries: (keys: ReadonlyArray<string>) => void
}

function createMutationApi<I, O, E>(
  rpc: Rpc.Rpc<string, I, O, E>,
  config: MutationApiConfig
): MutationApi<I, O, E> {
  const { runtimeAtom, group, invalidates, invalidateQueries } = config
  const name = rpc._tag
  
  const executeMutation = (input: I) =>
    Effect.gen(function* () {
      const client = yield* RpcClient.make(group)
      const result = yield* (client as any)[name](input)
      
      // Invalidate queries on success
      if (invalidates.length > 0) {
        invalidateQueries(invalidates)
      }
      
      return result
    }).pipe(Effect.provide(runtimeAtom.layer))
  
  return {
    useMutation: () => {
      const [result, setResult] = React.useState<Result.Result<O, E>>(Result.initial())
      
      const mutate = React.useCallback((input: I) => {
        setResult(Result.waiting())
        
        Effect.runPromise(executeMutation(input))
          .then((value) => setResult(Result.success(value)))
          .catch((error) => setResult(Result.failure(error)))
      }, [])
      
      const mutateAsync = React.useCallback(
        (input: I) => Effect.runPromise(executeMutation(input)),
        []
      )
      
      const reset = React.useCallback(() => setResult(Result.initial()), [])
      
      return {
        result,
        mutate,
        mutateAsync,
        reset,
        data: Result.isSuccess(result) ? result.value : undefined,
        error: Result.isFailure(result) ? result.cause : undefined,
        isLoading: Result.isWaiting(result),
        isSuccess: Result.isSuccess(result),
        isError: Result.isFailure(result),
      }
    },
    
    mutate: executeMutation,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Type Inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer the full client API type from an RPC group.
 */
type ClientApi<TGroup extends RpcGroup.Any> = {
  [K in RpcGroup.RpcNames<TGroup>]: RpcGroup.Rpc<TGroup, K> extends Rpc.Rpc<K, infer I, infer O, infer E>
    ? IsMutation<K> extends true
      ? MutationApi<I, O, E>
      : QueryApi<I, O, E>
    : never
}

type IsMutation<T extends string> = 
  T extends `create${string}` ? true :
  T extends `Create${string}` ? true :
  T extends `update${string}` ? true :
  T extends `Update${string}` ? true :
  T extends `delete${string}` ? true :
  T extends `Delete${string}` ? true :
  T extends `remove${string}` ? true :
  T extends `Remove${string}` ? true :
  false

// ─────────────────────────────────────────────────────────────────────────────
// Result Utilities (re-export from effect-atom)
// ─────────────────────────────────────────────────────────────────────────────

export { Result } from "@effect-atom/atom-react"

/**
 * Result builder pattern for rendering.
 * 
 * @example
 * ```tsx
 * return Result.match(query.result, {
 *   onInitial: () => <Skeleton />,
 *   onWaiting: () => <Spinner />,
 *   onSuccess: (data) => <DataView data={data} />,
 *   onFailure: (error) => <ErrorView error={error} />,
 * })
 * ```
 */
