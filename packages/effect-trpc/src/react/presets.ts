/**
 * @module effect-trpc/react/presets
 *
 * Query presets and helper functions for common data freshness patterns.
 *
 * @since 0.3.0
 */

import type { UseQueryOptions } from "./create-client.js"

// ─────────────────────────────────────────────────────────────────────────────
// keepPreviousData Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper to use previous data as placeholder while loading new data.
 * Pass to the `placeholderData` option.
 *
 * This is useful for pagination or filtering where you want to show
 * the previous page's data while the next page is loading.
 *
 * @example
 * ```ts
 * import { keepPreviousData } from 'effect-trpc/react'
 *
 * function UserList() {
 *   const [page, setPage] = useState(1)
 *
 *   const { data, isPlaceholderData } = trpc.user.list.useQuery(
 *     { page },
 *     { placeholderData: keepPreviousData }
 *   )
 *
 *   return (
 *     <div style={{ opacity: isPlaceholderData ? 0.5 : 1 }}>
 *       {data?.map(user => <div key={user.id}>{user.name}</div>)}
 *       <button onClick={() => setPage(p => p + 1)}>Next</button>
 *     </div>
 *   )
 * }
 * ```
 *
 * @since 0.3.0
 */
export const keepPreviousData = <T>(previousData: T | undefined): T | undefined => previousData

// ─────────────────────────────────────────────────────────────────────────────
// Query Presets
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pre-configured query option presets for common data freshness patterns.
 *
 * Note: These presets don't include `gcTime` because it's a global setting.
 * Set `gcTime` via `defaultQueryOptions.gcTime` in `createTRPCReact()`.
 *
 * @example
 * ```ts
 * import { queryPresets } from 'effect-trpc/react'
 *
 * // Per-query usage
 * const { data } = trpc.feed.list.useQuery(undefined, queryPresets.frequentData)
 * const { data } = trpc.user.profile.useQuery({ id }, queryPresets.semiStableData)
 * const { data } = trpc.page.content.useQuery({ slug }, queryPresets.static)
 *
 * // Or use with defaultQueryOptions for app-wide defaults
 * const trpc = createTRPCReact<AppRouter>({
 *   defaultQueryOptions: {
 *     ...queryPresets.semiStableData,
 *     gcTime: 30 * 60 * 1000, // Set gcTime globally
 *   },
 * })
 * ```
 *
 * @since 0.3.0
 */
export const queryPresets = {
  /**
   * For data that changes frequently (dashboards, feeds, notifications).
   * - Immediately stale
   * - Polls every 30 seconds
   */
  frequentData: {
    staleTime: 0,
    refetchInterval: 30_000,
  } satisfies Partial<UseQueryOptions<unknown>>,

  /**
   * For semi-stable data (user profiles, settings, product details).
   * - Fresh for 5 minutes
   * - Polls every 10 minutes
   */
  semiStableData: {
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
  } satisfies Partial<UseQueryOptions<unknown>>,

  /**
   * For stable data (static content, rarely changing configuration).
   * - Fresh for 10 minutes
   * - No polling
   */
  stableData: {
    staleTime: 10 * 60 * 1000,
    refetchInterval: false,
  } satisfies Partial<UseQueryOptions<unknown>>,

  /**
   * For SSG/SSR pages - disable all automatic refetching.
   * Use when data was prefetched on the server.
   */
  static: {
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  } satisfies Partial<UseQueryOptions<unknown>>,

  /**
   * Real-time data that should always be fresh.
   * - Never cached as fresh
   * - Refetch on all triggers
   * - Short polling interval
   */
  realtime: {
    staleTime: 0,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: "always",
  } satisfies Partial<UseQueryOptions<unknown>>,

  /**
   * Manual-only refresh - disable all automatic refetching.
   * Use refetch() explicitly to update data.
   */
  manual: {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  } satisfies Partial<UseQueryOptions<unknown>>,
} as const
