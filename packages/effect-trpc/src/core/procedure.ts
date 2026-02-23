/**
 * @module effect-trpc/core/procedure
 *
 * Procedure builder API for defining type-safe RPC endpoints.
 * Uses a fluent builder pattern: procedure.input(...).output(...).query()
 */

import type * as Schema from "effect/Schema"
import type { Middleware, BaseContext } from "./middleware.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The type of a procedure, determining its transport and behavior.
 *
 * - `query` - HTTP GET, cached, for reading data
 * - `mutation` - HTTP POST, not cached, for writing data
 * - `stream` - HTTP streaming via NDJSON, for server-sent events
 * - `chat` - HTTP streaming via NDJSON, @effect/ai compatible
 * - `subscription` - WebSocket-based real-time bidirectional communication
 *
 * @since 0.1.0
 * @category models
 */
export type ProcedureType = "query" | "mutation" | "stream" | "chat" | "subscription"

/**
 * A procedure definition containing all configuration for an RPC endpoint.
 *
 * @remarks
 * **Context Type Tracking (v2):**
 * 
 * The `Ctx` type parameter tracks the context type produced by the
 * middleware chain. This enables compile-time type safety for handlers:
 * 
 * ```ts
 * // Context type flows through middleware
 * procedure
 *   .use(authMiddleware)   // Ctx becomes AuthenticatedContext<User>
 *   .use(orgMiddleware)    // Ctx becomes AuthenticatedContext<User> & OrgContext
 *   .query()
 * 
 * // Handler receives typed context
 * const handlers = {
 *   myProc: (ctx, input) => {
 *     ctx.user     // ✅ Typed as User
 *     ctx.org      // ✅ Typed as Organization
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * // Type-safe composition
 * const authAndRateLimit = composeMiddleware(authMiddleware, rateLimitMiddleware)
 *
 * // Use composed middleware
 * const UserProcedures = procedures('user', {
 *   update: procedure.use(authAndRateLimit).input(UpdateSchema).mutation(),
 * })
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface ProcedureDefinition<
  I = unknown,
  A = unknown,
  E = unknown,
  Ctx extends BaseContext = BaseContext,
  Type extends ProcedureType = ProcedureType,
  R = never,
  Provides = never,
> {
  readonly _tag: "ProcedureDefinition"
  readonly type: Type
  readonly description?: string
  readonly deprecated?: boolean
  /**
   * Short summary of the procedure for OpenAPI generation.
   * Unlike description, this should be a brief one-liner.
   * @since 0.1.0
   */
  readonly summary?: string
  /**
   * URL to external documentation for this procedure.
   * Used in OpenAPI externalDocs field.
   * @since 0.1.0
   */
  readonly externalDocs?: string
  /**
   * Description of the successful response for OpenAPI generation.
   * @since 0.1.0
   */
  readonly responseDescription?: string
  readonly inputSchema: Schema.Schema<I, unknown> | undefined
  readonly outputSchema: Schema.Schema<A, unknown> | undefined
  readonly errorSchema: Schema.Schema<E, unknown> | undefined
  readonly tags: ReadonlyArray<string>
  readonly invalidates: ReadonlyArray<string>
  readonly invalidatesTags: ReadonlyArray<string>
  /** Middleware chain - context type is tracked via Ctx */
  readonly middlewares: ReadonlyArray<Middleware<any, any, any, any, any>>
  /**
   * Phantom type to carry context type information.
   * Never actually set at runtime - only exists for type inference.
   * @internal
   */
  readonly _contextType?: Ctx
  /**
   * Phantom type to carry accumulated middleware requirements.
   * Never actually set at runtime - only exists for type inference.
   * @internal
   */
  readonly _middlewareR?: R
  /**
   * Phantom type to carry services provided by middleware.
   * Never actually set at runtime - only exists for type inference.
   * @internal
   */
  readonly _provides?: Provides
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Type Inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the context type from a procedure definition.
 * 
 * @example
 * ```ts
 * const myProc = procedure.use(authMiddleware).query()
 * type MyContext = InferProcedureContext<typeof myProc>
 * // AuthenticatedContext<User>
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferProcedureContext<T> = T extends ProcedureDefinition<
  any,
  any,
  any,
  infer Ctx,
  any,
  any,
  any
>
  ? Ctx
  : BaseContext

/**
 * Extract the input type from a procedure definition.
 *
 * @example
 * ```ts
 * const myProc = procedure.input(Schema.Struct({ id: Schema.String })).query()
 * type MyInput = InferProcedureInput<typeof myProc>
 * // { id: string }
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferProcedureInput<T> = T extends ProcedureDefinition<
  infer I,
  any,
  any,
  any,
  any,
  any,
  any
>
  ? I
  : unknown

/**
 * Extract the output type from a procedure definition.
 *
 * @example
 * ```ts
 * const myProc = procedure.output(UserSchema).query()
 * type MyOutput = InferProcedureOutput<typeof myProc>
 * // User
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferProcedureOutput<T> = T extends ProcedureDefinition<
  any,
  infer A,
  any,
  any,
  any,
  any,
  any
>
  ? A
  : unknown

/**
 * Extract the error type from a procedure definition.
 *
 * @example
 * ```ts
 * const myProc = procedure.error(NotFoundError).query()
 * type MyError = InferProcedureError<typeof myProc>
 * // NotFoundError
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferProcedureError<T> = T extends ProcedureDefinition<
  any,
  any,
  infer E,
  any,
  any,
  any,
  any
>
  ? E
  : unknown

/**
 * Extract the middleware requirements (R channel) from a procedure definition.
 * 
 * @example
 * ```ts
 * const myProc = procedure
 *   .use(authMiddleware)  // Requires TokenService
 *   .use(loggingMiddleware)  // Requires Logger
 *   .query()
 * type MyR = InferProcedureMiddlewareR<typeof myProc>
 * // TokenService | Logger
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferProcedureMiddlewareR<T> = T extends ProcedureDefinition<
  any,
  any,
  any,
  any,
  any,
  infer R,
  any
>
  ? R
  : never

/**
 * Extract the services provided by middleware from a procedure definition.
 * 
 * @example
 * ```ts
 * const myProc = procedure
 *   .use(dbMiddleware)  // Provides Database
 *   .query()
 * type Provided = InferProcedureProvides<typeof myProc>
 * // Database
 * ```
 *
 * @since 0.1.0
 * @category utils
 */
export type InferProcedureProvides<T> = T extends ProcedureDefinition<
  any,
  any,
  any,
  any,
  any,
  any,
  infer Provides
>
  ? Provides
  : never

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fluent builder interface for constructing procedure definitions.
 *
 * The builder tracks types through the chain:
 * - `I` - Input type from `.input()` schema
 * - `A` - Output/success type from `.output()` schema
 * - `E` - Error type from `.error()` schema and middleware
 * - `Ctx` - Context type from middleware chain
 * - `R` - Service requirements from middleware
 * - `Provides` - Services provided by middleware
 *
 * @example
 * ```ts
 * const myProc = procedure
 *   .description("Get user by ID")
 *   .use(authMiddleware)
 *   .input(Schema.Struct({ id: Schema.String }))
 *   .output(UserSchema)
 *   .query()
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export interface ProcedureBuilder<
  I = unknown,
  A = unknown,
  E = unknown,
  Ctx extends BaseContext = BaseContext,
  R = never,
  Provides = never,
> {
  /**
   * Add a description to this procedure.
   * Useful for documentation and OpenAPI generation.
   */
  description(text: string): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Add a short summary to this procedure.
   * Unlike description, this should be a brief one-liner for OpenAPI.
   * 
   * @example
   * ```ts
   * procedure
   *   .summary("Get user by ID")
   *   .description("Retrieves a user by their unique identifier. Returns 404 if not found.")
   *   .query()
   * ```
   */
  summary(text: string): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Add a link to external documentation for this procedure.
   * Used in OpenAPI externalDocs field.
   * 
   * @example
   * ```ts
   * procedure
   *   .externalDocs("https://docs.example.com/api/users")
   *   .query()
   * ```
   */
  externalDocs(url: string): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Add a description for the successful response.
   * Used in OpenAPI response description field.
   * 
   * @example
   * ```ts
   * procedure
   *   .output(UserSchema)
   *   .responseDescription("The user object with all profile fields")
   *   .query()
   * ```
   */
  responseDescription(text: string): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Mark this procedure as deprecated.
   * Useful for documentation and OpenAPI generation.
   */
  deprecated(): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Apply middleware to this procedure.
   * Middleware can transform context, add authentication, rate limiting, etc.
   * 
   * **Type Tracking:**
   * - Context type is updated based on the middleware's output context type
   * - Error types are accumulated from middleware that can fail
   * - Requirements (R channel) are accumulated from middleware that needs services
   * - Provided services are accumulated from middleware that provides services
   *
   * @example
   * ```ts
   * const UserProcedures = procedures('user', {
   *   update: procedure
   *     .use(authMiddleware)     // Context: AuthenticatedContext, Error: AuthError, R: TokenService
   *     .use(dbMiddleware)       // Provides: Database
   *     .input(UpdateUserSchema)
   *     .mutation(),
   * })
   * 
   * // Handler receives typed context
   * const handlers = {
   *   update: (ctx, input) => {
   *     ctx.user.id           // ✅ Typed
   *     // Can use Database without requiring it (provided by middleware)
   *   }
   * }
   * // Layer requires: TokenService (Database is provided by middleware)
   * ```
   */
  use<CtxOut extends BaseContext, E2, R2, P = never>(
    middleware: Middleware<Ctx, CtxOut, E2, R2, P>,
  ): ProcedureBuilder<I, A, E | E2, CtxOut, R | R2, Provides | P>

  /**
   * Define the input schema for this procedure.
   * Input is validated before the handler is called.
   */
  input<I2, IFrom = I2>(
    schema: Schema.Schema<I2, IFrom>,
  ): ProcedureBuilder<I2, A, E, Ctx, R, Provides>

  /**
   * Define the output schema for this procedure.
   * For stream/chat procedures, this is the schema for each streamed part.
   */
  output<A2, AFrom = A2>(
    schema: Schema.Schema<A2, AFrom>,
  ): ProcedureBuilder<I, A2, E, Ctx, R, Provides>

  /**
   * Define the typed error schema for this procedure.
   * 
   * @remarks
   * **Middleware Error Types:**
   * 
   * When using middleware that can fail (e.g., `authMiddleware`, `rateLimitMiddleware`),
   * their error types are accumulated at the type level via `.use()`. However, for
   * proper wire serialization, you should include middleware error schemas in the
   * procedure's error schema using `Schema.Union`.
   * 
   * @example
   * ```ts
   * // Include middleware errors in error schema for full type safety
   * const updateUser = procedure
   *   .use(authMiddleware)  // Adds AuthError to type
   *   .use(rateLimitMiddleware)  // Adds RateLimitError to type
   *   .input(UpdateUserSchema)
   *   .error(Schema.Union(
   *     MyCustomError,
   *     AuthError,  // From middleware
   *     RateLimitError,  // From middleware
   *   ))
   *   .mutation()
   * ```
   */
  error<E2, EFrom = E2>(
    schema: Schema.Schema<E2, EFrom>,
  ): ProcedureBuilder<I, A, E2, Ctx, R, Provides>

  /**
   * Add tags to this procedure for tag-based cache invalidation.
   */
  tags(tags: ReadonlyArray<string>): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Declare which procedure paths this mutation invalidates.
   * @example procedure.invalidates(['user.list']).mutation()
   */
  invalidates(
    paths: ReadonlyArray<string>,
  ): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Declare which tags this mutation invalidates.
   * @example procedure.invalidatesTags(['users']).mutation()
   */
  invalidatesTags(
    tags: ReadonlyArray<string>,
  ): ProcedureBuilder<I, A, E, Ctx, R, Provides>

  /**
   * Create a query procedure (HTTP GET, cached).
   */
  query(): ProcedureDefinition<I, A, E, Ctx, "query", R, Provides>

  /**
   * Create a mutation procedure (HTTP POST, not cached).
   */
  mutation(): ProcedureDefinition<I, A, E, Ctx, "mutation", R, Provides>

  /**
   * Create a stream procedure (HTTP streaming via NDJSON).
   * Output schema validates each streamed part.
   */
  stream(): ProcedureDefinition<I, A, E, Ctx, "stream", R, Provides>

  /**
   * Create a chat procedure (HTTP streaming via NDJSON, @effect/ai compatible).
   * Output schema validates each ChatPart.
   */
  chat(): ProcedureDefinition<I, A, E, Ctx, "chat", R, Provides>

  /**
   * Create a subscription procedure (WebSocket-based real-time).
   * 
   * Handler returns Effect<Stream<A, E>, E, R>.
   * Output schema validates each streamed item.
   * 
   * @remarks
   * Requires WebSocket transport. Will fail at runtime if only HTTP is configured.
   * See DECISION-006 for full subscription system design.
   * 
   * @example
   * ```ts
   * const NotificationProcedures = procedures('notifications', {
   *   watch: procedure
   *     .input(Schema.Struct({ userId: Schema.String }))
   *     .output(NotificationSchema)
   *     .subscription(),
   * })
   * ```
   */
  subscription(): ProcedureDefinition<I, A, E, Ctx, "subscription", R, Provides>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

interface BuilderState {
  description?: string
  summary?: string
  externalDocs?: string
  responseDescription?: string
  deprecated?: boolean
  inputSchema: unknown
  outputSchema: unknown
  errorSchema: unknown
  tags: ReadonlyArray<string>
  invalidates: ReadonlyArray<string>
  invalidatesTags: ReadonlyArray<string>
  middlewares: ReadonlyArray<Middleware<any, any, any, any, any>>
}

/**
 * Create a ProcedureDefinition from builder state and procedure type.
 * Extracts common object creation to reduce duplication.
 *
 * @remarks
 * **Why the type assertion is safe:**
 *
 * The assertion `as ProcedureDefinition<...>` is safe because:
 * 1. The object structure matches ProcedureDefinition exactly (same fields)
 * 2. The generic parameters (I, A, E, Ctx, R, Provides) come from the builder chain
 * 3. The type parameter Type is directly passed and assigned to the `type` field
 * 4. BuilderState uses `unknown` for schemas, which are then narrowed by the caller
 * 5. Ctx is tracked through the middleware chain via the builder's type parameter
 * 6. R is tracked through the middleware chain via the builder's type parameter
 * 7. Provides is tracked through the middleware chain via the builder's type parameter
 *
 * TypeScript cannot verify the generic alignment without the cast because
 * BuilderState uses `unknown` for type-erased schema storage.
 */
const createDefinition = <I, A, E, Ctx extends BaseContext, Type extends ProcedureType, R = never, Provides = never>(
  state: BuilderState,
  type: Type,
): ProcedureDefinition<I, A, E, Ctx, Type, R, Provides> =>
  ({
    _tag: "ProcedureDefinition",
    type,
    description: state.description,
    summary: state.summary,
    externalDocs: state.externalDocs,
    responseDescription: state.responseDescription,
    deprecated: state.deprecated,
    inputSchema: state.inputSchema,
    outputSchema: state.outputSchema,
    errorSchema: state.errorSchema,
    tags: state.tags,
    invalidates: state.invalidates,
    invalidatesTags: state.invalidatesTags,
    middlewares: state.middlewares,
    // _contextType, _middlewareR, and _provides are intentionally not set - they're phantom types
  }) as ProcedureDefinition<I, A, E, Ctx, Type, R, Provides>

const createBuilder = <I, A, E, Ctx extends BaseContext, R = never, Provides = never>(
  state: BuilderState,
): ProcedureBuilder<I, A, E, Ctx, R, Provides> =>
  ({
    description: (text: string) =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, description: text }),
    summary: (text: string) =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, summary: text }),
    externalDocs: (url: string) =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, externalDocs: url }),
    responseDescription: (text: string) =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, responseDescription: text }),
    deprecated: () =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, deprecated: true }),
    use: <CtxOut extends BaseContext, E2, R2, P = never>(middleware: Middleware<Ctx, CtxOut, E2, R2, P>) =>
      createBuilder<I, A, E | E2, CtxOut, R | R2, Provides | P>({
        ...state,
        middlewares: [...state.middlewares, middleware],
      }),
    input: (schema: unknown) =>
      createBuilder<unknown, A, E, Ctx, R, Provides>({ ...state, inputSchema: schema }),
    output: (schema: unknown) =>
      createBuilder<I, unknown, E, Ctx, R, Provides>({ ...state, outputSchema: schema }),
    error: (schema: unknown) =>
      createBuilder<I, A, unknown, Ctx, R, Provides>({ ...state, errorSchema: schema }),
    tags: (tags: ReadonlyArray<string>) => createBuilder<I, A, E, Ctx, R, Provides>({ ...state, tags }),
    invalidates: (paths: ReadonlyArray<string>) =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, invalidates: paths }),
    invalidatesTags: (tags: ReadonlyArray<string>) =>
      createBuilder<I, A, E, Ctx, R, Provides>({ ...state, invalidatesTags: tags }),

    query: () => createDefinition<I, A, E, Ctx, "query", R, Provides>(state, "query"),
    mutation: () => createDefinition<I, A, E, Ctx, "mutation", R, Provides>(state, "mutation"),
    stream: () => createDefinition<I, A, E, Ctx, "stream", R, Provides>(state, "stream"),
    chat: () => createDefinition<I, A, E, Ctx, "chat", R, Provides>(state, "chat"),
    subscription: () => createDefinition<I, A, E, Ctx, "subscription", R, Provides>(state, "subscription"),
  }) as ProcedureBuilder<I, A, E, Ctx, R, Provides>

/**
 * Start building a procedure definition.
 *
 * The procedure builder uses a fluent API pattern where you chain methods
 * to configure input/output schemas, middleware, cache invalidation, and
 * finally call a terminal method (query, mutation, stream, chat, subscription)
 * to create the procedure definition.
 *
 * @example
 * ```ts
 * const UserProcedures = procedures('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 *   create: procedure.input(CreateSchema).invalidates(['user.list']).mutation(),
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const procedure: ProcedureBuilder<unknown, unknown, never, BaseContext, never, never> = createBuilder<unknown, unknown, never, BaseContext, never, never>({
  inputSchema: undefined,
  outputSchema: undefined,
  errorSchema: undefined,
  tags: [],
  invalidates: [],
  invalidatesTags: [],
  middlewares: [],
} as BuilderState)
