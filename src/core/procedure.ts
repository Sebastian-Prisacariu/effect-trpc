/**
 * @module effect-trpc/core/procedure
 * 
 * Procedure builder API with proper type separation for queries vs mutations.
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Definition Types (Discriminated Union)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcedureMeta {
  readonly description?: string
  readonly deprecated?: boolean
  readonly tags?: ReadonlyArray<string>
}

/**
 * Query definition — read-only, cacheable, no invalidation.
 */
export interface QueryDefinition<TInput = unknown, TOutput = unknown> {
  readonly _tag: "QueryDefinition"
  readonly type: "query"
  readonly inputSchema: Schema.Schema<TInput, unknown> | undefined
  readonly outputSchema: Schema.Schema<TOutput, unknown> | undefined
  readonly meta: ProcedureMeta
  readonly invalidates?: never // Discriminant: queries never invalidate
}

/**
 * Mutation definition — write operation, can invalidate queries.
 */
export interface MutationDefinition<TInput = unknown, TOutput = unknown> {
  readonly _tag: "MutationDefinition"
  readonly type: "mutation"
  readonly inputSchema: Schema.Schema<TInput, unknown> | undefined
  readonly outputSchema: Schema.Schema<TOutput, unknown> | undefined
  readonly meta: ProcedureMeta
  readonly invalidates: ReadonlyArray<string>
}

/**
 * A procedure definition — discriminated union of query or mutation.
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
// Builder Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initial procedure builder — can become either query or mutation.
 */
export interface ProcedureBuilder<TInput = void, TOutput = void> {
  /**
   * Define the input schema.
   */
  input<I>(schema: Schema.Schema<I, unknown>): ProcedureBuilder<I, TOutput>
  
  /**
   * Define the output schema.
   */
  output<O>(schema: Schema.Schema<O, unknown>): ProcedureBuilder<TInput, O>
  
  /**
   * Add metadata.
   */
  meta(meta: ProcedureMeta): ProcedureBuilder<TInput, TOutput>
  
  /**
   * Finalize as a query (read-only, cacheable).
   */
  query(): QueryDefinition<TInput, TOutput>
  
  /**
   * Transition to mutation builder (allows invalidates).
   */
  mutation(): MutationBuilder<TInput, TOutput>
}

/**
 * Mutation builder — available after calling mutation().
 * Has access to invalidates() which queries don't have.
 */
export interface MutationBuilder<TInput = void, TOutput = void> {
  /**
   * Specify which query keys this mutation invalidates.
   */
  invalidates(keys: ReadonlyArray<string>): MutationBuilder<TInput, TOutput>
  
  /**
   * Finalize the mutation definition.
   */
  build(): MutationDefinition<TInput, TOutput>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  readonly inputSchema: Schema.Schema<any, unknown> | undefined
  readonly outputSchema: Schema.Schema<any, unknown> | undefined
  readonly meta: ProcedureMeta
}

interface MutationBuilderState extends BuilderState {
  readonly invalidates: ReadonlyArray<string>
}

const createMutationBuilder = (state: MutationBuilderState): MutationBuilder<any, any> => ({
  invalidates: (keys) => createMutationBuilder({ 
    ...state, 
    invalidates: [...state.invalidates, ...keys] 
  }),
  
  build: () => ({
    _tag: "MutationDefinition",
    type: "mutation",
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    meta: state.meta,
    invalidates: state.invalidates,
  }),
})

const createProcedureBuilder = (state: BuilderState): ProcedureBuilder<any, any> => ({
  input: (schema) => createProcedureBuilder({ ...state, inputSchema: schema }),
  output: (schema) => createProcedureBuilder({ ...state, outputSchema: schema }),
  meta: (meta) => createProcedureBuilder({ ...state, meta: { ...state.meta, ...meta } }),
  
  query: () => ({
    _tag: "QueryDefinition",
    type: "query",
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    meta: state.meta,
  }),
  
  mutation: () => createMutationBuilder({
    ...state,
    invalidates: [],
  }),
})

/**
 * Create a new procedure.
 * 
 * @example
 * ```ts
 * // Query — no invalidates available
 * const list = procedure
 *   .output(Schema.Array(User))
 *   .query()
 * 
 * // Mutation — invalidates available after mutation()
 * const create = procedure
 *   .input(CreateUserSchema)
 *   .output(User)
 *   .mutation()
 *   .invalidates(["user.list"])
 *   .build()
 * ```
 */
export const procedure: ProcedureBuilder<void, void> = createProcedureBuilder({
  inputSchema: undefined,
  outputSchema: undefined,
  meta: {},
})
