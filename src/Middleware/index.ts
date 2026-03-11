/**
 * Middleware - Request/response middleware
 * 
 * @since 1.0.0
 * @module
 * 
 * Note: In production, this would re-export from Effect RPC's RpcMiddleware.
 * For now, we provide a compatible interface.
 */

import { Context, Effect, Layer } from "effect"

// =============================================================================
// Types
// =============================================================================

/**
 * Middleware configuration
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareConfig<Provides, Failure> {
  readonly provides: Context.Tag<Provides, Provides>
  readonly failure: new (...args: any[]) => Failure
  readonly requiredForClient?: boolean
}

/**
 * Middleware tag definition
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareTag<Self, Provides, Failure> extends Context.Tag<Self, MiddlewareHandler<Provides, Failure>> {
  readonly provides: Context.Tag<Provides, Provides>
  readonly failure: new (...args: any[]) => Failure
  readonly requiredForClient: boolean
  
  readonly of: (handler: MiddlewareHandlerFn<Provides, Failure>) => MiddlewareHandler<Provides, Failure>
}

/**
 * Middleware handler function
 */
export type MiddlewareHandlerFn<Provides, Failure> = (context: {
  readonly headers: Headers
}) => Effect.Effect<Provides, Failure>

/**
 * Middleware handler instance
 */
export interface MiddlewareHandler<Provides, Failure> {
  readonly _tag: "MiddlewareHandler"
  readonly handle: MiddlewareHandlerFn<Provides, Failure>
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a middleware tag
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * class Auth extends Middleware.Tag<Auth>()("Auth", {
 *   provides: CurrentUser,
 *   failure: UnauthorizedError,
 *   requiredForClient: true,
 * }) {}
 * ```
 */
export const Tag = <Self>() => <const Id extends string, Provides, Failure>(
  id: Id,
  config: MiddlewareConfig<Provides, Failure>
): MiddlewareTag<Self, Provides, Failure> => {
  const tag = Context.GenericTag<Self, MiddlewareHandler<Provides, Failure>>(id)
  
  return Object.assign(tag, {
    provides: config.provides,
    failure: config.failure,
    requiredForClient: config.requiredForClient ?? false,
    
    of: (handler: MiddlewareHandlerFn<Provides, Failure>): MiddlewareHandler<Provides, Failure> => ({
      _tag: "MiddlewareHandler",
      handle: handler,
    }),
  }) as MiddlewareTag<Self, Provides, Failure>
}

/**
 * Create a client-side middleware layer
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const AuthClientLive = Middleware.layerClient(Auth, ({ request }) =>
 *   Effect.gen(function* () {
 *     const token = yield* getStoredToken()
 *     return {
 *       ...request,
 *       headers: Headers.set(request.headers, "authorization", `Bearer ${token}`)
 *     }
 *   })
 * )
 * ```
 */
export const layerClient = <M extends MiddlewareTag<any, any, any>>(
  _middleware: M,
  handler: (context: {
    readonly request: { headers: Headers }
    readonly rpc: { path: string }
  }) => Effect.Effect<{ headers: Headers }, never>
): Layer.Layer<unknown> => {
  // Placeholder - in production this would integrate with Effect RPC
  return Layer.empty as any
}
