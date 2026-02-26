/**
 * @module effect-trpc/core/server/procedure
 *
 * Procedure builder API for defining type-safe RPC endpoints.
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
} from "./middleware.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProcedureType = "query" | "mutation" | "stream" | "chat" | "subscription"

export type ProcedureHandlerResult<
  A,
  E,
  Type extends ProcedureType,
  R,
> = Type extends "stream" | "chat"
  ? Stream.Stream<A, E, R>
  : Effect.Effect<A, E, R>

export interface ProcedureService<Ctx, I, A, E, Type extends ProcedureType = ProcedureType> {
  readonly handler: (ctx: Ctx, input: I) => ProcedureHandlerResult<A, E, Type, unknown>
}

export interface ProcedureDefinition<
  I = unknown,
  A = unknown,
  E = unknown,
  Ctx extends BaseContext = BaseContext,
  Type extends ProcedureType = ProcedureType,
  R = never,
  Provides = never
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

  /**
   * Service tag for retrieving the procedure implementation at runtime.
   * @internal
   */
  readonly serviceTag: Context.Tag<
    ProcedureService<Ctx, I, A, E, Type>,
    ProcedureService<Ctx, I, A, E, Type>
  >

  readonly toLayer: <R2>(
    handler: (ctx: Ctx, input: I) => ProcedureHandlerResult<A, E, Type, R2>
  ) => Layer.Layer<ProcedureService<Ctx, I, A, E, Type>, never, R2>

  // Phantom types
  readonly _contextType?: Ctx
  readonly _middlewareR?: R
  readonly _provides?: Provides
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference
// ─────────────────────────────────────────────────────────────────────────────

export type InferProcedureContext<T> =
  T extends ProcedureDefinition<any, any, any, infer Ctx, any, any, any> ? Ctx : BaseContext

export type InferProcedureInput<T> =
  T extends ProcedureDefinition<infer I, any, any, any, any, any, any> ? I : unknown

export type InferProcedureOutput<T> =
  T extends ProcedureDefinition<any, infer A, any, any, any, any, any> ? A : unknown

export type InferProcedureError<T> =
  T extends ProcedureDefinition<any, any, infer E, any, any, any, any> ? E : unknown

export type InferProcedureMiddlewareR<T> =
  T extends ProcedureDefinition<any, any, any, any, any, infer R, any> ? R : never

export type InferProcedureProvides<T> =
  T extends ProcedureDefinition<any, any, any, any, any, any, infer Provides> ? Provides : never

export type ApplyMiddlewareToProcedure<P, M> =
  P extends ProcedureDefinition<
    infer I,
    infer A,
    infer E,
    infer Ctx extends BaseContext,
    infer Type extends ProcedureType,
    infer R,
    infer Provides
  >
    ? M extends AnyMiddlewareDefinition
      ? Ctx extends MiddlewareContextIn<M>
        ? ProcedureDefinition<
          I & MiddlewareInput<M>,
          A,
          E | MiddlewareError<M>,
          Ctx & MiddlewareContextOut<M>,
          Type,
          R,
          Provides
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
    left as unknown as Schema.Struct<
      Record<string, Schema.Schema<unknown, unknown>>
    >,
    right as unknown as Schema.Struct<
      Record<string, Schema.Schema<unknown, unknown>>
    >,
  ) as unknown as Schema.Schema<unknown, unknown>

export function applyMiddlewareToProcedure<
  P extends ProcedureDefinition<
    unknown,
    unknown,
    unknown,
    BaseContext,
    ProcedureType,
    unknown,
    unknown
  >,
  M extends AnyMiddlewareDefinition,
>(
  definition: P,
  middleware: M,
): ApplyMiddlewareToProcedure<P, M>
export function applyMiddlewareToProcedure<
  P extends ProcedureDefinition<
    unknown,
    unknown,
    unknown,
    BaseContext,
    ProcedureType,
    unknown,
    unknown
  >,
  M extends AnyMiddlewareDefinition,
>(
  definition: P,
  middleware: M,
) {
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

export interface ProcedureBuilder<
  I = unknown,
  A = unknown,
  E = unknown,
  Ctx extends BaseContext = BaseContext,
  R = never,
  Provides = never
> {
  readonly description: (text: string) => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  readonly summary: (text: string) => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  readonly externalDocs: (url: string) => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  readonly responseDescription: (text: string) => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  readonly deprecated: () => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  
  readonly input: <I2, IFrom = I2>(schema: Schema.Schema<I2, IFrom>) => ProcedureBuilder<I & I2, A, E, Ctx, R, Provides>
  readonly output: <A2, AFrom = A2>(schema: Schema.Schema<A2, AFrom>) => ProcedureBuilder<I, A2, E, Ctx, R, Provides>
  readonly error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
    ...errors: Errors
  ) => ProcedureBuilder<I, A, E | Schema.Schema.Type<Errors[number]>, Ctx, R, Provides>
  
  readonly use: <CtxIn extends BaseContext, CtxOut extends BaseContext, InputExt, E2>(
    middleware: Ctx extends CtxIn ? MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2> : never
  ) => ProcedureBuilder<
    I & InputExt,
    A,
    E | E2,
    Ctx & CtxOut,
    R,
    Provides
  >
  
  readonly tags: (tags: ReadonlyArray<string>) => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  readonly invalidates: (paths: ReadonlyArray<string>) => ProcedureBuilder<I, A, E, Ctx, R, Provides>
  readonly invalidatesTags: (tags: ReadonlyArray<string>) => ProcedureBuilder<I, A, E, Ctx, R, Provides>

  readonly query: () => ProcedureDefinition<I, A, E, Ctx, "query", R, Provides>
  readonly mutation: () => ProcedureDefinition<I, A, E, Ctx, "mutation", R, Provides>
  readonly stream: () => ProcedureDefinition<I, A, E, Ctx, "stream", R, Provides>
  readonly chat: () => ProcedureDefinition<I, A, E, Ctx, "chat", R, Provides>
  readonly subscription: () => ProcedureDefinition<I, A, E, Ctx, "subscription", R, Provides>
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

const createDefinition = <
  I,
  A,
  E,
  Ctx extends BaseContext,
  Type extends ProcedureType,
  R = never,
  Provides = never,
>(
  state: BuilderState,
  type: Type,
): ProcedureDefinition<I, A, E, Ctx, Type, R, Provides> => {
  const mergedInputSchema = mergeInputSchemas(state.middlewares, state.inputSchema)
  
  const errorSchema = state.errorSchemas.length === 0 
    ? undefined 
    : state.errorSchemas.length === 1 
      ? state.errorSchemas[0] 
      : Schema.Union(...(state.errorSchemas as [Schema.Schema<any, any>, ...Schema.Schema<any, any>[]]))

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

  const definition: ProcedureDefinition<I, A, E, Ctx, Type, R, Provides> = {
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
    serviceTag,
    toLayer: <R2>(
      handler: (ctx: Ctx, input: I) => ProcedureHandlerResult<A, E, Type, R2>,
    ) => {
      const service: ProcedureService<Ctx, I, A, E, Type> = {
        handler,
      }
      return Layer.succeed(
        serviceTag,
        service,
      )
    }
  }

  return definition
}

const createBuilder = <I, A, E, Ctx extends BaseContext, R = never, Provides = never>(
  state: BuilderState,
): ProcedureBuilder<I, A, E, Ctx, R, Provides> =>
  ({
    description: (text: string) => createBuilder({ ...state, description: text }),
    summary: (text: string) => createBuilder({ ...state, summary: text }),
    externalDocs: (url: string) => createBuilder({ ...state, externalDocs: url }),
    responseDescription: (text: string) => createBuilder({ ...state, responseDescription: text }),
    deprecated: () => createBuilder({ ...state, deprecated: true }),
    
    use: <CtxIn extends BaseContext, CtxOut extends BaseContext, InputExt, E2>(
      middleware: Ctx extends CtxIn ? MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2> : never,
    ) => createBuilder<
      I & InputExt,
      A,
      E | E2,
      Ctx & CtxOut,
      R,
      Provides
    >({
      ...state,
      middlewares: [...state.middlewares, middleware as AnyMiddlewareDefinition],
    }),
    
    input: <I2>(schema: Schema.Schema<I2, unknown>) => {
      const nextInputSchema = state.inputSchema
        ? (extendStructSchemas(
          state.inputSchema as Schema.Schema<unknown, unknown>,
          schema as Schema.Schema<unknown, unknown>,
        ) as Schema.Schema<I & I2, unknown>)
        : schema

      return createBuilder<I & I2, A, E, Ctx, R, Provides>({
        ...state,
        inputSchema: nextInputSchema,
      })
    },
    
    output: <A2>(schema: Schema.Schema<A2, any>) => createBuilder<I, A2, E, Ctx, R, Provides>({ 
      ...state, 
      outputSchema: schema 
    }),
    
    error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(...errors: Errors) => createBuilder<I, A, E | Schema.Schema.Type<Errors[number]>, Ctx, R, Provides>({ 
      ...state, 
      errorSchemas: [...state.errorSchemas, ...errors] 
    }),
    
    tags: (tags: ReadonlyArray<string>) => createBuilder({ ...state, tags }),
    invalidates: (paths: ReadonlyArray<string>) => createBuilder({ ...state, invalidates: paths }),
    invalidatesTags: (tags: ReadonlyArray<string>) => createBuilder({ ...state, invalidatesTags: tags }),

    query: () => createDefinition(state, "query"),
    mutation: () => createDefinition(state, "mutation"),
    stream: () => createDefinition(state, "stream"),
    chat: () => createDefinition(state, "chat"),
    subscription: () => createDefinition(state, "subscription"),
  }) as ProcedureBuilder<I, A, E, Ctx, R, Provides>

export const procedure: ProcedureBuilder<unknown, unknown, never, BaseContext, never, never> =
  createBuilder<unknown, unknown, never, BaseContext, never, never>({
    errorSchemas: [],
    tags: [],
    invalidates: [],
    invalidatesTags: [],
    middlewares: [],
  })
