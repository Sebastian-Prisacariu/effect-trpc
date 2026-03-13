/**
 * Reactivity - Path-based cache invalidation
 * 
 * Wraps @effect/experimental/Reactivity with hierarchical path semantics.
 * Invalidating "users" will invalidate "users/list", "users/get", etc.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Reactivity } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * // Register a query path (scoped - auto-unregisters)
 * yield* Reactivity.PathReactivity.pipe(
 *   Effect.flatMap(r => r.register("users.list"))
 * )
 * 
 * // Invalidate - will invalidate all children of "users"
 * yield* Reactivity.invalidate(["users"])
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as RcMap from "effect/RcMap"
import * as Ref from "effect/Ref"
import * as HashSet from "effect/HashSet"
import { pipe } from "effect/Function"

// Re-export inner Reactivity for direct access if needed
import * as InnerReactivity from "@effect/experimental/Reactivity"
export { InnerReactivity }

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Normalize a path from dot-separated to slash-separated
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * normalizePath("users.list") // "users/list"
 * normalizePath("users")      // "users"
 * ```
 */
export const normalizePath = (path: string): string =>
  path.replace(/\./g, "/")

/**
 * Check if a registered path should be invalidated by an invalidation path.
 * A path is invalidated if it equals or is a descendant of the invalidation path.
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * shouldInvalidate("users/list", "users")     // true (child of users)
 * shouldInvalidate("users", "users")          // true (exact match)
 * shouldInvalidate("posts/list", "users")     // false (different tree)
 * ```
 */
export const shouldInvalidate = (
  registeredPath: string,
  invalidationPath: string
): boolean => {
  // Exact match
  if (registeredPath === invalidationPath) return true
  
  // Registered path is a descendant of invalidation path
  if (registeredPath.startsWith(invalidationPath + "/")) return true
  
  return false
}

// =============================================================================
// PathReactivity Service
// =============================================================================

/**
 * PathReactivity service shape.
 * Provides hierarchical path-based cache invalidation.
 * 
 * @since 1.0.0
 * @category models
 */
export interface PathReactivityService {
  /**
   * Register a path for invalidation tracking.
   * Returns a scoped resource - automatically unregisters when scope closes.
   * 
   * Multiple registrations of the same path are reference-counted.
   */
  readonly register: (path: string) => Effect.Effect<string, never, Scope.Scope>
  
  /**
   * Invalidate paths with hierarchy expansion.
   * Invalidating "users" will invalidate all registered descendants:
   * "users/list", "users/get", "users/permissions/edit", etc.
   */
  readonly invalidate: (paths: ReadonlyArray<string>) => Effect.Effect<void>
  
  /**
   * Get all currently registered paths.
   * Useful for debugging.
   */
  readonly getRegisteredPaths: () => Effect.Effect<ReadonlyArray<string>>
  
  /**
   * Direct access to inner @effect/experimental/Reactivity service.
   * For advanced use cases.
   */
  readonly inner: InnerReactivity.Reactivity.Service
}

/**
 * PathReactivity service tag.
 * 
 * @since 1.0.0
 * @category tags
 */
export class PathReactivity extends Context.Tag("@effect-trpc/PathReactivity")<
  PathReactivity,
  PathReactivityService
>() {}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a PathReactivity service.
 * 
 * @since 1.0.0
 * @category constructors
 */
export const make = Effect.gen(function* () {
  // Get inner Reactivity from @effect/experimental
  const inner = yield* InnerReactivity.Reactivity
  
  // Track all registered paths for hierarchy expansion
  // We need this because RcMap doesn't expose its keys directly in a sync way
  const registeredPathsRef = yield* Ref.make(HashSet.empty<string>())
  
  // RcMap for reference-counted path registration
  // lookup is called on first get, acquireRelease handles cleanup
  const pathRegistry = yield* RcMap.make({
    lookup: (path: string) => 
      Effect.acquireRelease(
        // Acquire: add to registered paths
        Ref.update(registeredPathsRef, HashSet.add(path)).pipe(
          Effect.as(path)
        ),
        // Release: remove from registered paths
        () => Ref.update(registeredPathsRef, HashSet.remove(path))
      ),
  })
  
  const service: PathReactivityService = {
    register: (path: string) => {
      const normalized = normalizePath(path)
      return RcMap.get(pathRegistry, normalized)
    },
    
    invalidate: (paths: ReadonlyArray<string>) => 
      Effect.gen(function* () {
        const registered = yield* Ref.get(registeredPathsRef)
        const toInvalidate: string[] = []
        
        for (const path of paths) {
          const normalized = normalizePath(path)
          
          // Find all registered paths that should be invalidated
          for (const reg of registered) {
            if (shouldInvalidate(reg, normalized)) {
              toInvalidate.push(reg)
            }
          }
        }
        
        // Deduplicate and delegate to inner Reactivity
        if (toInvalidate.length > 0) {
          const unique = [...new Set(toInvalidate)]
          yield* inner.invalidate(unique)
        }
      }),
    
    getRegisteredPaths: () => 
      Ref.get(registeredPathsRef).pipe(
        Effect.map(set => [...set])
      ),
    
    inner,
  }
  
  return service
})

/**
 * Layer that provides PathReactivity service.
 * Includes @effect/experimental/Reactivity as a dependency.
 * 
 * @since 1.0.0
 * @category layers
 */
export const layer: Layer.Layer<PathReactivity> = Layer.scoped(
  PathReactivity,
  make
).pipe(Layer.provide(InnerReactivity.layer))

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Register a path for invalidation tracking.
 * Scoped - automatically unregisters when scope closes.
 * 
 * @since 1.0.0
 * @category functions
 */
export const register = (
  path: string
): Effect.Effect<string, never, PathReactivity | Scope.Scope> =>
  PathReactivity.pipe(
    Effect.flatMap(r => r.register(path))
  )

/**
 * Invalidate paths with hierarchy expansion.
 * 
 * @since 1.0.0
 * @category functions
 */
export const invalidate = (
  paths: ReadonlyArray<string>
): Effect.Effect<void, never, PathReactivity> =>
  PathReactivity.pipe(
    Effect.flatMap(r => r.invalidate(paths))
  )

/**
 * Get all currently registered paths.
 * 
 * @since 1.0.0
 * @category functions
 */
export const getRegisteredPaths = (): Effect.Effect<
  ReadonlyArray<string>,
  never,
  PathReactivity
> =>
  PathReactivity.pipe(
    Effect.flatMap(r => r.getRegisteredPaths())
  )
