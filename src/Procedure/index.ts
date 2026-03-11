/**
 * Procedure - Define RPC endpoints
 * 
 * @since 1.0.0
 * @module
 */

import { Effect, Stream, Schema } from "effect"

// =============================================================================
// Types
// =============================================================================

/**
 * @since 1.0.0
 * @category models
 */
export type ProcedureType = "Query" | "Mutation" | "Stream"

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryDef<Payload, Success, Error, Requirements> {
  readonly _tag: "Query"
  readonly payload: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error: Schema.Schema<Error, unknown>
  readonly handler: ((payload: Payload) => Effect.Effect<Success, Error, Requirements>) | undefined
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationDef<Payload, Success, Error, Requirements> {
  readonly _tag: "Mutation"
  readonly payload: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error: Schema.Schema<Error, unknown>
  readonly invalidates: ReadonlyArray<string>
  readonly optimistic?: OptimisticConfig<any, Payload, Success>
  readonly handler: ((payload: Payload) => Effect.Effect<Success, Error, Requirements>) | undefined
}

/**
 * @since 1.0.0
 * @category models
 */
export interface OptimisticConfig<Target, Payload, Success> {
  readonly target: string
  readonly reducer: (current: Target, payload: Payload) => Target
  readonly reconcile?: (current: Target, payload: Payload, result: Success) => Target
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamDef<Payload, Success, Error, Requirements> {
  readonly _tag: "Stream"
  readonly payload: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error: Schema.Schema<Error, unknown>
  readonly handler: ((payload: Payload) => Stream.Stream<Success, Error, Requirements>) | undefined
}

/**
 * @since 1.0.0
 * @category models
 */
export type AnyDef =
  | QueryDef<any, any, any, any>
  | MutationDef<any, any, any, any>
  | StreamDef<any, any, any, any>

/**
 * A family of procedures with a namespace
 * @since 1.0.0
 */
export interface Family<Name extends string, Procedures extends Record<string, AnyDef>> {
  readonly _tag: "Family"
  readonly name: Name
  readonly procedures: Procedures
  readonly middleware: ReadonlyArray<unknown>
  
  /** Apply middleware to all procedures in this family */
  readonly withMiddleware: <M>(middleware: M) => Family<Name, Procedures>
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryOptions<Payload, Success, Error, Requirements> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly handler?: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
}

/**
 * Create a query procedure (read-only, cacheable)
 * 
 * @since 1.0.0
 * @category constructors
 */
export const query = <
  Payload = void,
  Success = unknown,
  Error = never,
  Requirements = never
>(
  options: QueryOptions<Payload, Success, Error, Requirements>
): QueryDef<Payload, Success, Error, Requirements> => ({
  _tag: "Query",
  payload: (options.payload ?? Schema.Void) as Schema.Schema<Payload, unknown>,
  success: options.success,
  error: (options.error ?? Schema.Never) as Schema.Schema<Error, unknown>,
  handler: options.handler,
})

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationOptions<Payload, Success, Error, Requirements, Target = unknown> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly invalidates: ReadonlyArray<string>
  readonly optimistic?: OptimisticConfig<Target, Payload, Success>
  readonly handler?: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
}

/**
 * Create a mutation procedure (writes, invalidates cache)
 * 
 * @since 1.0.0
 * @category constructors
 */
export const mutation = <
  Payload = void,
  Success = unknown,
  Error = never,
  Requirements = never,
  Target = unknown
>(
  options: MutationOptions<Payload, Success, Error, Requirements, Target>
): MutationDef<Payload, Success, Error, Requirements> => ({
  _tag: "Mutation",
  payload: (options.payload ?? Schema.Void) as Schema.Schema<Payload, unknown>,
  success: options.success,
  error: (options.error ?? Schema.Never) as Schema.Schema<Error, unknown>,
  invalidates: options.invalidates,
  optimistic: options.optimistic,
  handler: options.handler,
})

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamOptions<Payload, Success, Error, Requirements> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly handler?: (payload: Payload) => Stream.Stream<Success, Error, Requirements>
}

/**
 * Create a stream procedure (SSE streaming)
 * 
 * @since 1.0.0
 * @category constructors
 */
export const stream = <
  Payload = void,
  Success = unknown,
  Error = never,
  Requirements = never
>(
  options: StreamOptions<Payload, Success, Error, Requirements>
): StreamDef<Payload, Success, Error, Requirements> => ({
  _tag: "Stream",
  payload: (options.payload ?? Schema.Void) as Schema.Schema<Payload, unknown>,
  success: options.success,
  error: (options.error ?? Schema.Never) as Schema.Schema<Error, unknown>,
  handler: options.handler,
})

/**
 * Create a family of procedures with a namespace
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const UserProcedures = Procedure.family("user", {
 *   list: Procedure.query({ ... }),
 *   create: Procedure.mutation({ ... }),
 * })
 * ```
 */
export const family = <
  Name extends string,
  Procedures extends Record<string, AnyDef>
>(
  name: Name,
  procedures: Procedures
): Family<Name, Procedures> => ({
  _tag: "Family",
  name,
  procedures,
  middleware: [],
  withMiddleware: <M>(middleware: M) => ({
    _tag: "Family" as const,
    name,
    procedures,
    middleware: [...[], middleware],
    withMiddleware: (m: any) => family(name, procedures).withMiddleware(m),
  }),
})

// Alias for chaining
export { family as namespace }

// =============================================================================
// Type helpers
// =============================================================================

/**
 * Extract payload type from a procedure
 * @since 1.0.0
 */
export type PayloadOf<P extends AnyDef> = P extends QueryDef<infer Payload, any, any, any>
  ? Payload
  : P extends MutationDef<infer Payload, any, any, any>
    ? Payload
    : P extends StreamDef<infer Payload, any, any, any>
      ? Payload
      : never

/**
 * Extract success type from a procedure
 * @since 1.0.0
 */
export type SuccessOf<P extends AnyDef> = P extends QueryDef<any, infer Success, any, any>
  ? Success
  : P extends MutationDef<any, infer Success, any, any>
    ? Success
    : P extends StreamDef<any, infer Success, any, any>
      ? Success
      : never

/**
 * Extract error type from a procedure
 * @since 1.0.0
 */
export type ErrorOf<P extends AnyDef> = P extends QueryDef<any, any, infer Error, any>
  ? Error
  : P extends MutationDef<any, any, infer Error, any>
    ? Error
    : P extends StreamDef<any, any, infer Error, any>
      ? Error
      : never
