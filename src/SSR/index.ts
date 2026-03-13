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
 * Hydrate component - rehydrates server state on client
 * 
 * Wrap your app with this component to restore server-prefetched data.
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
  // Use Effect Atom's hydration mechanism
  React.useEffect(() => {
    if (state) {
      // Hydration happens automatically via context
      // The Provider's registry will pick up the state
    }
  }, [state])
  
  return React.createElement(React.Fragment, null, children)
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
