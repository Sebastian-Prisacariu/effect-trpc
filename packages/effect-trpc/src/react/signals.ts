/**
 * @module effect-trpc/react/signals
 *
 * Reactive signals for automatic refetching triggers.
 * Simple callback-based subscriptions for React hooks.
 *
 * For Effect-based network status, see the `Network` service:
 * ```ts
 * import { Network, NetworkBrowserLive } from 'effect-trpc'
 * ```
 *
 * For React hooks, see `useNetworkStatus`:
 * ```ts
 * import { useNetworkStatus } from 'effect-trpc/react'
 * ```
 *
 * @since 0.2.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// Stale Time Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if data is stale based on lastFetchedAt and staleTime.
 *
 * @param lastFetchedAt - Timestamp of last successful fetch (null if never fetched)
 * @param staleTime - How long data is considered fresh (ms). Infinity = never stale.
 * @returns true if data is stale and should be refetched
 *
 * @example
 * ```ts
 * if (isStale(atomState.lastFetchedAt, staleTime)) {
 *   refetch()
 * }
 * ```
 *
 * @since 0.2.0
 */
export const isStale = (lastFetchedAt: number | null, staleTime: number): boolean => {
  if (lastFetchedAt === null) return true
  if (staleTime === Infinity) return false
  return Date.now() - lastFetchedAt > staleTime
}

// ─────────────────────────────────────────────────────────────────────────────
// Window Focus Signal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks window focus state changes.
 * Increments a counter each time the window becomes visible.
 *
 * Uses the Page Visibility API (visibilitychange event) which is more
 * reliable than focus/blur events for detecting when the user returns
 * to the tab.
 *
 * @returns Current focus count (increments on each focus)
 *
 * @example
 * ```ts
 * // Subscribe to focus changes
 * useEffect(() => {
 *   return subscribeToWindowFocus(() => {
 *     if (isStale(lastFetchedAt, staleTime)) {
 *       refetch()
 *     }
 *   })
 * }, [lastFetchedAt, staleTime, refetch])
 * ```
 *
 * @since 0.2.0
 */
export const subscribeToWindowFocus = (callback: () => void): (() => void) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    // SSR - no-op
    return () => {}
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      callback()
    }
  }

  document.addEventListener("visibilitychange", handleVisibilityChange)

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Network Reconnect Signal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks network reconnection events.
 * Calls the callback when the browser reconnects to the network.
 *
 * Uses the Navigator.onLine API and 'online' event.
 *
 * @returns Cleanup function to unsubscribe
 *
 * @example
 * ```ts
 * useEffect(() => {
 *   return subscribeToNetworkReconnect(() => {
 *     if (isStale(lastFetchedAt, staleTime)) {
 *       refetch()
 *     }
 *   })
 * }, [lastFetchedAt, staleTime, refetch])
 * ```
 *
 * @since 0.2.0
 */
export const subscribeToNetworkReconnect = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") {
    // SSR - no-op
    return () => {}
  }

  const handleOnline = () => {
    callback()
  }

  window.addEventListener("online", handleOnline)

  return () => {
    window.removeEventListener("online", handleOnline)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibility Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the document is currently visible.
 * Used for refetchIntervalInBackground to pause polling when tab is hidden.
 *
 * @returns true if document is visible, false if hidden or SSR
 *
 * @since 0.2.0
 */
export const isDocumentVisible = (): boolean => {
  if (typeof document === "undefined") {
    return true // SSR - assume visible
  }
  return document.visibilityState === "visible"
}
