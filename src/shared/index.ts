/**
 * @module effect-trpc/shared
 * 
 * Re-export Effect RPC types for convenience.
 * The shared layer is just Effect RPC — no wrapper needed.
 */

// Re-export from @effect/rpc
export { Rpc, RpcGroup } from "@effect/rpc"

// Re-export Schema for convenience
export { Schema } from "effect"

/**
 * Metadata for cache invalidation.
 * 
 * Define which queries a mutation invalidates:
 * 
 * @example
 * ```ts
 * const invalidationRules: InvalidationRules<typeof UserRpcs> = {
 *   create: ["list"],
 *   update: ["list", "byId"],
 *   delete: ["list", "byId"],
 * }
 * ```
 */
export type InvalidationRules<TGroup> = TGroup extends { _tag: string }
  ? Partial<Record<string, ReadonlyArray<string>>>
  : never
