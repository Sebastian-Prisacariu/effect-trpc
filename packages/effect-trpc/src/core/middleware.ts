/**
 * @module effect-trpc/core/middleware
 *
 * Middleware system for effect-trpc.
 * Middleware can be applied at the procedure or router level.
 *
 * Middleware is pipeable and composable, following Effect's patterns:
 * @example
 * ```ts
 * const orgMiddleware = Middleware.make("org", (ctx, input, next) =>
 *   Effect.gen(function* () {
 *     const org = yield* OrgService.getBySlug(input.organizationSlug)
 *     return yield* next({ ...ctx, org })
 *   })
 * ).pipe(
 *   Middleware.withInput(Schema.Struct({ organizationSlug: Schema.String }))
 * )
 * ```
 */

import * as Effect from "effect/Effect"
import * as Array from "effect/Array"
import * as Clock from "effect/Clock"
import type * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import { dual } from "effect/Function"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import * as FiberRef from "effect/FiberRef"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import type { Pipeable } from "effect/Pipeable"
import { pipeArguments } from "effect/Pipeable"

// ─────────────────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base context available to all middleware and handlers.
 *
 * @remarks
 * This context is constructed from @effect/rpc's request options and provides
 * a familiar interface for middleware authors.
 *
 * @since 0.1.0
 */
export interface BaseContext {
  /**
   * The full procedure path (e.g., "user.create").
   */
  readonly procedure: string

  /**
   * Request headers (standard web Headers).
   *
   * @remarks
   * Converted from @effect/platform Headers for compatibility with
   * standard web APIs and existing middleware patterns.
   */
  readonly headers: Headers

  /**
   * Abort signal for request cancellation.
   *
   * @remarks
   * **Important**: This signal is provided for compatibility with code that
   * expects AbortSignal. However, Effect-based code should use Effect's
   * built-in fiber interruption system instead, which is more powerful.
   *
   * The signal will be aborted when:
   * - The client disconnects (handled by @effect/rpc's fiber interruption)
   * - The request times out (if configured)
   *
   * For Effect-idiomatic cancellation, use:
   * - `Effect.interrupt` to cancel the current fiber
   * - `Effect.onInterrupt` to handle cleanup on cancellation
   * - `Effect.interruptible` / `Effect.uninterruptible` to control regions
   */
  readonly signal: AbortSignal

  /**
   * Unique client identifier for this connection.
   *
   * @remarks
   * Provided by @effect/rpc. Useful for tracking requests from the same client
   * or implementing per-client rate limiting.
   */
  readonly clientId: number
}

/**
 * Context with authenticated user (after auth middleware).
 *
 * @since 0.1.0
 */
export interface AuthenticatedContext<TUser = unknown> extends BaseContext {
  readonly user: TUser
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A middleware function that can transform context and intercept requests.
 *
 * @template CtxIn - The input context type
 * @template CtxOut - The output context type (what's passed to next)
 * @template InputIn - The input type this middleware expects
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 *
 * @since 0.4.0
 */
export type MiddlewareFn<CtxIn, CtxOut, InputIn, E, R> = (
  ctx: CtxIn,
  input: InputIn,
  next: (ctx: CtxOut) => Effect.Effect<unknown, unknown, unknown>,
) => Effect.Effect<unknown, E, R>

/**
 * Symbol to identify Middleware at runtime.
 * @internal
 */
export const MiddlewareTypeId: unique symbol = Symbol.for("@effect-trpc/Middleware")

/**
 * @internal
 */
export type MiddlewareTypeId = typeof MiddlewareTypeId

/**
 * A middleware object with metadata.
 *
 * Middleware is pipeable, allowing composition with combinators like `withInput`.
 *
 * @template CtxIn - The input context type
 * @template CtxOut - The output context type
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 * @template Provides - Services this middleware provides to downstream handlers
 * @template InputExt - Input schema extension this middleware requires
 *
 * @example
 * ```ts
 * // Basic middleware
 * const logMiddleware = Middleware.make("log", (ctx, input, next) => {
 *   console.log("Request:", ctx.procedure)
 *   return next(ctx)
 * })
 *
 * // Middleware with input requirements (pipeable)
 * const orgMiddleware = Middleware.make("org", (ctx, input, next) =>
 *   Effect.gen(function* () {
 *     const org = yield* OrgService.getBySlug(input.organizationSlug)
 *     return yield* next({ ...ctx, org })
 *   })
 * ).pipe(
 *   Middleware.withInput(Schema.Struct({ organizationSlug: Schema.String }))
 * )
 * ```
 *
 * @since 0.1.0
 */
export interface Middleware<
  CtxIn = BaseContext,
  CtxOut = CtxIn,
  E = never,
  R = never,
  Provides = never,
  InputExt = unknown,
> extends Pipeable {
  readonly [MiddlewareTypeId]: MiddlewareTypeId
  readonly _tag: "Middleware"
  readonly name: string
  readonly fn: MiddlewareFn<CtxIn, CtxOut, InputExt, E, R>
  /**
   * Services this middleware provides to downstream handlers.
   * These are excluded from the procedure's requirements.
   * @internal
   */
  readonly _provides?: Provides
  /**
   * Phantom type for input extension.
   * @internal
   */
  readonly _inputExt?: InputExt
  /**
   * Runtime schema for input extension (used for schema merging).
   */
  readonly inputSchema?: Schema.Schema<InputExt, unknown>
}

/**
 * Check if a value is a Middleware.
 *
 * @since 0.4.0
 */
export const isMiddleware = (value: unknown): value is Middleware<any, any, any, any, any, any> =>
  typeof value === "object" && value !== null && MiddlewareTypeId in value

/**
 * Extract the "provides" type from a middleware.
 *
 * @since 0.1.0
 */
export type MiddlewareProvides<M> =
  M extends Middleware<any, any, any, any, infer P, any> ? P : never

/**
 * Extract the input extension type from a middleware.
 *
 * @since 0.4.0
 */
export type MiddlewareInputExt<M> =
  M extends Middleware<any, any, any, any, any, infer I> ? I : unknown

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Prototype (for Pipeable)
// ─────────────────────────────────────────────────────────────────────────────

const MiddlewareProto = {
  [MiddlewareTypeId]: MiddlewareTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * Create a Middleware object with the prototype set up for pipeability.
 * @internal
 */
function makeMiddlewareInternal<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  E,
  R,
  Provides,
  InputExt,
>(options: {
  name: string
  fn: MiddlewareFn<CtxIn, CtxOut, InputExt, E, R>
  inputSchema?: Schema.Schema<InputExt, unknown>
}): Middleware<CtxIn, CtxOut, E, R, Provides, InputExt> {
  const self = Object.create(MiddlewareProto) as Middleware<CtxIn, CtxOut, E, R, Provides, InputExt>
  return Object.assign(self, {
    _tag: "Middleware" as const,
    name: options.name,
    fn: options.fn,
    inputSchema: options.inputSchema,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Namespace for middleware creation utilities.
 *
 * @since 0.1.0
 */
export const Middleware = {
  /**
   * Create a named middleware.
   *
   * Supports both data-first and data-last (curried) usage:
   *
   * @example
   * ```ts
   * // Data-first: Middleware.make(name, fn)
   * const authMiddleware = Middleware.make('auth', (ctx, input, next) =>
   *   Effect.gen(function* () {
   *     const token = ctx.headers.get('authorization')
   *     if (!token) {
   *       return yield* Effect.fail(new UnauthorizedError({ procedure: ctx.procedure }))
   *     }
   *     const user = yield* verifyToken(token)
   *     return yield* next({ ...ctx, user })
   *   })
   * )
   *
   * // Data-last: pipe(fn, Middleware.make(name)) - for composition
   * const authMiddleware = pipe(
   *   (ctx, input, next) => Effect.gen(function* () {
   *     // ...
   *   }),
   *   Middleware.make('auth')
   * )
   * ```
   *
   * @since 0.1.0
   */
  make: dual<
    // Data-last: takes name, returns function that takes fn
    <
      CtxIn extends BaseContext = BaseContext,
      CtxOut extends BaseContext = CtxIn,
      E = never,
      R = never,
    >(
      name: string,
    ) => (
      fn: MiddlewareFn<CtxIn, CtxOut, unknown, E, R>,
    ) => Middleware<CtxIn, CtxOut, E, R, never, unknown>,
    // Data-first: takes name and fn
    <
      CtxIn extends BaseContext = BaseContext,
      CtxOut extends BaseContext = CtxIn,
      E = never,
      R = never,
    >(
      name: string,
      fn: MiddlewareFn<CtxIn, CtxOut, unknown, E, R>,
    ) => Middleware<CtxIn, CtxOut, E, R, never, unknown>
  >(
    2,
    <CtxIn extends BaseContext, CtxOut extends BaseContext, E, R>(
      name: string,
      fn: MiddlewareFn<CtxIn, CtxOut, unknown, E, R>,
    ) => makeMiddlewareInternal<CtxIn, CtxOut, E, R, never, unknown>({ name, fn }),
  ),

  /**
   * Create a middleware that provides a request-scoped service to handlers.
   *
   * This is the recommended way to provide per-request services. The framework
   * will use the correct method to provide the service:
   * - For Effects: `Effect.provideServiceEffect()`
   * - For Streams: `Stream.provideServiceEffect()`
   *
   * @see serviceMiddleware for full documentation and examples
   * @since 0.3.0
   */
  withService: serviceMiddleware,

  /**
   * Add input schema requirements to a middleware.
   *
   * When a procedure uses this middleware, the input type will be extended
   * to include the fields from the schema.
   *
   * This is a dual function supporting both data-first and data-last styles:
   *
   * @example
   * ```ts
   * // Data-last (pipeable)
   * const orgMiddleware = Middleware.make("org", (ctx, input, next) =>
   *   Effect.gen(function* () {
   *     // input.organizationSlug is typed!
   *     const org = yield* OrgService.getBySlug(input.organizationSlug)
   *     return yield* next({ ...ctx, org })
   *   })
   * ).pipe(
   *   Middleware.withInput(Schema.Struct({ organizationSlug: Schema.String }))
   * )
   *
   * // Data-first
   * const orgMiddleware = Middleware.withInput(
   *   baseMiddleware,
   *   Schema.Struct({ organizationSlug: Schema.String })
   * )
   *
   * // When used on a procedure:
   * const myProc = procedure
   *   .use(orgMiddleware)  // Input now requires { organizationSlug: string }
   *   .input(Schema.Struct({ id: Schema.String }))
   *   .query()
   * // Final input type: { organizationSlug: string } & { id: string }
   * ```
   *
   * @since 0.4.0
   */
  withInput: dual<
    // Data-last: withInput(schema) returns transformer
    <I, IFrom>(
      schema: Schema.Schema<I, IFrom>,
    ) => <CtxIn extends BaseContext, CtxOut extends BaseContext, E, R, P, OldInputExt>(
      self: Middleware<CtxIn, CtxOut, E, R, P, OldInputExt>,
    ) => Middleware<CtxIn, CtxOut, E, R, P, OldInputExt & I>,
    // Data-first: withInput(self, schema)
    <CtxIn extends BaseContext, CtxOut extends BaseContext, E, R, P, OldInputExt, I, IFrom>(
      self: Middleware<CtxIn, CtxOut, E, R, P, OldInputExt>,
      schema: Schema.Schema<I, IFrom>,
    ) => Middleware<CtxIn, CtxOut, E, R, P, OldInputExt & I>
  >(
    2,
    <CtxIn extends BaseContext, CtxOut extends BaseContext, E, R, P, OldInputExt, I, IFrom>(
      self: Middleware<CtxIn, CtxOut, E, R, P, OldInputExt>,
      schema: Schema.Schema<I, IFrom>,
    ): Middleware<CtxIn, CtxOut, E, R, P, OldInputExt & I> => {
      // Merge schemas if there's an existing inputSchema
      const mergedSchema = self.inputSchema
        ? Schema.extend(
            self.inputSchema as Schema.Schema<OldInputExt & object, unknown>,
            schema as Schema.Schema<I & object, IFrom>,
          )
        : schema

      return makeMiddlewareInternal<CtxIn, CtxOut, E, R, P, OldInputExt & I>({
        name: self.name,
        fn: self.fn as MiddlewareFn<CtxIn, CtxOut, OldInputExt & I, E, R>,
        inputSchema: mergedSchema as Schema.Schema<OldInputExt & I, unknown>,
      })
    },
  ),

  /**
   * Add a name to an existing middleware.
   *
   * @since 0.4.0
   */
  withName: dual<
    (name: string) => <M extends Middleware<any, any, any, any, any, any>>(self: M) => M,
    <M extends Middleware<any, any, any, any, any, any>>(self: M, name: string) => M
  >(2, <M extends Middleware<any, any, any, any, any, any>>(self: M, name: string): M => {
    const options: {
      name: string
      fn: MiddlewareFn<any, any, any, any, any>
      inputSchema?: Schema.Schema<any, unknown>
    } = {
      name,
      fn: self.fn,
    }
    if (self.inputSchema !== undefined) {
      options.inputSchema = self.inputSchema
    }
    return makeMiddlewareInternal(options) as M
  }),
}

/**
 * Create a middleware that provides services to downstream handlers.
 *
 * When a middleware "provides" a service, handlers using that middleware
 * don't need to require that service themselves - the middleware takes
 * care of providing it.
 *
 * @example
 * ```ts
 * // Create a middleware that provides Database to handlers
 * const dbMiddleware = middlewareWithProvides<
 *   BaseContext,
 *   BaseContext,
 *   never,
 *   ConnectionPool,  // Middleware needs ConnectionPool
 *   Database          // Middleware provides Database
 * >({
 *   name: 'database',
 *   fn: (ctx, input, next) =>
 *     Effect.gen(function* () {
 *       const pool = yield* ConnectionPool
 *       const db = new DatabaseImpl(pool)
 *       return yield* Effect.provideService(next(ctx), Database, db)
 *     })
 * })
 *
 * // Handlers can now use Database without requiring it
 * procedure
 *   .use(dbMiddleware)
 *   .query()
 *
 * const handlers = {
 *   myProc: (ctx, input) =>
 *     Effect.flatMap(Database, db => db.find(input.id))
 *     // Database requirement is satisfied by middleware!
 * }
 * ```
 *
 * @since 0.1.0
 */
export function middlewareWithProvides<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  E,
  R,
  Provides,
  InputExt = unknown,
>(options: {
  name: string
  fn: MiddlewareFn<CtxIn, CtxOut, InputExt, E, R>
  inputSchema?: Schema.Schema<InputExt, unknown>
}): Middleware<CtxIn, CtxOut, E, R, Provides, InputExt> {
  return makeMiddlewareInternal<CtxIn, CtxOut, E, R, Provides, InputExt>(options)
}

// ─────────────────────────────────────────────────────────────────────────────
// Service-Providing Middleware (Request-Scoped Services)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Symbol to identify ServiceMiddleware at runtime.
 * @internal
 */
export const ServiceMiddlewareTypeId: unique symbol = Symbol.for("@effect-trpc/ServiceMiddleware")

/**
 * @internal
 */
export type ServiceMiddlewareTypeId = typeof ServiceMiddlewareTypeId

/**
 * A middleware that provides a service to downstream handlers.
 *
 * Unlike regular middleware that uses `Effect.provideService()` internally,
 * ServiceMiddleware declares its provided service at runtime, allowing the
 * framework to apply the service correctly for both Effects and Streams.
 *
 * This solves the problem where `Effect.provideService()` doesn't propagate
 * to Stream's internal effects.
 *
 * @template CtxIn - The input context type
 * @template CtxOut - The output context type (after adding service data to context)
 * @template S - The service type being provided
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 * @template InputExt - Input schema extension this middleware requires
 *
 * @since 0.3.0
 */
export interface ServiceMiddleware<
  CtxIn extends BaseContext = BaseContext,
  CtxOut extends BaseContext = CtxIn,
  S = unknown,
  E = never,
  R = never,
  InputExt = unknown,
> extends Pipeable {
  readonly [ServiceMiddlewareTypeId]: ServiceMiddlewareTypeId
  readonly _tag: "ServiceMiddleware"
  readonly name: string

  /**
   * The Context.Tag for the service this middleware provides.
   * This is used at runtime to apply the service correctly.
   */
  readonly provides: Context.Tag<any, S>

  /**
   * Function that creates the service value from the context and input.
   * This is evaluated per-request and the result is provided to handlers.
   */
  readonly make: (ctx: CtxIn, input: InputExt) => Effect.Effect<S, E, R>

  /**
   * Optional function to transform the context after creating the service.
   * If provided, the handler receives CtxOut instead of CtxIn.
   * The service value is passed so it can be added to the context.
   */
  readonly transformContext?: ((ctx: CtxIn, service: S) => CtxOut) | undefined

  /**
   * Phantom type for input extension.
   * @internal
   */
  readonly _inputExt?: InputExt

  /**
   * Runtime schema for input extension (used for schema merging).
   */
  readonly inputSchema?: Schema.Schema<InputExt, unknown>
}

/**
 * Prototype for ServiceMiddleware (for Pipeable).
 * @internal
 */
const ServiceMiddlewareProto = {
  [ServiceMiddlewareTypeId]: ServiceMiddlewareTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * Check if a middleware is a ServiceMiddleware.
 *
 * @since 0.3.0
 */
export const isServiceMiddleware = (
  middleware:
    | Middleware<any, any, any, any, any, any>
    | ServiceMiddleware<any, any, any, any, any, any>,
): middleware is ServiceMiddleware<any, any, any, any, any, any> =>
  ServiceMiddlewareTypeId in middleware

/**
 * Extract the service type from a ServiceMiddleware.
 *
 * @since 0.3.0
 */
export type ServiceMiddlewareService<M> =
  M extends ServiceMiddleware<any, any, infer S, any, any, any> ? S : never

/**
 * Create a middleware that provides a request-scoped service to handlers.
 *
 * This is the recommended way to provide per-request services like `CurrentUser`,
 * `RequestContext`, or `Database` connections. The framework will:
 *
 * - For **Effects** (query/mutation): Use `Effect.provideServiceEffect()`
 * - For **Streams** (stream/chat/subscription): Use `Stream.provideServiceEffect()`
 *
 * This ensures the service is properly available in all handler contexts.
 *
 * @example
 * ```ts
 * import { Middleware } from 'effect-trpc'
 * import { Context, Effect } from 'effect'
 *
 * // Define your service tag
 * class CurrentUser extends Context.Tag('CurrentUser')<
 *   CurrentUser,
 *   { readonly userId: string; readonly permissions: Set<string> }
 * >() {}
 *
 * // Create auth middleware that provides CurrentUser
 * const authMiddleware = Middleware.withService({
 *   name: 'auth',
 *   provides: CurrentUser,
 *   make: (ctx, input) =>
 *     Effect.gen(function* () {
 *       const token = ctx.headers.get('authorization')
 *       if (!token) {
 *         return yield* Effect.fail(new UnauthorizedError())
 *       }
 *       const session = yield* verifyToken(token)
 *       return {
 *         userId: session.userId,
 *         permissions: new Set(session.permissions),
 *       }
 *     }),
 *   // Optionally add the user to the context for other middleware
 *   transformContext: (ctx, user) => ({ ...ctx, user }),
 * })
 *
 * // Use in router
 * const router = Router.make({
 *   user: UserProcedures,
 * }).use(authMiddleware)
 *
 * // Handlers can now use CurrentUser
 * const handlers = {
 *   me: (ctx, input) =>
 *     Effect.gen(function* () {
 *       const user = yield* CurrentUser  // Provided by middleware!
 *       return { userId: user.userId }
 *     }),
 * }
 * ```
 *
 * @since 0.3.0
 */
export function serviceMiddleware<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  S,
  E,
  R,
  InputExt = unknown,
>(options: {
  readonly name: string
  readonly provides: Context.Tag<any, S>
  readonly make: (ctx: CtxIn, input: InputExt) => Effect.Effect<S, E, R>
  readonly transformContext?: (ctx: CtxIn, service: S) => CtxOut
  readonly inputSchema?: Schema.Schema<InputExt, unknown>
}): ServiceMiddleware<CtxIn, CtxOut, S, E, R, InputExt> {
  const self = Object.create(ServiceMiddlewareProto) as ServiceMiddleware<
    CtxIn,
    CtxOut,
    S,
    E,
    R,
    InputExt
  >
  return Object.assign(self, {
    _tag: "ServiceMiddleware" as const,
    name: options.name,
    provides: options.provides,
    make: options.make,
    transformContext: options.transformContext,
    inputSchema: options.inputSchema,
  })
}

/**
 * Add input schema requirements to a ServiceMiddleware.
 *
 * @since 0.4.0
 */
export const withInputService = dual<
  // Data-last
  <I, IFrom>(
    schema: Schema.Schema<I, IFrom>,
  ) => <CtxIn extends BaseContext, CtxOut extends BaseContext, S, E, R, OldInputExt>(
    self: ServiceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt>,
  ) => ServiceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt & I>,
  // Data-first
  <CtxIn extends BaseContext, CtxOut extends BaseContext, S, E, R, OldInputExt, I, IFrom>(
    self: ServiceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt>,
    schema: Schema.Schema<I, IFrom>,
  ) => ServiceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt & I>
>(
  2,
  <CtxIn extends BaseContext, CtxOut extends BaseContext, S, E, R, OldInputExt, I, IFrom>(
    self: ServiceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt>,
    schema: Schema.Schema<I, IFrom>,
  ): ServiceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt & I> => {
    const mergedSchema = self.inputSchema
      ? Schema.extend(
          self.inputSchema as Schema.Schema<OldInputExt & object, unknown>,
          schema as Schema.Schema<I & object, IFrom>,
        )
      : schema

    // Build options object conditionally to satisfy exactOptionalPropertyTypes
    const baseOptions = {
      name: self.name,
      provides: self.provides,
      make: self.make as (ctx: CtxIn, input: OldInputExt & I) => Effect.Effect<S, E, R>,
      inputSchema: mergedSchema as Schema.Schema<OldInputExt & I, unknown>,
    }

    if (self.transformContext !== undefined) {
      return serviceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt & I>({
        ...baseOptions,
        transformContext: self.transformContext,
      })
    }

    return serviceMiddleware<CtxIn, CtxOut, S, E, R, OldInputExt & I>(baseOptions)
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Composition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compose multiple middleware into one.
 * Middleware are executed in order (first to last).
 *
 * Input extensions are merged from all middleware.
 *
 * @since 0.1.0
 */
export function composeMiddleware<
  Ctx1 extends BaseContext,
  Ctx2 extends BaseContext,
  E1,
  R1,
  I1,
  Ctx3 extends BaseContext,
  E2,
  R2,
  I2,
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1, never, I1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2, never, I2>,
): Middleware<Ctx1, Ctx3, E1 | E2, R1 | R2, never, I1 & I2>

export function composeMiddleware<
  Ctx1 extends BaseContext,
  Ctx2 extends BaseContext,
  E1,
  R1,
  I1,
  Ctx3 extends BaseContext,
  E2,
  R2,
  I2,
  Ctx4 extends BaseContext,
  E3,
  R3,
  I3,
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1, never, I1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2, never, I2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3, never, I3>,
): Middleware<Ctx1, Ctx4, E1 | E2 | E3, R1 | R2 | R3, never, I1 & I2 & I3>

export function composeMiddleware<
  Ctx1 extends BaseContext,
  Ctx2 extends BaseContext,
  E1,
  R1,
  I1,
  Ctx3 extends BaseContext,
  E2,
  R2,
  I2,
  Ctx4 extends BaseContext,
  E3,
  R3,
  I3,
  Ctx5 extends BaseContext,
  E4,
  R4,
  I4,
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1, never, I1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2, never, I2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3, never, I3>,
  m4: Middleware<Ctx4, Ctx5, E4, R4, never, I4>,
): Middleware<Ctx1, Ctx5, E1 | E2 | E3 | E4, R1 | R2 | R3 | R4, never, I1 & I2 & I3 & I4>

export function composeMiddleware<
  Ctx1 extends BaseContext,
  Ctx2 extends BaseContext,
  E1,
  R1,
  I1,
  Ctx3 extends BaseContext,
  E2,
  R2,
  I2,
  Ctx4 extends BaseContext,
  E3,
  R3,
  I3,
  Ctx5 extends BaseContext,
  E4,
  R4,
  I4,
  Ctx6 extends BaseContext,
  E5,
  R5,
  I5,
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1, never, I1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2, never, I2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3, never, I3>,
  m4: Middleware<Ctx4, Ctx5, E4, R4, never, I4>,
  m5: Middleware<Ctx5, Ctx6, E5, R5, never, I5>,
): Middleware<
  Ctx1,
  Ctx6,
  E1 | E2 | E3 | E4 | E5,
  R1 | R2 | R3 | R4 | R5,
  never,
  I1 & I2 & I3 & I4 & I5
>

export function composeMiddleware<
  Ctx1 extends BaseContext,
  Ctx2 extends BaseContext,
  E1,
  R1,
  I1,
  Ctx3 extends BaseContext,
  E2,
  R2,
  I2,
  Ctx4 extends BaseContext,
  E3,
  R3,
  I3,
  Ctx5 extends BaseContext,
  E4,
  R4,
  I4,
  Ctx6 extends BaseContext,
  E5,
  R5,
  I5,
  Ctx7 extends BaseContext,
  E6,
  R6,
  I6,
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1, never, I1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2, never, I2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3, never, I3>,
  m4: Middleware<Ctx4, Ctx5, E4, R4, never, I4>,
  m5: Middleware<Ctx5, Ctx6, E5, R5, never, I5>,
  m6: Middleware<Ctx6, Ctx7, E6, R6, never, I6>,
): Middleware<
  Ctx1,
  Ctx7,
  E1 | E2 | E3 | E4 | E5 | E6,
  R1 | R2 | R3 | R4 | R5 | R6,
  never,
  I1 & I2 & I3 & I4 & I5 & I6
>

/**
 * Implementation uses `any` types for the variadic case.
 * Type safety is provided by the overload signatures above (2-6 middlewares).
 * For more than 6 middlewares, chain multiple composeMiddleware calls.
 */
export function composeMiddleware(
  ...middlewares: Middleware<any, any, any, any, any, any>[]
): Middleware<any, any, any, any, any, any> {
  if (middlewares.length === 0) {
    return Middleware.make("identity", (_ctx, _input, next) => next(_ctx))
  }

  if (middlewares.length === 1) {
    return middlewares[0]!
  }

  // Using native map/join for simple string concatenation (cleaner than Effect Array)
  const names = middlewares.map((m) => m.name).join(" -> ")

  // Merge all input schemas
  let mergedSchema: Schema.Schema<any, any> | undefined
  for (const m of middlewares) {
    if (m.inputSchema) {
      mergedSchema = mergedSchema ? Schema.extend(mergedSchema, m.inputSchema) : m.inputSchema
    }
  }

  const options: {
    name: string
    fn: MiddlewareFn<any, any, any, any, any>
    inputSchema?: Schema.Schema<any, unknown>
  } = {
    name: names,
    fn: (ctx, input, next) => {
      // Build the middleware chain from right to left using reduceRight
      const chain = Array.reduceRight(
        middlewares,
        next,
        (nextFn, current) => (c: any) => current.fn(c, input, nextFn),
      )
      return chain(ctx)
    },
  }

  if (mergedSchema !== undefined) {
    options.inputSchema = mergedSchema
  }

  return makeMiddlewareInternal(options)
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logging middleware - logs request and response.
 *
 * Uses Effect.Clock for time measurement, making it testable and
 * compatible with Effect's runtime. The default Clock implementation is
 * provided automatically; use TestClock for testing.
 *
 * @remarks
 * **Type Assertion**: The `as Effect.Effect<unknown, never, never>` assertion
 * is required because the middleware's `next` function has type
 * `Effect<unknown, unknown, unknown>`. Each middleware declares its own error
 * type (here `never`), but TypeScript can't infer this from the generic chain.
 * The assertion is safe because this middleware only logs and doesn't add errors.
 *
 * @since 0.1.0
 */
export const loggingMiddleware: Middleware<BaseContext, BaseContext, never, never, never, unknown> =
  Middleware.make(
    "logging",
    (ctx, _input, next) =>
      Effect.gen(function* () {
        const start = yield* Clock.currentTimeMillis
        yield* Effect.logDebug(`→ ${ctx.procedure}`)

        const result = yield* Effect.exit(next(ctx))

        const end = yield* Clock.currentTimeMillis
        const duration = end - start
        if (result._tag === "Success") {
          yield* Effect.logDebug(`← ${ctx.procedure} (${duration}ms)`)
        } else {
          yield* Effect.logError(`✗ ${ctx.procedure} (${duration}ms)`)
        }

        return yield* result
      }) as Effect.Effect<unknown, never, never>,
  )

/**
 * Timing middleware - adds timing information to the response.
 *
 * Uses Effect.Clock for time measurement, making it testable and
 * compatible with Effect's runtime.
 *
 * Note: Type assertion is required because the `next` function has type
 * `Effect<unknown, unknown, unknown>` but this middleware doesn't add errors.
 * The errors from `next` are handled by the outer middleware chain.
 *
 * @since 0.1.0
 */
export const timingMiddleware: Middleware<
  BaseContext,
  BaseContext & { startTime: number },
  never,
  never,
  never,
  unknown
> = Middleware.make(
  "timing",
  (ctx, _input, next) =>
    Effect.gen(function* () {
      const startTime = yield* Clock.currentTimeMillis
      return yield* next({ ...ctx, startTime: Number(startTime) })
    }) as Effect.Effect<unknown, never, never>,
)

// ─────────────────────────────────────────────────────────────────────────────
// Timeout Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Timeout error for the timeout middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `TimeoutError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewareTimeoutError extends Schema.TaggedError<MiddlewareTimeoutError>()(
  "MiddlewareTimeoutError",
  {
    procedure: Schema.String,
    timeoutMs: Schema.Number,
  },
) {
  /** HTTP status code for timeout errors. */
  readonly httpStatus = 504
  /** Timeout errors are usually retryable. */
  readonly isRetryable = true

  override get message(): string {
    return `Request timed out for ${this.procedure} after ${this.timeoutMs}ms`
  }
}

/**
 * Create a timeout middleware.
 *
 * @param ms - Timeout in milliseconds
 *
 * @example
 * ```ts
 * const slowProcedure = procedure
 *   .use(timeoutMiddleware(1000)) // 1 second timeout
 *   .query(() => Effect.sleep(2000)) // Will fail with MiddlewareTimeoutError
 * ```
 *
 * @since 0.1.0
 */
export function timeoutMiddleware(
  ms: number,
): Middleware<BaseContext, BaseContext, MiddlewareTimeoutError, never, never, unknown> {
  return makeMiddlewareInternal({
    name: "timeout",
    fn: (ctx, _input, next) =>
      Effect.gen(function* () {
        const result = yield* next(ctx).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(ms),
            onTimeout: () =>
              new MiddlewareTimeoutError({
                procedure: ctx.procedure,
                timeoutMs: ms,
              }),
          }),
        )
        return result
      }) as Effect.Effect<unknown, MiddlewareTimeoutError, never>,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting with Ref
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tolerance for clock skew in milliseconds.
 * If the clock goes backward by more than this amount, we reset the rate limit window.
 * Small backward jumps (within tolerance) are handled by clamping to zero.
 */
const CLOCK_SKEW_TOLERANCE_MS = 1000

/**
 * Rate limit entry for tracking request counts.
 */
interface RateLimitEntry {
  readonly count: number
  readonly resetAt: number
}

/**
 * Rate limit state stored in a Ref using HashMap.
 */
type RateLimitState = HashMap.HashMap<string, RateLimitEntry>

/**
 * Result of rate limit check.
 */
interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs: number
}

/**
 * Options for rate limit middleware.
 *
 * @since 0.1.0
 */
export interface RateLimitOptions {
  /**
   * Maximum number of requests allowed within the window.
   */
  readonly maxRequests: number

  /**
   * Time window in milliseconds.
   */
  readonly windowMs: number

  /**
   * Function to generate a key for rate limiting.
   * Defaults to "global" (single rate limit for all requests).
   *
   * Common patterns:
   * - Per-client: `(ctx) => String(ctx.clientId)`
   * - Per-IP: `(ctx) => ctx.headers.get("x-forwarded-for") ?? "unknown"`
   * - Per-user: `(ctx) => ctx.user?.id ?? "anonymous"`
   */
  readonly keyFn?: (ctx: BaseContext) => string

  /**
   * Maximum number of unique keys to track before cleanup.
   * When exceeded, expired entries are cleaned up.
   * Defaults to 10000.
   *
   * @remarks
   * This prevents memory leaks from unbounded key growth.
   * Set this based on expected unique clients/IPs.
   */
  readonly maxKeys?: number
}

/**
 * Create a rate limiting middleware.
 *
 * Returns an Effect that creates the middleware with properly initialized state.
 * Uses Ref for thread-safe state management, HashMap for efficient key storage,
 * and Effect.Clock for time measurement, making it properly Effect-idiomatic.
 *
 * Expired entries are automatically cleaned up when maxKeys is exceeded.
 *
 * @param options - Rate limit configuration
 *
 * @example
 * ```ts
 * // Global rate limit - note the Effect wrapper
 * const globalRateLimitEffect = rateLimitMiddleware({
 *   maxRequests: 100,
 *   windowMs: 60000, // 1 minute
 * })
 *
 * // Use in your setup
 * const setup = Effect.gen(function* () {
 *   const rateLimit = yield* globalRateLimitEffect
 *   return createRouter({ middleware: [rateLimit] })
 * })
 *
 * // Per-client rate limit with cleanup
 * const perClientRateLimitEffect = rateLimitMiddleware({
 *   maxRequests: 10,
 *   windowMs: 1000,
 *   keyFn: (ctx) => String(ctx.clientId),
 *   maxKeys: 10000,
 * })
 * ```
 *
 * @since 0.1.0
 */
export const rateLimitMiddleware = (
  options: RateLimitOptions,
): Effect.Effect<
  Middleware<BaseContext, BaseContext, MiddlewareRateLimitError, never, never, unknown>
> =>
  Effect.gen(function* () {
    const { maxRequests, windowMs, keyFn = () => "global", maxKeys = 10000 } = options

    // Create the Ref within the Effect context - no runSync needed
    const stateRef = yield* Ref.make<RateLimitState>(HashMap.empty())

    /**
     * Clean up expired entries from the state.
     * Called when the number of keys exceeds maxKeys.
     */
    const cleanupExpiredEntries = (state: RateLimitState, nowMs: number): RateLimitState =>
      HashMap.filter(state, (entry) => entry.resetAt > nowMs)

    /**
     * Check and update rate limit state atomically.
     * Uses HashMap operations inside Ref.modify.
     * Cleans up expired entries when maxKeys is exceeded to prevent memory leaks.
     * Handles clock skew by resetting windows on significant backward jumps.
     */
    const checkRateLimit = (key: string): Effect.Effect<RateLimitResult, never, never> =>
      Effect.flatMap(Clock.currentTimeMillis, (nowBigInt) => {
        const nowMs = Number(nowBigInt)
        return Ref.modify(stateRef, (state): [RateLimitResult, RateLimitState] => {
          // Clean up expired entries if we have too many keys
          let workingState = state
          if (HashMap.size(state) > maxKeys) {
            workingState = cleanupExpiredEntries(state, nowMs)
          }

          const entry = HashMap.get(workingState, key)

          // No entry - create new entry
          if (entry._tag === "None") {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          // Calculate time until reset
          const timeUntilReset = entry.value.resetAt - nowMs

          // Handle clock skew - if current time is significantly before window start
          // (resetAt - windowMs), reset the window to avoid being stuck
          const windowStartMs = entry.value.resetAt - windowMs
          const timeSinceWindowStart = nowMs - windowStartMs
          if (timeSinceWindowStart < -CLOCK_SKEW_TOLERANCE_MS) {
            // Clock went backward significantly - reset window
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          // Window expired - create new entry
          if (timeUntilReset <= 0) {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          // Check if over limit
          const newCount = entry.value.count + 1
          if (newCount > maxRequests) {
            // Clamp retryAfterMs to 0 for small clock skews
            const retryAfterMs = Math.max(0, timeUntilReset)
            return [
              { allowed: false, retryAfterMs },
              workingState, // Don't update state on rejection
            ]
          }

          // Increment count
          const newState = HashMap.set(workingState, key, { ...entry.value, count: newCount })
          return [{ allowed: true, retryAfterMs: 0 }, newState]
        })
      })

    return makeMiddlewareInternal<
      BaseContext,
      BaseContext,
      MiddlewareRateLimitError,
      never,
      never,
      unknown
    >({
      name: "rateLimit",
      fn: (ctx, _input, next) =>
        Effect.gen(function* () {
          const key = keyFn(ctx)
          const result = yield* checkRateLimit(key)

          if (!result.allowed) {
            return yield* Effect.fail(
              new MiddlewareRateLimitError({
                procedure: ctx.procedure,
                retryAfterMs: result.retryAfterMs,
              }),
            )
          }

          return yield* next(ctx)
        }) as Effect.Effect<unknown, MiddlewareRateLimitError, never>,
    })
  })

/**
 * Rate limit error for the rate limiting middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `RateLimitError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 * Use this error for rate limiting middleware; use the errors module's
 * `RateLimitError` for custom error handling in procedure implementations.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewareRateLimitError extends Schema.TaggedError<MiddlewareRateLimitError>()(
  "MiddlewareRateLimitError",
  {
    procedure: Schema.String,
    retryAfterMs: Schema.Number,
  },
) {
  /** HTTP status code for rate limiting. */
  readonly httpStatus = 429
  /** Rate limit errors are retryable after the specified delay. */
  readonly isRetryable = true

  override get message(): string {
    return `Rate limit exceeded for ${this.procedure}. Retry after ${this.retryAfterMs}ms`
  }
}

/**
 * Extract and validate a Bearer token from an Authorization header.
 *
 * Validates that:
 * - Header starts with "Bearer " (case-insensitive on "Bearer")
 * - Token part is not empty
 * - Token doesn't contain spaces (malformed token)
 *
 * @param header - The Authorization header value
 * @param procedure - The procedure name for error reporting
 * @returns The extracted token or an AuthError
 *
 * @internal
 */
const extractBearerToken = (
  header: string,
  procedure: string,
): Effect.Effect<string, MiddlewareAuthError> =>
  Effect.gen(function* () {
    // Trim whitespace
    const trimmed = header.trim()
    const lowerTrimmed = trimmed.toLowerCase()

    // Check if it starts with "bearer" (case-insensitive)
    if (!lowerTrimmed.startsWith("bearer")) {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "Authorization header must use Bearer scheme",
        }),
      )
    }

    // Check if there's a space after "bearer" and something follows
    // Valid format: "Bearer <token>" where token is non-empty and has no spaces
    if (trimmed.length <= 7 || trimmed[6] !== " ") {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "No token provided after Bearer scheme",
        }),
      )
    }

    // Extract token (slice past "Bearer ")
    const token = trimmed.slice(7).trim()

    if (!token) {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "No token provided after Bearer scheme",
        }),
      )
    }

    // Check for embedded spaces (malformed token)
    if (token.includes(" ")) {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "Token contains invalid characters",
        }),
      )
    }

    return token
  })

/**
 * Create an authentication middleware.
 *
 * @param verifyToken - Function to verify the token and return a user
 *
 * @since 0.1.0
 */
export function authMiddleware<TUser>(
  verifyToken: (token: string) => Effect.Effect<TUser, MiddlewareAuthError>,
): Middleware<
  BaseContext,
  AuthenticatedContext<TUser>,
  MiddlewareAuthError,
  never,
  never,
  unknown
> {
  return makeMiddlewareInternal({
    name: "auth",
    fn: (ctx, _input, next) =>
      Effect.gen(function* () {
        const authHeader = ctx.headers.get("authorization")
        if (!authHeader) {
          return yield* Effect.fail(
            new MiddlewareAuthError({
              procedure: ctx.procedure,
              reason: "No authorization header",
            }),
          )
        }

        const token = yield* extractBearerToken(authHeader, ctx.procedure)
        const user = yield* verifyToken(token)

        return yield* next({ ...ctx, user })
      }) as Effect.Effect<unknown, MiddlewareAuthError, never>,
  })
}

/**
 * Authentication error for the auth middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `UnauthorizedError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewareAuthError extends Schema.TaggedError<MiddlewareAuthError>()(
  "MiddlewareAuthError",
  {
    procedure: Schema.String,
    reason: Schema.String,
  },
) {
  /** HTTP status code for authentication errors. */
  readonly httpStatus = 401
  /** Auth errors are not retryable without new credentials. */
  readonly isRetryable = false

  override get message(): string {
    return `Authentication failed for ${this.procedure}: ${this.reason}`
  }
}

/**
 * Create a permission check middleware.
 *
 * @param permission - Required permission
 * @param hasPermission - Function to check if user has permission
 *
 * @since 0.1.0
 */
export function requirePermission<TUser>(
  permission: string,
  hasPermission: (user: TUser, permission: string) => boolean,
): Middleware<
  AuthenticatedContext<TUser>,
  AuthenticatedContext<TUser>,
  MiddlewarePermissionError,
  never,
  never,
  unknown
> {
  return makeMiddlewareInternal({
    name: `requirePermission:${permission}`,
    fn: (ctx, _input, next) =>
      Effect.gen(function* () {
        if (!hasPermission(ctx.user, permission)) {
          return yield* Effect.fail(
            new MiddlewarePermissionError({
              procedure: ctx.procedure,
              requiredPermission: permission,
            }),
          )
        }
        return yield* next(ctx)
      }) as Effect.Effect<unknown, MiddlewarePermissionError, never>,
  })
}

/**
 * Permission error for the requirePermission middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `ForbiddenError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewarePermissionError extends Schema.TaggedError<MiddlewarePermissionError>()(
  "MiddlewarePermissionError",
  {
    procedure: Schema.String,
    requiredPermission: Schema.String,
  },
) {
  /** HTTP status code for permission errors. */
  readonly httpStatus = 403
  /** Permission errors are not retryable without different credentials. */
  readonly isRetryable = false
  override get message(): string {
    return `Permission denied for ${this.procedure}: requires ${this.requiredPermission}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Context FiberRef
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FiberRef that holds the middleware context during request processing.
 *
 * This allows handlers to access the enriched context from middleware
 * (e.g., authenticated user, organization, etc.) without changing the
 * handler function signature.
 *
 * @remarks
 * The FiberRef is set by `applyMiddleware` in rpc-bridge.ts after the
 * middleware chain has built up the context. Handlers can access it
 * using `getMiddlewareContext()`.
 *
 * @internal
 */
export const MiddlewareContextRef: FiberRef.FiberRef<unknown> =
  FiberRef.unsafeMake<unknown>(undefined)

/**
 * Get the middleware context in a handler.
 *
 * Use this to access context enriched by middleware (e.g., authenticated user).
 * Returns `Option.none()` if called outside of a middleware chain or if no
 * middleware has set the context.
 *
 * @example
 * ```ts
 * const getUserProcedure = procedure
 *   .use(authMiddleware)
 *   .query(({ input }) =>
 *     Effect.gen(function* () {
 *       const ctx = yield* getMiddlewareContext<AuthenticatedContext>()
 *       if (Option.isNone(ctx)) return yield* Effect.fail(new UnauthorizedError())
 *       return yield* db.getUser(ctx.value.user.id)
 *     })
 *   )
 * ```
 *
 * @since 0.1.0
 */
export const getMiddlewareContext = <T = BaseContext>(): Effect.Effect<Option.Option<T>> =>
  FiberRef.get(MiddlewareContextRef).pipe(
    Effect.map((ctx) => Option.fromNullable(ctx as T | null | undefined)),
  )

/**
 * Get the middleware context, failing if not available.
 *
 * Use this when you know middleware has run and the context must exist.
 * Fails with the provided error if context is not available.
 *
 * @example
 * ```ts
 * const getUserProcedure = procedure
 *   .use(authMiddleware) // Ensures user is always set
 *   .query(({ input }) =>
 *     Effect.gen(function* () {
 *       const ctx = yield* requireMiddlewareContext<AuthenticatedContext>(
 *         new UnauthorizedError({ procedure: "getUser", reason: "No auth context" })
 *       )
 *       return yield* db.getUser(ctx.user.id)
 *     })
 *   )
 * ```
 *
 * @since 0.1.0
 */
export const requireMiddlewareContext = <T, E>(onMissing: E): Effect.Effect<T, E> =>
  getMiddlewareContext<T>().pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(onMissing),
        onSome: (ctx) => Effect.succeed(ctx),
      }),
    ),
  )
