/**
 * @module effect-trpc/core/server/procedure
 *
 * Procedure builder API for defining type-safe RPC endpoints.
 *
 * Procedures track ALL requirements (middleware services + their dependencies + handler dependencies)
 * in a unified R channel via Effect's type system. Terminal methods like `.query()` and `.mutation()`
 * return `Effect<ProcedureDefinition, never, R>` enabling automatic requirement tracking.
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import type {
  AnyMiddlewareDefinition,
  BaseContext,
  MiddlewareDefinition,
  MiddlewareContextIn,
  MiddlewareContextOut,
  MiddlewareError,
  MiddlewareInput,
  MiddlewareService,
} from "./middleware.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProcedureType = "query" | "mutation" | "stream" | "chat" | "subscription"

export type ProcedureHandlerResult<A, E, Type extends ProcedureType, R> = Type extends
  | "stream"
  | "chat"
  ? Stream.Stream<A, E, R>
  : Effect.Effect<A, E, R>

export interface ProcedureService<Ctx, I, A, E, Type extends ProcedureType = ProcedureType> {
  readonly handler: (ctx: Ctx, input: I) => ProcedureHandlerResult<A, E, Type, unknown>
}

/**
 * A procedure definition (contract only).
 *
 * Simplified to 5 type parameters:
 * - I: Input type
 * - A: Output type
 * - E: Error type
 * - Ctx: Context type (accumulated from middleware)
 * - Type: Procedure type (query, mutation, stream, etc.)
 *
 * Requirements (R) are tracked at the Effect level, not here.
 */
export interface ProcedureDefinition<
  I = unknown,
  A = unknown,
  E = unknown,
  Ctx extends BaseContext = BaseContext,
  Type extends ProcedureType = ProcedureType,
> {
  readonly _tag: "ProcedureDefinition"
  readonly type: Type
  readonly description?: string
  readonly summary?: string
  readonly externalDocs?: string
  readonly responseDescription?: string
  readonly deprecated?: boolean
  readonly inputSchema: Schema.Schema<I, unknown> | undefined
  readonly outputSchema: Schema.Schema<A, unknown> | undefined
  readonly errorSchema: Schema.Schema<E, unknown> | undefined
  readonly tags: ReadonlyArray<string>
  readonly invalidates: ReadonlyArray<string>
  readonly invalidatesTags: ReadonlyArray<string>
  readonly middlewares: ReadonlyArray<AnyMiddlewareDefinition>
  readonly requiredTags: ReadonlyArray<Context.Tag<any, any>>

  /**
   * Service tag for retrieving the procedure implementation at runtime.
   * @internal
   */
  readonly serviceTag: Context.Tag<
    ProcedureService<Ctx, I, A, E, Type>,
    ProcedureService<Ctx, I, A, E, Type>
  >

  // Phantom type for context
  readonly _contextType?: Ctx
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference
// ─────────────────────────────────────────────────────────────────────────────

export type InferProcedureContext<T> =
  T extends ProcedureDefinition<any, any, any, infer Ctx, any> ? Ctx : BaseContext

export type InferProcedureInput<T> =
  T extends ProcedureDefinition<infer I, any, any, any, any> ? I : unknown

export type InferProcedureOutput<T> =
  T extends ProcedureDefinition<any, infer A, any, any, any> ? A : unknown

export type InferProcedureError<T> =
  T extends ProcedureDefinition<any, any, infer E, any, any> ? E : unknown

export type InferProcedureType<T> =
  T extends ProcedureDefinition<any, any, any, any, infer Type> ? Type : ProcedureType

/**
 * Extract requirements from a procedure Effect.
 */
export type InferProcedureRequirements<T> =
  T extends Effect.Effect<ProcedureDefinition<any, any, any, any, any>, any, infer R> ? R : never

// Legacy type aliases for backwards compatibility during migration
export type InferProcedureMiddlewareR<T> = never
export type InferProcedureProvides<T> = never
export type InferProcedureMiddlewareReqs<T> = InferProcedureRequirements<T>

export type ApplyMiddlewareToProcedure<P, M> =
  P extends ProcedureDefinition<
    infer I,
    infer A,
    infer E,
    infer Ctx extends BaseContext,
    infer Type extends ProcedureType
  >
    ? M extends MiddlewareDefinition<infer MCtxIn, infer MCtxOut, infer MInput, infer MError>
      ? Ctx extends MiddlewareContextIn<M>
        ? ProcedureDefinition<
            I & MiddlewareInput<M>,
            A,
            E | MiddlewareError<M>,
            Ctx & MiddlewareContextOut<M>,
            Type
          >
        : never
      : never
    : never

const mergeInputSchemaWithMiddleware = (
  procedureInputSchema: Schema.Schema<unknown, unknown> | undefined,
  middlewareInputSchema: Schema.Schema<unknown, unknown> | undefined,
): Schema.Schema<unknown, unknown> | undefined => {
  if (procedureInputSchema === undefined) {
    return middlewareInputSchema
  }
  if (middlewareInputSchema === undefined) {
    return procedureInputSchema
  }

  return extendStructSchemas(procedureInputSchema, middlewareInputSchema)
}

const mergeErrorSchemas = (
  procedureErrorSchema: Schema.Schema<unknown, unknown> | undefined,
  middlewareErrorSchemas: ReadonlyArray<Schema.Schema<unknown, unknown>> | undefined,
): Schema.Schema<unknown, unknown> | undefined => {
  const schemas: Array<Schema.Schema<unknown, unknown>> = []

  if (procedureErrorSchema !== undefined) {
    schemas.push(procedureErrorSchema)
  }
  if (middlewareErrorSchemas !== undefined) {
    schemas.push(...middlewareErrorSchemas)
  }

  if (schemas.length === 0) {
    return undefined
  }
  if (schemas.length === 1) {
    return schemas[0]
  }

  return Schema.Union(
    ...(schemas as [Schema.Schema<unknown, unknown>, ...Array<Schema.Schema<unknown, unknown>>]),
  ) as unknown as Schema.Schema<unknown, unknown>
}

/**
 * Runtime helper for extending object schemas whose exact field types are
 * computed dynamically while preserving a typed boundary.
 */
const extendStructSchemas = (
  left: Schema.Schema<unknown, unknown>,
  right: Schema.Schema<unknown, unknown>,
): Schema.Schema<unknown, unknown> =>
  Schema.extend(
    left as unknown as Schema.Struct<Record<string, Schema.Schema<unknown, unknown>>>,
    right as unknown as Schema.Struct<Record<string, Schema.Schema<unknown, unknown>>>,
  ) as unknown as Schema.Schema<unknown, unknown>

export function applyMiddlewareToProcedure<
  P extends ProcedureDefinition<unknown, unknown, unknown, BaseContext, ProcedureType>,
  M extends AnyMiddlewareDefinition,
>(definition: P, middleware: M): ApplyMiddlewareToProcedure<P, M>
export function applyMiddlewareToProcedure<
  P extends ProcedureDefinition<unknown, unknown, unknown, BaseContext, ProcedureType>,
  M extends AnyMiddlewareDefinition,
>(definition: P, middleware: M) {
  const nextInputSchema = mergeInputSchemaWithMiddleware(
    definition.inputSchema as Schema.Schema<unknown, unknown> | undefined,
    middleware.inputSchema as Schema.Schema<unknown, unknown> | undefined,
  )
  const nextErrorSchema = mergeErrorSchemas(
    definition.errorSchema as Schema.Schema<unknown, unknown> | undefined,
    middleware.errorSchemas as ReadonlyArray<Schema.Schema<unknown, unknown>> | undefined,
  )

  return {
    ...definition,
    inputSchema: nextInputSchema as typeof definition.inputSchema,
    errorSchema: nextErrorSchema as typeof definition.errorSchema,
    middlewares: [middleware, ...definition.middlewares],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procedure builder with unified requirement tracking.
 *
 * @typeParam I - Input type
 * @typeParam A - Output type
 * @typeParam E - Error type
 * @typeParam Ctx - Context type (accumulated from middleware)
 * @typeParam R - Requirements (all services needed: middleware + their deps + procedure deps)
 */
export interface ProcedureBuilder<
  I = unknown,
  A = unknown,
  E = unknown,
  Ctx extends BaseContext = BaseContext,
  R = never,
> {
  readonly description: (text: string) => ProcedureBuilder<I, A, E, Ctx, R>
  readonly summary: (text: string) => ProcedureBuilder<I, A, E, Ctx, R>
  readonly externalDocs: (url: string) => ProcedureBuilder<I, A, E, Ctx, R>
  readonly responseDescription: (text: string) => ProcedureBuilder<I, A, E, Ctx, R>
  readonly deprecated: () => ProcedureBuilder<I, A, E, Ctx, R>

  readonly input: <I2, IFrom = I2>(
    schema: Schema.Schema<I2, IFrom>,
  ) => ProcedureBuilder<I & I2, A, E, Ctx, R>

  readonly output: <A2, AFrom = A2>(
    schema: Schema.Schema<A2, AFrom>,
  ) => ProcedureBuilder<I, A2, E, Ctx, R>

  readonly error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
    ...errors: Errors
  ) => ProcedureBuilder<I, A, E | Schema.Schema.Type<Errors[number]>, Ctx, R>

  /**
   * Declare services this procedure's handler will require.
   * Pass Context.Tag values - they carry both runtime identity and type.
   */
  requires<T1 extends Context.Tag<any, any>>(
    t1: T1,
  ): ProcedureBuilder<I, A, E, Ctx, R | Context.Tag.Service<T1>>

  requires<T1 extends Context.Tag<any, any>, T2 extends Context.Tag<any, any>>(
    t1: T1,
    t2: T2,
  ): ProcedureBuilder<I, A, E, Ctx, R | Context.Tag.Service<T1> | Context.Tag.Service<T2>>

  requires<
    T1 extends Context.Tag<any, any>,
    T2 extends Context.Tag<any, any>,
    T3 extends Context.Tag<any, any>,
  >(
    t1: T1,
    t2: T2,
    t3: T3,
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
  ): ProcedureBuilder<
    I,
    A,
    E,
    Ctx,
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
   * Apply middleware to this procedure.
   *
   * Accepts an Effect<MiddlewareDefinition, never, MR> where MR is the middleware's
   * declared requirements. Adds both MiddlewareService<...> and MR to this procedure's R.
   */
  readonly use: <CtxIn extends BaseContext, CtxOut extends BaseContext, InputExt, E2, MR>(
    middleware: Ctx extends CtxIn
      ? Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>, never, MR>
      : never,
  ) => ProcedureBuilder<
    I & InputExt,
    A,
    E | E2,
    Ctx & CtxOut,
    R | MiddlewareService<CtxIn, CtxOut, InputExt, E2> | MR
  >

  readonly tags: (tags: ReadonlyArray<string>) => ProcedureBuilder<I, A, E, Ctx, R>
  readonly invalidates: (paths: ReadonlyArray<string>) => ProcedureBuilder<I, A, E, Ctx, R>
  readonly invalidatesTags: (tags: ReadonlyArray<string>) => ProcedureBuilder<I, A, E, Ctx, R>

  /**
   * Create a query procedure. Returns Effect with R requirements.
   */
  readonly query: () => Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "query">, never, R>

  /**
   * Create a mutation procedure. Returns Effect with R requirements.
   */
  readonly mutation: () => Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "mutation">, never, R>

  /**
   * Create a streaming procedure. Returns Effect with R requirements.
   */
  readonly stream: () => Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "stream">, never, R>

  /**
   * Create a chat procedure. Returns Effect with R requirements.
   */
  readonly chat: () => Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "chat">, never, R>

  /**
   * Create a subscription procedure. Returns Effect with R requirements.
   */
  readonly subscription: () => Effect.Effect<
    ProcedureDefinition<I, A, E, Ctx, "subscription">,
    never,
    R
  >
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  description?: string
  summary?: string
  externalDocs?: string
  responseDescription?: string
  deprecated?: boolean
  inputSchema?: Schema.Schema<any, any>
  outputSchema?: Schema.Schema<any, any>
  errorSchemas: ReadonlyArray<Schema.Schema<any, any>>
  tags: ReadonlyArray<string>
  invalidates: ReadonlyArray<string>
  invalidatesTags: ReadonlyArray<string>
  middlewares: ReadonlyArray<AnyMiddlewareDefinition>
  requiredTags: ReadonlyArray<Context.Tag<any, any>>
}

const mergeInputSchemas = (
  middlewares: ReadonlyArray<AnyMiddlewareDefinition>,
  procedureInputSchema: Schema.Schema<unknown, unknown> | undefined,
): Schema.Schema<unknown, unknown> | undefined => {
  const middlewareSchemas = middlewares
    .map((m) => m.inputSchema)
    .filter((s): s is Schema.Schema<unknown, unknown> => s !== undefined)

  const allSchemas = [...middlewareSchemas]
  if (procedureInputSchema !== undefined) {
    allSchemas.push(procedureInputSchema)
  }

  if (allSchemas.length === 0) return undefined
  if (allSchemas.length === 1) return allSchemas[0]

  return allSchemas.reduce((merged, schema) => extendStructSchemas(merged, schema))
}

let procedureServiceCounter = 0

const createDefinition = <I, A, E, Ctx extends BaseContext, Type extends ProcedureType>(
  state: BuilderState,
  type: Type,
): ProcedureDefinition<I, A, E, Ctx, Type> => {
  const mergedInputSchema = mergeInputSchemas(state.middlewares, state.inputSchema)

  const errorSchema =
    state.errorSchemas.length === 0
      ? undefined
      : state.errorSchemas.length === 1
        ? state.errorSchemas[0]
        : Schema.Union(
            ...(state.errorSchemas as [Schema.Schema<any, any>, ...Schema.Schema<any, any>[]]),
          )

  const serviceTag = Context.GenericTag<ProcedureService<Ctx, I, A, E, Type>>(
    `@effect-trpc/ProcedureService/${procedureServiceCounter++}`,
  )

  const optionalFields = {
    ...(state.description !== undefined ? { description: state.description } : {}),
    ...(state.summary !== undefined ? { summary: state.summary } : {}),
    ...(state.externalDocs !== undefined ? { externalDocs: state.externalDocs } : {}),
    ...(state.responseDescription !== undefined
      ? { responseDescription: state.responseDescription }
      : {}),
    ...(state.deprecated !== undefined ? { deprecated: state.deprecated } : {}),
  }

  const definition: ProcedureDefinition<I, A, E, Ctx, Type> = {
    _tag: "ProcedureDefinition",
    type,
    ...optionalFields,
    inputSchema: mergedInputSchema as Schema.Schema<I, unknown> | undefined,
    outputSchema: state.outputSchema as Schema.Schema<A, unknown> | undefined,
    errorSchema: errorSchema as Schema.Schema<E, unknown> | undefined,
    tags: state.tags,
    invalidates: state.invalidates,
    invalidatesTags: state.invalidatesTags,
    middlewares: state.middlewares,
    requiredTags: state.requiredTags,
    serviceTag,
  }

  return definition
}

/**
 * Extract middleware definition from Effect synchronously.
 * Safe because middleware .provides() always returns Effect.succeed(definition).
 */
function extractMiddlewareDef<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E>(
  middlewareEffect: Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, I, E>, never, any>,
): MiddlewareDefinition<CtxIn, CtxOut, I, E> {
  let extracted: MiddlewareDefinition<CtxIn, CtxOut, I, E> | undefined
  Effect.runSync(
    Effect.map(
      middlewareEffect as Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, I, E>, never, never>,
      (def) => {
        extracted = def
      },
    ),
  )
  if (!extracted) {
    throw new Error("Failed to extract middleware definition")
  }
  return extracted
}

const createBuilder = <I, A, E, Ctx extends BaseContext, R>(
  state: BuilderState,
): ProcedureBuilder<I, A, E, Ctx, R> =>
  ({
    description: (text: string) => createBuilder<I, A, E, Ctx, R>({ ...state, description: text }),
    summary: (text: string) => createBuilder<I, A, E, Ctx, R>({ ...state, summary: text }),
    externalDocs: (url: string) => createBuilder<I, A, E, Ctx, R>({ ...state, externalDocs: url }),
    responseDescription: (text: string) =>
      createBuilder<I, A, E, Ctx, R>({
        ...state,
        responseDescription: text,
      }),
    deprecated: () => createBuilder<I, A, E, Ctx, R>({ ...state, deprecated: true }),

    requires: (...tags: Context.Tag<any, any>[]): ProcedureBuilder<I, A, E, Ctx, any> =>
      createBuilder<I, A, E, Ctx, any>({
        ...state,
        requiredTags: [...state.requiredTags, ...tags],
      }),

    use: <CtxIn extends BaseContext, CtxOut extends BaseContext, InputExt, E2, MR>(
      middlewareEffect: Ctx extends CtxIn
        ? Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>, never, MR>
        : never,
    ) => {
      // Extract the middleware definition synchronously
      const middleware = extractMiddlewareDef(
        middlewareEffect as Effect.Effect<
          MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>,
          never,
          MR
        >,
      )

      return createBuilder<
        I & InputExt,
        A,
        E | E2,
        Ctx & CtxOut,
        R | MiddlewareService<CtxIn, CtxOut, InputExt, E2> | MR
      >({
        ...state,
        middlewares: [...state.middlewares, middleware as AnyMiddlewareDefinition],
        // Also collect middleware's required tags for runtime
        requiredTags: [...state.requiredTags, ...middleware.requiredTags],
      })
    },

    input: <I2>(schema: Schema.Schema<I2, unknown>) => {
      const nextInputSchema = state.inputSchema
        ? (extendStructSchemas(
            state.inputSchema as Schema.Schema<unknown, unknown>,
            schema as Schema.Schema<unknown, unknown>,
          ) as Schema.Schema<I & I2, unknown>)
        : schema

      return createBuilder<I & I2, A, E, Ctx, R>({
        ...state,
        inputSchema: nextInputSchema,
      })
    },

    output: <A2>(schema: Schema.Schema<A2, any>) =>
      createBuilder<I, A2, E, Ctx, R>({
        ...state,
        outputSchema: schema,
      }),

    error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(...errors: Errors) =>
      createBuilder<I, A, E | Schema.Schema.Type<Errors[number]>, Ctx, R>({
        ...state,
        errorSchemas: [...state.errorSchemas, ...errors],
      }),

    tags: (tags: ReadonlyArray<string>) => createBuilder<I, A, E, Ctx, R>({ ...state, tags }),
    invalidates: (paths: ReadonlyArray<string>) =>
      createBuilder<I, A, E, Ctx, R>({ ...state, invalidates: paths }),
    invalidatesTags: (tags: ReadonlyArray<string>) =>
      createBuilder<I, A, E, Ctx, R>({ ...state, invalidatesTags: tags }),

    query: (): Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "query">, never, R> => {
      const definition = createDefinition<I, A, E, Ctx, "query">(state, "query")
      return Effect.succeed(definition) as Effect.Effect<
        ProcedureDefinition<I, A, E, Ctx, "query">,
        never,
        R
      >
    },

    mutation: (): Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "mutation">, never, R> => {
      const definition = createDefinition<I, A, E, Ctx, "mutation">(state, "mutation")
      return Effect.succeed(definition) as Effect.Effect<
        ProcedureDefinition<I, A, E, Ctx, "mutation">,
        never,
        R
      >
    },

    stream: (): Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "stream">, never, R> => {
      const definition = createDefinition<I, A, E, Ctx, "stream">(state, "stream")
      return Effect.succeed(definition) as Effect.Effect<
        ProcedureDefinition<I, A, E, Ctx, "stream">,
        never,
        R
      >
    },

    chat: (): Effect.Effect<ProcedureDefinition<I, A, E, Ctx, "chat">, never, R> => {
      const definition = createDefinition<I, A, E, Ctx, "chat">(state, "chat")
      return Effect.succeed(definition) as Effect.Effect<
        ProcedureDefinition<I, A, E, Ctx, "chat">,
        never,
        R
      >
    },

    subscription: (): Effect.Effect<
      ProcedureDefinition<I, A, E, Ctx, "subscription">,
      never,
      R
    > => {
      const definition = createDefinition<I, A, E, Ctx, "subscription">(state, "subscription")
      return Effect.succeed(definition) as Effect.Effect<
        ProcedureDefinition<I, A, E, Ctx, "subscription">,
        never,
        R
      >
    },
  }) as ProcedureBuilder<I, A, E, Ctx, R>

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Layer that implements a procedure.
 *
 * @param definition - Effect containing the procedure definition
 * @param handler - Implementation function
 * @returns Layer that provides the ProcedureService
 */
function procedureToLayer<
  I,
  A,
  E,
  Ctx extends BaseContext,
  Type extends ProcedureType,
  DeclaredR,
  HandlerR,
>(
  definition: Effect.Effect<ProcedureDefinition<I, A, E, Ctx, Type>, never, DeclaredR>,
  handler: (ctx: Ctx, input: I) => ProcedureHandlerResult<A, E, Type, HandlerR>,
): Layer.Layer<ProcedureService<Ctx, I, A, E, Type>, never, DeclaredR | HandlerR> {
  // Extract the definition synchronously
  let extractedDef: ProcedureDefinition<I, A, E, Ctx, Type> | undefined
  Effect.runSync(
    Effect.map(
      definition as Effect.Effect<ProcedureDefinition<I, A, E, Ctx, Type>, never, never>,
      (def) => {
        extractedDef = def
      },
    ),
  )

  if (!extractedDef) {
    throw new Error("Failed to extract procedure definition")
  }

  const service: ProcedureService<Ctx, I, A, E, Type> = { handler }
  return Layer.succeed(extractedDef.serviceTag, service) as Layer.Layer<
    ProcedureService<Ctx, I, A, E, Type>,
    never,
    DeclaredR | HandlerR
  >
}

/**
 * Procedure builder and utilities.
 */
export interface ProcedureFactory
  extends ProcedureBuilder<unknown, unknown, never, BaseContext, never> {
  /**
   * Create a Layer that implements a procedure.
   */
  toLayer: typeof procedureToLayer
}

/**
 * Entry point for building procedures.
 *
 * @example
 * ```ts
 * const createUser = procedure
 *   .use(AuthMiddleware)
 *   .requires(Database, EmailService)
 *   .input(CreateUserSchema)
 *   .output(UserSchema)
 *   .error(ValidationError, ConflictError)
 *   .mutation()
 * // Type: Effect<ProcedureDefinition<...>, never, AuthMiddlewareService | SessionService | Database | EmailService>
 * ```
 */
export const procedure: ProcedureFactory = Object.assign(
  createBuilder<unknown, unknown, never, BaseContext, never>({
    errorSchemas: [],
    tags: [],
    invalidates: [],
    invalidatesTags: [],
    middlewares: [],
    requiredTags: [],
  }),
  { toLayer: procedureToLayer },
)

// For compatibility - also export as Procedure
export const Procedure = {
  toLayer: procedureToLayer,
}
