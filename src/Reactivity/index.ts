/**
 * Reactivity - Cache invalidation and refetch coordination
 * 
 * Manages subscriptions to query tags and triggers refetches when
 * mutations invalidate those tags.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Reactivity } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * // Get the service
 * const reactivity = yield* Reactivity.Reactivity
 * 
 * // Subscribe to invalidation (returns unsubscribe function)
 * const unsubscribe = reactivity.subscribe("@api/users/list", () => {
 *   console.log("users.list was invalidated!")
 *   // Trigger refetch...
 * })
 * 
 * // Invalidate tags (usually called after mutation)
 * reactivity.invalidate(["@api/users", "@api/users/list"])
 * 
 * // Cleanup
 * unsubscribe()
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const ReactivityTypeId: unique symbol = Symbol.for("effect-trpc/Reactivity")

/** @internal */
export type ReactivityTypeId = typeof ReactivityTypeId

// =============================================================================
// Reactivity Service
// =============================================================================

/**
 * Callback invoked when a tag is invalidated
 * 
 * @since 1.0.0
 * @category models
 */
export type InvalidationCallback = () => void

/**
 * Reactivity service for managing cache invalidation
 * 
 * @since 1.0.0
 * @category models
 */
export interface ReactivityService {
  /**
   * Subscribe to invalidation events for a tag.
   * Returns an unsubscribe function.
   * 
   * @example
   * ```ts
   * const unsub = reactivity.subscribe("@api/users/list", () => refetch())
   * // Later...
   * unsub()
   * ```
   */
  readonly subscribe: (
    tag: string,
    callback: InvalidationCallback
  ) => () => void
  
  /**
   * Invalidate tags, triggering all subscribed callbacks.
   * Supports hierarchical invalidation (invalidating "@api/users" 
   * also invalidates "@api/users/list").
   * 
   * @example
   * ```ts
   * // Invalidate specific tags
   * reactivity.invalidate(["@api/users/list", "@api/users/get"])
   * 
   * // Invalidate all users queries
   * reactivity.invalidate(["@api/users"])
   * ```
   */
  readonly invalidate: (tags: ReadonlyArray<string>) => void
  
  /**
   * Get all currently subscribed tags (for debugging)
   * 
   * @since 1.0.0
   */
  readonly getSubscribedTags: () => ReadonlyArray<string>
}

/**
 * Reactivity service tag
 * 
 * @since 1.0.0
 * @category context
 */
export class Reactivity extends Context.Tag("@effect-trpc/Reactivity")<
  Reactivity,
  ReactivityService
>() {}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a ReactivityService implementation
 * 
 * @since 1.0.0
 * @category constructors
 */
export const make = (): ReactivityService => {
  // Map of tag → Set of callbacks
  const subscriptions = new Map<string, Set<InvalidationCallback>>()
  
  // Generate unique subscription IDs
  let nextId = 0
  const callbackIds = new WeakMap<InvalidationCallback, number>()
  
  const subscribe = (tag: string, callback: InvalidationCallback): (() => void) => {
    // Get or create the set for this tag
    let callbacks = subscriptions.get(tag)
    if (!callbacks) {
      callbacks = new Set()
      subscriptions.set(tag, callbacks)
    }
    
    // Assign ID for debugging
    callbackIds.set(callback, nextId++)
    callbacks.add(callback)
    
    // Return unsubscribe function
    return () => {
      const set = subscriptions.get(tag)
      if (set) {
        set.delete(callback)
        if (set.size === 0) {
          subscriptions.delete(tag)
        }
      }
    }
  }
  
  const invalidate = (tags: ReadonlyArray<string>): void => {
    const callbacksToInvoke = new Set<InvalidationCallback>()
    
    // For each tag to invalidate
    for (const tag of tags) {
      // Find all subscribed tags that match (exact or hierarchical)
      for (const [subscribedTag, callbacks] of subscriptions) {
        // Exact match
        if (subscribedTag === tag) {
          for (const cb of callbacks) {
            callbacksToInvoke.add(cb)
          }
        }
        // Hierarchical: invalidating "@api/users" should invalidate "@api/users/list"
        else if (subscribedTag.startsWith(tag + "/")) {
          for (const cb of callbacks) {
            callbacksToInvoke.add(cb)
          }
        }
        // Reverse hierarchical: invalidating "@api/users/list" should also match
        // if someone subscribed to "@api/users" (parent watches children)
        else if (tag.startsWith(subscribedTag + "/")) {
          for (const cb of callbacks) {
            callbacksToInvoke.add(cb)
          }
        }
      }
    }
    
    // Invoke all unique callbacks
    for (const callback of callbacksToInvoke) {
      try {
        callback()
      } catch (error) {
        // Don't let one callback error stop others
        console.error("[Reactivity] Callback error:", error)
      }
    }
  }
  
  const getSubscribedTags = (): ReadonlyArray<string> => {
    return Array.from(subscriptions.keys())
  }
  
  return {
    subscribe,
    invalidate,
    getSubscribedTags,
  }
}

// =============================================================================
// Layer
// =============================================================================

/**
 * Live implementation of Reactivity
 * 
 * @since 1.0.0
 * @category layers
 */
export const ReactivityLive: Layer.Layer<Reactivity> = 
  Layer.sync(Reactivity, make)

// =============================================================================
// Effect-based API
// =============================================================================

/**
 * Subscribe to invalidation events (Effect-based)
 * 
 * Returns an Effect that yields the unsubscribe function.
 * 
 * @since 1.0.0
 * @category effects
 */
export const subscribe = (
  tag: string,
  callback: InvalidationCallback
): Effect.Effect<() => void, never, Reactivity> =>
  Effect.map(Reactivity, (r) => r.subscribe(tag, callback))

/**
 * Invalidate tags (Effect-based)
 * 
 * @since 1.0.0
 * @category effects
 */
export const invalidate = (
  tags: ReadonlyArray<string>
): Effect.Effect<void, never, Reactivity> =>
  Effect.map(Reactivity, (r) => r.invalidate(tags))

/**
 * Get all subscribed tags (Effect-based)
 * 
 * @since 1.0.0
 * @category effects
 */
export const getSubscribedTags: Effect.Effect<ReadonlyArray<string>, never, Reactivity> =
  Effect.map(Reactivity, (r) => r.getSubscribedTags())

// =============================================================================
// Utilities
// =============================================================================

/**
 * Convert paths to tags using a router's tag prefix
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * const tags = pathsToTags("@api", ["users", "users.list"])
 * // ["@api/users", "@api/users/list"]
 * ```
 */
export const pathsToTags = (
  rootTag: string,
  paths: ReadonlyArray<string>
): ReadonlyArray<string> =>
  paths.map((path) => `${rootTag}/${path.replace(/\./g, "/")}`)

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
