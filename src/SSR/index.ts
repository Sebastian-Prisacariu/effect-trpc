/**
 * SSR - Server-Side Rendering utilities
 * 
 * Provides utilities for server-side rendering with effect-trpc.
 * Built on @effect-atom/atom's Hydration module.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * // Server-side (e.g., Next.js getServerSideProps)
 * import { SSR, Client, Transport, Router } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * export async function getServerSideProps() {
 *   // Create server-side client
 *   const api = Client.make(appRouter)
 *   
 *   // Prefetch data
 *   const users = await Effect.runPromise(
 *     api.users.list.run().pipe(
 *       Effect.provide(Transport.http("/api"))
 *     )
 *   )
 *   
 *   // Dehydrate state for client
 *   const dehydratedState = SSR.dehydrate({
 *     "users.list": users,
 *   })
 *   
 *   return {
 *     props: { dehydratedState },
 *   }
 * }
 * 
 * // Client-side (e.g., _app.tsx)
 * import { SSR } from "effect-trpc"
 * 
 * function App({ dehydratedState, ...props }) {
 *   return (
 *     <api.Provider layer={Transport.http("/api")}>
 *       <SSR.Hydrate state={dehydratedState}>
 *         <Component {...props} />
 *       </SSR.Hydrate>
 *     </api.Provider>
 *   )
 * }
 * ```
 */

import * as React from "react"
import { Hydration, Registry } from "@effect-atom/atom-react"
import * as Either from "effect/Either"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

// =============================================================================
// Types
// =============================================================================

/**
 * Dehydrated state that can be serialized to JSON
 * 
 * @since 1.0.0
 * @category models
 */
export interface DehydratedState {
  readonly queries: Record<string, unknown>
  readonly timestamp: number
}

/**
 * Options for dehydration
 * 
 * @since 1.0.0
 * @category models
 */
export interface DehydrateOptions {
  /**
   * Whether to include failed queries (default: false)
   */
  readonly includeErrors?: boolean
}

// =============================================================================
// Server-side utilities
// =============================================================================

/**
 * Dehydrate query results for transfer to client
 * 
 * @since 1.0.0
 * @category server
 * @example
 * ```ts
 * const dehydratedState = SSR.dehydrate({
 *   "users.list": users,
 *   "users.get": { id: "1", name: "Alice" },
 * })
 * // Serialize and send to client
 * ```
 */
export const dehydrate = (
  queries: Record<string, unknown>,
  _options?: DehydrateOptions
): DehydratedState => ({
  queries,
  timestamp: Date.now(),
})

/**
 * Build a stable hydration key for a query path + optional payload.
 *
 * Plain path keys remain supported for backwards compatibility.
 *
 * @since 1.0.0
 * @category utilities
 */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, currentValue) => {
    if (currentValue === null || typeof currentValue !== "object" || Array.isArray(currentValue)) {
      return currentValue
    }

    const record = currentValue as Record<string, unknown>
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = record[key]
        return acc
      }, {})
  })

export const queryKey = (path: string, payload?: unknown): string =>
  payload === undefined ? path : `${path}:${stableStringify(payload)}`

/**
 * Build a stable hydration key using a payload schema for encoding first.
 *
 * This ensures custom schema encodings participate in key generation.
 *
 * @since 1.0.0
 * @category utilities
 */
export const queryKeyFromSchema = <A, I>(
  path: string,
  schema: Schema.Schema<A, I, never>,
  payload?: A
): string => {
  if (payload === undefined) {
    return path
  }

  const encoded = Schema.encodeUnknownEither(schema)(payload)
  if (Either.isLeft(encoded)) {
    throw new Error(ParseResult.TreeFormatter.formatErrorSync(encoded.left))
  }

  return queryKey(path, encoded.right)
}

/**
 * Prefetch context passed to the prefetch function.
 * Contains the typed API client for fetching data.
 * 
 * @since 1.0.0
 * @category server
 */
export interface PrefetchContext<API> {
  /** The typed API client for making queries */
  readonly api: API
  /** Add a query result to the dehydrated state */
  readonly collect: (path: string, data: unknown) => void
}

/**
 * Options for createPrefetch
 * 
 * @since 1.0.0
 * @category server
 */
export interface PrefetchOptions {
  /** Whether to include errors in dehydrated state (default: false) */
  readonly includeErrors?: boolean
}

/**
 * Create a prefetch helper for server-side rendering.
 * 
 * Use this to prefetch data on the server and pass it to the client
 * for hydration.
 * 
 * @since 1.0.0
 * @category server
 * @example
 * ```ts
 * import { SSR, Server, Transport } from "effect-trpc"
 * import { Effect, Layer } from "effect"
 * 
 * // In getServerSideProps (Next.js)
 * export async function getServerSideProps() {
 *   const { data, dehydratedState } = await SSR.prefetch(async (collect) => {
 *     // Run your Effects with Effect.runPromise
 *     const users = await Effect.runPromise(
 *       api.users.list.run().pipe(Effect.provide(layer))
 *     )
 *     collect("users.list", users)
 *     
 *     return { users }
 *   })
 *   
 *   return { props: { dehydratedState, ...data } }
 * }
 * ```
 */
export const prefetch = async <T>(
  fn: (collect: (path: string, data: unknown) => void) => Promise<T>
): Promise<{ data: T; dehydratedState: DehydratedState }> => {
  const collected: Record<string, unknown> = {}
  
  const collect = (path: string, data: unknown) => {
    collected[path] = data
  }
  
  const data = await fn(collect)
  
  return {
    data,
    dehydratedState: dehydrate(collected),
  }
}

/**
 * Prefetch by running an Effect directly.
 * The Effect should return a record of path → data.
 * 
 * @since 1.0.0
 * @category server
 * @example
 * ```ts
 * import { SSR } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * const { dehydratedState } = await SSR.prefetchEffect(
 *   Effect.all({
 *     "users.list": api.users.list.run(),
 *     "config.get": api.config.get.run(),
 *   }).pipe(Effect.provide(fullLayer))
 * )
 * ```
 */
export const prefetchEffect = async <A extends Record<string, unknown>>(
  effect: import("effect/Effect").Effect<A, unknown, never>
): Promise<{ data: A; dehydratedState: DehydratedState }> => {
  const { Effect } = await import("effect")
  
  const data = await Effect.runPromise(effect)
  
  return {
    data,
    dehydratedState: dehydrate(data),
  }
}

// =============================================================================
// Client-side utilities
// =============================================================================

/**
 * Props for Hydrate component
 * 
 * @since 1.0.0
 * @category components
 */
export interface HydrateProps {
  readonly state: DehydratedState | undefined
  readonly children: React.ReactNode
}

/**
 * Hydration context for passing server state to client
 */
const HydrationContext = React.createContext<DehydratedState | null>(null)

/**
 * Hook to access hydration state
 * 
 * @since 1.0.0
 * @category hooks
 */
export const useHydrationState = (): DehydratedState | null => {
  return React.useContext(HydrationContext)
}

/**
 * Hook to get pre-fetched data for a specific path
 * 
 * @since 1.0.0
 * @category hooks
 * @example
 * ```tsx
 * function UserList() {
 *   const prefetched = useHydratedData<User[]>("users.list")
 *   // prefetched is the server-fetched data or undefined
 * }
 * ```
 */
export const useHydratedData = <T>(path: string): T | undefined => {
  const state = React.useContext(HydrationContext)
  return state?.queries[path] as T | undefined
}

/**
 * Hydrate component - rehydrates server state on client
 * 
 * Wrap your app with this component to restore server-prefetched data.
 * The dehydrated state is made available via context, and components
 * can access it via useHydratedData() to use as initial values.
 * 
 * @since 1.0.0
 * @category components
 * @example
 * ```tsx
 * <api.Provider layer={Transport.http("/api")}>
 *   <SSR.Hydrate state={dehydratedState}>
 *     <App />
 *   </SSR.Hydrate>
 * </api.Provider>
 * ```
 */
export const Hydrate: React.FC<HydrateProps> = ({ state, children }) => {
  // Validate staleness - reject if too old (default: 5 minutes)
  const isStale = state && (Date.now() - state.timestamp > 5 * 60 * 1000)
  const validState = isStale ? null : state ?? null
  
  return React.createElement(
    HydrationContext.Provider,
    { value: validState },
    children
  )
}

// =============================================================================
// Re-exports from @effect-atom/atom
// =============================================================================

/**
 * Low-level hydration utilities from @effect-atom/atom
 * 
 * @since 1.0.0
 * @category re-exports
 */
export { Hydration }

/**
 * Check if running on server
 * 
 * @since 1.0.0
 * @category utilities
 */
export const isServer = typeof window === "undefined"

/**
 * Check if running on client
 * 
 * @since 1.0.0
 * @category utilities
 */
export const isClient = !isServer
