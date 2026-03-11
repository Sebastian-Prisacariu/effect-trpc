/**
 * Router - Compose procedures into a typed API
 * 
 * @since 1.0.0
 * @module
 */

import type * as Procedure from "../Procedure/index.js"

// =============================================================================
// Types
// =============================================================================

/**
 * A record of procedures or nested routers
 * 
 * @since 1.0.0
 * @category models
 */
export interface Definition {
  readonly [key: string]: Procedure.AnyDef | Definition
}

/**
 * Router instance
 * 
 * @since 1.0.0
 * @category models
 */
export interface Router<D extends Definition> {
  readonly _tag: "Router"
  readonly definition: D
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
 * const UserRouter = Router.make({
 *   list: Procedure.query({
 *     success: Schema.Array(User),
 *     handler: () => UserService.findAll()
 *   }),
 *   byId: Procedure.query({
 *     payload: Schema.Struct({ id: Schema.String }),
 *     success: User,
 *     handler: ({ id }) => UserService.findById(id)
 *   }),
 * })
 * ```
 */
export const make = <D extends Definition>(definition: D): Router<D> => ({
  _tag: "Router",
  definition,
})

/**
 * Merge multiple routers into one
 * 
 * @since 1.0.0
 * @category combinators
 */
export const merge = <Routers extends ReadonlyArray<Router<any>>>(
  ...routers: Routers
): Router<MergeDefinitions<Routers>> => {
  const merged = routers.reduce(
    (acc, router) => ({ ...acc, ...router.definition }),
    {} as any
  )
  return make(merged)
}

type MergeDefinitions<R extends ReadonlyArray<Router<any>>> = UnionToIntersection<
  R[number]["definition"]
>

type UnionToIntersection<U> = (
  U extends any ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get all procedure paths from a router
 * 
 * @since 1.0.0
 * @category utilities
 */
export const paths = <D extends Definition>(router: Router<D>): ReadonlyArray<string> => {
  const result: string[] = []

  const walk = (def: Definition, prefix: string) => {
    for (const key of Object.keys(def)) {
      const value = def[key]
      const path = prefix ? `${prefix}.${key}` : key

      if (isProcedure(value)) {
        result.push(path)
      } else {
        walk(value as Definition, path)
      }
    }
  }

  walk(router.definition, "")
  return result
}

/**
 * Get a procedure by path
 * 
 * @since 1.0.0
 * @category utilities
 */
export const get = <D extends Definition>(
  router: Router<D>,
  path: string
): Procedure.AnyDef | undefined => {
  const parts = path.split(".")
  let current: any = router.definition

  for (const part of parts) {
    if (current === undefined) return undefined
    current = current[part]
  }

  return isProcedure(current) ? current : undefined
}

const isProcedure = (value: unknown): value is Procedure.AnyDef =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value._tag === "Query" || value._tag === "Mutation" || value._tag === "Stream")
