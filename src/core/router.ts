/**
 * @module effect-trpc/core/router
 * 
 * Compose procedures groups into a router tree.
 */

import type { ProceduresGroup, ProcedureRecord } from "./procedures.js"
import type { ProcedureDefinition, InferInput, InferOutput, ProcedureType } from "./procedure.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A router entry can be a ProceduresGroup or a nested router.
 */
export type RouterEntry = 
  | ProceduresGroup<string, ProcedureRecord>
  | RouterDefinition<any>

/**
 * A record of router entries.
 */
export type RouterRecord = Record<string, RouterEntry>

/**
 * A router definition.
 */
export interface RouterDefinition<Routes extends RouterRecord> {
  readonly _tag: "RouterDefinition"
  readonly routes: Routes
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference for Client
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten router into a record of path -> procedure definition.
 * Used for generating client types.
 */
export type FlattenRouter<Routes extends RouterRecord, Prefix extends string = ""> = {
  [K in keyof Routes]: Routes[K] extends ProceduresGroup<infer Name, infer P>
    ? FlattenProcedures<P, `${Prefix}${Name}.`>
    : Routes[K] extends RouterDefinition<infer R>
      ? FlattenRouter<R, `${Prefix}${K & string}.`>
      : never
}[keyof Routes]

type FlattenProcedures<P extends ProcedureRecord, Prefix extends string> = {
  [K in keyof P as `${Prefix}${K & string}`]: P[K]
}

/**
 * Client interface for a router.
 * Generates typed query/mutation methods for each procedure.
 */
export type RouterClient<Routes extends RouterRecord> = {
  [K in keyof Routes]: Routes[K] extends ProceduresGroup<string, infer P>
    ? ProceduresClient<P>
    : Routes[K] extends RouterDefinition<infer R>
      ? RouterClient<R>
      : never
}

type ProceduresClient<P extends ProcedureRecord> = {
  [K in keyof P]: ProcedureClient<P[K]>
}

type ProcedureClient<TDef extends ProcedureDefinition<any, any, any>> =
  TDef extends ProcedureDefinition<infer I, infer O, infer Type>
    ? Type extends "query"
      ? QueryClient<I, O>
      : MutationClient<I, O>
    : never

interface QueryClient<I, O> {
  /**
   * Execute the query.
   */
  query(input: I extends void ? void : I): Promise<O>
  
  /**
   * React hook for this query.
   */
  useQuery(input?: I extends void ? void : I): {
    data: O | undefined
    isLoading: boolean
    error: Error | undefined
    refetch: () => void
  }
}

interface MutationClient<I, O> {
  /**
   * Execute the mutation.
   */
  mutate(input: I extends void ? void : I): Promise<O>
  
  /**
   * React hook for this mutation.
   */
  useMutation(): {
    mutate: (input: I extends void ? void : I) => void
    mutateAsync: (input: I extends void ? void : I) => Promise<O>
    isLoading: boolean
    error: Error | undefined
    data: O | undefined
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Router namespace.
 */
export const Router = {
  /**
   * Create a new router from a record of procedures groups.
   * 
   * @example
   * ```ts
   * const appRouter = Router.make({
   *   user: UserProcedures,
   *   post: PostProcedures,
   *   admin: Router.make({
   *     users: AdminUserProcedures,
   *   }),
   * })
   * ```
   */
  make: <Routes extends RouterRecord>(routes: Routes): RouterDefinition<Routes> => ({
    _tag: "RouterDefinition",
    routes,
  }),
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all procedure paths from a router.
 */
export const getProcedurePaths = (
  router: RouterDefinition<any>,
  prefix = ""
): string[] => {
  const paths: string[] = []
  
  for (const [key, entry] of Object.entries(router.routes)) {
    if ((entry as any)._tag === "ProceduresGroup") {
      const group = entry as ProceduresGroup<string, ProcedureRecord>
      for (const procKey of Object.keys(group.procedures)) {
        paths.push(`${prefix}${group.name}.${procKey}`)
      }
    } else if ((entry as any)._tag === "RouterDefinition") {
      paths.push(...getProcedurePaths(entry as RouterDefinition<any>, `${prefix}${key}.`))
    }
  }
  
  return paths
}

/**
 * Get a procedure definition by path.
 */
export const getProcedure = (
  router: RouterDefinition<any>,
  path: string
): ProcedureDefinition<any, any, any> | undefined => {
  const parts = path.split(".")
  let current: any = router.routes
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    
    if (current._tag === "ProceduresGroup") {
      return current.procedures[parts.slice(i).join(".")]
    }
    
    if (current._tag === "RouterDefinition") {
      current = current.routes[part]
    } else if (current[part]) {
      current = current[part]
    } else {
      return undefined
    }
  }
  
  return undefined
}
