/**
 * Middleware - Add cross-cutting concerns to procedures
 * 
 * Middleware can provide services to handlers, fail early, or wrap execution.
 * Applied at procedure, group, or server level with inheritance.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Middleware, Procedure, Router, Server } from "effect-trpc"
 * import { Effect, Schema, Context } from "effect"
 * 
 * // Define what middleware provides
 * class CurrentUser extends Context.Tag("CurrentUser")<CurrentUser, User>() {}
 * 
 * // Define middleware tag
 * class AuthMiddleware extends Middleware.Tag<AuthMiddleware>()("AuthMiddleware", {
 *   provides: CurrentUser,
 *   failure: UnauthorizedError,
 * }) {}
 * 
 * // Implement middleware
 * const AuthMiddlewareLive = Middleware.implement(AuthMiddleware, (request) =>
 *   Effect.gen(function* () {
 *     const token = request.headers.get("authorization")
 *     if (!token) return yield* Effect.fail(new UnauthorizedError({}))
 *     return yield* verifyToken(token)
 *   })
 * )
 * 
 * // Apply to procedures
 * const getSecret = Procedure.query({ success: Secret }).middleware(AuthMiddleware)
 * 
 * // Apply to groups
 * const adminRoutes = Router.withMiddleware([AuthMiddleware, AdminMiddleware], {
 *   list: adminList,
 *   delete: adminDelete,
 * })
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const MiddlewareTypeId: unique symbol = Symbol.for("effect-trpc/Middleware")

/** @internal */
export type MiddlewareTypeId = typeof MiddlewareTypeId

/** @internal */
export const MiddlewareTagTypeId: unique symbol = Symbol.for("effect-trpc/MiddlewareTag")

/** @internal */
export type MiddlewareTagTypeId = typeof MiddlewareTagTypeId

// =============================================================================
// Request Context
// =============================================================================

/**
 * Request information available to middleware
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareRequest {
  readonly id: string
  readonly tag: string
  readonly headers: Headers
  readonly payload: unknown
}

/**
 * Minimal Headers interface (no DOM dependency)
 * 
 * @since 1.0.0
 * @category models
 */
export interface Headers {
  readonly get: (name: string) => string | null
  readonly has: (name: string) => boolean
}

// =============================================================================
// Middleware Tag
// =============================================================================

/**
 * Configuration for a middleware tag
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareConfig<Provides, Failure> {
  /**
   * The service this middleware provides to handlers.
   * Use `never` for wrap-only middleware that doesn't provide anything.
   */
  readonly provides: Context.Tag<any, Provides>
  
  /**
   * The error type this middleware can fail with.
   * Omit if middleware cannot fail.
   */
  readonly failure?: Schema.Schema<Failure, any>
}

/**
 * A middleware tag that can be applied to procedures
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareTag<
  Self,
  Provides,
  Failure = never
> extends Context.Tag<Self, MiddlewareImpl<Provides, Failure>> {
  readonly [MiddlewareTagTypeId]: MiddlewareTagTypeId
  readonly _provides: Provides
  readonly _failure: Failure
  readonly provides: Context.Tag<any, Provides>
}

/**
 * The implementation of a middleware
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareImpl<Provides, Failure> {
  readonly run: (
    request: MiddlewareRequest
  ) => Effect.Effect<Provides, Failure>
}

/**
 * Wrap middleware implementation (has access to next)
 * 
 * @since 1.0.0
 * @category models
 */
export interface WrapMiddlewareImpl<Failure> {
  readonly wrap: <A, E, R>(
    request: MiddlewareRequest,
    next: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>
}

/**
 * Create a middleware tag
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const AuthMiddleware = Middleware.Tag<CurrentUser, UnauthorizedError>(
 *   "AuthMiddleware",
 *   CurrentUser
 * )
 * ```
 */
export const Tag = <Provides, Failure = never>(
  id: string,
  provides: Context.Tag<any, Provides>
): MiddlewareTag<any, Provides, Failure> => {
  const tag = Context.GenericTag<any, MiddlewareImpl<Provides, Failure>>(id)
  return Object.assign(tag, {
    [MiddlewareTagTypeId]: MiddlewareTagTypeId,
    _provides: undefined as unknown as Provides,
    _failure: undefined as unknown as Failure,
    provides,
  }) as MiddlewareTag<any, Provides, Failure>
}

// =============================================================================
// Middleware Implementation
// =============================================================================

/**
 * Implement a middleware
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const AuthMiddlewareLive = Middleware.implement(AuthMiddleware, (request) =>
 *   Effect.gen(function* () {
 *     const token = request.headers.get("authorization")
 *     if (!token) return yield* Effect.fail(new UnauthorizedError({}))
 *     return yield* verifyToken(token)
 *   })
 * )
 * ```
 */
export const implement = <Self, Provides, Failure>(
  tag: MiddlewareTag<Self, Provides, Failure>,
  run: (request: MiddlewareRequest) => Effect.Effect<Provides, Failure>
): Layer.Layer<Self, never, never> =>
  Layer.succeed(tag as any, { run } as MiddlewareImpl<Provides, Failure>) as any

/**
 * Implement a wrap middleware (has access to next)
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const LoggingMiddlewareLive = Middleware.implementWrap(LoggingMiddleware, (request, next) =>
 *   Effect.gen(function* () {
 *     const start = Date.now()
 *     const result = yield* next
 *     console.log(`${request.tag} took ${Date.now() - start}ms`)
 *     return result
 *   })
 * )
 * ```
 */
export const implementWrap = <Self, Failure>(
  tag: MiddlewareTag<Self, never, Failure>,
  wrap: <A, E, R>(
    request: MiddlewareRequest,
    next: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R>
): Layer.Layer<Self, never, never> =>
  Layer.succeed(tag as any, { wrap } as WrapMiddlewareImpl<Failure>) as any

// =============================================================================
// Middleware Composition
// =============================================================================

/**
 * Combined middleware
 * 
 * @since 1.0.0
 * @category models
 */
export interface CombinedMiddleware<Tags extends ReadonlyArray<MiddlewareTag<any, any, any>>> {
  readonly [MiddlewareTypeId]: MiddlewareTypeId
  readonly tags: Tags
  readonly concurrency: "sequential" | "unbounded" | number
}

/**
 * Combine multiple middlewares
 * 
 * @since 1.0.0
 * @category combinators
 * @example
 * ```ts
 * // Sequential (default)
 * const combined = Middleware.all(Auth, RateLimit, FeatureFlag)
 * 
 * // Concurrent for independent middlewares
 * const concurrent = Middleware.all(Auth, RateLimit, { concurrency: "unbounded" })
 * ```
 */
export const all = <Tags extends ReadonlyArray<MiddlewareTag<any, any, any>>>(
  ...args: [...Tags] | [...Tags, { concurrency?: "sequential" | "unbounded" | number }]
): CombinedMiddleware<Tags> => {
  const lastArg = args[args.length - 1]
  const hasOptions = typeof lastArg === "object" && MiddlewareTagTypeId in lastArg === false
  
  const tags = (hasOptions ? args.slice(0, -1) : args) as unknown as Tags
  const options = hasOptions ? lastArg as { concurrency?: "sequential" | "unbounded" | number } : {}
  
  return {
    [MiddlewareTypeId]: MiddlewareTypeId,
    tags,
    concurrency: options.concurrency ?? "sequential",
  }
}

// =============================================================================
// Middleware Application
// =============================================================================

/**
 * Middleware that can be applied to procedures/routers
 * 
 * @since 1.0.0
 * @category models
 */
export type Applicable = 
  | MiddlewareTag<any, any, any>
  | CombinedMiddleware<any>

/**
 * Extract the provides type from middleware
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Provides<M> = 
  M extends MiddlewareTag<any, infer P, any> ? P :
  M extends CombinedMiddleware<infer Tags> ? Tags[number] extends MiddlewareTag<any, infer P, any> ? P : never :
  never

/**
 * Extract the failure type from middleware
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Failure<M> =
  M extends MiddlewareTag<any, any, infer F> ? F :
  M extends CombinedMiddleware<infer Tags> ? Tags[number] extends MiddlewareTag<any, any, infer F> ? F : never :
  never

// =============================================================================
// Middleware Chain Execution
// =============================================================================

/**
 * Execute a middleware chain
 * 
 * @since 1.0.0
 * @category execution
 */
export const execute = <A, E, R>(
  middlewares: ReadonlyArray<Applicable>,
  request: MiddlewareRequest,
  handler: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure<typeof middlewares[number]>, R | Provides<typeof middlewares[number]>> => {
  // Flatten combined middlewares
  const flatMiddlewares = middlewares.flatMap((m) =>
    MiddlewareTypeId in m ? (m as CombinedMiddleware<any>).tags : [m]
  )
  
  // Execute from outermost to innermost
  return flatMiddlewares.reduceRight(
    (next, middleware) => executeOne(middleware, request, next),
    handler as Effect.Effect<A, any, any>
  )
}

const executeOne = <A, E, R, Provides, Failure>(
  middleware: MiddlewareTag<any, Provides, Failure>,
  request: MiddlewareRequest,
  next: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure, R> =>
  Effect.gen(function* () {
    const impl = yield* middleware as any as Context.Tag<any, MiddlewareImpl<Provides, Failure> | WrapMiddlewareImpl<Failure>>
    
    if ("wrap" in impl) {
      // Wrap middleware
      return yield* (impl as WrapMiddlewareImpl<Failure>).wrap(request, next)
    } else {
      // Provides middleware
      const provided = yield* (impl as MiddlewareImpl<Provides, Failure>).run(request)
      return yield* next.pipe(
        Effect.provideService(middleware as any, provided as any)
      ) as Effect.Effect<A, E, R>
    }
  }) as Effect.Effect<A, E | Failure, R>

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if a value is a middleware tag
 * 
 * @since 1.0.0
 * @category guards
 */
export const isMiddlewareTag = (value: unknown): value is MiddlewareTag<any, any, any> =>
  typeof value === "object" &&
  value !== null &&
  MiddlewareTagTypeId in value

/**
 * Check if a value is a combined middleware
 * 
 * @since 1.0.0
 * @category guards
 */
export const isCombinedMiddleware = (value: unknown): value is CombinedMiddleware<any> =>
  typeof value === "object" &&
  value !== null &&
  MiddlewareTypeId in value

/**
 * Check if a value is applicable middleware
 * 
 * @since 1.0.0
 * @category guards
 */
export const isApplicable = (value: unknown): value is Applicable =>
  isMiddlewareTag(value) || isCombinedMiddleware(value)
