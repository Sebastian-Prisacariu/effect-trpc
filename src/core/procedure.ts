/**
 * @module effect-trpc/core/procedure
 * 
 * Procedure builder API — define type-safe RPC endpoints.
 * 
 * This module is interface-first: we define the CONTRACT for procedures,
 * not their implementations. Implementations come via Layers.
 */

import * as Schema from "effect/Schema"
import * as Data from "effect/Data"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProcedureType = "query" | "mutation"

/**
 * A procedure definition — the contract only.
 * 
 * This is a pure data structure describing what a procedure accepts and returns.
 * No implementation details, no handlers, just the schema.
 */
export interface ProcedureDefinition<
  TInput = unknown,
  TOutput = unknown,
  TType extends ProcedureType = ProcedureType,
> {
  readonly _tag: "ProcedureDefinition"
  readonly type: TType
  readonly inputSchema: Schema.Schema<TInput, unknown> | undefined
  readonly outputSchema: Schema.Schema<TOutput, unknown> | undefined
  readonly invalidates: ReadonlyArray<string>
  readonly meta: ProcedureMeta
}

export interface ProcedureMeta {
  readonly description?: string
  readonly deprecated?: boolean
  readonly tags?: ReadonlyArray<string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference
// ─────────────────────────────────────────────────────────────────────────────

export type InferInput<T> = 
  T extends ProcedureDefinition<infer I, any, any> ? I : never

export type InferOutput<T> = 
  T extends ProcedureDefinition<any, infer O, any> ? O : never

export type InferType<T> = 
  T extends ProcedureDefinition<any, any, infer Type> ? Type : never

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procedure builder — fluent API for defining procedures.
 * 
 * @example
 * ```ts
 * const getUser = procedure
 *   .input(Schema.Struct({ id: Schema.String }))
 *   .output(UserSchema)
 *   .query()
 * ```
 */
export interface ProcedureBuilder<
  TInput = void,
  TOutput = void,
> {
  /**
   * Define the input schema for this procedure.
   */
  input<I>(schema: Schema.Schema<I, unknown>): ProcedureBuilder<I, TOutput>
  
  /**
   * Define the output schema for this procedure.
   */
  output<O>(schema: Schema.Schema<O, unknown>): ProcedureBuilder<TInput, O>
  
  /**
   * Specify which query keys this mutation invalidates.
   * Only meaningful for mutations.
   */
  invalidates(keys: ReadonlyArray<string>): ProcedureBuilder<TInput, TOutput>
  
  /**
   * Add metadata to the procedure.
   */
  meta(meta: ProcedureMeta): ProcedureBuilder<TInput, TOutput>
  
  /**
   * Mark this procedure as a query (read-only, cacheable).
   */
  query(): ProcedureDefinition<TInput, TOutput, "query">
  
  /**
   * Mark this procedure as a mutation (write, may invalidate cache).
   */
  mutation(): ProcedureDefinition<TInput, TOutput, "mutation">
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  readonly inputSchema: Schema.Schema<any, unknown> | undefined
  readonly outputSchema: Schema.Schema<any, unknown> | undefined
  readonly invalidates: ReadonlyArray<string>
  readonly meta: ProcedureMeta
}

const createBuilder = (state: BuilderState): ProcedureBuilder<any, any> => ({
  input: (schema) => createBuilder({ ...state, inputSchema: schema }),
  output: (schema) => createBuilder({ ...state, outputSchema: schema }),
  invalidates: (keys) => createBuilder({ ...state, invalidates: keys }),
  meta: (meta) => createBuilder({ ...state, meta: { ...state.meta, ...meta } }),
  
  query: () => ({
    _tag: "ProcedureDefinition",
    type: "query",
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    invalidates: state.invalidates,
    meta: state.meta,
  }),
  
  mutation: () => ({
    _tag: "ProcedureDefinition",
    type: "mutation",
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    invalidates: state.invalidates,
    meta: state.meta,
  }),
})

/**
 * Create a new procedure definition.
 * 
 * @example
 * ```ts
 * const listUsers = procedure
 *   .output(Schema.Array(UserSchema))
 *   .query()
 * 
 * const createUser = procedure
 *   .input(CreateUserSchema)
 *   .output(UserSchema)
 *   .invalidates(['user.list'])
 *   .mutation()
 * ```
 */
export const procedure: ProcedureBuilder<void, void> = createBuilder({
  inputSchema: undefined,
  outputSchema: undefined,
  invalidates: [],
  meta: {},
})
