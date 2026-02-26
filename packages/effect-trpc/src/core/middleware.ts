/**
 * @module effect-trpc/core/middleware
 *
 * Middleware system for effect-trpc with builder pattern.
 *
 * @example
 * ```ts
 * // Define middleware with builder pattern
 * const OrgMiddleware = Middleware("org")
 *   .input(Schema.Struct({ organizationSlug: Schema.String }))
 *   .error(NotAuthorized, NotOrgMember)
 *   .provides<{ orgMembership: OrgMembership }>()
 *
 * // Implement via toLayer - no `next`, return full context
 * const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
 *   Effect.gen(function* () {
 *     const membership = yield* OrgService.load(input.organizationSlug)
 *     if (!membership) {
 *       yield* new NotOrgMember({ organizationSlug: input.organizationSlug })
 *     }
 *     return { ...ctx, orgMembership: membership }
 *   })
 * )
 *
 * // Middleware that requires authenticated context
 * const AdminMiddleware = Middleware<AuthenticatedContext<User>>("admin")
 *   .error(NotAdmin)
 *   .provides<{ isAdmin: true }>()
 * ```
 */

import * as Effect from "effect/Effect"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as HashMap from "effect/HashMap"
import * as Ref from "effect/Ref"
import * as FiberRef from "effect/FiberRef"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import * as Layer from "effect/Layer"
import type { Pipeable } from "effect/Pipeable"
import { pipeArguments } from "effect/Pipeable"

// ─────────────────────────────────────────────────────────────────────────────
// Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base context available to all middleware and handlers.
 *
 * @since 0.1.0
 */
export interface BaseContext {
  /** The full procedure path (e.g., "user.create"). */
  readonly procedure: string
  /** Request headers (standard web Headers). */
  readonly headers: Headers
  /** Abort signal for request cancellation. */
  readonly signal: AbortSignal
  /** Unique client identifier for this connection. */
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
// Middleware Definition (Type-Only Contract)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Symbol to identify MiddlewareDefinition at runtime.
 * @internal
 */
export const MiddlewareDefinitionTypeId: unique symbol = Symbol.for(
  "@effect-trpc/MiddlewareDefinition",
)

/** @internal */
export type MiddlewareDefinitionTypeId = typeof MiddlewareDefinitionTypeId

/**
 * A middleware definition (contract only, no implementation).
 *
 * Created via the `Middleware("name")` builder. Contains:
 * - Input schema requirements
 * - Error types it can produce
 * - Context type it provides
 *
 * Call `.toLayer()` to provide the implementation.
 *
 * @template CtxIn - Input context type (what middleware receives)
 * @template CtxOut - Output context type (what middleware provides)
 * @template I - Input type requirements from `.input()`
 * @template E - Error types from `.error()`
 *
 * @since 0.5.0
 */
export interface MiddlewareDefinition<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
> extends Pipeable {
  readonly [MiddlewareDefinitionTypeId]: MiddlewareDefinitionTypeId
  readonly _tag: "MiddlewareDefinition"
  readonly name: string

  /** Input schema (if any). @internal */
  readonly inputSchema?: Schema.Schema<I, unknown>

  /** Error schemas (if any). @internal */
  readonly errorSchemas?: ReadonlyArray<Schema.Schema<any, any>>

  /**
   * Service tag for retrieving the middleware implementation at runtime.
   * Used by rpc-bridge to get the middleware handler from Effect context.
   * @internal
   */
  readonly serviceTag: Context.Tag<MiddlewareService<CtxIn, CtxOut, I, E>, MiddlewareService<CtxIn, CtxOut, I, E>>

  /**
   * Create a Layer that implements this middleware.
   *
   * Handler receives `(ctx, input)` and returns `Effect<CtxOut, E, R>`.
   * Return the FULL context (spread existing + add new fields).
   *
   * @example
   * ```ts
   * const OrgMiddlewareLive = OrgMiddleware.toLayer((ctx, input) =>
   *   Effect.gen(function* () {
   *     const membership = yield* OrgService.load(input.organizationSlug)
   *     return { ...ctx, orgMembership: membership }
   *   })
   * )
   * ```
   */
  toLayer<R>(
    handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, R>,
  ): Layer.Layer<MiddlewareService<CtxIn, CtxOut, I, E>, never, R>
}

/**
 * Service type for a middleware implementation.
 * Contains the handler function that transforms context.
 */
export interface MiddlewareService<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
> {
  readonly handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, any>
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builder interface for constructing middleware definitions.
 *
 * @template CtxIn - Input context type
 * @template CtxOut - Output context type (same as CtxIn until .provides() is called)
 * @template I - Accumulated input type
 * @template E - Accumulated error type
 *
 * @since 0.5.0
 */
export interface MiddlewareBuilder<
  CtxIn extends BaseContext,
  CtxOut extends BaseContext,
  I,
  E,
> {
  /**
   * Add input requirements to this middleware.
   * When applied to a procedure, these fields are added to the procedure's input.
   */
  input<I2, IFrom = I2>(
    schema: Schema.Schema<I2, IFrom>,
  ): MiddlewareBuilder<CtxIn, CtxOut, I & I2, E>

  /**
   * Declare error types this middleware can produce.
   * Accepts varargs - each error class must extend Schema.TaggedError.
   */
  error<Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
    ...errors: Errors
  ): MiddlewareBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>>

  /**
   * Declare what context this middleware provides.
   * The implementation must return `{ ...ctx, ...additions }`.
   */
  provides<Additions extends object>(): MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E>
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder State & Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  readonly name: string
  readonly inputSchema?: Schema.Schema<any, any>
  readonly errorSchemas: ReadonlyArray<Schema.Schema<any, any>>
}

const BuilderProto = {
  pipe() {
    return pipeArguments(this, arguments)
  },
}

const DefinitionProto = {
  [MiddlewareDefinitionTypeId]: MiddlewareDefinitionTypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
}

function createBuilder<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E>(
  state: BuilderState,
): MiddlewareBuilder<CtxIn, CtxOut, I, E> {
  const self = Object.create(BuilderProto) as MiddlewareBuilder<CtxIn, CtxOut, I, E>

  return Object.assign(self, {
    input: <I2, IFrom = I2>(
      schema: Schema.Schema<I2, IFrom>,
    ): MiddlewareBuilder<CtxIn, CtxOut, I & I2, E> => {
      const mergedSchema = state.inputSchema
        ? Schema.extend(
            state.inputSchema as Schema.Schema<I & object, unknown>,
            schema as Schema.Schema<I2 & object, IFrom>,
          )
        : schema

      return createBuilder<CtxIn, CtxOut, I & I2, E>({
        ...state,
        inputSchema: mergedSchema as Schema.Schema<I & I2, unknown>,
      })
    },

    error: <Errors extends ReadonlyArray<Schema.Schema<any, any>>>(
      ...errors: Errors
    ): MiddlewareBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>> => {
      return createBuilder<CtxIn, CtxOut, I, E | Schema.Schema.Type<Errors[number]>>({
        ...state,
        errorSchemas: [...state.errorSchemas, ...errors],
      })
    },

    provides: <Additions extends object>(): MiddlewareDefinition<CtxIn, CtxIn & Additions, I, E> => {
      return createDefinition<CtxIn, CtxIn & Additions, I, E>(state)
    },
  })
}

function createDefinition<CtxIn extends BaseContext, CtxOut extends BaseContext, I, E>(
  state: BuilderState,
): MiddlewareDefinition<CtxIn, CtxOut, I, E> {
  const self = Object.create(DefinitionProto) as MiddlewareDefinition<CtxIn, CtxOut, I, E>

  // Create a unique tag for this middleware service
  const ServiceTag = Context.GenericTag<MiddlewareService<CtxIn, CtxOut, I, E>>(
    `@effect-trpc/Middleware/${state.name}`,
  )

  return Object.assign(self, {
    _tag: "MiddlewareDefinition" as const,
    name: state.name,
    inputSchema: state.inputSchema,
    errorSchemas: state.errorSchemas.length > 0 ? state.errorSchemas : undefined,
    serviceTag: ServiceTag,

    toLayer: <R>(
      handler: (ctx: CtxIn, input: I) => Effect.Effect<CtxOut, E, R>,
    ): Layer.Layer<MiddlewareService<CtxIn, CtxOut, I, E>, never, R> => {
      return Layer.succeed(ServiceTag, { handler })
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a middleware definition using the builder pattern.
 *
 * @param name - Unique name for this middleware (used for service tag)
 * @template CtxIn - The input context type this middleware expects (default: BaseContext)
 *
 * @example
 * ```ts
 * // Basic middleware (starts with BaseContext)
 * const OrgMiddleware = Middleware("org")
 *   .input(Schema.Struct({ organizationSlug: Schema.String }))
 *   .error(NotAuthorized, NotOrgMember)
 *   .provides<{ orgMembership: OrgMembership }>()
 *
 * // Middleware that requires authenticated context
 * const AdminMiddleware = Middleware<AuthenticatedContext<User>>("admin")
 *   .error(NotAdmin)
 *   .provides<{ isAdmin: true }>()
 * ```
 *
 * @since 0.5.0
 */
export function Middleware<CtxIn extends BaseContext = BaseContext>(
  name: string,
): MiddlewareBuilder<CtxIn, CtxIn, unknown, never> {
  return createBuilder<CtxIn, CtxIn, unknown, never>({
    name,
    errorSchemas: [],
  })
}

/**
 * Check if a value is a MiddlewareDefinition.
 *
 * @since 0.5.0
 */
export const isMiddlewareDefinition = (
  value: unknown,
): value is MiddlewareDefinition<any, any, any, any> =>
  typeof value === "object" && value !== null && MiddlewareDefinitionTypeId in value

// ─────────────────────────────────────────────────────────────────────────────
// Type Extraction Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the input type from a middleware definition.
 *
 * @since 0.5.0
 */
export type MiddlewareInput<M> =
  M extends MiddlewareDefinition<any, any, infer I, any> ? I : unknown

/**
 * Extract the error type from a middleware definition.
 *
 * @since 0.5.0
 */
export type MiddlewareError<M> =
  M extends MiddlewareDefinition<any, any, any, infer E> ? E : never

/**
 * Extract the output context type from a middleware definition.
 *
 * @since 0.5.0
 */
export type MiddlewareContextOut<M> =
  M extends MiddlewareDefinition<any, infer CtxOut, any, any> ? CtxOut : BaseContext

/**
 * Extract the input context type from a middleware definition.
 *
 * @since 0.5.0
 */
export type MiddlewareContextIn<M> =
  M extends MiddlewareDefinition<infer CtxIn, any, any, any> ? CtxIn : BaseContext

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Context FiberRef
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FiberRef that holds the middleware context during request processing.
 * @internal
 */
export const MiddlewareContextRef: FiberRef.FiberRef<unknown> =
  FiberRef.unsafeMake<unknown>(undefined)

/**
 * Get the middleware context in a handler.
 *
 * @since 0.1.0
 */
export const getMiddlewareContext = <T = BaseContext>(): Effect.Effect<Option.Option<T>> =>
  FiberRef.get(MiddlewareContextRef).pipe(
    Effect.map((ctx) => Option.fromNullable(ctx as T | null | undefined)),
  )

/**
 * Get the middleware context, failing if not available.
 *
 * @since 0.1.0
 */
export const requireMiddlewareContext = <T, E>(onMissing: E): Effect.Effect<T, E> =>
  getMiddlewareContext<T>().pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(onMissing),
        onSome: (ctx) => Effect.succeed(ctx),
      }),
    ),
  )

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Middleware Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Timeout error for the timeout middleware.
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
  readonly httpStatus = 504
  readonly isRetryable = true

  override get message(): string {
    return `Request timed out for ${this.procedure} after ${this.timeoutMs}ms`
  }
}

/**
 * Rate limit error for the rate limiting middleware.
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
  readonly httpStatus = 429
  readonly isRetryable = true

  override get message(): string {
    return `Rate limit exceeded for ${this.procedure}. Retry after ${this.retryAfterMs}ms`
  }
}

/**
 * Authentication error for the auth middleware.
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
  readonly httpStatus = 401
  readonly isRetryable = false

  override get message(): string {
    return `Authentication failed for ${this.procedure}: ${this.reason}`
  }
}

/**
 * Permission error for the requirePermission middleware.
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
  readonly httpStatus = 403
  readonly isRetryable = false

  override get message(): string {
    return `Permission denied for ${this.procedure}: requires ${this.requiredPermission}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Middleware Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logging middleware definition.
 *
 * @since 0.5.0
 */
export const LoggingMiddleware = Middleware("logging").provides<{}>()

/**
 * Timing middleware definition - adds startTime to context.
 *
 * @since 0.5.0
 */
export const TimingMiddleware = Middleware("timing").provides<{ startTime: number }>()

/**
 * Create logging middleware layer.
 *
 * @since 0.5.0
 */
export const LoggingMiddlewareLive = LoggingMiddleware.toLayer((ctx, _input) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis
    yield* Effect.logDebug(`→ ${ctx.procedure}`)
    return ctx
  }).pipe(Effect.annotateLogs("middleware", "logging")),
)

/**
 * Create timing middleware layer.
 *
 * @since 0.5.0
 */
export const TimingMiddlewareLive = TimingMiddleware.toLayer((ctx, _input) =>
  Effect.gen(function* () {
    const startTime = yield* Clock.currentTimeMillis
    return { ...ctx, startTime: Number(startTime) }
  }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Auth Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an auth middleware definition.
 *
 * @since 0.5.0
 */
export function AuthMiddleware<TUser>() {
  return Middleware("auth")
    .error(Schema.instanceOf(MiddlewareAuthError))
    .provides<{ user: TUser }>()
}

/**
 * Extract Bearer token from Authorization header.
 * @internal
 */
const extractBearerToken = (
  header: string,
  procedure: string,
): Effect.Effect<string, MiddlewareAuthError> => {
  const trimmed = header.trim()
  const lowerTrimmed = trimmed.toLowerCase()

  if (!lowerTrimmed.startsWith("bearer")) {
    return Effect.fail(
      new MiddlewareAuthError({
        procedure,
        reason: "Authorization header must use Bearer scheme",
      }),
    )
  }

  if (trimmed.length <= 7 || trimmed[6] !== " ") {
    return Effect.fail(
      new MiddlewareAuthError({
        procedure,
        reason: "No token provided after Bearer scheme",
      }),
    )
  }

  const token = trimmed.slice(7).trim()

  if (!token) {
    return Effect.fail(
      new MiddlewareAuthError({
        procedure,
        reason: "No token provided after Bearer scheme",
      }),
    )
  }

  if (token.includes(" ")) {
    return Effect.fail(
      new MiddlewareAuthError({
        procedure,
        reason: "Token contains invalid characters",
      }),
    )
  }

  return Effect.succeed(token)
}

/**
 * Create auth middleware layer with a token verification function.
 *
 * @since 0.5.0
 */
export function createAuthMiddlewareLive<TUser, R = never>(
  verifyToken: (token: string) => Effect.Effect<TUser, MiddlewareAuthError, R>,
) {
  const mwDef = AuthMiddleware<TUser>()

  return mwDef.toLayer((ctx, _input) =>
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

      return { ...ctx, user }
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Permission Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a permission check middleware definition.
 *
 * This middleware requires an authenticated context (from AuthMiddleware).
 *
 * @since 0.5.0
 */
export function RequirePermissionMiddleware<TUser>(permission: string) {
  return Middleware<AuthenticatedContext<TUser>>(`requirePermission:${permission}`)
    .error(Schema.instanceOf(MiddlewarePermissionError))
    .provides<{}>()
}

/**
 * Create permission middleware layer.
 *
 * @since 0.5.0
 */
export function createRequirePermissionMiddlewareLive<TUser>(
  permission: string,
  hasPermission: (user: TUser, permission: string) => boolean,
) {
  const mwDef = RequirePermissionMiddleware<TUser>(permission)

  return mwDef.toLayer((ctx, _input) =>
    Effect.gen(function* () {
      if (!hasPermission(ctx.user, permission)) {
        return yield* Effect.fail(
          new MiddlewarePermissionError({
            procedure: ctx.procedure,
            requiredPermission: permission,
          }),
        )
      }
      return ctx
    }),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  readonly count: number
  readonly resetAt: number
}

type RateLimitState = HashMap.HashMap<string, RateLimitEntry>

interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs: number
}

const CLOCK_SKEW_TOLERANCE_MS = 1000

/**
 * Options for rate limit middleware.
 *
 * @since 0.1.0
 */
export interface RateLimitOptions {
  /** Maximum number of requests allowed within the window. */
  readonly maxRequests: number
  /** Time window in milliseconds. */
  readonly windowMs: number
  /** Function to generate a key for rate limiting. Defaults to "global". */
  readonly keyFn?: (ctx: BaseContext) => string
  /** Maximum number of unique keys to track before cleanup. Defaults to 10000. */
  readonly maxKeys?: number
}

/**
 * Create a rate limit middleware definition.
 *
 * @since 0.5.0
 */
export function RateLimitMiddleware(options: RateLimitOptions) {
  return Middleware(`rateLimit-${options.maxRequests}/${options.windowMs}`)
    .error(Schema.instanceOf(MiddlewareRateLimitError))
    .provides<{}>()
}

/**
 * Create a rate limit middleware layer with the given options.
 *
 * Returns an Effect that initializes the rate limit state and produces the Layer.
 *
 * @since 0.5.0
 */
export const createRateLimitMiddlewareLive = (options: RateLimitOptions) =>
  Effect.gen(function* () {
    const { maxRequests, windowMs, keyFn = () => "global", maxKeys = 10000 } = options

    const stateRef = yield* Ref.make<RateLimitState>(HashMap.empty())

    const cleanupExpiredEntries = (state: RateLimitState, nowMs: number): RateLimitState =>
      HashMap.filter(state, (entry) => entry.resetAt > nowMs)

    const checkRateLimit = (key: string): Effect.Effect<RateLimitResult> =>
      Effect.flatMap(Clock.currentTimeMillis, (nowBigInt) => {
        const nowMs = Number(nowBigInt)
        return Ref.modify(stateRef, (state): [RateLimitResult, RateLimitState] => {
          let workingState = state
          if (HashMap.size(state) > maxKeys) {
            workingState = cleanupExpiredEntries(state, nowMs)
          }

          const entry = HashMap.get(workingState, key)

          if (entry._tag === "None") {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          const timeUntilReset = entry.value.resetAt - nowMs
          const windowStartMs = entry.value.resetAt - windowMs
          const timeSinceWindowStart = nowMs - windowStartMs

          if (timeSinceWindowStart < -CLOCK_SKEW_TOLERANCE_MS) {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          if (timeUntilReset <= 0) {
            const newEntry: RateLimitEntry = { count: 1, resetAt: nowMs + windowMs }
            const newState = HashMap.set(workingState, key, newEntry)
            return [{ allowed: true, retryAfterMs: 0 }, newState]
          }

          const newCount = entry.value.count + 1
          if (newCount > maxRequests) {
            const retryAfterMs = Math.max(0, timeUntilReset)
            return [{ allowed: false, retryAfterMs }, workingState]
          }

          const newState = HashMap.set(workingState, key, { ...entry.value, count: newCount })
          return [{ allowed: true, retryAfterMs: 0 }, newState]
        })
      })

    const mwDef = RateLimitMiddleware(options)

    return mwDef.toLayer((ctx, _input) =>
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

        return ctx
      }),
    )
  })
