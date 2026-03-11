/**
 * Client - Create typed API clients for React
 * 
 * @since 1.0.0
 * @module
 */

import { Effect, Layer, Scope } from "effect"
import type * as Router from "../Router/index.js"
import type * as Procedure from "../Procedure/index.js"
import type { Transport } from "../Transport/index.js"
import type { QueryResult, DehydratedState } from "./internal/types.js"

// Re-export types
export type { QueryResult, DehydratedState } from "./internal/types.js"

// =============================================================================
// Client Types
// =============================================================================

/**
 * Typed client mapped from router definition
 * 
 * @since 1.0.0
 * @category models
 */
export type Client<D extends Router.Definition> = {
  readonly [K in keyof D]: D[K] extends Procedure.QueryDef<infer P, infer S, infer E, any>
    ? QueryClient<P, S, E>
    : D[K] extends Procedure.MutationDef<infer P, infer S, infer E, any>
      ? MutationClient<P, S, E>
      : D[K] extends Procedure.StreamDef<infer P, infer S, infer E, any>
        ? StreamClient<P, S, E>
        : D[K] extends Router.Definition
          ? Client<D[K]>
          : never
}

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryClient<Payload, Success, Error> {
  readonly useQuery: (
    payload: Payload,
    options?: QueryHookOptions
  ) => QueryHookResult<Success, Error>
  
  readonly run: (payload: Payload) => Effect.Effect<Success, Error>
  readonly prefetch: (payload: Payload) => Effect.Effect<void>
  readonly key: (payload: Payload) => string
}

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryHookOptions {
  readonly enabled?: boolean
  readonly staleTime?: number
  readonly refetchOnMount?: boolean
  readonly refetchOnWindowFocus?: boolean
  readonly refetchInterval?: number
}

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryHookResult<Success, Error> {
  readonly result: QueryResult<Success, Error>
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly refetch: () => void
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationClient<Payload, Success, Error> {
  readonly useMutation: (
    options?: MutationHookOptions<Payload, Success, Error>
  ) => MutationHookResult<Payload, Success, Error>
  
  readonly run: (payload: Payload) => Effect.Effect<Success, Error>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationHookOptions<Payload, Success, Error> {
  readonly onSuccess?: (data: Success, payload: Payload) => void
  readonly onError?: (error: Error, payload: Payload) => void
  readonly onSettled?: () => void
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationHookResult<Payload, Success, Error> {
  readonly mutate: (payload: Payload) => void
  readonly mutateAsync: (payload: Payload) => Promise<Success>
  readonly result: QueryResult<Success, Error>
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly reset: () => void
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamClient<Payload, Success, Error> {
  readonly useStream: (
    payload: Payload,
    options?: StreamHookOptions
  ) => StreamHookResult<Success, Error>
  
  readonly run: (payload: Payload) => Effect.Effect<AsyncIterable<Success>, Error, Scope.Scope>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamHookOptions {
  readonly enabled?: boolean
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamHookResult<Success, Error> {
  readonly data: ReadonlyArray<Success>
  readonly latest: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
}

// =============================================================================
// Client Instance
// =============================================================================

/**
 * Full client instance with Provider
 * 
 * @since 1.0.0
 * @category models
 */
export interface ClientInstance<D extends Router.Definition> extends Client<D> {
  readonly Provider: React.FC<ProviderProps>
  readonly invalidate: (keys: ReadonlyArray<string>) => void
  readonly dehydrate: () => Effect.Effect<DehydratedState>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface ProviderProps {
  readonly children: React.ReactNode
  readonly layer: Layer.Layer<Transport, never, never>
  readonly hydrationState?: DehydratedState
}

// React types placeholder
declare namespace React {
  interface FC<P = {}> {
    (props: P): any
  }
  type ReactNode = any
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a typed client for React
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Client } from "effect-trpc"
 * import type { AppRouter } from "./router"
 * 
 * export const api = Client.make<AppRouter>()
 * 
 * // In app:
 * <api.Provider layer={Transport.http("/api/trpc")}>
 *   <App />
 * </api.Provider>
 * 
 * // In component:
 * const { data } = api.user.list.useQuery({})
 * ```
 */
export const make = <D extends Router.Definition>(): ClientInstance<D> => {
  // Implementation will use:
  // - Effect Atom for state management
  // - Transport for requests
  // - React context for Provider
  throw new Error("Not implemented")
}

/**
 * Create a server-side client for SSR
 * 
 * @since 1.0.0
 * @category constructors
 */
export const makeServer = <D extends Router.Definition>(config: {
  readonly layer: Layer.Layer<any, never, never>
}): Client<D> => {
  throw new Error("Not implemented")
}
