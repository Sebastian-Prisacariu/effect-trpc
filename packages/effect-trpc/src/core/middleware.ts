/**
 * @module effect-trpc/core/middleware
 *
 * Middleware system for effect-trpc.
 * Middleware can be applied at the procedure or router level.
 *
 * Middleware uses a builder-first API with explicit implementation layers:
 * @example
 * ```ts
 * const OrgMiddleware = Middleware("org")
 *   .input(Schema.Struct({ organizationSlug: Schema.String }))
 *   .provides<{ org: Organization }>()
 *
 * const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
 *   Effect.gen(function* () {
 *     const org = yield* OrgService.getBySlug(input.organizationSlug)
 *     return { ...ctx, org }
 *   }),
 * )
 * ```
 */

import * as Effect from "effect/Effect"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { Pipeable } from "effect/Pipeable"
import { pipeArguments } from "effect/Pipeable"

// ─────────────────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base context available to all middleware and handlers.
 *
 * @remarks
 * This context is constructed from @effect/rpc's request options and provides
 * a familiar interface for middleware authors.
 *
 * @since 0.1.0
 */
export interface BaseContext {
  /**
   * The full procedure path (e.g., "user.create").
   */
  readonly procedure: string

  /**
   * Request headers (standard web Headers).
   *
   * @remarks
   * Converted from @effect/platform Headers for compatibility with
   * standard web APIs and existing middleware patterns.
   */
  readonly headers: Headers

  /**
   * Abort signal for request cancellation.
   *
   * @remarks
   * **Important**: This signal is provided for compatibility with code that
   * expects AbortSignal. However, Effect-based code should use Effect's
   * built-in fiber interruption system instead, which is more powerful.
   *
   * The signal will be aborted when:
   * - The client disconnects (handled by @effect/rpc's fiber interruption)
   * - The request times out (if configured)
   *
   * For Effect-idiomatic cancellation, use:
   * - `Effect.interrupt` to cancel the current fiber
   * - `Effect.onInterrupt` to handle cleanup on cancellation
   * - `Effect.interruptible` / `Effect.uninterruptible` to control regions
   */
  readonly signal: AbortSignal

  /**
   * Unique client identifier for this connection.
   *
   * @remarks
   * Provided by @effect/rpc. Useful for tracking requests from the same client
   * or implementing per-client rate limiting.
   */
  readonly clientId: number
}

/**
 * Runtime constructor + schema type for tagged errors.
 */
export type TaggedErrorClass = Schema.Schema<unknown, unknown> &
  (abstract new (...args: ReadonlyArray<unknown>) => { readonly _tag: string })

/**
 * Runtime implementation signature for middleware definitions.
 */
export type MiddlewareImplementation<CtxIn, CtxOut, InputExt, E, R = never> = (
  ctx: CtxIn,
  input: InputExt,
) => Effect.Effect<CtxOut, E, R>

/**
 * Fluent middleware builder used by `Middleware("name")`.
 */
export interface MiddlewareBuilder<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  E,
  R,
  Provides,
  InputExt,
> extends Middleware<CtxIn, CtxOut, E, R, Provides, InputExt> {
  input<I, IFrom>(
    schema: Schema.Schema<I, IFrom>,
  ): MiddlewareBuilder<CtxIn, CtxOut, E, R, Provides, InputExt & I>

  error<Errors extends readonly [TaggedErrorClass, ...ReadonlyArray<TaggedErrorClass>]>(
    ...errors: Errors
  ): MiddlewareBuilder<CtxIn, CtxOut, E | InstanceType<Errors[number]>, R, Provides, InputExt>

  provides<P extends object>(): MiddlewareBuilder<CtxIn, CtxOut & P, E, R, Provides | P, InputExt>

  toLayer<RImpl>(
    implementation: MiddlewareImplementation<CtxIn, CtxOut, InputExt, E, RImpl>,
  ): Layer.Layer<R, never, RImpl>
}

let middlewareDefinitionId = 0

const nextMiddlewareImplementationTagId = (name: string): string => {
  middlewareDefinitionId += 1
  return `@effect-trpc/middleware/${name}/${middlewareDefinitionId}`
}

function mergeInputSchemas(
  left: Schema.Schema<unknown, unknown> | undefined,
  right: Schema.Schema<unknown, unknown> | undefined,
): Schema.Schema<unknown, unknown> | undefined {
  if (left === undefined) {
    return right
  }
  if (right === undefined) {
    return left
  }
  return Schema.extend(
    left as Schema.Schema<object, unknown>,
    right as Schema.Schema<object, unknown>,
  ) as Schema.Schema<unknown, unknown>
}

function unsafeAssertLayerRequirements<A, RRequirements>(
  layer: Layer.Layer<A, never, never>,
): Layer.Layer<A, never, RRequirements> {
  return layer as Layer.Layer<A, never, RRequirements>
}

/**
 * Context with authenticated user (after auth middleware).
 *
 * @since 0.1.0
 */
export interface AuthenticatedContext<TUser = unknown> extends BaseContext {
  readonly user: TUser
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A middleware function that can transform context and intercept requests.
 *
 * @template CtxIn - The input context type
 * @template CtxOut - The output context type (what's passed to next)
 * @template InputIn - The input type this middleware expects
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 *
 * @since 0.4.0
 */
export type MiddlewareFn<CtxIn, CtxOut, InputIn, E, R> = (
  ctx: CtxIn,
  input: InputIn,
  next: (ctx: CtxOut) => Effect.Effect<unknown, unknown, unknown>,
) => Effect.Effect<unknown, E, R>

/**
 * Symbol to identify Middleware at runtime.
 * @internal
 */
export const MiddlewareTypeId: unique symbol = Symbol.for("@effect-trpc/Middleware")

/**
 * @internal
 */
export type MiddlewareTypeId = typeof MiddlewareTypeId

/**
 * A middleware object with metadata.
 *
 * Middleware is pipeable and can be provided via `Router.provide(...)`.
 *
 * @template CtxIn - The input context type
 * @template CtxOut - The output context type
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 * @template Provides - Services this middleware provides to downstream handlers
 * @template InputExt - Input schema extension this middleware requires
 *
 * @example
 * ```ts
 * const OrgMiddleware = Middleware("org")
 *   .input(Schema.Struct({ organizationSlug: Schema.String }))
 *   .provides<{ org: Organization }>()
 *
 * const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
 *   Effect.gen(function* () {
 *     const org = yield* OrgService.getBySlug(input.organizationSlug)
 *     return { ...ctx, org }
 *   }),
 * )
 * ```
 *
 * @since 0.1.0
 */
export interface Middleware<
  CtxIn = BaseContext,
  CtxOut = CtxIn,
  E = never,
  R = never,
  Provides = never,
  InputExt = unknown,
> extends Pipeable {
  readonly [MiddlewareTypeId]: MiddlewareTypeId
  readonly _tag: "Middleware"
  readonly name: string
  readonly fn: MiddlewareFn<CtxIn, CtxOut, InputExt, E, R>
  /**
   * Services this middleware provides to downstream handlers.
   * These are excluded from the procedure's requirements.
   * @internal
   */
  readonly _provides?: Provides
  /**
   * Phantom type for input extension.
   * @internal
   */
  readonly _inputExt?: InputExt
  /**
   * Runtime schema for input extension (used for schema merging).
   */
  readonly inputSchema?: Schema.Schema<InputExt, unknown>
  /**
   * Declared tagged error classes for this middleware.
   */
  readonly errorSchemas?: ReadonlyArray<TaggedErrorClass>
}

/**
 * Check if a value is a Middleware.
 *
 * @since 0.4.0
 */
export const isMiddleware = (value: unknown): value is Middleware<any, any, any, any, any, any> =>
  typeof value === "object" && value !== null && MiddlewareTypeId in value

/**
 * Extract the "provides" type from a middleware.
 *
 * @since 0.1.0
 */
export type MiddlewareProvides<M> =
  M extends Middleware<any, any, any, any, infer P, any> ? P : never

/**
 * Extract the input extension type from a middleware.
 *
 * @since 0.4.0
 */
export type MiddlewareInputExt<M> =
  M extends Middleware<any, any, any, any, any, infer I> ? I : unknown

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Prototype (for Pipeable)
// ─────────────────────────────────────────────────────────────────────────────

const MiddlewareProto = {
  [MiddlewareTypeId]: MiddlewareTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

/**
 * Create a Middleware object with the prototype set up for pipeability.
 * @internal
 */
function makeMiddlewareInternal<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  E,
  R,
  Provides,
  InputExt,
>(options: {
  name: string
  fn: MiddlewareFn<CtxIn, CtxOut, InputExt, E, R>
  inputSchema?: Schema.Schema<InputExt, unknown>
  errorSchemas?: ReadonlyArray<TaggedErrorClass>
}): Middleware<CtxIn, CtxOut, E, R, Provides, InputExt> {
  const self = Object.create(MiddlewareProto) as Middleware<CtxIn, CtxOut, E, R, Provides, InputExt>
  return Object.assign(self, {
    _tag: "Middleware" as const,
    name: options.name,
    fn: options.fn,
    inputSchema: options.inputSchema,
    errorSchemas: options.errorSchemas,
  })
}

function createMiddlewareBuilder<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  E,
  InputExt,
  RTag extends Context.Tag<unknown, MiddlewareImplementation<CtxIn, CtxOut, InputExt, E>>,
  Provides,
>(
  name: string,
  implementationTag: RTag,
  inputSchema: Schema.Schema<InputExt, unknown> | undefined,
  errorSchemas: ReadonlyArray<TaggedErrorClass>,
): MiddlewareBuilder<CtxIn, CtxOut, E, RTag, Provides, InputExt> {
  const middleware = makeMiddlewareInternal<CtxIn, CtxOut, E, RTag, Provides, InputExt>({
    name,
    fn: (ctx, input, next) =>
      Effect.flatMap(
        implementationTag,
        (implementation: MiddlewareImplementation<CtxIn, CtxOut, InputExt, E>) =>
          Effect.flatMap(implementation(ctx, input), (nextContext: CtxOut) => next(nextContext)),
      ),
    inputSchema,
    errorSchemas,
  })

  return Object.assign(middleware, {
    input: <I, IFrom>(schema: Schema.Schema<I, IFrom>) =>
      createMiddlewareBuilder<CtxIn, CtxOut, E, InputExt & I, RTag, Provides>(
        name,
        implementationTag as unknown as Context.Tag<
          unknown,
          MiddlewareImplementation<CtxIn, CtxOut, InputExt & I, E>
        >,
        mergeInputSchemas(
          inputSchema as Schema.Schema<unknown, unknown> | undefined,
          schema as Schema.Schema<unknown, unknown>,
        ) as Schema.Schema<InputExt & I, unknown>,
        errorSchemas,
      ),

    error: <Errors extends readonly [TaggedErrorClass, ...ReadonlyArray<TaggedErrorClass>]>(
      ...errors: Errors
    ) =>
      createMiddlewareBuilder<
        CtxIn,
        CtxOut,
        E | InstanceType<Errors[number]>,
        InputExt,
        Context.Tag<unknown, MiddlewareImplementation<CtxIn, CtxOut, InputExt, E | InstanceType<Errors[number]>>>,
        Provides
      >(
        name,
        implementationTag as unknown as Context.Tag<
          unknown,
          MiddlewareImplementation<CtxIn, CtxOut, InputExt, E | InstanceType<Errors[number]>>
        >,
        inputSchema,
        [...errorSchemas, ...errors],
      ),

    provides: <P extends object>() =>
      createMiddlewareBuilder<
        CtxIn,
        CtxOut & P,
        E,
        InputExt,
        Context.Tag<unknown, MiddlewareImplementation<CtxIn, CtxOut & P, InputExt, E>>,
        Provides | P
      >(
        name,
        implementationTag as unknown as Context.Tag<
          unknown,
          MiddlewareImplementation<CtxIn, CtxOut & P, InputExt, E>
        >,
        inputSchema,
        errorSchemas,
      ),

    toLayer: <RImpl>(implementation: MiddlewareImplementation<CtxIn, CtxOut, InputExt, E, RImpl>) =>
      unsafeAssertLayerRequirements<RTag, RImpl>(
        Layer.effect(
          implementationTag,
          Effect.succeed(implementation as MiddlewareImplementation<CtxIn, CtxOut, InputExt, E>),
        ),
      ),
  })
}

/**
 * Create a named middleware definition.
 *
 * v2 usage:
 * `Middleware("Org").input(...).error(...).provides<...>().toLayer(...)`
 */
const MiddlewareBuilderEntry = <CtxIn extends BaseContext = BaseContext>(name: string) => {
  const implementationTag = Context.GenericTag<
    MiddlewareImplementation<CtxIn, CtxIn, unknown, never>
  >(nextMiddlewareImplementationTagId(name))

  return createMiddlewareBuilder<
    CtxIn,
    CtxIn,
    never,
    unknown,
    typeof implementationTag,
    never
  >(name, implementationTag, undefined, [])
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Creation
// ─────────────────────────────────────────────────────────────────────────────

export const Middleware = MiddlewareBuilderEntry

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logging middleware - logs request and response.
 *
 * Uses Effect.Clock for time measurement, making it testable and
 * compatible with Effect's runtime. The default Clock implementation is
 * provided automatically; use TestClock for testing.
 *
 * @remarks
 * **Type Assertion**: The `as Effect.Effect<unknown, never, never>` assertion
 * is required because the middleware's `next` function has type
 * `Effect<unknown, unknown, unknown>`. Each middleware declares its own error
 * type (here `never`), but TypeScript can't infer this from the generic chain.
 * The assertion is safe because this middleware only logs and doesn't add errors.
 *
 * @since 0.1.0
 */
export const loggingMiddleware: Middleware<BaseContext, BaseContext, never, never, never, unknown> =
  makeMiddlewareInternal({
    name: "logging",
    fn: (
      ctx: BaseContext,
      _input: unknown,
      next: (ctx: BaseContext) => Effect.Effect<unknown, unknown, unknown>,
    ) =>
      Effect.gen(function* () {
        const start = yield* Clock.currentTimeMillis
        yield* Effect.logDebug(`→ ${ctx.procedure}`)

        const result = yield* Effect.exit(next(ctx))

        const end = yield* Clock.currentTimeMillis
        const duration = end - start
        if (result._tag === "Success") {
          yield* Effect.logDebug(`← ${ctx.procedure} (${duration}ms)`)
        } else {
          yield* Effect.logError(`✗ ${ctx.procedure} (${duration}ms)`)
        }

        return yield* result
      }) as Effect.Effect<unknown, never, never>,
  })

/**
 * Timing middleware - adds timing information to the response.
 *
 * Uses Effect.Clock for time measurement, making it testable and
 * compatible with Effect's runtime.
 *
 * Note: Type assertion is required because the `next` function has type
 * `Effect<unknown, unknown, unknown>` but this middleware doesn't add errors.
 * The errors from `next` are handled by the outer middleware chain.
 *
 * @since 0.1.0
 */
export const timingMiddleware: Middleware<
  BaseContext,
  BaseContext & { startTime: number },
  never,
  never,
  never,
  unknown
> = makeMiddlewareInternal({
  name: "timing",
  fn: (
    ctx: BaseContext,
    _input: unknown,
    next: (ctx: BaseContext & { startTime: number }) => Effect.Effect<unknown, unknown, unknown>,
  ) =>
    Effect.gen(function* () {
      const startTime = yield* Clock.currentTimeMillis
      return yield* next({ ...ctx, startTime: Number(startTime) })
    }) as Effect.Effect<unknown, never, never>,
})

// ─────────────────────────────────────────────────────────────────────────────
// Timeout Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Timeout error for the timeout middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `TimeoutError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewareTimeoutError extends Schema.TaggedError<MiddlewareTimeoutError>()(
  "MiddlewareTimeoutError",
  {
    procedure: Schema.String,
    timeoutMs: Schema.Number,
  },
) {
  /** HTTP status code for timeout errors. */
  readonly httpStatus = 504
  /** Timeout errors are usually retryable. */
  readonly isRetryable = true

  override get message(): string {
    return `Request timed out for ${this.procedure} after ${this.timeoutMs}ms`
  }
}

/**
 * Create a timeout middleware.
 *
 * @param ms - Timeout in milliseconds
 *
 * @example
 * ```ts
 * const slowProcedure = Procedure
 *   .use(timeoutMiddleware(1000)) // 1 second timeout
 *   .query(() => Effect.sleep(2000)) // Will fail with MiddlewareTimeoutError
 * ```
 *
 * @since 0.1.0
 */
export function timeoutMiddleware(
  ms: number,
): Middleware<BaseContext, BaseContext, MiddlewareTimeoutError, never, never, unknown> {
  return makeMiddlewareInternal({
    name: "timeout",
    fn: (
      ctx: BaseContext,
      _input: unknown,
      next: (ctx: BaseContext) => Effect.Effect<unknown, unknown, unknown>,
    ) =>
      Effect.gen(function* () {
        const result = yield* next(ctx).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(ms),
            onTimeout: () =>
              new MiddlewareTimeoutError({
                procedure: ctx.procedure,
                timeoutMs: ms,
              }),
          }),
        )
        return result
      }) as Effect.Effect<unknown, MiddlewareTimeoutError, never>,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting with Ref
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tolerance for clock skew in milliseconds.
 * If the clock goes backward by more than this amount, we reset the rate limit window.
 * Small backward jumps (within tolerance) are handled by clamping to zero.
 */
const CLOCK_SKEW_TOLERANCE_MS = 1000

/**
 * Rate limit entry for tracking request counts.
 */
interface RateLimitEntry {
  readonly count: number
  readonly resetAt: number
}

/**
 * Rate limit state stored in a Ref using HashMap.
 */
type RateLimitState = HashMap.HashMap<string, RateLimitEntry>

/**
 * Result of rate limit check.
 */
interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs: number
}

/**
 * Options for rate limit middleware.
 *
 * @since 0.1.0
 */
export interface RateLimitOptions {
  /**
   * Maximum number of requests allowed within the window.
   */
  readonly maxRequests: number

  /**
   * Time window in milliseconds.
   */
  readonly windowMs: number

  /**
   * Function to generate a key for rate limiting.
   * Defaults to "global" (single rate limit for all requests).
   *
   * Common patterns:
   * - Per-client: `(ctx) => String(ctx.clientId)`
   * - Per-IP: `(ctx) => ctx.headers.get("x-forwarded-for") ?? "unknown"`
   * - Per-user: `(ctx) => ctx.user?.id ?? "anonymous"`
   */
  readonly keyFn?: (ctx: BaseContext) => string

  /**
   * Maximum number of unique keys to track before cleanup.
   * When exceeded, expired entries are cleaned up.
   * Defaults to 10000.
   *
   * @remarks
   * This prevents memory leaks from unbounded key growth.
   * Set this based on expected unique clients/IPs.
   */
  readonly maxKeys?: number
}

/**
 * Create a rate limiting middleware.
 *
 * Returns an Effect that creates the middleware with properly initialized state.
 * Uses Ref for thread-safe state management, HashMap for efficient key storage,
 * and Effect.Clock for time measurement, making it properly Effect-idiomatic.
 *
 * Expired entries are automatically cleaned up when maxKeys is exceeded.
 *
 * @param options - Rate limit configuration
 *
 * @example
 * ```ts
 * // Global rate limit - note the Effect wrapper
 * const globalRateLimitEffect = rateLimitMiddleware({
 *   maxRequests: 100,
 *   windowMs: 60000, // 1 minute
 * })
 *
 * // Use in your setup
 * const setup = Effect.gen(function* () {
 *   const rateLimit = yield* globalRateLimitEffect
 *   return Router.make({ middleware: [rateLimit] })
 * })
 *
 * // Per-client rate limit with cleanup
 * const perClientRateLimitEffect = rateLimitMiddleware({
 *   maxRequests: 10,
 *   windowMs: 1000,
 *   keyFn: (ctx) => String(ctx.clientId),
 *   maxKeys: 10000,
 * })
 * ```
 *
 * @since 0.1.0
 */
export const rateLimitMiddleware = (
  options: RateLimitOptions,
): Effect.Effect<
  Middleware<BaseContext, BaseContext, MiddlewareRateLimitError, never, never, unknown>
> =>
  Effect.gen(function* () {
    const { maxRequests, windowMs, keyFn = () => "global", maxKeys = 10000 } = options

    // Create the Ref within the Effect context - no runSync needed
    const stateRef = yield* Ref.make<RateLimitState>(HashMap.empty())

    /**
     * Clean up expired entries from the state.
     * Called when the number of keys exceeds maxKeys.
     */
    const cleanupExpiredEntries = (state: RateLimitState, nowMs: number): RateLimitState =>
      HashMap.filter(state, (entry) => entry.resetAt > nowMs)

    /**
     * Check and update rate limit state atomically.
     * Uses HashMap operations inside Ref.modify.
     * Cleans up expired entries when maxKeys is exceeded to prevent memory leaks.
     * Handles clock skew by resetting windows on significant backward jumps.
     */
    const checkRateLimit = (key: string): Effect.Effect<RateLimitResult, never, never> =>
      Effect.flatMap(Clock.currentTimeMillis, (nowBigInt) => {
        const nowMs = Number(nowBigInt)
        return Ref.modify(stateRef, (state): [RateLimitResult, RateLimitState] => {
          // Clean up expired entries if we have too many keys
          let workingState = state
          if (HashMap.size(state) > maxKeys) {
            workingState = cleanupExpiredEntries(state, nowMs)
          }

          const entry = HashMap.get(workingState, key)

          // No entry - create new entry
          if (entry._tag === "None") {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          // Calculate time until reset
          const timeUntilReset = entry.value.resetAt - nowMs

          // Handle clock skew - if current time is significantly before window start
          // (resetAt - windowMs), reset the window to avoid being stuck
          const windowStartMs = entry.value.resetAt - windowMs
          const timeSinceWindowStart = nowMs - windowStartMs
          if (timeSinceWindowStart < -CLOCK_SKEW_TOLERANCE_MS) {
            // Clock went backward significantly - reset window
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          // Window expired - create new entry
          if (timeUntilReset <= 0) {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          // Check if over limit
          const newCount = entry.value.count + 1
          if (newCount > maxRequests) {
            // Clamp retryAfterMs to 0 for small clock skews
            const retryAfterMs = Math.max(0, timeUntilReset)
            return [
              { allowed: false, retryAfterMs },
              workingState, // Don't update state on rejection
            ]
          }

          // Increment count
          const newState = HashMap.set(workingState, key, { ...entry.value, count: newCount })
          return [{ allowed: true, retryAfterMs: 0 }, newState]
        })
      })

    return makeMiddlewareInternal<
      BaseContext,
      BaseContext,
      MiddlewareRateLimitError,
      never,
      never,
      unknown
    >({
      name: "rateLimit",
      fn: (
        ctx: BaseContext,
        _input: unknown,
        next: (ctx: BaseContext) => Effect.Effect<unknown, unknown, unknown>,
      ) =>
        Effect.gen(function* () {
          const key = keyFn(ctx)
          const result = yield* checkRateLimit(key)

          if (!result.allowed) {
            return yield* Effect.fail(
              new MiddlewareRateLimitError({
                procedure: ctx.procedure,
                retryAfterMs: result.retryAfterMs,
              }),
            )
          }

          return yield* next(ctx)
        }) as Effect.Effect<unknown, MiddlewareRateLimitError, never>,
    })
  })

/**
 * Rate limit error for the rate limiting middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `RateLimitError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 * Use this error for rate limiting middleware; use the errors module's
 * `RateLimitError` for custom error handling in procedure implementations.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewareRateLimitError extends Schema.TaggedError<MiddlewareRateLimitError>()(
  "MiddlewareRateLimitError",
  {
    procedure: Schema.String,
    retryAfterMs: Schema.Number,
  },
) {
  /** HTTP status code for rate limiting. */
  readonly httpStatus = 429
  /** Rate limit errors are retryable after the specified delay. */
  readonly isRetryable = true

  override get message(): string {
    return `Rate limit exceeded for ${this.procedure}. Retry after ${this.retryAfterMs}ms`
  }
}

/**
 * Extract and validate a Bearer token from an Authorization header.
 *
 * Validates that:
 * - Header starts with "Bearer " (case-insensitive on "Bearer")
 * - Token part is not empty
 * - Token doesn't contain spaces (malformed token)
 *
 * @param header - The Authorization header value
 * @param procedure - The procedure name for error reporting
 * @returns The extracted token or an AuthError
 *
 * @internal
 */
const extractBearerToken = (
  header: string,
  procedure: string,
): Effect.Effect<string, MiddlewareAuthError> =>
  Effect.gen(function* () {
    // Trim whitespace
    const trimmed = header.trim()
    const lowerTrimmed = trimmed.toLowerCase()

    // Check if it starts with "bearer" (case-insensitive)
    if (!lowerTrimmed.startsWith("bearer")) {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "Authorization header must use Bearer scheme",
        }),
      )
    }

    // Check if there's a space after "bearer" and something follows
    // Valid format: "Bearer <token>" where token is non-empty and has no spaces
    if (trimmed.length <= 7 || trimmed[6] !== " ") {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "No token provided after Bearer scheme",
        }),
      )
    }

    // Extract token (slice past "Bearer ")
    const token = trimmed.slice(7).trim()

    if (!token) {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "No token provided after Bearer scheme",
        }),
      )
    }

    // Check for embedded spaces (malformed token)
    if (token.includes(" ")) {
      return yield* Effect.fail(
        new MiddlewareAuthError({
          procedure,
          reason: "Token contains invalid characters",
        }),
      )
    }

    return token
  })

/**
 * Create an authentication middleware.
 *
 * @param verifyToken - Function to verify the token and return a user
 *
 * @since 0.1.0
 */
export function authMiddleware<TUser>(
  verifyToken: (token: string) => Effect.Effect<TUser, MiddlewareAuthError>,
): Middleware<
  BaseContext,
  AuthenticatedContext<TUser>,
  MiddlewareAuthError,
  never,
  never,
  unknown
> {
  return makeMiddlewareInternal({
    name: "auth",
    fn: (
      ctx: BaseContext,
      _input: unknown,
      next: (ctx: AuthenticatedContext<TUser>) => Effect.Effect<unknown, unknown, unknown>,
    ) =>
      Effect.gen(function* () {
        const authHeader = ctx.headers.get("authorization")
        if (!authHeader) {
          return yield* Effect.fail(
            new MiddlewareAuthError({
              procedure: ctx.procedure,
              reason: "No authorization header",
            }),
          )
        }

        const token = yield* extractBearerToken(authHeader, ctx.procedure)
        const user = yield* verifyToken(token)

        return yield* next({ ...ctx, user })
      }) as Effect.Effect<unknown, MiddlewareAuthError, never>,
  })
}

/**
 * Authentication error for the auth middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `UnauthorizedError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewareAuthError extends Schema.TaggedError<MiddlewareAuthError>()(
  "MiddlewareAuthError",
  {
    procedure: Schema.String,
    reason: Schema.String,
  },
) {
  /** HTTP status code for authentication errors. */
  readonly httpStatus = 401
  /** Auth errors are not retryable without new credentials. */
  readonly isRetryable = false

  override get message(): string {
    return `Authentication failed for ${this.procedure}: ${this.reason}`
  }
}

/**
 * Create a permission check middleware.
 *
 * @param permission - Required permission
 * @param hasPermission - Function to check if user has permission
 *
 * @since 0.1.0
 */
export function requirePermission<TUser>(
  permission: string,
  hasPermission: (user: TUser, permission: string) => boolean,
): Middleware<
  AuthenticatedContext<TUser>,
  AuthenticatedContext<TUser>,
  MiddlewarePermissionError,
  never,
  never,
  unknown
> {
  return makeMiddlewareInternal({
    name: `requirePermission:${permission}`,
    fn: (
      ctx: AuthenticatedContext<TUser>,
      _input: unknown,
      next: (ctx: AuthenticatedContext<TUser>) => Effect.Effect<unknown, unknown, unknown>,
    ) =>
      Effect.gen(function* () {
        if (!hasPermission(ctx.user, permission)) {
          return yield* Effect.fail(
            new MiddlewarePermissionError({
              procedure: ctx.procedure,
              requiredPermission: permission,
            }),
          )
        }
        return yield* next(ctx)
      }) as Effect.Effect<unknown, MiddlewarePermissionError, never>,
  })
}

/**
 * Permission error for the requirePermission middleware.
 *
 * Uses Schema.TaggedError for wire serializability.
 *
 * @remarks
 * This is intentionally separate from `ForbiddenError` in errors/index.ts.
 * Middleware errors have a minimal API (just required fields) while the
 * errors module provides richer error types with optional context fields.
 *
 * @since 0.1.0
 * @category errors
 */
export class MiddlewarePermissionError extends Schema.TaggedError<MiddlewarePermissionError>()(
  "MiddlewarePermissionError",
  {
    procedure: Schema.String,
    requiredPermission: Schema.String,
  },
) {
  /** HTTP status code for permission errors. */
  readonly httpStatus = 403
  /** Permission errors are not retryable without different credentials. */
  readonly isRetryable = false
  override get message(): string {
    return `Permission denied for ${this.procedure}: requires ${this.requiredPermission}`
  }
}

