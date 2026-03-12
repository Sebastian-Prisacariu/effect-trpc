/**
 * Router - Compose procedures into a typed API
 * 
 * Router.make creates the root router with a tag. All procedure tags are
 * auto-derived from the root tag plus the path to the procedure.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Procedure, Router } from "effect-trpc"
 * import { Schema } from "effect"
 * 
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: Procedure.query({ success: Schema.Array(User) }),
 *     get: Procedure.query({ 
 *       payload: Schema.Struct({ id: Schema.String }), 
 *       success: User 
 *     }),
 *     create: Procedure.mutation({
 *       payload: CreateUserInput,
 *       success: User,
 *       invalidates: ["users"],
 *     }),
 *   },
 *   health: Procedure.query({ success: Schema.String }),
 * })
 * 
 * // Auto-derived tags:
 * // "users.list" → "@api/users/list"
 * // "users.get" → "@api/users/get"
 * // "users.create" → "@api/users/create"
 * // "health" → "@api/health"
 * ```
 */

import * as Rpc from "@effect/rpc/Rpc"
import * as RpcRouter from "@effect/rpc/RpcRouter"
import * as Schema from "effect/Schema"
import { Pipeable, pipeArguments } from "effect/Pipeable"
import * as Procedure from "../Procedure/index.js"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const RouterTypeId: unique symbol = Symbol.for("effect-trpc/Router")

/** @internal */
export type RouterTypeId = typeof RouterTypeId

// =============================================================================
// Models
// =============================================================================

/**
 * A definition is a record of procedures or nested definitions
 * 
 * @since 1.0.0
 * @category models
 */
export type Definition = {
  readonly [key: string]: Procedure.Any | Definition
}

/**
 * Internal representation of a tagged procedure
 * 
 * @since 1.0.0
 * @category models
 */
export interface TaggedProcedure {
  readonly path: string
  readonly tag: string
  readonly procedure: Procedure.Any
  readonly rpc: Rpc.Rpc<any, any, any, any, any>
}

/**
 * Path to tag mapping for lookups
 * 
 * @since 1.0.0
 * @category models
 */
export interface PathMap {
  /**
   * Map from path to tag
   */
  readonly pathToTag: ReadonlyMap<string, string>
  
  /**
   * Map from tag to path
   */
  readonly tagToPath: ReadonlyMap<string, string>
  
  /**
   * Map from path to tagged procedure
   */
  readonly procedures: ReadonlyMap<string, TaggedProcedure>
  
  /**
   * Get all paths that start with a prefix (for hierarchical invalidation)
   */
  readonly getChildPaths: (prefix: string) => ReadonlyArray<string>
  
  /**
   * Get all tags that start with a prefix (for hierarchical invalidation)
   */
  readonly getChildTags: (prefix: string) => ReadonlyArray<string>
}

/**
 * A Router containing procedures with auto-derived tags
 * 
 * @since 1.0.0
 * @category models
 */
export interface Router<D extends Definition> extends Pipeable {
  readonly [RouterTypeId]: RouterTypeId
  
  /**
   * The root tag for this router
   */
  readonly tag: string
  
  /**
   * The original definition
   */
  readonly definition: D
  
  /**
   * Path/tag mappings for lookups
   */
  readonly pathMap: PathMap
  
  /**
   * All tagged procedures
   */
  readonly procedures: ReadonlyArray<TaggedProcedure>
  
  /**
   * The Effect RPC router (for server use)
   */
  readonly rpcRouter: RpcRouter.RpcRouter<any, any>
}

// =============================================================================
// Constructors
// =============================================================================

const RouterProto = {
  [RouterTypeId]: RouterTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * Create a router from a definition
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Router, Procedure } from "effect-trpc"
 * 
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: Procedure.query({ success: Schema.Array(User) }),
 *   },
 *   health: Procedure.query({ success: Schema.String }),
 * })
 * ```
 */
export const make = <D extends Definition>(
  tag: string,
  definition: D
): Router<D> => {
  const procedures: TaggedProcedure[] = []
  const pathToTag = new Map<string, string>()
  const tagToPath = new Map<string, string>()
  const proceduresByPath = new Map<string, TaggedProcedure>()
  
  // Walk the definition tree and build tagged procedures
  const walk = (def: Definition, pathPrefix: string, tagPrefix: string): void => {
    for (const key of Object.keys(def)) {
      const value = def[key]
      const path = pathPrefix ? `${pathPrefix}.${key}` : key
      const procedureTag = `${tagPrefix}/${key}`
      
      if (Procedure.isProcedure(value)) {
        // Create the Effect RPC
        const rpc = createRpc(procedureTag, value)
        
        const tagged: TaggedProcedure = {
          path,
          tag: procedureTag,
          procedure: value,
          rpc,
        }
        
        procedures.push(tagged)
        pathToTag.set(path, procedureTag)
        tagToPath.set(procedureTag, path)
        proceduresByPath.set(path, tagged)
      } else {
        // It's a nested definition, recurse
        // Also register the path prefix for hierarchical invalidation
        pathToTag.set(path, procedureTag)
        tagToPath.set(procedureTag, path)
        
        walk(value, path, procedureTag)
      }
    }
  }
  
  walk(definition, "", tag)
  
  // Build the path map
  const pathMap: PathMap = {
    pathToTag,
    tagToPath,
    procedures: proceduresByPath,
    
    getChildPaths: (prefix: string): ReadonlyArray<string> => {
      const result: string[] = []
      for (const path of pathToTag.keys()) {
        if (path === prefix || path.startsWith(`${prefix}.`)) {
          result.push(path)
        }
      }
      return result
    },
    
    getChildTags: (prefix: string): ReadonlyArray<string> => {
      const paths = pathMap.getChildPaths(prefix)
      return paths.map((p) => pathToTag.get(p)!).filter(Boolean)
    },
  }
  
  // Build the Effect RPC router
  const rpcs = procedures.map((p) => p.rpc)
  const rpcRouter = RpcRouter.make(...rpcs)
  
  const self = Object.create(RouterProto)
  self.tag = tag
  self.definition = definition
  self.pathMap = pathMap
  self.procedures = procedures
  self.rpcRouter = rpcRouter
  
  return self
}

/**
 * Create an Effect RPC from a Procedure
 * @internal
 */
const createRpc = (tag: string, procedure: Procedure.Any): Rpc.Rpc<any, any, any, any, any> => {
  if (Procedure.isQuery(procedure) || Procedure.isMutation(procedure)) {
    return Rpc.make(tag, {
      payload: procedure.payloadSchema,
      success: procedure.successSchema,
      error: procedure.errorSchema,
    })
  } else {
    // Stream
    return Rpc.make(tag, {
      payload: procedure.payloadSchema,
      success: procedure.successSchema,
      error: procedure.errorSchema,
      stream: true,
    })
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get all procedure paths from a router
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * const paths = Router.paths(appRouter)
 * // ["users.list", "users.get", "users.create", "health"]
 * ```
 */
export const paths = <D extends Definition>(router: Router<D>): ReadonlyArray<string> =>
  router.procedures.map((p) => p.path)

/**
 * Get a tagged procedure by path
 * 
 * @since 1.0.0
 * @category utilities
 */
export const get = <D extends Definition>(
  router: Router<D>,
  path: string
): TaggedProcedure | undefined =>
  router.pathMap.procedures.get(path)

/**
 * Get the tag for a path
 * 
 * @since 1.0.0
 * @category utilities
 */
export const tagOf = <D extends Definition>(
  router: Router<D>,
  path: string
): string | undefined =>
  router.pathMap.pathToTag.get(path)

/**
 * Get the path for a tag
 * 
 * @since 1.0.0
 * @category utilities
 */
export const pathOf = <D extends Definition>(
  router: Router<D>,
  tag: string
): string | undefined =>
  router.pathMap.tagToPath.get(tag)

/**
 * Get all tags to invalidate for a path (including children)
 * 
 * @since 1.0.0
 * @category utilities
 * @example
 * ```ts
 * // Invalidate all user-related queries
 * const tags = Router.tagsToInvalidate(appRouter, "users")
 * // ["@api/users", "@api/users/list", "@api/users/get", "@api/users/create"]
 * ```
 */
export const tagsToInvalidate = <D extends Definition>(
  router: Router<D>,
  path: string
): ReadonlyArray<string> =>
  router.pathMap.getChildTags(path)

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Extract all paths from a definition type
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Paths<D extends Definition, Prefix extends string = ""> = {
  [K in keyof D & string]: D[K] extends Procedure.Any
    ? Prefix extends "" ? K : `${Prefix}.${K}`
    : D[K] extends Definition
      ? Paths<D[K], Prefix extends "" ? K : `${Prefix}.${K}`>
      : never
}[keyof D & string]

/**
 * Get the procedure at a specific path
 * 
 * @since 1.0.0
 * @category type-level
 */
export type ProcedureAt<D extends Definition, Path extends string> = 
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof D
      ? D[Head] extends Definition
        ? ProcedureAt<D[Head], Tail>
        : never
      : never
    : Path extends keyof D
      ? D[Path] extends Procedure.Any
        ? D[Path]
        : never
      : never

/**
 * Flatten a definition to a record of path → procedure
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Flatten<D extends Definition, Prefix extends string = ""> = {
  [K in keyof D & string as D[K] extends Procedure.Any 
    ? (Prefix extends "" ? K : `${Prefix}.${K}`)
    : never
  ]: D[K]
} & {
  [K in keyof D & string as D[K] extends Definition ? never : never]: never
} & UnionToIntersection<{
  [K in keyof D & string]: D[K] extends Definition
    ? Flatten<D[K], Prefix extends "" ? K : `${Prefix}.${K}`>
    : {}
}[keyof D & string]>

type UnionToIntersection<U> = (
  U extends any ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never
