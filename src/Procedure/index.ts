/**
 * Procedure - Define RPC endpoints
 * 
 * Procedures define the shape of API endpoints without tags.
 * Tags are auto-derived when the procedure is placed in a Router.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Procedure, Router } from "effect-trpc"
 * import { Schema } from "effect"
 * 
 * const listUsers = Procedure.query({
 *   success: Schema.Array(User),
 * })
 * 
 * const createUser = Procedure.mutation({
 *   payload: CreateUserInput,
 *   success: User,
 *   error: ValidationError,
 *   invalidates: ["users"],
 * })
 * 
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: listUsers,   // tag becomes "@api/users/list"
 *     create: createUser, // tag becomes "@api/users/create"
 *   },
 * })
 * ```
 */

import * as Schema from "effect/Schema"
import { Pipeable, pipeArguments } from "effect/Pipeable"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const ProcedureTypeId: unique symbol = Symbol.for("effect-trpc/Procedure")

/** @internal */
export type ProcedureTypeId = typeof ProcedureTypeId

/** @internal */
export const QueryTypeId: unique symbol = Symbol.for("effect-trpc/Procedure/Query")

/** @internal */
export type QueryTypeId = typeof QueryTypeId

/** @internal */
export const MutationTypeId: unique symbol = Symbol.for("effect-trpc/Procedure/Mutation")

/** @internal */
export type MutationTypeId = typeof MutationTypeId

/** @internal */
export const StreamTypeId: unique symbol = Symbol.for("effect-trpc/Procedure/Stream")

/** @internal */
export type StreamTypeId = typeof StreamTypeId

// =============================================================================
// Models
// =============================================================================

/**
 * Base interface for all procedures
 * 
 * @since 1.0.0
 * @category models
 */
export interface ProcedureBase<
  out Payload extends Schema.Schema.Any,
  out Success extends Schema.Schema.Any,
  out Error extends Schema.Schema.All
> extends Pipeable {
  readonly [ProcedureTypeId]: ProcedureTypeId
  readonly payloadSchema: Payload
  readonly successSchema: Success
  readonly errorSchema: Error
}

/**
 * A query procedure (read-only, cacheable)
 * 
 * @since 1.0.0
 * @category models
 */
export interface Query<
  out Payload extends Schema.Schema.Any = typeof Schema.Void,
  out Success extends Schema.Schema.Any = typeof Schema.Void,
  out Error extends Schema.Schema.All = typeof Schema.Never
> extends ProcedureBase<Payload, Success, Error> {
  readonly [QueryTypeId]: QueryTypeId
  readonly _tag: "Query"
}

/**
 * Configuration for optimistic updates
 * 
 * @since 1.0.0
 * @category models
 */
export interface OptimisticConfig<in out Target, in Payload, in Success> {
  /**
   * The path to the query that should be optimistically updated
   */
  readonly target: string
  
  /**
   * Update the target data immediately with the mutation payload
   */
  readonly reducer: (current: Target, payload: Payload) => Target
  
  /**
   * Optionally reconcile after server response (if not provided, target is invalidated)
   */
  readonly reconcile?: (current: Target, payload: Payload, result: Success) => Target
}

/**
 * A mutation procedure (writes, invalidates cache)
 * 
 * @since 1.0.0
 * @category models
 */
export interface Mutation<
  out Payload extends Schema.Schema.Any = typeof Schema.Void,
  out Success extends Schema.Schema.Any = typeof Schema.Void,
  out Error extends Schema.Schema.All = typeof Schema.Never,
  out Invalidates extends ReadonlyArray<string> = ReadonlyArray<string>
> extends ProcedureBase<Payload, Success, Error> {
  readonly [MutationTypeId]: MutationTypeId
  readonly _tag: "Mutation"
  
  /**
   * Paths to invalidate after successful mutation
   */
  readonly invalidates: Invalidates
  
  /**
   * Optional optimistic update configuration
   */
  readonly optimistic?: OptimisticConfig<any, Schema.Schema.Type<Payload>, Schema.Schema.Type<Success>>
}

/**
 * A stream procedure (SSE streaming)
 * 
 * @since 1.0.0
 * @category models
 */
export interface Stream<
  out Payload extends Schema.Schema.Any = typeof Schema.Void,
  out Success extends Schema.Schema.Any = typeof Schema.Void,
  out Error extends Schema.Schema.All = typeof Schema.Never
> extends ProcedureBase<Payload, Success, Error> {
  readonly [StreamTypeId]: StreamTypeId
  readonly _tag: "Stream"
}

/**
 * Any procedure type
 * 
 * @since 1.0.0
 * @category models
 */
export type Any = Query<any, any, any> | Mutation<any, any, any, any> | Stream<any, any, any>

// =============================================================================
// Constructors
// =============================================================================

const ProcedureProto = {
  [ProcedureTypeId]: ProcedureTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * Options for creating a query procedure
 * 
 * @since 1.0.0
 * @category models
 */
export interface QueryOptions<
  Payload extends Schema.Schema.Any,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All
> {
  /**
   * Schema for the request payload (optional, defaults to void)
   */
  readonly payload?: Payload
  
  /**
   * Schema for the success response (required)
   */
  readonly success: Success
  
  /**
   * Schema for error responses (optional, defaults to never)
   */
  readonly error?: Error
}

/**
 * Create a query procedure (read-only, cacheable)
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 * import { Schema } from "effect"
 * 
 * // Simple query with no payload
 * const listUsers = Procedure.query({
 *   success: Schema.Array(User),
 * })
 * 
 * // Query with payload and error
 * const getUser = Procedure.query({
 *   payload: Schema.Struct({ id: Schema.String }),
 *   success: User,
 *   error: NotFoundError,
 * })
 * ```
 */
export const query = <
  Payload extends Schema.Schema.Any = typeof Schema.Void,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never
>(
  options: QueryOptions<Payload, Success, Error>
): Query<Payload, Success, Error> => {
  const self = Object.create(ProcedureProto)
  self[QueryTypeId] = QueryTypeId
  self._tag = "Query"
  self.payloadSchema = options.payload ?? Schema.Void
  self.successSchema = options.success
  self.errorSchema = options.error ?? Schema.Never
  return self
}

/**
 * Options for creating a mutation procedure
 * 
 * @since 1.0.0
 * @category models
 */
export interface MutationOptions<
  Payload extends Schema.Schema.Any,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All,
  Paths extends string = string,
  Target = unknown
> {
  /**
   * Schema for the request payload (optional, defaults to void)
   */
  readonly payload?: Payload
  
  /**
   * Schema for the success response (required)
   */
  readonly success: Success
  
  /**
   * Schema for error responses (optional, defaults to never)
   */
  readonly error?: Error
  
  /**
   * Paths to invalidate after successful mutation (required)
   * 
   * @example
   * ```ts
   * invalidates: ["users", "users.count"]
   * ```
   * 
   * @tip For autocomplete, use `Procedure.mutation<Router.Paths<typeof router>>()`.
   * This is optional — any string is valid, but known paths will autocomplete.
   */
  readonly invalidates: readonly AutoComplete<Paths>[]
  
  /**
   * Optional optimistic update configuration
   * 
   * @example
   * ```ts
   * optimistic: {
   *   target: "users",
   *   reducer: (users, input) => [...users, { ...input, id: "temp" }],
   * }
   * ```
   */
  readonly optimistic?: OptimisticConfig<Target, Schema.Schema.Type<Payload>, Schema.Schema.Type<Success>>
}

/**
 * Create a mutation procedure (writes, invalidates cache)
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 * import { Schema } from "effect"
 * 
 * const createUser = Procedure.mutation({
 *   payload: CreateUserInput,
 *   success: User,
 *   error: ValidationError,
 *   invalidates: ["users"],
 * })
 * 
 * // With optimistic update
 * const createUserOptimistic = Procedure.mutation({
 *   payload: CreateUserInput,
 *   success: User,
 *   invalidates: ["users"],
 *   optimistic: {
 *     target: "users",
 *     reducer: (users, input) => [...users, { ...input, id: `temp-${Date.now()}` }],
 *   },
 * })
 * ```
 */
export const mutation = <
  Paths extends string = string,
  Payload extends Schema.Schema.Any = typeof Schema.Void,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never,
  Target = unknown
>(
  options: MutationOptions<Payload, Success, Error, Paths, Target>
): Mutation<Payload, Success, Error, readonly AutoComplete<Paths>[]> => {
  const self = Object.create(ProcedureProto)
  self[MutationTypeId] = MutationTypeId
  self._tag = "Mutation"
  self.payloadSchema = options.payload ?? Schema.Void
  self.successSchema = options.success
  self.errorSchema = options.error ?? Schema.Never
  self.invalidates = options.invalidates
  self.optimistic = options.optimistic
  return self
}

/**
 * Options for creating a stream procedure
 * 
 * @since 1.0.0
 * @category models
 */
export interface StreamOptions<
  Payload extends Schema.Schema.Any,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All
> {
  /**
   * Schema for the request payload (optional, defaults to void)
   */
  readonly payload?: Payload
  
  /**
   * Schema for each chunk in the stream (required)
   */
  readonly success: Success
  
  /**
   * Schema for error responses (optional, defaults to never)
   */
  readonly error?: Error
}

/**
 * Create a stream procedure (SSE streaming)
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 * import { Schema } from "effect"
 * 
 * const watchUsers = Procedure.stream({
 *   success: UserEvent,
 *   error: UnauthorizedError,
 * })
 * 
 * const watchUserActivity = Procedure.stream({
 *   payload: Schema.Struct({ userId: Schema.String }),
 *   success: ActivityEvent,
 * })
 * ```
 */
export const stream = <
  Payload extends Schema.Schema.Any = typeof Schema.Void,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never
>(
  options: StreamOptions<Payload, Success, Error>
): Stream<Payload, Success, Error> => {
  const self = Object.create(ProcedureProto)
  self[StreamTypeId] = StreamTypeId
  self._tag = "Stream"
  self.payloadSchema = options.payload ?? Schema.Void
  self.successSchema = options.success
  self.errorSchema = options.error ?? Schema.Never
  return self
}

// =============================================================================
// Guards
// =============================================================================

/**
 * Check if a value is a Procedure
 * 
 * @since 1.0.0
 * @category guards
 */
export const isProcedure = (u: unknown): u is Any =>
  typeof u === "object" && u !== null && ProcedureTypeId in u

/**
 * Check if a value is a Query
 * 
 * @since 1.0.0
 * @category guards
 */
export const isQuery = (u: unknown): u is Query<any, any, any> =>
  typeof u === "object" && u !== null && QueryTypeId in u

/**
 * Check if a value is a Mutation
 * 
 * @since 1.0.0
 * @category guards
 */
export const isMutation = (u: unknown): u is Mutation<any, any, any, any> =>
  typeof u === "object" && u !== null && MutationTypeId in u

/**
 * Check if a value is a Stream
 * 
 * @since 1.0.0
 * @category guards
 */
export const isStream = (u: unknown): u is Stream<any, any, any> =>
  typeof u === "object" && u !== null && StreamTypeId in u

// =============================================================================
// AutoComplete Helper
// =============================================================================

/**
 * Allows any string but provides autocomplete for known values
 * 
 * @since 1.0.0
 * @category type-level
 * @example
 * ```ts
 * type Paths = "users" | "users.list"
 * type Input = AutoComplete<Paths>
 * 
 * const x: Input = "users"      // autocomplete works
 * const y: Input = "other"      // also valid, no error
 * ```
 */
export type AutoComplete<T extends string> = T | (string & {})

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Extract the payload type from a procedure
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Payload<P extends Any> = P extends ProcedureBase<infer Payload, any, any>
  ? Schema.Schema.Type<Payload>
  : never

/**
 * Extract the success type from a procedure
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Success<P extends Any> = P extends ProcedureBase<any, infer Success, any>
  ? Schema.Schema.Type<Success>
  : never

/**
 * Extract the error type from a procedure
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Error<P extends Any> = P extends ProcedureBase<any, any, infer Error>
  ? Schema.Schema.Type<Error>
  : never

/**
 * Extract the invalidates paths from a mutation
 * 
 * @since 1.0.0
 * @category type-level
 */
export type Invalidates<P extends Mutation<any, any, any, any>> = P extends Mutation<any, any, any, infer I>
  ? I
  : never
