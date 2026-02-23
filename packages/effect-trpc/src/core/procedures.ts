/**
 * @module effect-trpc/core/procedures
 *
 * Procedures group definition. Groups related procedures under a namespace
 * and provides `.toLayer()` for creating the implementation layer.
 */

import * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import type { ProcedureDefinition, InferProcedureContext } from "./procedure.js"
import type { BaseContext as _BaseContext } from "./middleware.js"
import type { ClientId, SubscriptionId } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Subscription Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context provided to subscription handlers.
 *
 * Contains information about the subscription connection, client identity,
 * and authentication metadata. Passed to all subscription lifecycle hooks.
 *
 * @since 0.1.0
 * @category models
 */
export interface SubscriptionContext {
  /** Unique subscription ID */
  readonly subscriptionId: SubscriptionId
  /** Client connection ID */
  readonly clientId: ClientId
  /** User ID from authentication */
  readonly userId: string
  /** Auth metadata */
  readonly metadata: Record<string, unknown>
  /** Procedure path (e.g., "notifications.watch") */
  readonly path: string
}

/**
 * Reason why a subscription ended.
 *
 * Used in the `onUnsubscribe` lifecycle hook to indicate how
 * the subscription terminated.
 *
 * @since 0.1.0
 * @category models
 */
export type UnsubscribeReason =
  | { readonly _tag: "ClientUnsubscribed" }
  | { readonly _tag: "ClientDisconnected" }
  | { readonly _tag: "StreamCompleted" }
  | { readonly _tag: "StreamErrored"; readonly error: unknown }
  | { readonly _tag: "ServerShutdown" }

/**
 * Constructors for `UnsubscribeReason` discriminated union.
 *
 * @example
 * ```ts
 * const reason = UnsubscribeReason.StreamErrored(new Error("Connection lost"))
 * if (reason._tag === "StreamErrored") {
 *   console.log("Error:", reason.error)
 * }
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const UnsubscribeReason = {
  ClientUnsubscribed: { _tag: "ClientUnsubscribed" } as const,
  ClientDisconnected: { _tag: "ClientDisconnected" } as const,
  StreamCompleted: { _tag: "StreamCompleted" } as const,
  StreamErrored: (error: unknown): UnsubscribeReason => ({
    _tag: "StreamErrored",
    error,
  }),
  ServerShutdown: { _tag: "ServerShutdown" } as const,
} as const

/**
 * Explicit lifecycle handlers for subscription procedures.
 *
 * Subscriptions use a handler object with lifecycle methods rather than
 * a simple function. This enables:
 * - Setup and teardown logic via `onSubscribe` and `onUnsubscribe`
 * - Bidirectional communication via `onClientMessage`
 * - Resource cleanup on disconnection
 *
 * @example
 * ```ts
 * const handler: SubscriptionHandler<{ roomId: string }, Message, never, never> = {
 *   onSubscribe: (input, ctx) =>
 *     Effect.gen(function* () {
 *       const rooms = yield* ChatRoomService
 *       yield* rooms.join(input.roomId, ctx.userId)
 *       return rooms.messages(input.roomId)
 *     }),
 *
 *   onClientMessage: (data, ctx) =>
 *     Effect.gen(function* () {
 *       const rooms = yield* ChatRoomService
 *       yield* rooms.broadcast(ctx.metadata.roomId, data)
 *     }),
 *
 *   onUnsubscribe: (ctx, reason) =>
 *     Effect.log(`User ${ctx.userId} left: ${reason._tag}`),
 * }
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface SubscriptionHandler<
  I = unknown,
  O = unknown,
  E = unknown,
  R = never,
> {
  /**
   * Called when a client subscribes.
   * Perform setup and return the Stream that will emit data to the client.
   * If this Effect fails, the subscription is rejected.
   */
  readonly onSubscribe: (
    input: I,
    ctx: SubscriptionContext,
  ) => Effect.Effect<Stream.Stream<O, E>, E, R>

  /**
   * Called when the client sends a message to this subscription.
   * Optional. Use for bidirectional communication.
   */
  readonly onClientMessage?: (
    data: unknown,
    ctx: SubscriptionContext,
  ) => Effect.Effect<void, E, R>

  /**
   * Called when the subscription ends.
   * Optional. Use for cleanup (release resources, logging, metrics).
   * Called regardless of how the subscription ended.
   */
  readonly onUnsubscribe?: (
    ctx: SubscriptionContext,
    reason: UnsubscribeReason,
  ) => Effect.Effect<void, never, R>
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A record of procedure definitions.
 *
 * @remarks
 * Uses a permissive base type to allow heterogeneous procedure collections.
 * Type safety is restored via `InferHandlers<P>` when creating implementations,
 * and via hook types when calling procedures.
 * 
 * The fourth type parameter is the context type from middleware chain.
 *
 * @since 0.1.0
 * @category models
 */
 
export type ProcedureRecord = Record<string, any>

/**
 * Infer the handler type for a procedure definition.
 *
 * **v2 Context-Aware Handlers:**
 * 
 * Handlers now receive the middleware context as their first parameter.
 * The context type is automatically inferred from the middleware chain.
 *
 * - query/mutation: `(ctx: C, input: I) => Effect<O, E, R>`
 * - stream/chat: `(ctx: C, input: I) => Effect<AsyncIterable<O>, E, R>`
 * - subscription: `SubscriptionHandler<I, O, E, R>` (context via SubscriptionContext)
 *
 * **Handler Requirements (R channel):**
 * 
 * Handlers can return `Effect<O, E, R>` with any requirements.
 * Using `any` for R allows TypeScript to infer the actual requirements
 * from the handler implementation, which are then tracked via `HandlersRequirements`.
 * 
 * @example
 * ```ts
 * const UserProcedures = procedures("user", {
 *   getUser: procedure
 *     .use(authMiddleware)  // Context becomes AuthenticatedContext<User>
 *     .input(IdSchema)
 *     .query()
 * })
 * 
 * // Handler receives typed context automatically
 * const handlers = {
 *   getUser: (ctx, input) => {
 *     ctx.user.id  // ✅ Typed as User
 *     return db.getUser(input.id)
 *   }
 * }
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferHandler<P> =
  P extends ProcedureDefinition<infer I, infer A, infer E, infer Ctx, infer Type, infer _R>
    ? Type extends "subscription"
      ? SubscriptionHandler<I, A, E, any>
      : Type extends "stream" | "chat"
        ? (ctx: Ctx, input: I) => Effect.Effect<AsyncIterable<A>, E, any>
        : (ctx: Ctx, input: I) => Effect.Effect<A, E, any>
    : never

/**
 * Infer the handler record type for a procedures group.
 * 
 * Each handler receives:
 * 1. `ctx` - The middleware context (typed based on middleware chain)
 * 2. `input` - The validated input (typed based on input schema)
 * 
 * Handler requirements (R channel) are tracked separately via `HandlersRequirements`.
 * 
 * @example
 * ```ts
 * const UserProcedures = procedures("user", {
 *   getUser: procedure.use(authMiddleware).input(IdSchema).query(),
 *   listUsers: procedure.output(UsersSchema).query(),
 * })
 * 
 * // InferHandlers produces:
 * // {
 * //   getUser: (ctx: AuthenticatedContext<User>, input: { id: string }) => Effect<User, ...>
 * //   listUsers: (ctx: BaseContext, input: unknown) => Effect<User[], ...>
 * // }
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferHandlers<P extends Record<string, any>> = {
  readonly [K in keyof P]: InferHandler<P[K]>
}

/**
 * Extract the context type from a procedure definition.
 *
 * Alias for `InferProcedureContext` when working with handlers.
 * 
 * @example
 * ```ts
 * const myProc = procedure.use(authMiddleware).query()
 * type MyContext = InferHandlerContext<typeof myProc>
 * // AuthenticatedContext<User>
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferHandlerContext<P extends ProcedureDefinition<any, any, any, any, any, any, any>> =
  InferProcedureContext<P>

// ─────────────────────────────────────────────────────────────────────────────
// Handler Requirements Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the requirements (R channel) from a single handler function.
 * 
 * This type extracts the third type parameter from Effect.Effect<A, E, R>
 * or Stream.Stream<A, E, R> returned by a handler.
 *
 * @internal
 */
type ExtractHandlerRequirements<H> = 
  H extends (...args: any[]) => Effect.Effect<any, any, infer R>
    ? R
    : H extends (...args: any[]) => Stream.Stream<any, any, infer R>
      ? R
      : H extends SubscriptionHandler<any, any, any, infer R>
        ? R
        : never

/**
 * Extract all requirements from a handlers object.
 * Returns a union of all handler requirements.
 * 
 * @example
 * ```ts
 * const handlers = {
 *   getUser: (ctx, input) => Effect.flatMap(Database, db => db.find(input.id)),
 *   log: (ctx, input) => Effect.flatMap(Logger, log => log.info(input))
 * }
 * type R = HandlersRequirements<typeof handlers>
 * // Database | Logger
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type HandlersRequirements<H extends Record<string, any>> = {
  [K in keyof H]: ExtractHandlerRequirements<H[K]>
}[keyof H]

/**
 * Extract all middleware requirements from a procedures record.
 * Returns a union of middleware R from all procedures.
 * 
 * @example
 * ```ts
 * const UserProcedures = procedures("user", {
 *   getUser: procedure.use(authMiddleware).query(),  // authMiddleware needs TokenService
 *   list: procedure.use(rateLimitMiddleware).query(),  // rateLimitMiddleware needs nothing
 * })
 * type R = ProceduresMiddlewareR<typeof UserProcedures["procedures"]>
 * // TokenService
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type ProceduresMiddlewareR<Procs extends ProcedureRecord> = {
  [K in keyof Procs]: Procs[K] extends ProcedureDefinition<any, any, any, any, any, infer R, any>
    ? R
    : never
}[keyof Procs]

/**
 * Extract all errors from a procedures record.
 * Returns a union of error types from all procedures.
 * 
 * @example
 * ```ts
 * const UserProcedures = procedures("user", {
 *   getUser: procedure.use(authMiddleware).query(),  // AuthError
 *   update: procedure.use(rateLimitMiddleware).mutation(),  // RateLimitError
 * })
 * type E = ProceduresError<typeof UserProcedures["procedures"]>
 * // AuthError | RateLimitError
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type ProceduresError<Procs extends ProcedureRecord> = {
  [K in keyof Procs]: Procs[K] extends ProcedureDefinition<any, any, infer E, any, any, any, any>
    ? E
    : never
}[keyof Procs]

/**
 * Extract all services provided by middleware from a procedures record.
 * Returns a union of provided service types from all procedures.
 * 
 * @example
 * ```ts
 * const UserProcedures = procedures("user", {
 *   getUser: procedure.use(dbMiddleware).query(),  // Provides Database
 *   update: procedure.use(cacheMiddleware).mutation(),  // Provides Cache
 * })
 * type Provided = ProceduresProvides<typeof UserProcedures["procedures"]>
 * // Database | Cache
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type ProceduresProvides<Procs extends ProcedureRecord> = {
  [K in keyof Procs]: Procs[K] extends ProcedureDefinition<any, any, any, any, any, any, infer Provides>
    ? Provides
    : never
}[keyof Procs]

/**
 * Calculate effective handler requirements after excluding provided services.
 * 
 * Handler requirements are extracted from handler return types, then any
 * services provided by middleware are excluded.
 *
 * @since 0.1.0
 * @category utils
 */
export type EffectiveHandlerRequirements<
  Handlers extends Record<string, any>,
  Procs extends ProcedureRecord
> = Exclude<HandlersRequirements<Handlers>, ProceduresProvides<Procs>>

/**
 * A group of related procedures under a namespace.
 *
 * Created by the `procedures` function. Provides `.toLayer()` to create
 * the implementation layer with type-safe handlers.
 *
 * @example
 * ```ts
 * const UserProcedures = procedures('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 * })
 *
 * // UserProcedures.name === 'user'
 * // UserProcedures.procedures contains the definitions
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface ProceduresGroup<
  Name extends string = string,
  Procs extends ProcedureRecord = ProcedureRecord,
> {
  readonly _tag: "ProceduresGroup"
  readonly name: Name
  readonly procedures: Procs

  /**
   * Create a Layer that provides the implementation for these procedures.
   *
   * **Requirements Tracking:**
   * 
   * The Layer's requirements include:
   * - `REffect`: Requirements from the Effect that creates handlers (if using Effect wrapper)
   * - `EffectiveHandlerRequirements`: Requirements from handlers, minus services provided by middleware
   * - `ProceduresMiddlewareR`: Requirements from middleware attached to procedures
   * 
   * Services provided by middleware (via `middlewareWithProvides`) are automatically
   * excluded from handler requirements.
   * 
   * @example
   * ```ts
   * // Effect-wrapped handlers: R comes from the Effect
   * const UserProceduresLive = UserProcedures.toLayer(
   *   Effect.gen(function* () {
   *     const db = yield* Database  // REffect includes Database
   *     return {
   *       list: (ctx, input) => db.users.findMany(),
   *       byId: (ctx, input) => db.users.findUnique({ where: { id: input.id } }),
   *     }
   *   })
   * )
   * // Layer requires: Database
   * 
   * // Middleware provides services
   * const myProc = procedure.use(dbMiddleware).query()  // dbMiddleware provides Database
   * const handlers = {
   *   myProc: (ctx, input) => Effect.flatMap(Database, db => db.find(input.id))
   * }
   * // Database is NOT in layer requirements (provided by middleware)
   * ```
   */
  toLayer<Handlers extends InferHandlers<Procs>, REffect = never>(
    implementation: Handlers | Effect.Effect<Handlers, never, REffect>,
  ): Layer.Layer<
    ProceduresService<Name, Procs>,
    never,
    | REffect
    | EffectiveHandlerRequirements<Handlers, Procs>
    | ProceduresMiddlewareR<Procs>
  >
}

/**
 * Service type for a procedures group.
 *
 * This is the type that gets provided to the Effect context when
 * using `.toLayer()`. Contains the handlers implementation.
 *
 * @since 0.1.0
 * @category models
 */
export interface ProceduresService<
  Name extends string = string,
  Procs extends ProcedureRecord = ProcedureRecord,
> {
  readonly _tag: Name
  readonly handlers: InferHandlers<Procs>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Define a group of related procedures under a namespace.
 *
 * Groups related procedures together and provides a type-safe way to
 * create the implementation layer via `.toLayer()`.
 *
 * @param name - The namespace for these procedures (e.g., 'user', 'post')
 * @param defs - Record of procedure definitions
 *
 * @example
 * ```ts
 * import { procedures, procedure } from 'effect-trpc'
 *
 * export const UserProcedures = procedures('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 *   create: procedure.input(CreateSchema).invalidates(['user.list']).mutation(),
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const procedures = <
  Name extends string,
  Procs extends Record<string, any>,
>(
  name: Name,
  defs: Procs,
): ProceduresGroup<Name, Procs> => {
  // Create a unique tag for this procedures group
  const ServiceTag = Context.GenericTag<ProceduresService<Name, Procs>>(
    `@effect-trpc/${name}`,
  )

  return {
    _tag: "ProceduresGroup",
    name,
    procedures: defs,

    toLayer: <Handlers extends InferHandlers<Procs>, REffect = never>(
      implementation: Handlers | Effect.Effect<Handlers, never, REffect>,
    ) => {
      const effect: Effect.Effect<Handlers, never, REffect> = Effect.isEffect(implementation)
        ? implementation
        : Effect.succeed(implementation)

      return Layer.effect(
        ServiceTag,
        Effect.map(effect, (handlers) => ({
          _tag: name,
          handlers,
        })),
      ) as Layer.Layer<
        ProceduresService<Name, Procs>,
        never,
        REffect | EffectiveHandlerRequirements<Handlers, Procs> | ProceduresMiddlewareR<Procs>
      >
    },
  }
}
