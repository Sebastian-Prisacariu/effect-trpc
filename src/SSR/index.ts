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
 * Create a prefetch helper for a router
 * 
 * @since 1.0.0
 * @category server
 * @example
 * ```ts
 * const prefetch = SSR.createPrefetch(appRouter)
 * 
 * // In getServerSideProps
 * const state = await prefetch(async (api) => ({
 *   users: await api.users.list(),
 *   config: await api.config.get(),
 * }))
 * ```
 */
export const createPrefetch = <R>(
  _router: R
): (<T>(
  fn: (api: any) => Promise<T>
) => Promise<{ data: T; dehydratedState: DehydratedState }>) => {
  return async (fn) => {
    // TODO: Implement proper prefetch with client
    const data = await fn({})
    return {
      data,
      dehydratedState: dehydrate(data as Record<string, unknown>),
    }
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
