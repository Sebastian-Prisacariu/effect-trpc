/**
 * Convenience type exports for effect-trpc
 * 
 * These types can be imported directly for type-level programming:
 * 
 * @example
 * ```ts
 * import type { InferProcedurePayload, InferRouterPaths } from "effect-trpc/types"
 * ```
 * 
 * @since 1.0.0
 * @module
 */

import type * as Procedure from "./Procedure/index.js"
import type * as Router from "./Router/index.js"
import type * as Transport from "./Transport/index.js"
import type * as Middleware from "./Middleware/index.js"
import type * as Reactivity from "./Reactivity/index.js"

// =============================================================================
// Procedure Type Helpers
// =============================================================================

/**
 * Extract the payload type from a procedure
 * 
 * @since 1.0.0
 * @category type helpers
 * @example
 * ```ts
 * type Payload = InferProcedurePayload<typeof createUser>
 * // { name: string; email: string }
 * ```
 */
export type InferProcedurePayload<P extends Procedure.Any> = Procedure.Payload<P>

/**
 * Extract the success type from a procedure
 * 
 * @since 1.0.0
 * @category type helpers
 * @example
 * ```ts
 * type User = InferProcedureSuccess<typeof getUser>
 * // { id: string; name: string; email: string }
 * ```
 */
export type InferProcedureSuccess<P extends Procedure.Any> = Procedure.Success<P>

/**
 * Extract the error type from a procedure
 * 
 * @since 1.0.0
 * @category type helpers
 * @example
 * ```ts
 * type Error = InferProcedureError<typeof getUser>
 * // NotFoundError
 * ```
 */
export type InferProcedureError<P extends Procedure.Any> = Procedure.Error<P>

/**
 * Extract invalidation paths from a mutation
 * 
 * @since 1.0.0
 * @category type helpers
 */
export type InferMutationInvalidates<P extends Procedure.Mutation<any, any, any, any>> = 
  Procedure.Invalidates<P>

// =============================================================================
// Router Type Helpers
// =============================================================================

/**
 * Extract all paths from a router
 * 
 * @since 1.0.0
 * @category type helpers
 * @example
 * ```ts
 * type Paths = InferRouterPaths<typeof appRouter>
 * // "users.list" | "users.get" | "users.create" | "health"
 * ```
 */
export type InferRouterPaths<R extends Router.Router<any>> = 
  R extends Router.Router<infer D> ? Router.Paths<D> : never

/**
 * Extract the definition from a router
 * 
 * @since 1.0.0
 * @category type helpers
 */
export type InferRouterDefinition<R extends Router.Router<any>> = Router.DefinitionOf<R>

/**
 * Get a procedure at a specific path
 * 
 * @since 1.0.0
 * @category type helpers
 * @example
 * ```ts
 * type GetUserProc = InferRouterProcedure<typeof appRouter, "users.get">
 * // Query<{ id: string }, User, NotFoundError>
 * ```
 */
export type InferRouterProcedure<
  R extends Router.Router<any>,
  Path extends string
> = R extends Router.Router<infer D> 
  ? Router.ProcedureAt<D, Path> 
  : never

// =============================================================================
// Transport Types
// =============================================================================

/**
 * Transport request type
 * 
 * @since 1.0.0
 * @category types
 */
export type TransportRequest = Transport.TransportRequest

/**
 * Transport response union type
 * 
 * @since 1.0.0
 * @category types
 */
export type TransportResponse = Transport.TransportResponse

/**
 * Transport error type
 * 
 * @since 1.0.0
 * @category types
 */
export type TransportError = Transport.TransportError

// =============================================================================
// Middleware Types
// =============================================================================

/**
 * Middleware request context
 * 
 * @since 1.0.0
 * @category types
 */
export type MiddlewareRequest = Middleware.MiddlewareRequest

/**
 * Procedure type
 * 
 * @since 1.0.0
 * @category types
 */
export type ProcedureType = Middleware.ProcedureType

// =============================================================================
// Reactivity Types
// =============================================================================

/**
 * PathReactivity service
 * 
 * @since 1.0.0
 * @category types
 */
export type PathReactivityService = Reactivity.PathReactivityService
