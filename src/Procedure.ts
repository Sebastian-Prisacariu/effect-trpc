/**
 * Procedure module - Define RPC endpoints
 * 
 * @since 1.0.0
 */

import { Effect, Stream, Schema } from "effect"

// =============================================================================
// Procedure Types
// =============================================================================

/**
 * Base procedure definition
 * 
 * @since 1.0.0
 * @category models
 */
export interface ProcedureDefinition<
  Tag extends string,
  Payload,
  Success,
  Error,
  Requirements
> {
  readonly _tag: Tag
  readonly payload: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error: Schema.Schema<Error, unknown>
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
}

/**
 * Query procedure - read-only, cacheable
 * 
 * @since 1.0.0
 * @category models
 */
export interface QueryDefinition<Payload, Success, Error, Requirements>
  extends ProcedureDefinition<"Query", Payload, Success, Error, Requirements> {
  readonly invalidates?: never
}

/**
 * Mutation procedure - writes, invalidates cache
 * 
 * @since 1.0.0
 * @category models
 */
export interface MutationDefinition<Payload, Success, Error, Requirements>
  extends ProcedureDefinition<"Mutation", Payload, Success, Error, Requirements> {
  readonly invalidates: ReadonlyArray<string>
}

/**
 * Stream procedure - SSE streaming
 * 
 * @since 1.0.0
 * @category models
 */
export interface StreamDefinition<Payload, Success, Error, Requirements> {
  readonly _tag: "Stream"
  readonly payload: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error: Schema.Schema<Error, unknown>
  readonly handler: (payload: Payload) => Stream.Stream<Success, Error, Requirements>
}

/**
 * Any procedure definition
 * 
 * @since 1.0.0
 * @category models
 */
export type AnyDefinition =
  | QueryDefinition<any, any, any, any>
  | MutationDefinition<any, any, any, any>
  | StreamDefinition<any, any, any, any>

// =============================================================================
// Constructors
// =============================================================================

/**
 * Query procedure config
 * 
 * @since 1.0.0
 * @category models
 */
export interface QueryConfig<Payload, Success, Error, Requirements> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
}

/**
 * Create a query procedure
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 * import { Effect, Schema } from "effect"
 * 
 * const list = Procedure.query({
 *   success: Schema.Array(User),
 *   handler: () => UserService.findAll()
 * })
 * 
 * const byId = Procedure.query({
 *   payload: Schema.Struct({ id: Schema.String }),
 *   success: User,
 *   error: UserNotFound,
 *   handler: ({ id }) => UserService.findById(id)
 * })
 * ```
 */
export const query = <Payload, Success, Error, Requirements>(
  config: QueryConfig<Payload, Success, Error, Requirements>
): QueryDefinition<Payload, Success, Error, Requirements> => {
  return {
    _tag: "Query",
    payload: config.payload ?? (Schema.Void as any),
    success: config.success,
    error: config.error ?? (Schema.Never as any),
    handler: config.handler,
  }
}

/**
 * Mutation procedure config
 * 
 * @since 1.0.0
 * @category models
 */
export interface MutationConfig<Payload, Success, Error, Requirements> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly invalidates: ReadonlyArray<string>
  readonly handler: (payload: Payload) => Effect.Effect<Success, Error, Requirements>
}

/**
 * Create a mutation procedure
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 * 
 * const create = Procedure.mutation({
 *   payload: CreateUserInput,
 *   success: User,
 *   error: EmailTaken,
 *   invalidates: ["user.list"],
 *   handler: (input) => UserService.create(input)
 * })
 * ```
 */
export const mutation = <Payload, Success, Error, Requirements>(
  config: MutationConfig<Payload, Success, Error, Requirements>
): MutationDefinition<Payload, Success, Error, Requirements> => {
  return {
    _tag: "Mutation",
    payload: config.payload ?? (Schema.Void as any),
    success: config.success,
    error: config.error ?? (Schema.Never as any),
    invalidates: config.invalidates,
    handler: config.handler,
  }
}

/**
 * Stream procedure config
 * 
 * @since 1.0.0
 * @category models
 */
export interface StreamConfig<Payload, Success, Error, Requirements> {
  readonly payload?: Schema.Schema<Payload, unknown>
  readonly success: Schema.Schema<Success, unknown>
  readonly error?: Schema.Schema<Error, unknown>
  readonly handler: (payload: Payload) => Stream.Stream<Success, Error, Requirements>
}

/**
 * Create a stream procedure
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Procedure } from "effect-trpc"
 * import { Stream } from "effect"
 * 
 * const subscribe = Procedure.stream({
 *   payload: Schema.Struct({ channel: Schema.String }),
 *   success: Message,
 *   handler: ({ channel }) =>
 *     MessageService.subscribe(channel)
 * })
 * ```
 */
export const stream = <Payload, Success, Error, Requirements>(
  config: StreamConfig<Payload, Success, Error, Requirements>
): StreamDefinition<Payload, Success, Error, Requirements> => {
  return {
    _tag: "Stream",
    payload: config.payload ?? (Schema.Void as any),
    success: config.success,
    error: config.error ?? (Schema.Never as any),
    handler: config.handler,
  }
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Apply middleware to a procedure
 * 
 * @since 1.0.0
 * @category combinators
 * @example
 * ```ts
 * import { Procedure, Middleware } from "effect-trpc"
 * 
 * const protectedQuery = Procedure.query({
 *   success: User,
 *   handler: () => UserService.me()
 * }).pipe(
 *   Procedure.middleware(Auth)
 * )
 * ```
 */
export const middleware = <M>(
  _middleware: M
) => <P extends AnyDefinition>(
  procedure: P
): P => {
  // Contract only - implementation TBD
  // This will integrate with Effect RPC's middleware system
  return procedure
}
