/**
 * @module effect-trpc/core/rpc-bridge
 *
 * Bridge between effect-trpc API and @effect/rpc.
 * Converts our procedure definitions to @effect/rpc structures.
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Schedule from "effect/Schedule"
import type * as Layer from "effect/Layer"
import type * as Schema from "effect/Schema"
import * as Data from "effect/Data"
import * as Array from "effect/Array"
import type * as Brand from "effect/Brand"
import type { RpcSchema } from "@effect/rpc"
import { Rpc, RpcGroup } from "@effect/rpc"
import type { Headers } from "@effect/platform/Headers"
import type { ProcedureDefinition } from "./procedure.js"
import type {
  ProceduresGroup,
  ProcedureRecord,
  InferHandlers,
  EffectiveHandlerRequirements,
  ProceduresMiddlewareR,
} from "./procedures.js"
import type { BaseContext, MiddlewareDefinition } from "./middleware.js"
import { MiddlewareContextRef } from "./middleware.js"
import * as FiberRef from "effect/FiberRef"

// ─────────────────────────────────────────────────────────────────────────────
// RPC Bridge Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when RPC bridge validation fails.
 *
 * This is a defect (programmer error) not a runtime failure.
 *
 * @remarks
 * **Why Data.TaggedError instead of Schema.TaggedError?**
 *
 * This uses `Data.TaggedError` (not `Schema.TaggedError`) because:
 * 1. This is a programmer error (defect) that occurs during router setup
 * 2. It happens at module initialization time, not at runtime over the wire
 * 3. It doesn't need to be serialized/deserialized across network boundaries
 *
 * Use `Schema.TaggedError` for errors that need wire serialization (like
 * middleware errors that are sent to clients).
 *
 * @since 0.1.0
 * @category errors
 */
export class RpcBridgeValidationError extends Data.TaggedError("RpcBridgeValidationError")<{
  readonly module: string
  readonly method: string
  readonly reason: string
  readonly groupName?: string
}> {
  override get message(): string {
    const context = this.groupName ? ` (group: ${this.groupName})` : ""
    return `[${this.module}.${this.method}]${context} ${this.reason}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Any Rpc type
 */
export type AnyRpc = Rpc.Any

/**
 * Any ProcedureDefinition - used for type constraints that accept any procedure.
 * This uses `any` consistently to avoid variance issues with `never` types
 * when using `exactOptionalPropertyTypes`.
 */

type AnyProcedure = ProcedureDefinition<any, any, any, any, any, any, any>

// ─────────────────────────────────────────────────────────────────────────────
// Branded Types for Type-Safe Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A verified Rpc that carries proof of its origin ProcedureDefinition.
 *
 * Uses Effect's Brand pattern to ensure type safety when building RpcGroups.
 * The brand carries the procedure type information, enabling TypeScript to
 * verify that each Rpc correctly corresponds to its source procedure.
 *
 * @example
 * ```ts
 * const rpc = VerifiedRpc.make("user.get", myProcedure)
 * // rpc has type VerifiedRpc<"user.get", typeof myProcedure>
 * // The brand carries proof that this Rpc was created from myProcedure
 * ```
 */
export type VerifiedRpc<Name extends string, P extends AnyProcedure> = ProcedureToRpc<Name, P> &
  Brand.Brand<"VerifiedRpc"> & {
    /** Phantom type carrying the procedure name */
    readonly _name: Name
    /** Phantom type carrying the source procedure */
    readonly _procedure: P
  }

/**
 * Namespace for VerifiedRpc operations.
 *
 * Provides a clean factory pattern for creating verified Rpcs from procedures,
 * avoiding explicit type assertions in user code.
 */
export const VerifiedRpc = {
  /**
   * Create a VerifiedRpc from a procedure definition.
   *
   * This wraps `Rpc.make` and adds the verification brand, providing
   * type-safe proof that the Rpc was created from the given procedure.
   *
   * @param name - The full procedure name (e.g., "user.create")
   * @param def - The procedure definition with schemas
   * @returns A VerifiedRpc with precise type information and origin proof
   */
  make: <Name extends string, P extends AnyProcedure>(name: Name, def: P): VerifiedRpc<Name, P> => {
    const isStream = def.type === "stream" || def.type === "chat" || def.type === "subscription"

    // Build the Rpc with the correct options
    // The type assertion bridges our type-level computation (ProcedureToRpc)
    // with Rpc.make's inferred type. The Brand is purely compile-time.
    return Rpc.make(name, {
      ...(def.inputSchema && { payload: def.inputSchema }),
      ...(def.outputSchema && { success: def.outputSchema }),
      ...(def.errorSchema && { error: def.errorSchema }),
      ...(isStream && { stream: true as const }),
    }) as unknown as VerifiedRpc<Name, P>
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-Level Procedure → Rpc Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the payload schema from a ProcedureDefinition.
 * Returns `typeof Schema.Void` if no input schema is defined.
 */
type ProcedurePayloadSchema<P> =
  P extends ProcedureDefinition<infer I, any, any, any, any, any, any>
    ? P extends { inputSchema: Schema.Schema<I, infer IEncoded> }
      ? P["inputSchema"] extends undefined
        ? typeof Schema.Void
        : Schema.Schema<I, IEncoded>
      : typeof Schema.Void
    : typeof Schema.Void

/**
 * Extract the success schema from a ProcedureDefinition.
 * Returns `typeof Schema.Void` if no output schema is defined.
 */
type ProcedureSuccessSchema<P> =
  P extends ProcedureDefinition<any, infer A, any, any, any, any, any>
    ? P extends { outputSchema: Schema.Schema<A, infer AEncoded> }
      ? P["outputSchema"] extends undefined
        ? typeof Schema.Void
        : Schema.Schema<A, AEncoded>
      : typeof Schema.Void
    : typeof Schema.Void

/**
 * Extract the error schema from a ProcedureDefinition.
 * Returns `typeof Schema.Never` if no error schema is defined.
 */
type ProcedureErrorSchema<P> =
  P extends ProcedureDefinition<any, any, infer E, any, any, any, any>
    ? P extends { errorSchema: Schema.Schema<E, infer EEncoded> }
      ? P["errorSchema"] extends undefined
        ? typeof Schema.Never
        : Schema.Schema<E, EEncoded>
      : typeof Schema.Never
    : typeof Schema.Never

/**
 * Check if a procedure is a streaming type (stream, chat, or subscription).
 */
type IsStreamingProcedure<P> =
  P extends ProcedureDefinition<any, any, any, any, infer Type, any, any>
    ? Type extends "stream" | "chat" | "subscription"
      ? true
      : false
    : false

/**
 * Type-level mapping from ProcedureDefinition to @effect/rpc Rpc type.
 *
 * This preserves all type information through the conversion:
 * - Payload: Input schema (A channel for input)
 * - Success: Output schema, wrapped in RpcSchema.Stream for streaming procedures
 * - Error: Error schema (E channel)
 *
 * @example
 * ```ts
 * // Given:
 * const myProc = procedure
 *   .input(Schema.Struct({ id: Schema.String }))
 *   .output(Schema.Struct({ name: Schema.String }))
 *   .error(NotFoundError)
 *   .query()
 *
 * // ProcedureToRpc<"user.get", typeof myProc> produces:
 * // Rpc<"user.get", Schema.Struct<{id: String}>, Schema.Struct<{name: String}>, NotFoundError>
 * ```
 */
export type ProcedureToRpc<
  Name extends string,
  P extends ProcedureDefinition<any, any, any, any, any, any, any>,
> = Rpc.Rpc<
  Name,
  ProcedurePayloadSchema<P>,
  IsStreamingProcedure<P> extends true
    ? RpcSchema.Stream<ProcedureSuccessSchema<P>, ProcedureErrorSchema<P>>
    : ProcedureSuccessSchema<P>,
  IsStreamingProcedure<P> extends true ? typeof Schema.Never : ProcedureErrorSchema<P>
>

/**
 * Map all procedures in a record to their corresponding VerifiedRpc types.
 * Returns a union of all branded Rpc types for the group.
 *
 * Each Rpc in the union carries proof of its origin procedure via the brand,
 * enabling type-safe composition and verification.
 *
 * @example
 * ```ts
 * const UserProcs = procedures("user", {
 *   get: procedure.input(IdSchema).output(UserSchema).query(),
 *   list: procedure.output(UsersSchema).query(),
 * })
 *
 * // ProceduresToRpcs<"user", typeof UserProcs["procedures"]> produces:
 * // VerifiedRpc<"user.get", ...> | VerifiedRpc<"user.list", ...>
 * ```
 */
export type ProceduresToRpcs<
  GroupName extends string,
  Procs extends ProcedureRecord,
  Prefix extends string = "",
> = {
  [K in keyof Procs & string]: VerifiedRpc<`${Prefix}${GroupName}.${K}`, Procs[K]>
}[keyof Procs & string]

/**
 * Infer the handler function type for an Rpc.
 * This aligns with @effect/rpc's ToHandlerFn type.
 */
export type InferRpcHandler<R extends Rpc.Any> = Rpc.ToHandlerFn<R, any>

// ─────────────────────────────────────────────────────────────────────────────
// Procedure → Rpc Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a single procedure definition to an @effect/rpc Rpc.
 *
 * **Type Safety:**
 *
 * This function returns a `VerifiedRpc` - a branded type that carries proof
 * that this Rpc was created from the given ProcedureDefinition. This enables
 * type-safe composition when building RpcGroups.
 *
 * The return type preserves:
 * - Input schema (payload)
 * - Output schema (success)
 * - Error schema (error)
 * - Whether it's a streaming procedure
 * - The source procedure (via brand)
 *
 * @param name - The full procedure name (e.g., "user.create")
 * @param def - The procedure definition with schemas
 * @returns A VerifiedRpc with precise type information and origin proof
 *
 * @see {@link VerifiedRpc.make} for the underlying implementation
 */
export const procedureToRpc = <Name extends string, P extends AnyProcedure>(
  name: Name,
  def: P,
): VerifiedRpc<Name, P> => VerifiedRpc.make(name, def)

// ─────────────────────────────────────────────────────────────────────────────
// ProceduresGroup → RpcGroup Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a procedures group to an @effect/rpc RpcGroup.
 *
 * **Type Safety:**
 *
 * The returned RpcGroup preserves full type information from the procedures.
 * This enables type-safe handler implementations and proper R/E/A channel tracking.
 *
 * @param group - The procedures group to convert
 * @param pathPrefix - Optional path prefix for nested routers (e.g., "user.posts.")
 *
 * @throws RpcBridgeValidationError - If the group has no procedures (programmer error)
 */
export const proceduresGroupToRpcGroup = <
  Name extends string,
  Procs extends ProcedureRecord,
  Prefix extends string = "",
>(
  group: ProceduresGroup<Name, Procs>,
  pathPrefix: Prefix = "" as Prefix,
): RpcGroup.RpcGroup<ProceduresToRpcs<Name, Procs, Prefix>> => {
  // Convert each procedure to an Rpc with full path using functional map
  const rpcs = Object.entries(group.procedures).map(([key, def]) => {
    // Full path: prefix + group name + procedure name
    // e.g., "user." + "posts" + "." + "list" = "user.posts.list"
    const fullName = `${pathPrefix}${group.name}.${key}`
    return procedureToRpc(fullName, def)
  })

  // Validation: ProceduresGroup must have at least one procedure.
  //
  // Why throw instead of Effect.fail?
  // 1. This is a DEFECT (programmer error), not a recoverable runtime error
  // 2. It happens at module initialization time, before any Effect runtime
  // 3. Using Effect.fail would change the return type to Effect<RpcGroup, Error>
  //    and propagate through the entire API, requiring error handling everywhere
  // 4. This matches Effect's pattern: defects throw, expected errors use Effect.fail
  // 5. Similar to Zod's approach: schema definition errors throw immediately
  if (rpcs.length === 0) {
    throw new RpcBridgeValidationError({
      module: "RpcBridge",
      method: "proceduresGroupToRpcGroup",
      reason: "ProceduresGroup has no procedures",
      groupName: group.name,
    })
  }

  // Build RpcGroup using spread - RpcGroup.make takes variadic Rpc arguments
  //
  // Why is `as unknown as` necessary?
  // TypeScript can't track the union type through the dynamic array construction.
  // We compute the exact type at the type level with ProceduresToRpcs<...>,
  // but the runtime builds the array dynamically from Object.entries().
  // The assertion is sound because our type-level computation matches
  // exactly what RpcGroup.make produces from the procedure definitions.
  return RpcGroup.make(...(rpcs as unknown as ReadonlyArray<ProceduresToRpcs<Name, Procs, Prefix>>))
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handler options passed by @effect/rpc
 */
export interface RpcHandlerOptions {
  readonly clientId: number
  readonly headers: Headers
}

/**
 * The actual handler function type expected by @effect/rpc
 */
type _RpcHandlerFn = (
  payload: unknown,
  options: RpcHandlerOptions,
) => Effect.Effect<unknown, unknown>

/**
 * Convert @effect/platform Headers to standard web Headers.
 *
 * @effect/platform Headers are branded objects with string values.
 * The standard Headers constructor accepts them directly.
 *
 * @remarks
 * **Why `as unknown as Record<string, string>`?**
 *
 * @effect/platform's `Headers` type is branded (`Headers & Brand<"Headers">`),
 * but at runtime it's a plain object with string keys and values. The web
 * `Headers` constructor accepts `Record<string, string>`, but TypeScript
 * doesn't know the branded type is compatible.
 *
 * This cast is safe because:
 * 1. @effect/platform Headers are created from web Headers or plain objects
 * 2. The underlying structure is always `{ [key: string]: string }`
 * 3. The web Headers constructor handles this shape correctly
 */
const toWebHeaders = (platformHeaders: Headers): globalThis.Headers => {
  return new globalThis.Headers(platformHeaders as unknown as Record<string, string>)
}

/**
 * Apply middleware chain to a handler.
 * Middleware are executed in order, each calling next() to proceed.
 *
 * Includes automatic tracing for observability.
 * Each procedure call creates a span with metadata about the request.
 *
 * @remarks
 * **Middleware Execution:**
 *
 * Middleware is executed in the order they are applied via `.use()` on the procedure.
 * Each middleware's implementation is retrieved via its `serviceTag` and executed
 * sequentially, with context flowing through the chain.
 *
 * **Context Construction:**
 * The middleware context is constructed from @effect/rpc's handler options:
 * - `procedure`: Full procedure path (e.g., "user.create")
 * - `headers`: Converted from @effect/platform Headers to standard web Headers
 * - `signal`: AbortSignal for compatibility (Effect uses fiber interruption)
 * - `clientId`: Unique client identifier from @effect/rpc
 */
/**
 * Generic handler function type for context-aware handlers.
 *
 * @template Ctx - The context type after middleware transformation
 * @template I - The input/payload type
 * @template A - The output type (value for effects, item for streams)
 * @template E - The error type
 * @template R - The requirements (dependencies)
 */
type GenericHandler<Ctx extends BaseContext, I, A, E, R> = (
  ctx: Ctx,
  input: I,
) => Effect.Effect<A, E, R>

/**
 * Generic stream handler function type.
 */
type GenericStreamHandler<Ctx extends BaseContext, I, A, E, R> = (
  ctx: Ctx,
  input: I,
) => Stream.Stream<A, E, R>

/**
 * Result type from applyMiddleware - either an Effect or a Stream depending on procedure type.
 *
 * @template A - The output type
 * @template E - The error type
 * @template R - The requirements
 */
type MiddlewareResult<A = unknown, E = unknown, R = unknown> =
  | Effect.Effect<A, E, R>
  | Stream.Stream<A, E, R>

/**
 * Simple handler type for internal use in convertHandlers.
 * Uses `any` because we iterate over procedures dynamically.
 */

type Handler = (ctx: any, input: any) => Effect.Effect<any, any, any>

/**
 * Apply middleware chain to a handler with full type tracking.
 *
 * **Type Safety:**
 *
 * This function is generic over all Effect channels:
 * - `I`: The payload type from the procedure's input schema
 * - `A`: The output type from the procedure's output schema
 * - `E`: Combined error types from middleware chain + handler
 * - `Ctx`: The context type after middleware transformation
 * - `R`: Combined requirements from middleware + handler
 *
 * The middleware array uses `any` because the chain is dynamically composed,
 * but type safety is ensured at the procedure definition level where
 * middleware is attached via `.use()`.
 *
 * @overload Stream procedures return Stream.Stream
 * @overload Effect procedures return Effect.Effect
 */
/**
 * Type alias for any middleware definition.
 *
 * NOTE: The new middleware system uses MiddlewareDefinition as a contract.
 * Middleware execution is handled by providing MiddlewareService layers
 * and accessing them at runtime. This is a work-in-progress.
 */
type AnyMiddleware = MiddlewareDefinition<any, any, any, any>

/**
 * Apply middleware chain to a handler.
 *
 * TODO: Middleware execution needs to be redesigned for the new MiddlewareDefinition pattern.
 * The new pattern separates definition (contract) from implementation (Layer).
 * For now, middleware definitions are tracked at the type level but not executed at runtime.
 * Middleware implementation will be addressed in a follow-up PR.
 */
function applyMiddleware<I, A, E, Ctx extends BaseContext, R>(
  middlewares: ReadonlyArray<AnyMiddleware>,
  procedureName: string,
  handler: GenericStreamHandler<Ctx, I, A, E, R>,
  options: RpcHandlerOptions,
  payload: I,
  isStream: true,
): Stream.Stream<A, E, R>

function applyMiddleware<I, A, E, Ctx extends BaseContext, R>(
  middlewares: ReadonlyArray<AnyMiddleware>,
  procedureName: string,
  handler: GenericHandler<Ctx, I, A, E, R>,
  options: RpcHandlerOptions,
  payload: I,
  isStream: false,
): Effect.Effect<A, E, R>

function applyMiddleware<I, A, E, Ctx extends BaseContext, R>(
  middlewares: ReadonlyArray<AnyMiddleware>,
  procedureName: string,
  handler: GenericHandler<Ctx, I, A, E, R> | GenericStreamHandler<Ctx, I, A, E, R>,
  options: RpcHandlerOptions,
  payload: I,
  isStream: boolean,
): MiddlewareResult<A, E, R>

function applyMiddleware<I, A, E, Ctx extends BaseContext, R>(
  middlewares: ReadonlyArray<AnyMiddleware>,
  procedureName: string,
  handler: GenericHandler<Ctx, I, A, E, R> | GenericStreamHandler<Ctx, I, A, E, R>,
  options: RpcHandlerOptions,
  payload: I,
  isStream: boolean,
): MiddlewareResult<A, E, R> {
  type AnyHandler = (ctx: any, input: any) => any
  const anyHandler = handler as AnyHandler

  /**
   * Execute the middleware chain by sequentially getting each middleware's
   * service from the Effect context and running its handler.
   *
   * Each middleware handler receives the current context and input, and returns
   * the transformed context. The final context is passed to the procedure handler.
   */
  const executeMiddlewareChain = (baseContext: BaseContext): Effect.Effect<any, any, any> =>
    Effect.gen(function* () {
      let ctx: any = baseContext

      // Execute each middleware in sequence
      for (const middleware of middlewares) {
        // Get the middleware service from Effect context using its serviceTag
        const service = yield* middleware.serviceTag
        // Execute the middleware handler, passing current context and input
        ctx = yield* service.handler(ctx, payload)
      }

      return ctx
    })

  const setupContext = Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({
      "trpc.procedure": procedureName,
      "trpc.clientId": options.clientId,
      "trpc.hasMiddleware": middlewares.length > 0,
    })

    const abortController = new AbortController()

    const baseContext: BaseContext = {
      procedure: procedureName,
      headers: toWebHeaders(options.headers),
      signal: abortController.signal,
      clientId: options.clientId,
    }

    return { baseContext, abortController }
  })

  if (isStream) {
    // Stream handler - execute middleware chain then call handler
    const stream = Stream.unwrap(
      Effect.gen(function* () {
        const { baseContext } = yield* setupContext
        // Execute middleware chain to get final context
        const finalCtx = middlewares.length > 0
          ? yield* executeMiddlewareChain(baseContext)
          : baseContext
        yield* FiberRef.set(MiddlewareContextRef, finalCtx)
        return anyHandler(finalCtx, payload)
      }),
    ).pipe(Stream.withSpan(`trpc.procedure.${procedureName}`, { captureStackTrace: false }))

    return stream as Stream.Stream<A, E, R>
  }

  // Effect (Mutation/Query) logic - execute middleware chain then call handler
  const effect = Effect.gen(function* () {
    const { baseContext } = yield* setupContext
    // Execute middleware chain to get final context
    const finalCtx = middlewares.length > 0
      ? yield* executeMiddlewareChain(baseContext)
      : baseContext
    yield* FiberRef.set(MiddlewareContextRef, finalCtx)
    return yield* anyHandler(finalCtx, payload)
  }).pipe(Effect.withSpan(`trpc.procedure.${procedureName}`, { captureStackTrace: false }))

  return effect as Effect.Effect<A, E, R>
}

/**
 * Convert effect-trpc handlers to @effect/rpc handler format.
 *
 * **v2 Handler Signature:**
 * Our handlers: `{ methodName: (ctx, input) => Effect<Output, Error> }`
 * RpcGroup handlers: `{ "namespace.methodName": (payload, options) => Effect<Output, Error> }`
 *
 * The context is automatically passed to handlers based on the middleware chain.
 * This enables compile-time type safety for middleware context.
 *
 * @param group - The procedures group
 * @param handlers - The handler implementations (v2 signature: `(ctx, input) => Effect`)
 * @param pathPrefix - Optional path prefix for nested routers (e.g., "user.posts.")
 * @param routerMiddlewares - Optional router-level middlewares to prepend to each procedure's chain
 *
 * @throws RpcBridgeValidationError - If a procedure is missing its handler implementation
 */
export const convertHandlers = <Name extends string, Procs extends ProcedureRecord>(
  group: ProceduresGroup<Name, Procs>,
  handlers: InferHandlers<Procs>,
  pathPrefix: string = "",
  routerMiddlewares: ReadonlyArray<AnyMiddleware> = [],
): Record<string, (payload: unknown, options: RpcHandlerOptions) => MiddlewareResult> => {
  // First, validate that all procedures have handlers
  // This is a programmer error that should fail fast during setup
  const missingHandlers = Object.keys(group.procedures).filter((key) => {
    const userHandler = (handlers as Record<string, unknown>)[key]
    return userHandler === undefined || typeof userHandler !== "function"
  })

  if (missingHandlers.length > 0) {
    throw new RpcBridgeValidationError({
      module: "RpcBridge",
      method: "convertHandlers",
      reason: `Missing handler implementation(s) for procedure(s): ${missingHandlers.join(", ")}`,
      groupName: group.name,
    })
  }

  // Use reduce for functional pattern instead of imperative mutation
  return Object.keys(group.procedures).reduce(
    (rpcHandlers, key) => {
      // Full path: prefix + group name + procedure name
      const fullName = `${pathPrefix}${group.name}.${key}`
      const procedureDef = group.procedures[key] as ProcedureDefinition
      // Get the user handler - signature: (ctx, input) => Effect
      // Cast through unknown because InferHandlers allows any R in handler return types
      const userHandler = (handlers as unknown as Record<string, Handler>)[key]! // Non-null assertion is safe after validation above

      const isStream =
        procedureDef.type === "stream" ||
        procedureDef.type === "chat" ||
        procedureDef.type === "subscription"

      // Add keep-alive messages every 15s for stream/chat procedures to prevent proxies from killing the connection
      const finalUserHandler = isStream
        ? (ctx: unknown, payload: unknown) => {
            const dataStream = userHandler(ctx, payload) as unknown as Stream.Stream<
              unknown,
              unknown
            >
            const keepAliveStream = Stream.repeatEffect(
              Effect.succeed({ _tag: "KeepAlive" } as const),
            ).pipe(Stream.schedule(Schedule.spaced("15 seconds")))

            return Stream.merge(dataStream, keepAliveStream, { haltStrategy: "left" }) as any
          }
        : userHandler

      // Combine router-level middleware (first) with procedure-level middleware (second)
      // Router middleware runs first, then procedure-specific middleware
      const procedureMiddlewares = procedureDef.middlewares ?? []
      const middlewares = [...routerMiddlewares, ...procedureMiddlewares]

      // Wrap user handler with middleware chain
      return {
        ...rpcHandlers,
        [fullName]: (payload: unknown, options: RpcHandlerOptions) =>
          applyMiddleware(middlewares, fullName, finalUserHandler, options, payload, isStream),
      }
    },
    {} as Record<string, (payload: unknown, options: RpcHandlerOptions) => MiddlewareResult>,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Layer Creation
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateServerLayerOptions {
  /**
   * Path for the RPC endpoint.
   * @default '/rpc'
   */
  readonly path?: string
}

/**
 * Create the @effect/rpc components from a procedures group.
 * Returns the RpcGroup for use with RpcServer.
 *
 * @remarks
 * **Type Safety:**
 *
 * This function tracks requirements through the bridge:
 * - `REffect`: Requirements from the Effect that creates handlers
 * - `HandlersRequirements`: Requirements from individual handler return types
 * - `ProceduresMiddlewareR`: Requirements from middleware attached to procedures
 *
 * The only type assertion is for the handler record shape conversion between
 * our format `{ key: (ctx, input) => Effect }` and @effect/rpc's format
 * `{ "namespace.key": (payload, options) => Effect }`. The requirements and
 * error types flow through properly.
 */
/**
 * The precise Rpc union type for a procedures group.
 */
export type GroupRpcs<
  Name extends string,
  Procs extends ProcedureRecord,
  Prefix extends string = "",
> = ProceduresToRpcs<Name, Procs, Prefix>

/**
 * The precise handler type required for a procedures group.
 * This matches @effect/rpc's HandlersFrom type for our Rpcs.
 */
export type GroupHandlers<
  Name extends string,
  Procs extends ProcedureRecord,
  Prefix extends string = "",
> = RpcGroup.HandlersFrom<GroupRpcs<Name, Procs, Prefix>>

/**
 * Create the @effect/rpc components from a procedures group.
 * Returns the RpcGroup for use with RpcServer.
 *
 * **Full Type Safety:**
 *
 * This function now preserves complete type information through the bridge:
 * - `rpcGroup`: Precisely typed with all procedure schemas preserved
 * - `createHandlersLayer`: Returns a Layer with accurate requirements tracking
 *
 * The types flow through cleanly:
 * - Input schemas → Rpc payload types
 * - Output schemas → Rpc success types (wrapped in Stream for streaming procs)
 * - Error schemas → Rpc error types
 * - Handler requirements → Layer requirements
 * - Middleware requirements → Layer requirements
 * - Middleware provides → Excluded from Layer requirements
 */
export const createRpcComponents = <Name extends string, Procs extends ProcedureRecord>(
  group: ProceduresGroup<Name, Procs>,
): {
  rpcGroup: RpcGroup.RpcGroup<GroupRpcs<Name, Procs>>
  createHandlersLayer: <Handlers extends InferHandlers<Procs>, REffect = never>(
    handlersOrEffect: Handlers | Effect.Effect<Handlers, never, REffect>,
  ) => Layer.Layer<
    RpcGroup.Rpcs<GroupRpcs<Name, Procs>>,
    never,
    REffect | EffectiveHandlerRequirements<Handlers, Procs> | ProceduresMiddlewareR<Procs>
  >
} => {
  const rpcGroup = proceduresGroupToRpcGroup(group)

  return {
    rpcGroup,
    createHandlersLayer: <Handlers extends InferHandlers<Procs>, REffect = never>(
      handlersOrEffect: Handlers | Effect.Effect<Handlers, never, REffect>,
    ) => {
      const handlersEffect: Effect.Effect<Handlers, never, REffect> = Effect.isEffect(
        handlersOrEffect,
      )
        ? handlersOrEffect
        : (Effect.succeed(handlersOrEffect) as Effect.Effect<Handlers, never, REffect>)

      // Convert our handlers to @effect/rpc format
      // The runtime conversion is correct; we use unknown as an intermediate step
      // to bridge between our handler format and @effect/rpc's HandlersFrom format
      const adaptedHandlers = Effect.map(handlersEffect, (handlers) =>
        convertHandlers(group, handlers),
      ) as unknown as Effect.Effect<GroupHandlers<Name, Procs>, never, REffect>

      // Create the layer - the type flows through from the RpcGroup
      return rpcGroup.toLayer(adaptedHandlers) as Layer.Layer<
        RpcGroup.Rpcs<GroupRpcs<Name, Procs>>,
        never,
        REffect | EffectiveHandlerRequirements<Handlers, Procs> | ProceduresMiddlewareR<Procs>
      >
    },
  }
}
