/**
 * @module effect-trpc/react/hooks/useGate
 *
 * React hook for observing Gate state.
 *
 * @since 0.2.0
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
 * @since 0.2.0
 * @category hooks
 */
export interface UseGateReturn {
  /**
   * Whether the gate is currently open.
   */
  readonly isOpen: boolean

  /**
   * Timestamp of when the gate was last opened (ms since epoch).
   * Null if never opened.
   */
  readonly openedAt: number | null

  /**
   * Timestamp of when the gate was last closed (ms since epoch).
   * Null if never closed.
   */
  readonly closedAt: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to observe a Gate's open/closed state.
 *
 * @example
 * ```tsx
 * function AuthGuard({ children, authGate }) {
 *   const { isOpen } = useGate(authGate)
 *
 *   if (!isOpen) {
 *     return <LoginPrompt />
 *   }
 *
 *   return children
 * }
 * ```
 *
 * @param gate - The Gate instance to observe
 * @since 0.2.0
 * @category hooks
 */
export function useGate(gate: GateInstance): UseGateReturn {
  // Get initial state from the gate's SubscriptionRef
  // SubscriptionRef.get is a synchronous read, safe to run with Effect.runSync
  const [state, setState] = React.useState(() => {
    try {
      const currentState = Effect.runSync(SubscriptionRef.get(gate.state))
      return {
        isOpen: currentState.isOpen,
        openedAt: currentState.openedAt,
        closedAt: currentState.closedAt,
      }
    } catch {
      // Fallback if runSync fails (shouldn't happen for sync operations)
      return {
        isOpen: true,
        openedAt: null,
        closedAt: null,
      }
    }
  })

  React.useEffect(() => {
    // Subscribe to gate changes
    const cleanup = Gate.subscribe(gate, (open) => {
      setState((prev) => ({
        isOpen: open,
        openedAt: open ? Date.now() : prev.openedAt,
        closedAt: open ? prev.closedAt : Date.now(),
      }))
    })

    return cleanup
  }, [gate])

  return state
}
