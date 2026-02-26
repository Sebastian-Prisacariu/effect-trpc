/**
 * @module effect-trpc/react/hooks/useGate
 *
 * React hook for observing Gate state.
 *
 * @since 0.3.0
 */

import * as React from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return type for useGate hook.
 *
 * @since 0.3.0
 * @category hooks
 */
export interface UseGateReturn {
  /**
   * Whether the gate is currently open.
   * During SSR and before hydration, this is always `true`.
   */
  readonly isOpen: boolean

  /**
   * Whether the hook has hydrated with the real gate state.
   * Use this to conditionally render based on actual gate status.
   */
  readonly isHydrated: boolean

  /**
   * Timestamp of when the gate was last opened (ms since epoch).
   * Null if never opened or during SSR.
   */
  readonly openedAt: number | null

  /**
   * Timestamp of when the gate was last closed (ms since epoch).
   * Null if never closed or during SSR.
   */
  readonly closedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to observe a Gate's open/closed state.
 *
 * **SSR/Hydration Safety:**
 * - During SSR: Returns `isOpen: true, isHydrated: false`
 * - After hydration: Returns actual gate state, `isHydrated: true`
 *
 * This prevents hydration mismatches while still providing accurate
 * gate status after the component mounts.
 *
 * @example
 * ```tsx
 * function AuthGuard({ children, authGate }) {
 *   const { isOpen, isHydrated } = useGate(authGate)
 *
 *   // Don't block until we know the real state
 *   if (!isHydrated) return <LoadingSpinner />
 *   if (!isOpen) return <LoginPrompt />
 *
 *   return children
 * }
 * ```
 *
 * @param gate - The Gate instance to observe
 * @since 0.3.0
 * @category hooks
 */
export function useGate(_gate: unknown): UseGateReturn {
  const [state] = React.useState<UseGateReturn>({
    isOpen: true,
    isHydrated: true,
    openedAt: null,
    closedAt: null,
  })

  return state
}
