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
 * A record of procedures, families, or nested routers
 * 
 * @since 1.0.0
 * @category models
 */
export type Definition = {
  readonly [key: string]: 
    | Procedure.AnyDef 
    | Procedure.Family<string, any>
    | Definition
}

/**
 * Flatten a definition (resolve families to their procedures)
 */
export type FlattenDefinition<D extends Definition> = {
  readonly [K in keyof D]: D[K] extends Procedure.Family<string, infer P>
    ? P
    : D[K] extends Procedure.AnyDef
      ? D[K]
      : D[K] extends Definition
        ? FlattenDefinition<D[K]>
        : never
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
  readonly flattened: FlattenDefinition<D>
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
 * const UserProcedures = Procedure.family("user", {
 *   list: Procedure.query({ ... }),
 * })
 * 
 * const AppRouter = Router.make({
 *   user: UserProcedures,
 *   post: PostProcedures,
 * })
 * ```
 */
export const make = <D extends Definition>(definition: D): Router<D> => {
  const flattened = flattenDefinition(definition)
  return {
    _tag: "Router",
    definition,
    flattened: flattened as FlattenDefinition<D>,
  }
}

const flattenDefinition = (def: Definition): any => {
  const result: Record<string, any> = {}
  
  for (const key of Object.keys(def)) {
    const value = def[key]
    
    if (isFamily(value)) {
      // Family: use its procedures directly
      result[key] = value.procedures
    } else if (isProcedure(value)) {
      // Procedure: use as-is
      result[key] = value
    } else {
      // Nested definition: recurse
      result[key] = flattenDefinition(value as Definition)
    }
  }
  
  return result
}

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

  const walk = (def: any, prefix: string) => {
    for (const key of Object.keys(def)) {
      const value = def[key]
      const path = prefix ? `${prefix}.${key}` : key

      if (isProcedure(value)) {
        result.push(path)
      } else if (typeof value === "object" && value !== null) {
        walk(value, path)
      }
    }
  }

  walk(router.flattened, "")
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
  let current: any = router.flattened

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

const isFamily = (value: unknown): value is Procedure.Family<string, any> =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "Family"
