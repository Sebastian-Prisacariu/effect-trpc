/**
 * @module effect-trpc/react/hooks/useNetworkStatus
 *
 * React hook for network online/offline status.
 * Uses useSyncExternalStore for React 18 concurrent mode safety.
 * Handles SSR/hydration safely via getServerSnapshot.
 *
 * @since 0.2.0
 */

import * as React from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return type for useNetworkStatus hook.
 *
 * @since 0.2.0
 * @category hooks
 */
export interface UseNetworkStatusReturn {
  /**
   * Whether the network is currently online.
   * During SSR and before hydration, this is always `true`.
   */
  readonly isOnline: boolean

  /**
   * Whether the hook has hydrated with the real browser state.
   * Use this to conditionally render offline UI.
   */
  readonly isHydrated: boolean

  /**
   * Timestamp of when the network was last online (ms since epoch).
   * Null if never recorded or during SSR.
   */
  readonly lastOnlineAt: number | null

  /**
   * Timestamp of when the network was last offline (ms since epoch).
   * Null if never recorded or during SSR.
   */
  readonly lastOfflineAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current online status from the browser.
 * Returns true if navigator.onLine is not available (SSR/Node.js).
 */
const getOnlineStatus = (): boolean => {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine
  }
  return true
}

/**
 * Subscribe to online/offline events.
 * Returns a cleanup function.
 */
const subscribeToNetworkStatus = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") {
    return () => {}
  }

  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)

  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

/**
 * Server snapshot - always online during SSR.
 */
const getServerSnapshot = (): boolean => true

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to track network online/offline status.
 *
 * Uses `useSyncExternalStore` for React 18 concurrent mode safety.
 * This ensures consistent reads during concurrent renders and proper
 * integration with React's scheduling.
 *
 * **SSR/Hydration Safety:**
 * - During SSR: Returns `isOnline: true, isHydrated: false`
 * - After hydration: Returns real browser state, `isHydrated: true`
 *
 * This prevents hydration mismatches while still providing accurate
 * network status after the component mounts.
 *
 * @example
 * ```tsx
 * function OfflineBanner() {
 *   const { isOnline, isHydrated } = useNetworkStatus()
 *
 *   // Don't show banner until we know the real state
 *   if (!isHydrated) return null
 *   if (isOnline) return null
 *
 *   return <div className="offline-banner">You are offline</div>
 * }
 * ```
 *
 * @since 0.2.0
 * @category hooks
 */
export function useNetworkStatus(): UseNetworkStatusReturn {
  // Use useSyncExternalStore for concurrent mode safety
  const isOnline = React.useSyncExternalStore(
    subscribeToNetworkStatus,
    getOnlineStatus,
    getServerSnapshot,
  )

  // Track hydration state
  const [isHydrated, setIsHydrated] = React.useState(false)

  // Track timestamps in separate state (these don't need sync external store)
  const [timestamps, setTimestamps] = React.useState<{
    lastOnlineAt: number | null
    lastOfflineAt: number | null
  }>({
    lastOnlineAt: null,
    lastOfflineAt: null,
  })

  // Set hydrated and initial timestamps after mount
  // We intentionally read `isOnline` only once at mount time to record
  // the initial timestamp. Subsequent changes are handled by the effect below.
  React.useEffect(() => {
    setIsHydrated(true)

    // Set initial timestamp based on current status at mount time
    if (isOnline) {
      setTimestamps((prev) => ({ ...prev, lastOnlineAt: Date.now() }))
    } else {
      setTimestamps((prev) => ({ ...prev, lastOfflineAt: Date.now() }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only run on mount
  }, [])

  // Update timestamps when online status changes
  const prevIsOnlineRef = React.useRef(isOnline)
  React.useEffect(() => {
    // Only update if status actually changed (not on initial render)
    if (prevIsOnlineRef.current !== isOnline) {
      if (isOnline) {
        setTimestamps((prev) => ({ ...prev, lastOnlineAt: Date.now() }))
      } else {
        setTimestamps((prev) => ({ ...prev, lastOfflineAt: Date.now() }))
      }
      prevIsOnlineRef.current = isOnline
    }
  }, [isOnline])

  return {
    isOnline,
    isHydrated,
    lastOnlineAt: timestamps.lastOnlineAt,
    lastOfflineAt: timestamps.lastOfflineAt,
  }
}
