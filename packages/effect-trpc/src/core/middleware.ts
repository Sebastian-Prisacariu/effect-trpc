/**
 * @module effect-trpc/core/middleware
 *
 * Middleware system for effect-trpc.
 * Middleware can be applied at the procedure or router level.
 */

import * as Effect from "effect/Effect"
import * as Array from "effect/Array"
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import { dual } from "effect/Function"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import * as FiberRef from "effect/FiberRef"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"

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
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 *
 * @since 0.1.0
 */
export type MiddlewareFn<CtxIn, CtxOut, E, R> = (
  ctx: CtxIn,
  next: (ctx: CtxOut) => Effect.Effect<unknown, unknown, unknown>,
) => Effect.Effect<unknown, E, R>

/**
 * A middleware object with metadata.
 * 
 * @template CtxIn - The input context type
 * @template CtxOut - The output context type
 * @template E - Error type the middleware can produce
 * @template R - Requirements (Effect context) the middleware needs
 * @template Provides - Services this middleware provides to downstream handlers
 *
 * @since 0.1.0
 */
export interface Middleware<CtxIn = BaseContext, CtxOut = CtxIn, E = never, R = never, Provides = never> {
  readonly _tag: "Middleware"
  readonly name: string
  readonly fn: MiddlewareFn<CtxIn, CtxOut, E, R>
  /**
   * Services this middleware provides to downstream handlers.
   * These are excluded from the procedure's requirements.
   * @internal
   */
  readonly _provides?: Provides
}

/**
 * Extract the "provides" type from a middleware.
 *
 * @since 0.1.0
 */
export type MiddlewareProvides<M> = M extends Middleware<any, any, any, any, infer P>
  ? P
  : never

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Namespace for middleware creation utilities.
 *
 * @since 0.1.0
 */
export const Middleware = {
  /**
   * Create a named middleware.
   *
   * Supports both data-first and data-last (curried) usage:
   *
   * @example
   * ```ts
   * // Data-first: Middleware.make(name, fn)
   * const authMiddleware = Middleware.make('auth', (ctx, next) =>
   *   Effect.gen(function* () {
   *     const token = ctx.headers.get('authorization')
   *     if (!token) {
   *       return yield* Effect.fail(new UnauthorizedError({ procedure: ctx.procedure }))
   *     }
   *     const user = yield* verifyToken(token)
   *     return yield* next({ ...ctx, user })
   *   })
   * )
   *
   * // Data-last: pipe(fn, Middleware.make(name)) - for composition
   * const authMiddleware = pipe(
   *   (ctx, next) => Effect.gen(function* () {
   *     // ...
   *   }),
   *   Middleware.make('auth')
   * )
   * ```
   *
   * @since 0.1.0
   */
  make: dual<
    // Data-last: takes name, returns function that takes fn
    <CtxIn = BaseContext, CtxOut = CtxIn, E = never, R = never>(
      name: string
    ) => (fn: MiddlewareFn<CtxIn, CtxOut, E, R>) => Middleware<CtxIn, CtxOut, E, R, never>,
    // Data-first: takes name and fn
    <CtxIn = BaseContext, CtxOut = CtxIn, E = never, R = never>(
      name: string,
      fn: MiddlewareFn<CtxIn, CtxOut, E, R>
    ) => Middleware<CtxIn, CtxOut, E, R, never>
  >(2, (name, fn) => ({
    _tag: "Middleware" as const,
    name,
    fn,
  })),
}

/**
 * Create a middleware that provides services to downstream handlers.
 * 
 * When a middleware "provides" a service, handlers using that middleware
 * don't need to require that service themselves - the middleware takes
 * care of providing it.
 * 
 * @example
 * ```ts
 * // Create a middleware that provides Database to handlers
 * const dbMiddleware = middlewareWithProvides<
 *   BaseContext,
 *   BaseContext,
 *   never,
 *   ConnectionPool,  // Middleware needs ConnectionPool
 *   Database          // Middleware provides Database
 * >({
 *   name: 'database',
 *   fn: (ctx, next) =>
 *     Effect.gen(function* () {
 *       const pool = yield* ConnectionPool
 *       const db = new DatabaseImpl(pool)
 *       return yield* Effect.provideService(next(ctx), Database, db)
 *     })
 * })
 * 
 * // Handlers can now use Database without requiring it
 * procedure
 *   .use(dbMiddleware)
 *   .query()
 * 
 * const handlers = {
 *   myProc: (ctx, input) => 
 *     Effect.flatMap(Database, db => db.find(input.id))
 *     // Database requirement is satisfied by middleware!
 * }
 * ```
 *
 * @since 0.1.0
 */
export function middlewareWithProvides<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  E,
  R,
  Provides
>(options: {
  name: string
  fn: MiddlewareFn<CtxIn, CtxOut, E, R>
}): Middleware<CtxIn, CtxOut, E, R, Provides> {
  return {
    _tag: "Middleware",
    name: options.name,
    fn: options.fn,
    // _provides is a phantom type, not set at runtime
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Composition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compose multiple middleware into one.
 * Middleware are executed in order (first to last).
 *
 * @since 0.1.0
 */
export function composeMiddleware<Ctx1, Ctx2, E1, R1, Ctx3, E2, R2>(
  m1: Middleware<Ctx1, Ctx2, E1, R1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2>,
): Middleware<Ctx1, Ctx3, E1 | E2, R1 | R2>

export function composeMiddleware<Ctx1, Ctx2, E1, R1, Ctx3, E2, R2, Ctx4, E3, R3>(
  m1: Middleware<Ctx1, Ctx2, E1, R1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3>,
): Middleware<Ctx1, Ctx4, E1 | E2 | E3, R1 | R2 | R3>

export function composeMiddleware<
  Ctx1, Ctx2, E1, R1,
  Ctx3, E2, R2,
  Ctx4, E3, R3,
  Ctx5, E4, R4
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3>,
  m4: Middleware<Ctx4, Ctx5, E4, R4>,
): Middleware<Ctx1, Ctx5, E1 | E2 | E3 | E4, R1 | R2 | R3 | R4>

export function composeMiddleware<
  Ctx1, Ctx2, E1, R1,
  Ctx3, E2, R2,
  Ctx4, E3, R3,
  Ctx5, E4, R4,
  Ctx6, E5, R5
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3>,
  m4: Middleware<Ctx4, Ctx5, E4, R4>,
  m5: Middleware<Ctx5, Ctx6, E5, R5>,
): Middleware<Ctx1, Ctx6, E1 | E2 | E3 | E4 | E5, R1 | R2 | R3 | R4 | R5>

export function composeMiddleware<
  Ctx1, Ctx2, E1, R1,
  Ctx3, E2, R2,
  Ctx4, E3, R3,
  Ctx5, E4, R4,
  Ctx6, E5, R5,
  Ctx7, E6, R6
>(
  m1: Middleware<Ctx1, Ctx2, E1, R1>,
  m2: Middleware<Ctx2, Ctx3, E2, R2>,
  m3: Middleware<Ctx3, Ctx4, E3, R3>,
  m4: Middleware<Ctx4, Ctx5, E4, R4>,
  m5: Middleware<Ctx5, Ctx6, E5, R5>,
  m6: Middleware<Ctx6, Ctx7, E6, R6>,
): Middleware<Ctx1, Ctx7, E1 | E2 | E3 | E4 | E5 | E6, R1 | R2 | R3 | R4 | R5 | R6>

/**
 * Implementation uses `any` types for the variadic case.
 * Type safety is provided by the overload signatures above (2-6 middlewares).
 * For more than 6 middlewares, chain multiple composeMiddleware calls.
 */
export function composeMiddleware(
  ...middlewares: Middleware<any, any, any, any>[]
): Middleware<any, any, any, any> {
  if (middlewares.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return Middleware.make("identity", (_ctx, next) => next(_ctx))
  }

  if (middlewares.length === 1) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return middlewares[0]!
  }

  // Using native map/join for simple string concatenation (cleaner than Effect Array)
  const names = middlewares.map((m) => m.name).join(" -> ")

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return Middleware.make(names, (ctx, next) => {
    // Build the middleware chain from right to left using reduceRight
    const chain = Array.reduceRight(
      middlewares,
      next,
      (nextFn, current) => (c: any) => current.fn(c, nextFn),
    )
    return chain(ctx)
  })
}

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
export const loggingMiddleware: Middleware<BaseContext, BaseContext, never, never> = Middleware.make(
  "logging",
  (ctx, next) =>
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
)

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
export const timingMiddleware: Middleware<BaseContext, BaseContext & { startTime: number }, never, never> = Middleware.make(
  "timing",
  (ctx, next) =>
    Effect.gen(function* () {
      const startTime = yield* Clock.currentTimeMillis
      return yield* next({ ...ctx, startTime: Number(startTime) })
    }) as Effect.Effect<unknown, never, never>,
)

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
 * const slowProcedure = procedure
 *   .use(timeoutMiddleware(1000)) // 1 second timeout
 *   .query(() => Effect.sleep(2000)) // Will fail with MiddlewareTimeoutError
 * ```
 *
 * @since 0.1.0
 */
export function timeoutMiddleware(
  ms: number,
): Middleware<BaseContext, BaseContext, MiddlewareTimeoutError, never> {
  return {
    _tag: "Middleware",
    name: "timeout",
    fn: (ctx, next) =>
      Effect.gen(function* () {
        const result = yield* next(ctx).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(ms),
            onTimeout: () => new MiddlewareTimeoutError({
              procedure: ctx.procedure,
              timeoutMs: ms,
            }),
          }),
        )
        return result
      }) as Effect.Effect<unknown, MiddlewareTimeoutError, never>,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting with Ref
// ─────────────────────────────────────────────────────────────────────────────

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
 *   return createRouter({ middleware: [rateLimit] })
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
): Effect.Effect<Middleware<BaseContext, BaseContext, MiddlewareRateLimitError, never>> =>
  Effect.gen(function* () {
    const {
      maxRequests,
      windowMs,
      keyFn = () => "global",
      maxKeys = 10000,
    } = options

    // Create the Ref within the Effect context - no runSync needed
    const stateRef = yield* Ref.make<RateLimitState>(HashMap.empty())

    /**
     * Clean up expired entries from the state.
     * Called when the number of keys exceeds maxKeys.
     */
    const cleanupExpiredEntries = (
      state: RateLimitState,
      nowMs: number,
    ): RateLimitState =>
      HashMap.filter(state, (entry) => entry.resetAt > nowMs)

    /**
     * Check and update rate limit state atomically.
     * Uses HashMap operations inside Ref.modify.
     * Cleans up expired entries when maxKeys is exceeded to prevent memory leaks.
     */
    const checkRateLimit = (key: string, nowMs: number): Effect.Effect<RateLimitResult, never, never> =>
      Ref.modify(stateRef, (state): [RateLimitResult, RateLimitState] => {
        // Clean up expired entries if we have too many keys
        let workingState = state
        if (HashMap.size(state) > maxKeys) {
          workingState = cleanupExpiredEntries(state, nowMs)
        }

        const entry = HashMap.get(workingState, key)

        // No entry or window expired - create new entry
        if (entry._tag === "None" || nowMs > entry.value.resetAt) {
          const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
          const newState = HashMap.set(workingState, key, newEntry)
          return [{ allowed: true, retryAfterMs: 0 }, newState]
        }

        // Check if over limit
        const newCount = entry.value.count + 1
        if (newCount > maxRequests) {
          return [
            { allowed: false, retryAfterMs: entry.value.resetAt - nowMs },
            workingState, // Don't update state on rejection
          ]
        }

        // Increment count
        const newState = HashMap.set(workingState, key, { ...entry.value, count: newCount })
        return [{ allowed: true, retryAfterMs: 0 }, newState]
      })

    return Middleware.make<BaseContext, BaseContext, MiddlewareRateLimitError, never>(
      "rateLimit",
      (ctx, next) =>
        Effect.gen(function* () {
          const key = keyFn(ctx)
          const now = yield* Clock.currentTimeMillis
          const result = yield* checkRateLimit(key, Number(now))

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
    )
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
 * Create an authentication middleware.
 *
 * @param verifyToken - Function to verify the token and return a user
 *
 * @since 0.1.0
 */
export function authMiddleware<TUser>(
  verifyToken: (token: string) => Effect.Effect<TUser, MiddlewareAuthError>,
): Middleware<BaseContext, AuthenticatedContext<TUser>, MiddlewareAuthError, never> {
  return {
    _tag: "Middleware",
    name: "auth",
    fn: (ctx, next) =>
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

        const token = authHeader.replace(/^Bearer\s+/i, "")
        const user = yield* verifyToken(token)

        return yield* next({ ...ctx, user })
      }) as Effect.Effect<unknown, MiddlewareAuthError, never>,
  }
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
): Middleware<AuthenticatedContext<TUser>, AuthenticatedContext<TUser>, MiddlewarePermissionError, never> {
  return {
    _tag: "Middleware",
    name: `requirePermission:${permission}`,
    fn: (ctx, next) =>
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
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Context FiberRef
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FiberRef that holds the middleware context during request processing.
 * 
 * This allows handlers to access the enriched context from middleware
 * (e.g., authenticated user, organization, etc.) without changing the
 * handler function signature.
 * 
 * @remarks
 * The FiberRef is set by `applyMiddleware` in rpc-bridge.ts after the
 * middleware chain has built up the context. Handlers can access it
 * using `getMiddlewareContext()`.
 * 
 * @internal
 */
export const MiddlewareContextRef: FiberRef.FiberRef<unknown> = FiberRef.unsafeMake<unknown>(undefined)

/**
 * Get the middleware context in a handler.
 * 
 * Use this to access context enriched by middleware (e.g., authenticated user).
 * Returns `Option.none()` if called outside of a middleware chain or if no
 * middleware has set the context.
 * 
 * @example
 * ```ts
 * const getUserProcedure = procedure
 *   .use(authMiddleware)
 *   .query(({ input }) =>
 *     Effect.gen(function* () {
 *       const ctx = yield* getMiddlewareContext<AuthenticatedContext>()
 *       if (Option.isNone(ctx)) return yield* Effect.fail(new UnauthorizedError())
 *       return yield* db.getUser(ctx.value.user.id)
 *     })
 *   )
 * ```
 *
 * @since 0.1.0
 */
export const getMiddlewareContext = <T = BaseContext>(): Effect.Effect<Option.Option<T>> =>
  FiberRef.get(MiddlewareContextRef).pipe(
    Effect.map((ctx) => Option.fromNullable(ctx as T | null | undefined))
  )

/**
 * Get the middleware context, failing if not available.
 * 
 * Use this when you know middleware has run and the context must exist.
 * Fails with the provided error if context is not available.
 * 
 * @example
 * ```ts
 * const getUserProcedure = procedure
 *   .use(authMiddleware) // Ensures user is always set
 *   .query(({ input }) =>
 *     Effect.gen(function* () {
 *       const ctx = yield* requireMiddlewareContext<AuthenticatedContext>(
 *         new UnauthorizedError({ procedure: "getUser", reason: "No auth context" })
 *       )
 *       return yield* db.getUser(ctx.user.id)
 *     })
 *   )
 * ```
 *
 * @since 0.1.0
 */
export const requireMiddlewareContext = <T, E>(
  onMissing: E,
): Effect.Effect<T, E> =>
  getMiddlewareContext<T>().pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(onMissing),
        onSome: (ctx) => Effect.succeed(ctx),
      })
    )
  )


