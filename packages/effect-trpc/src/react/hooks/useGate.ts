/**
 * @module effect-trpc/react/hooks/useGate
 *
 * React hook for observing Gate state.
 *
 * @since 0.3.0
 */

import * as React from "react"
import * as Effect from "effect/Effect"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { GateInstance } from "../../core/gate/index.js"
import { Gate } from "../../core/gate/index.js"

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
export function useGate(gate: GateInstance): UseGateReturn {
  // Start with SSR-safe defaults to avoid hydration mismatch
  const [state, setState] = React.useState<UseGateReturn>({
    isOpen: true, // Default during SSR
    isHydrated: false,
    openedAt: null,
    closedAt: null,
  })

  // Sync with actual gate state after mount
  React.useEffect(() => {
    // Read current gate state
    try {
      const currentState = Effect.runSync(SubscriptionRef.get(gate.state))
      setState({
        isOpen: currentState.isOpen,
        isHydrated: true,
        openedAt: currentState.openedAt,
        closedAt: currentState.closedAt,
      })
    } catch {
      // Fallback if runSync fails
      setState((prev) => ({ ...prev, isHydrated: true }))
    }

    // Subscribe to gate changes
    const cleanup = Gate.subscribe(gate, (open) => {
      setState((prev) => ({
        isOpen: open,
        isHydrated: true,
        openedAt: open ? Date.now() : prev.openedAt,
        closedAt: open ? prev.closedAt : Date.now(),
      }))
    })

    return cleanup
  }, [gate])

  return state
}
