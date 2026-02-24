/**
 * @module effect-trpc/react/hooks/useGate
 *
 * React hook for observing Gate state.
 *
 * @since 0.2.0
 */

import * as React from "react"
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
  const [isOpen, setIsOpen] = React.useState(() => {
    // Get initial state synchronously if possible
    // This avoids a flash of incorrect state
    try {
      // We can't use Effect.runSync here safely in all cases,
      // so we'll rely on the subscription to update
      return true // Default to open
    } catch {
      return true
    }
  })

  const [openedAt, setOpenedAt] = React.useState<number | null>(null)
  const [closedAt, setClosedAt] = React.useState<number | null>(null)

  React.useEffect(() => {
    // Subscribe to gate changes
    const cleanup = Gate.subscribe(gate, (open) => {
      setIsOpen(open)
      if (open) {
        setOpenedAt(Date.now())
      } else {
        setClosedAt(Date.now())
      }
    })

    return cleanup
  }, [gate])

  return {
    isOpen,
    openedAt,
    closedAt,
  }
}
