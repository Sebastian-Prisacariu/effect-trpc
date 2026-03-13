/**
 * Reactivity - Cache invalidation and refetch coordination
 * 
 * Re-exports @effect/experimental/Reactivity with additional utilities
 * for path-based invalidation in effect-trpc.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Reactivity } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * // Invalidate tags after a mutation
 * yield* Reactivity.invalidate(["users", "users/list"])
 * 
 * // Use mutation helper (invalidates after success)
 * const result = yield* Reactivity.mutation(
 *   ["users"],  // keys to invalidate
 *   createUserEffect
 * )
 * ```
 */

// Re-export everything from @effect/experimental/Reactivity
export * from "@effect/experimental/Reactivity"
export { Reactivity as ReactivityService } from "@effect/experimental/Reactivity"

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Convert paths to tags using a router's tag prefix
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * const tags = pathsToTags("@api", ["users", "users.list"])
 * // ["users", "users/list"]
 * ```
 */
export const pathsToTags = (
  _rootTag: string,
  paths: ReadonlyArray<string>
): ReadonlyArray<string> =>
  paths.map((path) => path.replace(/\./g, "/"))

/**
 * Check if a tag should be invalidated by another tag
 * 
 * @since 1.0.0
 * @category utilities
 */
export const shouldInvalidate = (
  subscribedTag: string,
  invalidatedTag: string
): boolean => {
  // Exact match
  if (subscribedTag === invalidatedTag) return true
  
  // Hierarchical: invalidating parent invalidates children
  if (subscribedTag.startsWith(invalidatedTag + "/")) return true
  
  // Reverse: invalidating child triggers parent (if subscribed to parent)
  if (invalidatedTag.startsWith(subscribedTag + "/")) return true
  
  return false
}
