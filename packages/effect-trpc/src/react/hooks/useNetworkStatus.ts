/**
 * @module effect-trpc/react/hooks/useNetworkStatus
 *
 * React hook for network online/offline status.
 * Handles SSR/hydration safely by deferring to useEffect.
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
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to track network online/offline status.
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
  // Start with server-safe values to avoid hydration mismatch
  const [isOnline, setIsOnline] = React.useState(true)
  const [isHydrated, setIsHydrated] = React.useState(false)
  const [lastOnlineAt, setLastOnlineAt] = React.useState<number | null>(null)
  const [lastOfflineAt, setLastOfflineAt] = React.useState<number | null>(null)

  React.useEffect(() => {
    // Now on client - get real value
    const currentOnline = typeof navigator !== "undefined" ? navigator.onLine : true
    setIsOnline(currentOnline)
    setIsHydrated(true)

    if (currentOnline) {
      setLastOnlineAt(Date.now())
    } else {
      setLastOfflineAt(Date.now())
    }

    // Subscribe to changes
    const handleOnline = () => {
      setIsOnline(true)
      setLastOnlineAt(Date.now())
    }

    const handleOffline = () => {
      setIsOnline(false)
      setLastOfflineAt(Date.now())
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return {
    isOnline,
    isHydrated,
    lastOnlineAt,
    lastOfflineAt,
  }
}
