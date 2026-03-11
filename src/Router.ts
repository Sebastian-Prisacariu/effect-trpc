/**
 * Router module - Compose procedures into a typed API
 * 
 * @since 1.0.0
 */

import type { AnyDefinition } from "./Procedure.js"

// =============================================================================
// Router Types
// =============================================================================

/**
 * Router definition - a record of procedures or nested routers
 * 
 * @since 1.0.0
 * @category models
 */
export interface RouterDefinition {
  readonly [key: string]: AnyDefinition | RouterDefinition
}

/**
 * Infer requirements from a router
 * 
 * @since 1.0.0
 * @category type-level
 */
export type RouterRequirements<R extends RouterDefinition> = {
  [K in keyof R]: R[K] extends AnyDefinition
    ? R[K] extends { readonly handler: (payload: any) => infer E }
      ? E extends { [Symbol.iterator]: any }
        ? never // Stream - handled differently
        : E extends { readonly [key: string]: any }
          ? E extends { readonly _tag: string }
            ? never
            : never // Effect - extract R
          : never
      : never
    : R[K] extends RouterDefinition
      ? RouterRequirements<R[K]>
      : never
}[keyof R]

/**
 * Router instance
 * 
 * @since 1.0.0
 * @category models
 */
export interface Router<
  Definition extends RouterDefinition,
  Requirements
> {
  readonly _tag: "Router"
  readonly definition: Definition
  readonly _Requirements: Requirements
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a router from procedure definitions
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Router, Procedure } from "effect-trpc"
 * 
 * // Flat router
 * const UserRouter = Router.make({
 *   list: Procedure.query({
 *     success: Schema.Array(User),
 *     handler: () => UserService.findAll()
 *   }),
 *   byId: Procedure.query({
 *     payload: Schema.Struct({ id: Schema.String }),
 *     success: User,
 *     error: UserNotFound,
 *     handler: ({ id }) => UserService.findById(id)
 *   }),
 * })
 * 
 * // Nested router
 * const AppRouter = Router.make({
 *   user: UserRouter,
 *   post: PostRouter,
 * })
 * ```
 */
export const make = <Definition extends RouterDefinition>(
  definition: Definition
): Router<Definition, unknown> => {
  return {
    _tag: "Router",
    definition,
    _Requirements: undefined as unknown,
  }
}

/**
 * Merge multiple routers
 * 
 * @since 1.0.0
 * @category combinators
 * @example
 * ```ts
 * import { Router } from "effect-trpc"
 * 
 * const AppRouter = Router.merge(
 *   UserRouter,
 *   PostRouter,
 *   CommentRouter,
 * )
 * ```
 */
export const merge = <
  Routers extends ReadonlyArray<Router<any, any>>
>(
  ...routers: Routers
): Router<
  UnionToIntersection<Routers[number]["definition"]>,
  Routers[number]["_Requirements"]
> => {
  const merged = routers.reduce(
    (acc, router) => ({ ...acc, ...router.definition }),
    {} as any
  )
  return make(merged) as any
}

// Helper type
type UnionToIntersection<U> = (
  U extends any ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get all procedure paths from a router (for invalidation)
 * 
 * @since 1.0.0
 * @category utilities
 */
export const paths = <R extends RouterDefinition>(
  router: Router<R, any>
): ReadonlyArray<string> => {
  const result: string[] = []
  
  const walk = (def: RouterDefinition, prefix: string) => {
    for (const key of Object.keys(def)) {
      const value = def[key]
      const path = prefix ? `${prefix}.${key}` : key
      
      if ("_tag" in value && typeof value._tag === "string") {
        // It's a procedure
        result.push(path)
      } else {
        // It's a nested router
        walk(value as RouterDefinition, path)
      }
    }
  }
  
  walk(router.definition, "")
  return result
}
