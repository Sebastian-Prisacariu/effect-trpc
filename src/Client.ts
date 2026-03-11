/**
 * Client module - Create typed API clients
 * 
 * @since 1.0.0
 */

import { Effect, Layer, Scope } from "effect"
import type { Router, RouterDefinition } from "./Router.js"
import type { QueryDefinition, MutationDefinition, StreamDefinition } from "./Procedure.js"
import type { Transport, Registry, Executor, QueryResult } from "./internal/services.js"

// =============================================================================
// Client Types
// =============================================================================

/**
 * Typed client for a router
 * Maps procedure definitions to callable methods
 * 
 * @since 1.0.0
 * @category models
 */
export type Client<R extends RouterDefinition> = {
  readonly [K in keyof R]: R[K] extends QueryDefinition<infer P, infer S, infer E, any>
    ? QueryClient<P, S, E>
    : R[K] extends MutationDefinition<infer P, infer S, infer E, any>
      ? MutationClient<P, S, E>
      : R[K] extends StreamDefinition<infer P, infer S, infer E, any>
        ? StreamClient<P, S, E>
        : R[K] extends RouterDefinition
          ? Client<R[K]>
          : never
}

/**
 * Query client methods
 * 
 * @since 1.0.0
 * @category models
 */
export interface QueryClient<Payload, Success, Error> {
  /**
   * React hook for queries
   */
  readonly useQuery: UseQuery<Payload, Success, Error>
  
  /**
   * Execute query as Effect (for server/imperative use)
   */
  readonly run: (payload: Payload) => Effect.Effect<Success, Error>
  
  /**
   * Prefetch query (for SSR)
   */
  readonly prefetch: (payload: Payload) => Effect.Effect<void>
  
  /**
   * Get query key for manual invalidation
   */
  readonly key: (payload: Payload) => string
}

/**
 * useQuery hook signature
 */
export interface UseQuery<Payload, Success, Error> {
  (payload: Payload, options?: QueryHookOptions): QueryHookResult<Success, Error>
}

export interface QueryHookOptions {
  readonly enabled?: boolean
  readonly refetchOnMount?: boolean
  readonly refetchOnWindowFocus?: boolean
  readonly refetchInterval?: number
  readonly staleTime?: number
}

export interface QueryHookResult<Success, Error> {
  readonly result: QueryResult<Success, Error>
  readonly refetch: () => void
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
}

/**
 * Mutation client methods
 * 
 * @since 1.0.0
 * @category models
 */
export interface MutationClient<Payload, Success, Error> {
  /**
   * React hook for mutations
   */
  readonly useMutation: UseMutation<Payload, Success, Error>
  
  /**
   * Execute mutation as Effect (for server/imperative use)
   */
  readonly run: (payload: Payload) => Effect.Effect<Success, Error>
}

/**
 * useMutation hook signature
 */
export interface UseMutation<Payload, Success, Error> {
  (options?: MutationHookOptions<Payload, Success, Error>): MutationHookResult<Payload, Success, Error>
}

export interface MutationHookOptions<Payload, Success, Error> {
  readonly onSuccess?: (data: Success, payload: Payload) => void
  readonly onError?: (error: Error, payload: Payload) => void
  readonly onSettled?: (data: Success | undefined, error: Error | undefined, payload: Payload) => void
}

export interface MutationHookResult<Payload, Success, Error> {
  readonly mutate: (payload: Payload) => void
  readonly mutateAsync: (payload: Payload) => Promise<Success>
  readonly result: QueryResult<Success, Error>
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly reset: () => void
}

/**
 * Stream client methods
 * 
 * @since 1.0.0
 * @category models
 */
export interface StreamClient<Payload, Success, Error> {
  /**
   * React hook for streams
   */
  readonly useStream: UseStream<Payload, Success, Error>
  
  /**
   * Execute stream as Effect Stream (for server/imperative use)
   */
  readonly run: (payload: Payload) => Effect.Effect<
    AsyncIterable<Success>,
    Error,
    Scope.Scope
  >
}

export interface UseStream<Payload, Success, Error> {
  (payload: Payload, options?: StreamHookOptions): StreamHookResult<Success, Error>
}

export interface StreamHookOptions {
  readonly enabled?: boolean
}

export interface StreamHookResult<Success, Error> {
  readonly data: ReadonlyArray<Success>
  readonly latestValue: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
}

// =============================================================================
// Client Instance (with Provider)
// =============================================================================

/**
 * Full client instance with React Provider
 * 
 * @since 1.0.0
 * @category models
 */
export interface ClientInstance<R extends RouterDefinition> extends Client<R> {
  /**
   * React Provider component
   */
  readonly Provider: React.FC<ProviderProps>
  
  /**
   * Invalidate queries by key pattern
   */
  readonly invalidate: (keys: ReadonlyArray<string>) => void
  
  /**
   * Get dehydrated state for SSR
   */
  readonly dehydrate: () => Effect.Effect<import("./internal/services.js").DehydratedState>
}

export interface ProviderProps {
  readonly children: React.ReactNode
  readonly layer: Layer.Layer<Transport, never, never>
  readonly hydrationState?: import("./internal/services.js").DehydratedState
}

// Placeholder for React types
declare namespace React {
  interface FC<P = {}> {
    (props: P): any
  }
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a typed client for a router
 * 
 * Returns an Effect that needs Transport, Registry, etc.
 * Use `unsafeMake` for React integration.
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Client } from "effect-trpc"
 * import type { AppRouter } from "./router"
 * 
 * const program = Effect.gen(function* () {
 *   const api = yield* Client.make<AppRouter>()
 *   const users = yield* api.user.list.run({})
 * })
 * ```
 */
export const make = <R extends RouterDefinition>(): Effect.Effect<
  Client<R>,
  never,
  Transport | Registry | Executor | Scope.Scope
> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

/**
 * Create a typed client instance for React
 * 
 * Returns the client with Provider component.
 * Use this in React applications.
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Client } from "effect-trpc"
 * import type { AppRouter } from "./router"
 * 
 * export const api = Client.unsafeMake<AppRouter>()
 * 
 * // In your app:
 * <api.Provider layer={Transport.http("/api/trpc")}>
 *   <App />
 * </api.Provider>
 * 
 * // In components:
 * const query = api.user.list.useQuery({})
 * ```
 */
export const unsafeMake = <R extends RouterDefinition>(): ClientInstance<R> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

/**
 * Create a server-side client for SSR prefetching
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * // lib/api.ts
 * import { Client } from "effect-trpc/server"
 * import type { AppRouter } from "./router"
 * 
 * export const serverApi = Client.makeServer<AppRouter>({
 *   layer: ServerLayer,
 * })
 * 
 * // In Server Component:
 * await serverApi.user.list.prefetch({})
 * ```
 */
export const makeServer = <R extends RouterDefinition>(config: {
  readonly layer: Layer.Layer<any, never, never>
}): Client<R> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}
