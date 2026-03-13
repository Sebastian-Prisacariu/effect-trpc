/**
 * Optimistic Updates - Instant UI feedback with automatic rollback
 * 
 * Optimistic updates show the expected result immediately while the
 * mutation runs in the background. On failure, automatically rolls back.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Optimistic, Client } from "effect-trpc"
 * 
 * // Define optimistic update
 * const createUser = api.users.create.useOptimisticMutation({
 *   // Optimistically update the list
 *   optimisticUpdate: (cache, input) => ({
 *     "users.list": [...cache["users.list"], { 
 *       id: "temp-id", 
 *       ...input 
 *     }],
 *   }),
 *   
 *   // On success, replace temp with real data
 *   onSuccess: (result, cache) => ({
 *     "users.list": cache["users.list"].map(u => 
 *       u.id === "temp-id" ? result : u
 *     ),
 *   }),
 *   
 *   // On error, rollback happens automatically
 * })
 * 
 * // Usage
 * createUser.mutate({ name: "Alice", email: "alice@example.com" })
 * ```
 */

import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Option from "effect/Option"
import { pipe } from "effect/Function"

// =============================================================================
// Types
// =============================================================================

/**
 * Cache snapshot type - maps query paths to their data
 * 
 * @since 1.0.0
 * @category models
 */
export type CacheSnapshot = Record<string, unknown>

/**
 * Optimistic update configuration
 * 
 * @since 1.0.0
 * @category models
 */
export interface OptimisticConfig<Input, Success> {
  /**
   * Compute the optimistic cache update.
   * Called immediately when mutation is triggered.
   * 
   * @param cache Current cache snapshot
   * @param input Mutation input
   * @returns Updated cache entries
   */
  readonly optimisticUpdate: (
    cache: CacheSnapshot,
    input: Input
  ) => CacheSnapshot
  
  /**
   * Compute final cache update on success.
   * If not provided, invalidation handles cache refresh.
   * 
   * @param result Mutation result
   * @param cache Current cache (with optimistic update applied)
   * @param input Original mutation input
   * @returns Final cache entries
   */
  readonly onSuccess?: (
    result: Success,
    cache: CacheSnapshot,
    input: Input
  ) => CacheSnapshot
  
  /**
   * Called on mutation error (after rollback).
   * Useful for showing error toasts.
   * 
   * @param error The error that occurred
   * @param input Original mutation input
   */
  readonly onError?: (error: unknown, input: Input) => void
  
  /**
   * Called after mutation settles (success or error).
   */
  readonly onSettled?: () => void
}

/**
 * Optimistic mutation state
 * 
 * @since 1.0.0
 * @category models
 */
export interface OptimisticState<Success, Error> {
  readonly isOptimistic: boolean
  readonly isPending: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
}

// =============================================================================
// Core Implementation
// =============================================================================

/**
 * Create an optimistic mutation effect.
 * 
 * This wraps a mutation with optimistic update logic:
 * 1. Immediately apply optimistic update
 * 2. Run the actual mutation
 * 3. On success: apply onSuccess update (or let invalidation refresh)
 * 4. On error: rollback to previous cache state
 * 
 * @since 1.0.0
 * @category constructors
 */
export const createOptimisticMutation = <Input, Success, Error>(
  mutation: (input: Input) => Effect.Effect<Success, Error>,
  config: OptimisticConfig<Input, Success>,
  cacheRef: Ref.Ref<CacheSnapshot>
): (input: Input) => Effect.Effect<Success, Error> => {
  return (input: Input) =>
    Effect.gen(function* () {
      // 1. Capture previous cache state
      const previousCache = yield* Ref.get(cacheRef)
      
      // 2. Apply optimistic update immediately
      const optimisticCache = config.optimisticUpdate(previousCache, input)
      yield* Ref.set(cacheRef, optimisticCache)
      
      // 3. Run the actual mutation
      const result = yield* mutation(input).pipe(
        Effect.tapError(() =>
          // 4a. On error: rollback to previous state
          Ref.set(cacheRef, previousCache).pipe(
            Effect.tap(() =>
              config.onError
                ? Effect.sync(() => config.onError!(undefined, input))
                : Effect.void
            )
          )
        ),
        Effect.tap((success) =>
          // 4b. On success: apply onSuccess update if provided
          config.onSuccess
            ? Ref.get(cacheRef).pipe(
                Effect.flatMap((currentCache) => {
                  const finalCache = config.onSuccess!(success, currentCache, input)
                  return Ref.set(cacheRef, finalCache)
                })
              )
            : Effect.void
        ),
        Effect.ensuring(
          config.onSettled 
            ? Effect.sync(() => config.onSettled!())
            : Effect.void
        )
      )
      
      return result
    })
}

// =============================================================================
// React Integration Types
// =============================================================================

/**
 * Options for useOptimisticMutation hook
 * 
 * @since 1.0.0
 * @category react
 */
export interface UseOptimisticMutationOptions<Input, Success, Error> 
  extends OptimisticConfig<Input, Success> {
  /**
   * Paths to invalidate on success (in addition to procedure's invalidates)
   */
  readonly invalidate?: readonly string[]
}

/**
 * Return type for useOptimisticMutation hook
 * 
 * @since 1.0.0
 * @category react
 */
export interface UseOptimisticMutationResult<Input, Success, Error> {
  readonly mutate: (input: Input) => void
  readonly mutateAsync: (input: Input) => Promise<Success>
  readonly isOptimistic: boolean
  readonly isPending: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly reset: () => void
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Helper to create a list updater for optimistic updates.
 * Commonly used for adding/removing items from a list.
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * const config = {
 *   optimisticUpdate: Optimistic.listUpdater(
 *     "users.list",
 *     (list, input) => [...list, { id: "temp", ...input }]
 *   ),
 * }
 * ```
 */
export const listUpdater = <Item, Input>(
  path: string,
  updater: (list: readonly Item[], input: Input) => readonly Item[]
) => (cache: CacheSnapshot, input: Input): CacheSnapshot => ({
  ...cache,
  [path]: updater((cache[path] as readonly Item[]) ?? [], input),
})

/**
 * Helper to create a replace updater for single items.
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * const config = {
 *   optimisticUpdate: Optimistic.replaceUpdater(
 *     "users.current",
 *     (current, input) => ({ ...current, ...input })
 *   ),
 * }
 * ```
 */
export const replaceUpdater = <Item, Input>(
  path: string,
  updater: (current: Item | undefined, input: Input) => Item
) => (cache: CacheSnapshot, input: Input): CacheSnapshot => ({
  ...cache,
  [path]: updater(cache[path] as Item | undefined, input),
})

/**
 * Helper to remove an item from a list by predicate.
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * // For delete mutation
 * const config = {
 *   optimisticUpdate: Optimistic.removeFromList(
 *     "users.list",
 *     (user, input) => user.id === input.id
 *   ),
 * }
 * ```
 */
export const removeFromList = <Item, Input>(
  path: string,
  predicate: (item: Item, input: Input) => boolean
) => (cache: CacheSnapshot, input: Input): CacheSnapshot => ({
  ...cache,
  [path]: ((cache[path] as readonly Item[]) ?? []).filter(
    item => !predicate(item, input)
  ),
})

/**
 * Helper to update an item in a list by predicate.
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * // For update mutation
 * const config = {
 *   optimisticUpdate: Optimistic.updateInList(
 *     "users.list",
 *     (user, input) => user.id === input.id,
 *     (user, input) => ({ ...user, ...input })
 *   ),
 * }
 * ```
 */
export const updateInList = <Item, Input>(
  path: string,
  predicate: (item: Item, input: Input) => boolean,
  updater: (item: Item, input: Input) => Item
) => (cache: CacheSnapshot, input: Input): CacheSnapshot => ({
  ...cache,
  [path]: ((cache[path] as readonly Item[]) ?? []).map(
    item => predicate(item, input) ? updater(item, input) : item
  ),
})
