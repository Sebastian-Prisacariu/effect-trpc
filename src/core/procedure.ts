/**
 * @module effect-trpc/core/procedure
 * 
 * Declarative procedure definitions — query() and mutation() wrappers.
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Definition Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcedureMeta {
  readonly description?: string
  readonly deprecated?: boolean
  readonly tags?: ReadonlyArray<string>
}

/**
 * Query definition — read-only, cacheable.
 */
export interface QueryDefinition<TInput = void, TOutput = unknown> {
  readonly _tag: "QueryDefinition"
  readonly type: "query"
  readonly input: Schema.Schema<TInput, unknown> | undefined
  readonly output: Schema.Schema<TOutput, unknown>
  readonly meta: ProcedureMeta
  readonly invalidates?: never
}

/**
 * Mutation definition — write operation, can invalidate queries.
 */
export interface MutationDefinition<TInput = void, TOutput = unknown> {
  readonly _tag: "MutationDefinition"
  readonly type: "mutation"
  readonly input: Schema.Schema<TInput, unknown> | undefined
  readonly output: Schema.Schema<TOutput, unknown>
  readonly meta: ProcedureMeta
  readonly invalidates: ReadonlyArray<string>
}

/**
 * A procedure definition.
 */
export type ProcedureDefinition<TInput = unknown, TOutput = unknown> =
  | QueryDefinition<TInput, TOutput>
  | MutationDefinition<TInput, TOutput>

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference
// ─────────────────────────────────────────────────────────────────────────────

export type InferInput<T> = 
  T extends QueryDefinition<infer I, any> ? I :
  T extends MutationDefinition<infer I, any> ? I :
  never

export type InferOutput<T> = 
  T extends QueryDefinition<any, infer O> ? O :
  T extends MutationDefinition<any, infer O> ? O :
  never

export type IsQuery<T> = T extends QueryDefinition<any, any> ? true : false
export type IsMutation<T> = T extends MutationDefinition<any, any> ? true : false

// ─────────────────────────────────────────────────────────────────────────────
// Config Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryConfig<TInput, TOutput> {
  readonly input?: Schema.Schema<TInput, unknown>
  readonly output: Schema.Schema<TOutput, unknown>
  readonly meta?: ProcedureMeta
}

export interface MutationConfig<TInput, TOutput> {
  readonly input?: Schema.Schema<TInput, unknown>
  readonly output: Schema.Schema<TOutput, unknown>
  readonly invalidates?: ReadonlyArray<string>
  readonly meta?: ProcedureMeta
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Factories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Define a query procedure (read-only, cacheable).
 * 
 * @example
 * ```ts
 * const list = query({
 *   output: Schema.Array(User),
 * })
 * 
 * const byId = query({
 *   input: Schema.Struct({ id: Schema.String }),
 *   output: User,
 * })
 * ```
 */
export function query<TOutput>(
  config: QueryConfig<void, TOutput>
): QueryDefinition<void, TOutput>

export function query<TInput, TOutput>(
  config: QueryConfig<TInput, TOutput> & { input: Schema.Schema<TInput, unknown> }
): QueryDefinition<TInput, TOutput>

export function query<TInput, TOutput>(
  config: QueryConfig<TInput, TOutput>
): QueryDefinition<TInput, TOutput> {
  return {
    _tag: "QueryDefinition",
    type: "query",
    input: config.input,
    output: config.output,
    meta: config.meta ?? {},
  }
}

/**
 * Define a mutation procedure (write operation).
 * 
 * @example
 * ```ts
 * const create = mutation({
 *   input: CreateUserSchema,
 *   output: User,
 *   invalidates: ["user.list"],
 * })
 * 
 * const deleteUser = mutation({
 *   input: Schema.Struct({ id: Schema.String }),
 *   output: Schema.Void,
 *   invalidates: ["user.list", "user.byId"],
 * })
 * ```
 */
export function mutation<TOutput>(
  config: MutationConfig<void, TOutput>
): MutationDefinition<void, TOutput>

export function mutation<TInput, TOutput>(
  config: MutationConfig<TInput, TOutput> & { input: Schema.Schema<TInput, unknown> }
): MutationDefinition<TInput, TOutput>

export function mutation<TInput, TOutput>(
  config: MutationConfig<TInput, TOutput>
): MutationDefinition<TInput, TOutput> {
  return {
    _tag: "MutationDefinition",
    type: "mutation",
    input: config.input,
    output: config.output,
    meta: config.meta ?? {},
    invalidates: config.invalidates ?? [],
  }
}
