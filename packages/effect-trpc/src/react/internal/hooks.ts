/**
 * @module effect-trpc/react/internal/hooks
 * @internal
 *
 * Internal React hook utilities shared across the React client.
 */

import * as React from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Isomorphic Layout Effect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if we're in a browser environment.
 * @internal
 */
const canUseDOM = !!(
  typeof window !== "undefined" &&
  window.document &&
  window.document.createElement
)

/**
 * Isomorphic layout effect - uses useLayoutEffect on client, useEffect on server.
 * This prevents SSR warnings about useLayoutEffect not running on the server.
 *
 * @internal
 */
export const useIsomorphicLayoutEffect = canUseDOM
  ? React.useLayoutEffect
  : React.useEffect

// ─────────────────────────────────────────────────────────────────────────────
// useEvent Polyfill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Polyfill for React's upcoming useEffectEvent hook.
 *
 * This hook returns a stable callback reference that always calls the latest
 * version of the provided callback. This is useful for event handlers in
 * effects where you want to avoid recreating the effect when the callback
 * changes, but still want to call the latest version.
 *
 * @example
 * ```tsx
 * const onData = useEvent((data) => {
 *   // This always calls the latest version of the callback
 *   props.onData?.(data)
 * })
 *
 * useEffect(() => {
 *   // onData is stable, so this effect doesn't re-run when props.onData changes
 *   subscribe(onData)
 *   return () => unsubscribe(onData)
 * }, [onData]) // onData is stable
 * ```
 *
 * @param callback - The callback function (can be undefined)
 * @returns A stable callback that always calls the latest version
 *
 * @internal
 */
export function useEvent<T extends (...args: any[]) => any>(
  callback: T | undefined,
): (...args: Parameters<T>) => ReturnType<T> | undefined {
  const ref = React.useRef(callback)

  useIsomorphicLayoutEffect(() => {
    ref.current = callback
  })

  return React.useCallback((...args: Parameters<T>) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return ref.current?.(...args)
  }, [])
}
