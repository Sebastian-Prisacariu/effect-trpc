/**
 * @module effect-trpc/core/server/middleware
 *
 * Middleware system for effect-trpc with builder pattern.
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
 *
 * Call `.toLayer()` to provide the implementation.
 */
export interface MiddlewareDefinition<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
> extends Pipeable {
  readonly [MiddlewareDefinitionTypeId]: MiddlewareDefinitionTypeId
  readonly _tag: "MiddlewareDefinition"
  readonly name: string

  /** Input schema (if any). @internal */
  readonly inputSchema?: Schema.Schema<I, unknown>

  /** Error schemas (if any). @internal */
  readonly errorSchemas?: ReadonlyArray<Schema.Schema<any, any>>

  /**
   * Service tag for retrieving the middleware implementation at runtime.
   * @internal
   */
  readonly serviceTag: Context.Tag<MiddlewareService<CtxIn, CtxOut, I, E>, MiddlewareService<CtxIn, CtxOut, I, E>>

  /**
   * Create a Layer that implements this middleware.
   *
   * Handler receives `(ctx, input)` and returns `Effect<CtxOut, E, R>`.
   * Return the FULL context (spread existing + add new fields).
   */
  toLayer<R>(
    handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, R>,
  ): Layer.Layer<MiddlewareService<CtxIn, CtxOut, I, E>, never, R>
}

export interface AnyMiddlewareDefinition extends Pipeable {
  readonly _tag: "MiddlewareDefinition"
  readonly name: string
  readonly inputSchema?: unknown
  readonly errorSchemas?: ReadonlyArray<Schema.Schema<any, any>>
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
export interface MiddlewareService<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
> {
  readonly handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, any>
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builder interface for constructing middleware definitions.
 */
export interface MiddlewareBuilder<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
> {
  /**
   * Add input requirements to this middleware.
   * When applied to a procedure, these fields are added to the procedure's input.
   */
  input<I2, IFrom = I2>(
    schema: Schema.Schema<I2, IFrom>,
  ): MiddlewareBuilder<CtxIn, CtxOut, I & I2, E>

  /**
   * Declare error types this middleware can produce.
   * Accepts varargs - each error class must extend Schema.TaggedError.
   */
  error<Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
    ...errors: Errors
  ): MiddlewareBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>>

  /**
   * Declare what context this middleware provides.
   * The implementation must return `{ ...ctx, ...additions }`.
   */
  provides<Additions extends object>(): MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E>
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder State & Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  readonly name: string
  readonly inputSchema?: Schema.Schema<any, any>
  readonly errorSchemas: ReadonlyArray<Schema.Schema<any, any>>
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



function createBuilder<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E>(
  state: BuilderState,
): MiddlewareBuilder<CtxIn, CtxOut, I, E> {
  const self = Object.create(BuilderProto) as MiddlewareBuilder<CtxIn, CtxOut, I, E>

  return Object.assign(self, {
    input: <I2, IFrom = I2>(
      schema: Schema.Schema<I2, IFrom>,
    ): MiddlewareBuilder<CtxIn, CtxOut, I & I2, E> => {
      const mergedSchema = state.inputSchema
        ? Schema.extend(
            state.inputSchema as Schema.Schema<I & object, unknown>,
            schema as Schema.Schema<I2 & object, IFrom>,
          )
        : schema

      return createBuilder<CtxIn, CtxOut, I & I2, E>({
        ...state,
        inputSchema: mergedSchema as Schema.Schema<I & I2, unknown>,
      })
    },

    error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
      ...errors: Errors
    ): MiddlewareBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>> => {
      return createBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>>({
        ...state,
        errorSchemas: [...state.errorSchemas, ...errors],
      })
    },

    provides: <Additions extends object>(): MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E> => {
      return createDefinition<CtxIn, CtxIn & Additions, I, E>(state)
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
    serviceTag: ServiceTag,

    toLayer: <R>(
      handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, R>,
    ): Layer.Layer<MiddlewareService<CtxIn, CtxOut, I, E>, never, R> => {
      return Layer.succeed(ServiceTag, { handler })
    },
  })
}



// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a middleware definition using the builder pattern.
 *
 * @param name - Unique name for this middleware (used for service tag)
 * @template CtxIn - The input context type this middleware expects (default: BaseContext)
 */
export function Middleware<CtxIn extends BaseContext = BaseContext>(
  name: string,
): MiddlewareBuilder<CtxIn, CtxIn, unknown, never> {
  return createBuilder<CtxIn, CtxIn, unknown, never>({
    name,
    errorSchemas: [],
  })
}

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
  M extends MiddlewareDefinition<any, any, infer I, any>
    ? I
    : unknown

export type MiddlewareError<M> =
  M extends MiddlewareDefinition<any, any, any, infer E>
    ? E
    : never

export type MiddlewareContextOut<M> =
  M extends MiddlewareDefinition<any, infer CtxOut, any, any>
    ? CtxOut
    : BaseContext

export type MiddlewareContextIn<M> =
  M extends MiddlewareDefinition<infer CtxIn, any, any, any>
    ? CtxIn
    : BaseContext

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
