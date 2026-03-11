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
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
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
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
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
  readonly handler: (payload: Payload) => Stream.Stream<Success, Error, Requirements>
}

/**
 * @since 1.0.0
 * @category models
 */
export type AnyDef =
  | QueryDef<any, any, any, any>
  | MutationDef<any, any, any, any>
  | StreamDef<any, any, any, any>

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
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
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
export interface MutationOptions<Payload, Success, Error, Requirements> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly invalidates: ReadonlyArray<string>
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
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
  Requirements = never
>(
  options: MutationOptions<Payload, Success, Error, Requirements>
): MutationDef<Payload, Success, Error, Requirements> => ({
  _tag: "Mutation",
  payload: (options.payload ?? Schema.Void) as Schema.Schema<Payload, unknown>,
  success: options.success,
  error: (options.error ?? Schema.Never) as Schema.Schema<Error, unknown>,
  invalidates: options.invalidates,
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
  readonly handler: (payload: Payload) => Stream.Stream<Success, Error, Requirements>
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
