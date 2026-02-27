/**
 * @module effect-trpc/core/server/middleware
 *
 * Middleware system for effect-trpc with builder pattern.
 *
 * Middleware definitions declare their requirements via `.requires(Tag1, Tag2, ...)`.
 * The `.provides()` method returns an `Effect<MiddlewareDefinition, never, R>` where R
 * is the union of all declared requirements. This enables automatic tracking via
 * Effect's type system.
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as FiberRef from "effect/FiberRef"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import * as Layer from "effect/Layer"
import type { Pipeable } from "effect/Pipeable"
import { pipeArguments } from "effect/Pipeable"

// ─────────────────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base context available to all middleware and handlers.
 */
export interface BaseContext {
  /** The full procedure path (e.g., "user.create"). */
  readonly procedure: string
  /** Request headers (standard web Headers). */
  readonly headers: Headers
  /** Abort signal for request cancellation. */
  readonly signal: AbortSignal
  /** Unique client identifier for this connection. */
  readonly clientId: number
}

/**
 * Context with authenticated user (after auth middleware).
 */
export interface AuthenticatedContext<TUser = unknown> extends BaseContext {
  readonly user: TUser
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Definition (Type-Only Contract)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Symbol to identify MiddlewareDefinition at runtime.
 * @internal
 */
export const MiddlewareDefinitionTypeId: unique symbol = Symbol.for(
  "@effect-trpc/MiddlewareDefinition",
)

/** @internal */
export type MiddlewareDefinitionTypeId = typeof MiddlewareDefinitionTypeId

/**
 * A middleware definition (contract only, no implementation).
 *
 * Created via the `Middleware("name")` builder. Contains:
 * - Input schema requirements
 * - Error types it can produce
 * - Context type it provides
 * - Declared service requirements
 *
 * Use `Middleware.toLayer()` to provide the implementation.
 */
export interface MiddlewareDefinition<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E>
  extends Pipeable {
  readonly [MiddlewareDefinitionTypeId]: MiddlewareDefinitionTypeId
  readonly _tag: "MiddlewareDefinition"
  readonly name: string

  /** Input schema (if any). @internal */
  readonly inputSchema?: Schema.Schema<I, unknown>

  /** Error schemas (if any). @internal */
  readonly errorSchemas?: ReadonlyArray<Schema.Schema<any, any>>

  /** Declared requirement tags. @internal */
  readonly requiredTags: ReadonlyArray<Context.Tag<any, any>>

  /**
   * Service tag for retrieving the middleware implementation at runtime.
   * @internal
   */
  readonly serviceTag: Context.Tag<
    MiddlewareService<CtxIn, CtxOut, I, E>,
    MiddlewareService<CtxIn, CtxOut, I, E>
  >
}

export interface AnyMiddlewareDefinition extends Pipeable {
  readonly _tag: "MiddlewareDefinition"
  readonly name: string
  readonly inputSchema?: unknown
  readonly errorSchemas?: ReadonlyArray<Schema.Schema<any, any>>
  readonly requiredTags: ReadonlyArray<Context.Tag<any, any>>
}

export type MiddlewareSpec<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  InputExt,
  E,
> = MiddlewareDefinition<CtxIn, CtxOut, InputExt, E>

/**
 * Service type for a middleware implementation.
 * Contains the handler function that transforms context.
 */
export interface MiddlewareService<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E> {
  readonly handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, any>
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builder interface for constructing middleware definitions.
 *
 * @typeParam CtxIn - Input context type
 * @typeParam CtxOut - Output context type (after middleware transforms it)
 * @typeParam I - Input schema type (merged with procedure input)
 * @typeParam E - Error types this middleware can produce
 * @typeParam R - Declared requirements (services the implementation will need)
 */
export interface MiddlewareBuilder<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
  R = never,
> {
  /**
   * Add input requirements to this middleware.
   * When applied to a procedure, these fields are added to the procedure's input.
   */
  input<I2, IFrom = I2>(
    schema: Schema.Schema<I2, IFrom>,
  ): MiddlewareBuilder<CtxIn, CtxOut, I & I2, E, R>

  /**
   * Declare error types this middleware can produce.
   * Accepts varargs - each error class must extend Schema.TaggedError.
   */
  error<Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
    ...errors: Errors
  ): MiddlewareBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>, R>

  /**
   * Declare services this middleware implementation will require.
   * Pass Context.Tag values - they carry both runtime identity and type.
   *
   * @example
   * ```ts
   * const AuthMiddleware = Middleware("auth")
   *   .requires(SessionService, UserRepository)
   *   .provides<{ user: User }>()
   * ```
   */
  requires<T1 extends Context.Tag<any, any>>(
    t1: T1,
  ): MiddlewareBuilder<CtxIn, CtxOut, I, E, R | Context.Tag.Service<T1>>

  requires<T1 extends Context.Tag<any, any>, T2 extends Context.Tag<any, any>>(
    t1: T1,
    t2: T2,
  ): MiddlewareBuilder<CtxIn, CtxOut, I, E, R | Context.Tag.Service<T1> | Context.Tag.Service<T2>>

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    R | Context.Tag.Service<T1> | Context.Tag.Service<T2> | Context.Tag.Service<T3>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
    T5 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
    t5: T5,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
    | Context.Tag.Service<T5>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
    T5 extends Context.Tag<any, any>,
    T6 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
    t5: T5,
    t6: T6,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
    | Context.Tag.Service<T5>
    | Context.Tag.Service<T6>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
    T5 extends Context.Tag<any, any>,
    T6 extends Context.Tag<any, any>,
    T7 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
    t5: T5,
    t6: T6,
    t7: T7,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
    | Context.Tag.Service<T5>
    | Context.Tag.Service<T6>
    | Context.Tag.Service<T7>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
    T5 extends Context.Tag<any, any>,
    T6 extends Context.Tag<any, any>,
    T7 extends Context.Tag<any, any>,
    T8 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
    t5: T5,
    t6: T6,
    t7: T7,
    t8: T8,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
    | Context.Tag.Service<T5>
    | Context.Tag.Service<T6>
    | Context.Tag.Service<T7>
    | Context.Tag.Service<T8>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
    T5 extends Context.Tag<any, any>,
    T6 extends Context.Tag<any, any>,
    T7 extends Context.Tag<any, any>,
    T8 extends Context.Tag<any, any>,
    T9 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
    t5: T5,
    t6: T6,
    t7: T7,
    t8: T8,
    t9: T9,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
    | Context.Tag.Service<T5>
    | Context.Tag.Service<T6>
    | Context.Tag.Service<T7>
    | Context.Tag.Service<T8>
    | Context.Tag.Service<T9>
  >

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
    T4 extends Context.Tag<any, any>,
    T5 extends Context.Tag<any, any>,
    T6 extends Context.Tag<any, any>,
    T7 extends Context.Tag<any, any>,
    T8 extends Context.Tag<any, any>,
    T9 extends Context.Tag<any, any>,
    T10 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
    t4: T4,
    t5: T5,
    t6: T6,
    t7: T7,
    t8: T8,
    t9: T9,
    t10: T10,
  ): MiddlewareBuilder<
    CtxIn,
    CtxOut,
    I,
    E,
    | R
    | Context.Tag.Service<T1>
    | Context.Tag.Service<T2>
    | Context.Tag.Service<T3>
    | Context.Tag.Service<T4>
    | Context.Tag.Service<T5>
    | Context.Tag.Service<T6>
    | Context.Tag.Service<T7>
    | Context.Tag.Service<T8>
    | Context.Tag.Service<T9>
    | Context.Tag.Service<T10>
  >

  /**
   * Declare what context this middleware provides.
   * The implementation must return `{ ...ctx, ...additions }`.
   *
   * Returns an Effect that carries the declared requirements in its R channel.
   * This enables automatic requirement tracking via Effect's type system.
   */
  provides<Additions extends object>(): Effect.Effect<
    MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E>,
    never,
    R
  >
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder State & Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  readonly name: string
  readonly inputSchema?: Schema.Schema<any, any>
  readonly errorSchemas: ReadonlyArray<Schema.Schema<any, any>>
  readonly requiredTags: ReadonlyArray<Context.Tag<any, any>>
}

const BuilderProto = {
  pipe() {
    return pipeArguments(this, arguments)
  },
}

const DefinitionProto = {
  [MiddlewareDefinitionTypeId]: MiddlewareDefinitionTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

function createBuilder<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E, R>(
  state: BuilderState,
): MiddlewareBuilder<CtxIn, CtxOut, I, E, R> {
  const self = Object.create(BuilderProto) as MiddlewareBuilder<CtxIn, CtxOut, I, E, R>

  return Object.assign(self, {
    input: <I2, IFrom = I2>(
      schema: Schema.Schema<I2, IFrom>,
    ): MiddlewareBuilder<CtxIn, CtxOut, I & I2, E, R> => {
      const mergedSchema = state.inputSchema
        ? Schema.extend(
            state.inputSchema as Schema.Schema<I & object, unknown>,
            schema as Schema.Schema<I2 & object, IFrom>,
          )
        : schema

      return createBuilder<CtxIn, CtxOut, I & I2, E, R>({
        ...state,
        inputSchema: mergedSchema as Schema.Schema<I & I2, unknown>,
      })
    },

    error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
      ...errors: Errors
    ): MiddlewareBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>, R> => {
      return createBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>, R>({
        ...state,
        errorSchemas: [...state.errorSchemas, ...errors],
      })
    },

    requires: (...tags: Context.Tag<any, any>[]): MiddlewareBuilder<CtxIn, CtxOut, I, E, any> => {
      return createBuilder<CtxIn, CtxOut, I, E, any>({
        ...state,
        requiredTags: [...state.requiredTags, ...tags],
      })
    },

    provides: <Additions extends object>(): Effect.Effect<
      MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E>,
      never,
      R
    > => {
      const definition = createDefinition<CtxIn, CtxIn & Additions, I, E>(state)
      // Return as Effect with R requirements (phantom type - tracked at type level)
      return Effect.succeed(definition) as Effect.Effect<
        MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E>,
        never,
        R
      >
    },
  })
}

function createDefinition<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E>(
  state: BuilderState,
): MiddlewareDefinition<CtxIn, CtxOut, I, E> {
  const self = Object.create(DefinitionProto) as MiddlewareDefinition<CtxIn, CtxOut, I, E>

  // Create a unique tag for this middleware service
  const ServiceTag = Context.GenericTag<MiddlewareService<CtxIn, CtxOut, I, E>>(
    `@effect-trpc/Middleware/${state.name}`,
  )

  return Object.assign(self, {
    _tag: "MiddlewareDefinition" as const,
    name: state.name,
    inputSchema: state.inputSchema,
    errorSchemas: state.errorSchemas.length > 0 ? state.errorSchemas : undefined,
    requiredTags: state.requiredTags,
    serviceTag: ServiceTag,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @internal
 * @since 0.4.0
 */
function createMiddlewareBuilder<CtxIn extends BaseContext = BaseContext>(
  name: string,
): MiddlewareBuilder<CtxIn, CtxIn, unknown, never, never> {
  return createBuilder<CtxIn, CtxIn, unknown, never, never>({
    name,
    errorSchemas: [],
    requiredTags: [],
  })
}

/**
 * Create a Layer that implements a middleware.
 *
 * The handler's requirements (HandlerR) must match the declared requirements.
 * TypeScript will enforce this at compile time.
 *
 * @param definition - Effect containing the middleware definition
 * @param handler - Implementation function that transforms context
 * @returns Layer that provides the MiddlewareService
 *
 * @example
 * ```ts
 * const AuthMiddlewareLive = Middleware.toLayer(AuthMiddleware, (ctx, input) =>
 *   Effect.gen(function* () {
 *     const session = yield* SessionService
 *     const userRepo = yield* UserRepository
 *     const user = yield* userRepo.findById(session.userId)
 *     return { ...ctx, user }
 *   })
 * )
 * ```
 */
function middlewareToLayer<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
  DeclaredR,
  HandlerR,
>(
  definition: Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, I, E>, never, DeclaredR>,
  handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, HandlerR>,
): Layer.Layer<MiddlewareService<CtxIn, CtxOut, I, E>, never, DeclaredR | HandlerR> {
  // Extract the definition synchronously (it's just Effect.succeed internally)
  // This is safe because .provides() always returns Effect.succeed(definition)
  let extractedDef: MiddlewareDefinition<CtxIn, CtxOut, I, E> | undefined
  Effect.runSync(
    Effect.map(
      definition as Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, I, E>, never, never>,
      (def) => {
        extractedDef = def
      },
    ),
  )

  if (!extractedDef) {
    throw new Error("Failed to extract middleware definition")
  }

  return Layer.succeed(extractedDef.serviceTag, { handler }) as Layer.Layer<
    MiddlewareService<CtxIn, CtxOut, I, E>,
    never,
    DeclaredR | HandlerR
  >
}

/**
 * Middleware builder and utilities.
 *
 * Call as a function to create a middleware definition:
 * ```ts
 * const AuthMiddleware = Middleware<BaseContext>("auth")
 *   .input(Schema.Struct({ token: Schema.String }))
 *   .error(AuthError)
 *   .requires(SessionService, UserRepository)
 *   .provides<{ user: User }>()
 * ```
 *
 * Use `.toLayer()` to create an implementation:
 * ```ts
 * const AuthMiddlewareLive = Middleware.toLayer(AuthMiddleware, handler)
 * ```
 */
export interface MiddlewareFactory {
  /**
   * Create a middleware definition using the builder pattern.
   * @param name - Unique name for this middleware (used for service tag)
   */
  <CtxIn extends BaseContext = BaseContext>(
    name: string,
  ): MiddlewareBuilder<CtxIn, CtxIn, unknown, never, never>

  /**
   * Create a Layer that implements a middleware.
   */
  toLayer: typeof middlewareToLayer
}

/**
 * Middleware factory - create definitions and implementations.
 *
 * @example
 * ```ts
 * // Define middleware with requirements
 * const AuthMiddleware = Middleware<BaseContext>("auth")
 *   .input(Schema.Struct({ token: Schema.String }))
 *   .error(AuthError)
 *   .requires(SessionService, UserRepository)
 *   .provides<{ user: User }>()
 * // Type: Effect<MiddlewareDefinition<...>, never, SessionService | UserRepository>
 *
 * // Create implementation
 * const AuthMiddlewareLive = Middleware.toLayer(AuthMiddleware, (ctx, input) =>
 *   Effect.gen(function* () {
 *     const session = yield* SessionService
 *     const userRepo = yield* UserRepository
 *     const user = yield* userRepo.findById(session.userId)
 *     return { ...ctx, user }
 *   })
 * )
 * ```
 */
export const Middleware: MiddlewareFactory = Object.assign(createMiddlewareBuilder, {
  toLayer: middlewareToLayer,
})

/**
 * Check if a value is a MiddlewareDefinition.
 */
export const isMiddlewareDefinition = (
  value: unknown,
): value is MiddlewareDefinition<any, any, any, any> =>
  typeof value === "object" && value !== null && MiddlewareDefinitionTypeId in value

// ─────────────────────────────────────────────────────────────────────────────
// Type Extraction Utilities
// ─────────────────────────────────────────────────────────────────────────────

export type MiddlewareInput<M> =
  M extends MiddlewareDefinition<any, any, infer I, any> ? I : unknown

export type MiddlewareError<M> = M extends MiddlewareDefinition<any, any, any, infer E> ? E : never

export type MiddlewareContextOut<M> =
  M extends MiddlewareDefinition<any, infer CtxOut, any, any> ? CtxOut : BaseContext

export type MiddlewareContextIn<M> =
  M extends MiddlewareDefinition<infer CtxIn, any, any, any> ? CtxIn : BaseContext

/**
 * Extract the service type that a middleware requires.
 * This is the service type that must be provided via the middleware's Layer.
 */
export type MiddlewareServiceType<M> =
  M extends MiddlewareDefinition<infer CtxIn, infer CtxOut, infer I, infer E>
    ? MiddlewareService<CtxIn, CtxOut, I, E>
    : never

/**
 * Extract requirements from a middleware Effect.
 */
export type InferMiddlewareRequirements<M> =
  M extends Effect.Effect<MiddlewareDefinition<any, any, any, any>, any, infer R> ? R : never

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Context FiberRef
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FiberRef that holds the middleware context during request processing.
 * @internal
 */
export const MiddlewareContextRef: FiberRef.FiberRef<unknown> =
  FiberRef.unsafeMake<unknown>(undefined)

/**
 * Get the middleware context in a handler.
 */
export const getMiddlewareContext = <T = BaseContext>(): Effect.Effect<Option.Option<T>> =>
  FiberRef.get(MiddlewareContextRef).pipe(
    Effect.map((ctx) => Option.fromNullable(ctx as T | null | undefined)),
  )

/**
 * Get the middleware context, failing if not available.
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
