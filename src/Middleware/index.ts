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
 * Procedure type
 * 
 * @since 1.0.0
 * @category models
 */
export type ProcedureType = "query" | "mutation" | "stream"

/**
 * Request information available to middleware
 * 
 * @since 1.0.0
 * @category models
 */
export interface MiddlewareRequest {
  /** Unique request ID */
  readonly id: string
  
  /** Full tag (e.g., "@api/users/list") */
  readonly tag: string
  
  /** Dot-separated path (e.g., "users.list") */
  readonly path: string
  
  /** Procedure type: "query" | "mutation" | "stream" */
  readonly type: ProcedureType
  
  /** Request headers */
  readonly headers: Headers
  
  /** Request payload (decoded) */
  readonly payload: unknown
  
  /** Procedure-level metadata (from procedure.meta()) */
  readonly meta: Record<string, unknown>
  
  /** AbortSignal for request cancellation */
  readonly signal?: AbortSignal
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
> extends Context.Tag<Self, MiddlewareImpl<Provides, Failure, any>> {
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
export interface MiddlewareImpl<Provides, Failure, R = never> {
  readonly run: (
    request: MiddlewareRequest
  ) => Effect.Effect<Provides, Failure, R>
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
  const tag = Context.GenericTag<any, MiddlewareImpl<Provides, Failure, any>>(id)
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
export const implement = <Self, Provides, Failure, R>(
  tag: MiddlewareTag<Self, Provides, Failure>,
  run: (request: MiddlewareRequest) => Effect.Effect<Provides, Failure, R>
): Layer.Layer<Self, never, R> =>
  Layer.succeed(tag as any, { run } as MiddlewareImpl<Provides, Failure, R>) as any

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
export const implementWrap = <Self, Failure, R2 = never>(
  tag: MiddlewareTag<Self, never, Failure>,
  wrap: <A, E, R>(
    request: MiddlewareRequest,
    next: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Failure, R | R2>
): Layer.Layer<Self, never, R2> =>
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
  // Process middlewares, respecting concurrency for CombinedMiddleware
  let current = handler as Effect.Effect<A, any, any>
  
  // Process in reverse order (outermost to innermost)
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const m = middlewares[i]
    
    if (MiddlewareTypeId in m) {
      // CombinedMiddleware - check concurrency setting
      const combined = m as CombinedMiddleware<any>
      const tags = combined.tags
      const concurrency = combined.concurrency
      
      if (concurrency === "sequential" || tags.length <= 1) {
        // Sequential: wrap each middleware around current
        for (let j = tags.length - 1; j >= 0; j--) {
          current = executeOne(tags[j], request, current)
        }
      } else {
        // Concurrent: run "provides" middleware in parallel, then handler
        // Wrap middleware still chains sequentially (they modify control flow)
        const captured = current
        const concurrencyNum = concurrency === "unbounded" ? tags.length : concurrency
        
        type MiddlewareResult = 
          | { _tag: "wrap"; tag: MiddlewareTag<any, any, any>; impl: WrapMiddlewareImpl<any> }
          | { _tag: "provides"; tag: MiddlewareTag<any, any, any>; provided: unknown }
        
        current = Effect.gen(function* () {
          // Collect all provides concurrently
          const effects = tags.map((tag: MiddlewareTag<any, any, any>): Effect.Effect<MiddlewareResult, any, any> =>
            Effect.gen(function* () {
              const impl = yield* tag as any as Context.Tag<any, MiddlewareImpl<any, any> | WrapMiddlewareImpl<any>>
              
              if ("wrap" in impl) {
                return { _tag: "wrap" as const, tag, impl: impl as WrapMiddlewareImpl<any> }
              } else {
                const provided = yield* (impl as MiddlewareImpl<any, any>).run(request)
                return { _tag: "provides" as const, tag, provided }
              }
            })
          )
          
          const results = (yield* Effect.all(effects, { concurrency: concurrencyNum })) as MiddlewareResult[]
          
          // Apply wrap middleware sequentially, provide services from provides middleware
          let inner = captured
          for (const r of results) {
            const result = r as MiddlewareResult
            if (result._tag === "wrap") {
              const prev = inner
              inner = result.impl.wrap(request, prev) as Effect.Effect<A, any, any>
            } else {
              inner = inner.pipe(
                Effect.provideService(result.tag.provides, result.provided)
              )
            }
          }
          
          return yield* inner
        }) as Effect.Effect<A, any, any>
      }
    } else {
      // Single middleware tag
      current = executeOne(m as MiddlewareTag<any, any, any>, request, current)
    }
  }
  
  return current
}

const executeOne = <A, E, R, Provides, Failure>(
  middleware: MiddlewareTag<any, Provides, Failure>,
  request: MiddlewareRequest,
  next: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Failure, R> =>
  Effect.gen(function* () {
    const impl = yield* middleware as any as Context.Tag<any, MiddlewareImpl<Provides, Failure, any> | WrapMiddlewareImpl<Failure>>
    
    if ("wrap" in impl) {
      // Wrap middleware - wraps the handler execution
      return yield* (impl as WrapMiddlewareImpl<Failure>).wrap(request, next)
    } else {
      // Provides middleware - runs first, then provides service to handler
      const provided = yield* (impl as MiddlewareImpl<Provides, Failure, any>).run(request)
      // Provide to the middleware's "provides" tag (e.g., CurrentUser)
      return yield* next.pipe(
        Effect.provideService(middleware.provides, provided)
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
