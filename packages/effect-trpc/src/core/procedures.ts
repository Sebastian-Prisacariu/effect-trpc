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
import type { BaseContext } from "./middleware.js"
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
 * A procedure definition with fully permissive type parameters.
 * 
 * This type uses `any` for all type parameters to serve as a constraint
 * that accepts any valid procedure definition.
 *
 * @remarks
 * **Why `any` is necessary here:**
 * 
 * With `exactOptionalPropertyTypes: true`, TypeScript's variance rules
 * become very strict. The Schema type is invariant, meaning:
 * - `Schema<string>` is NOT assignable to `Schema<unknown>`
 * - `Schema<never>` is NOT assignable to `Schema<any>` (!)
 * 
 * Even using `any` for all type parameters doesn't work because procedures
 * may have `errorSchema: Schema<never, ...>` when no error schema is defined.
 * 
 * This type is provided for cases where you need to work with a single
 * procedure definition. For collections, use `ProcedureRecord`.
 *
 * @since 0.1.0
 * @category models
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for variance compatibility
export type AnyProcedureDefinition = ProcedureDefinition<any, any, any, any, any, any, any>

/**
 * A record of procedure definitions.
 *
 * @remarks
 * **Why `Record<string, any>` is used:**
 * 
 * With `exactOptionalPropertyTypes: true`, TypeScript's variance rules
 * prevent even `ProcedureDefinition<any, any, ...>` from accepting all
 * valid procedures. The issue is:
 * 
 * 1. Procedures without error schemas have `errorSchema: Schema<never, ...> | undefined`
 * 2. `Schema<never>` is NOT assignable to `Schema<any>` due to contravariance
 * 3. This is a fundamental TypeScript limitation with invariant types
 * 
 * Using `Record<string, any>` is the standard pattern in libraries like
 * tRPC, React Query, and Effect itself.
 * 
 * **Type safety is NOT lost because:**
 * 
 * 1. This is a constraint type, not a value type
 * 2. Actual procedures preserve their full types through generic parameters
 * 3. `InferHandlers<P>` extracts the correct types for implementation
 * 4. Hook types provide full type safety when calling procedures
 *
 * @since 0.1.0
 * @category models
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for variance compatibility with exactOptionalPropertyTypes
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
 * - stream/chat: `(ctx: C, input: I) => Stream<O, E, R>`
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
        ? (ctx: Ctx, input: I) => Stream.Stream<A, E, any>
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- See ProcedureRecord for explanation
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
export type InferHandlerContext<P extends AnyProcedureDefinition> =
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
 * @remarks
 * Uses `any` in the conditional type patterns because TypeScript's type
 * inference requires `any` (not `unknown`) to properly extract type parameters
 * in `infer` positions. Using `unknown` would cause the conditionals to fail
 * to match.
 *
 * @internal
 */
type ExtractHandlerRequirements<H> = 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for `infer` to work
  H extends (...args: any[]) => Effect.Effect<any, any, infer R>
    ? R
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for `infer` to work
    : H extends (...args: any[]) => Stream.Stream<any, any, infer R>
      ? R
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for `infer` to work
      : H extends SubscriptionHandler<any, any, any, infer R>
        ? R
        : never

/**
 * A handler function type - either a function returning Effect/Stream or a SubscriptionHandler.
 * 
 * @remarks
 * Uses `any` for Effect/Stream type parameters because:
 * 1. Effect.Effect<A, E, R> is covariant in A, contravariant in E and R
 * 2. A handler returning Effect<User[], never, never> isn't assignable to Effect<unknown, unknown, unknown>
 * 3. Using `any` allows all valid handler return types to be accepted
 * 
 * This type is used as a constraint, not a value type - actual handler types are preserved.
 *
 * @internal
 */
type AnyHandlerFunction =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for variance compatibility
  | ((...args: any[]) => Effect.Effect<any, any, any>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for variance compatibility
  | ((...args: any[]) => Stream.Stream<any, any, any>)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for variance compatibility
  | SubscriptionHandler<any, any, any, any>

/**
 * Extract all requirements from a handlers object.
 * Returns a union of all handler requirements.
 * 
 * @remarks
 * The constraint uses `AnyHandlerFunction` with `any` for variance compatibility.
 * Actual handler types are preserved through the generic parameter.
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
export type HandlersRequirements<H extends Record<string, AnyHandlerFunction>> = {
  [K in keyof H]: ExtractHandlerRequirements<H[K]>
}[keyof H]

/**
 * Extract all middleware requirements from a procedures record.
 * Returns a union of middleware R from all procedures.
 * 
 * @remarks
 * Uses `any` in conditional type patterns for type parameter extraction.
 * See `ExtractHandlerRequirements` for detailed explanation.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for `infer` to work
  [K in keyof Procs]: Procs[K] extends ProcedureDefinition<any, any, any, any, any, infer R, any>
    ? R
    : never
}[keyof Procs]

/**
 * Extract all errors from a procedures record.
 * Returns a union of error types from all procedures.
 * 
 * @remarks
 * Uses `any` in conditional type patterns for type parameter extraction.
 * See `ExtractHandlerRequirements` for detailed explanation.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for `infer` to work
  [K in keyof Procs]: Procs[K] extends ProcedureDefinition<any, any, infer E, any, any, any, any>
    ? E
    : never
}[keyof Procs]

/**
 * Extract all services provided by middleware from a procedures record.
 * Returns a union of provided service types from all procedures.
 * 
 * @remarks
 * Uses `any` in conditional type patterns for type parameter extraction.
 * See `ExtractHandlerRequirements` for detailed explanation.
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for `infer` to work
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
  Handlers extends Record<string, AnyHandlerFunction>,
  Procs extends ProcedureRecord
> = Exclude<HandlersRequirements<Handlers>, ProceduresProvides<Procs>>

/**
 * A group of related procedures.
 *
 * Created by `Procedures.make()`. User-visible tags are inferred from Router.make() keys,
 * not from the procedures group itself. The `namespace` parameter is only used for
 * internal service identification in the Effect context.
 *
 * @example
 * ```ts
 * // The namespace "user" is for internal service identification
 * const UserProcedures = Procedures.make("user", {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 * })
 *
 * // User-visible tags come from Router.make keys:
 * const router = Router.make({
 *   users: UserProcedures,  // Tags: "users.list", "users.byId"
 * })
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface ProceduresGroup<
  Namespace extends string = string,
  Procs extends ProcedureRecord = ProcedureRecord,
> {
  readonly _tag: "ProceduresGroup"
  /**
   * Internal namespace for service identification.
   * User-visible tags are determined by Router.make() keys.
   */
  readonly namespace: Namespace
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
    ProceduresService<Namespace, Procs>,
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
 * Assert that the layer type includes handler and middleware requirements.
 *
 * **Why this assertion is intentional:**
 *
 * `Layer.effect` returns `Layer<A, E, REffect>` where `REffect` is only the
 * requirements of the Effect that *constructs* the handlers object.
 *
 * However, consumers need to know about ALL requirements:
 * - `REffect`: Requirements to construct the handlers (e.g., Database to build handlers)
 * - `EffectiveHandlerRequirements`: Requirements when handlers are *invoked*
 * - `ProceduresMiddlewareR`: Requirements from middleware attached to procedures
 *
 * By widening the Layer's R type, we ensure consumers provide all dependencies
 * that will be needed when the service is actually used, not just when it's
 * constructed.
 *
 * This is a **type-level propagation** pattern - the assertion doesn't change
 * runtime behavior, it propagates requirement information through the type system.
 *
 * @internal
 */
function unsafeAssertLayerRequirements<A, R>(
  layer: Layer.Layer<A, never, unknown>,
): Layer.Layer<A, never, R> {
  return layer as Layer.Layer<A, never, R>
}

/**
 * Define a group of related procedures.
 *
 * Groups related procedures together and provides a type-safe way to
 * create the implementation layer via `.toLayer()`.
 *
 * **Namespace vs Tags:**
 * - The `namespace` parameter is for internal service identification in the Effect context
 * - User-visible tags (like "users.list") are determined by Router.make() keys
 *
 * @param namespace - Internal namespace for service identification (e.g., 'user', 'post')
 * @param defs - Record of procedure definitions
 *
 * @example
 * ```ts
 * import { Procedures, procedure } from 'effect-trpc'
 *
 * // "user" is the internal namespace for service identification
 * export const UserProcedures = Procedures.make('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 *   create: procedure.input(CreateSchema).invalidates(['users.list']).mutation(),
 * })
 *
 * // User-visible tags come from Router.make keys:
 * const router = Router.make({
 *   users: UserProcedures,  // Tags: "users.list", "users.byId", "users.create"
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
const make = <
  Namespace extends string,
  Procs extends ProcedureRecord,
>(
  namespace: Namespace,
  defs: Procs,
): ProceduresGroup<Namespace, Procs> => {
  // Create a unique tag for this procedures group
  const ServiceTag = Context.GenericTag<ProceduresService<Namespace, Procs>>(
    `@effect-trpc/${namespace}`,
  )

  return {
    _tag: "ProceduresGroup",
    namespace,
    procedures: defs,

    toLayer: <Handlers extends InferHandlers<Procs>, REffect = never>(
      implementation: Handlers | Effect.Effect<Handlers, never, REffect>,
    ) => {
      const effect: Effect.Effect<Handlers, never, REffect> = Effect.isEffect(implementation)
        ? implementation
        : Effect.succeed(implementation)

      const layer = Layer.effect(
        ServiceTag,
        Effect.map(effect, (handlers) => ({
          _tag: namespace,
          handlers,
        })),
      )

      // Widen the layer type to include handler and middleware requirements.
      // See unsafeAssertLayerRequirements documentation for why this is intentional.
      return unsafeAssertLayerRequirements<
        ProceduresService<Namespace, Procs>,
        REffect | EffectiveHandlerRequirements<Handlers, Procs> | ProceduresMiddlewareR<Procs>
      >(layer)
    },
  }
}

/**
 * Namespace for procedure group functions.
 *
 * @example
 * ```ts
 * import { Procedures, procedure } from 'effect-trpc'
 *
 * const UserProcedures = Procedures.make('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 * })
 * ```
 *
 * @since 0.5.0
 * @category namespaces
 */
export const Procedures = {
  make,
} as const

/**
 * @deprecated Use `Procedures.make()` instead. Will be removed in v1.0.
 */
export const procedures = make
