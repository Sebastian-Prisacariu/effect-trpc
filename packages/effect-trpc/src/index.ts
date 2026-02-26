/**
 * @module effect-trpc
 *
 * tRPC-style ergonomics for Effect-based applications.
 *
 * @example
 * ```ts
 * import { procedures, procedure, Router } from 'effect-trpc'
 * import * as Schema from 'effect/Schema'
 *
 * // Define procedures
 * const UserProcedures = procedures('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 *   create: procedure.input(CreateSchema).invalidates(['user.list']).mutation(),
 * })
 *
 * // Create router
 * const appRouter = Router.make({
 *   user: UserProcedures,
 * })
 *
 * // Create implementation
 * const UserProceduresLive = UserProcedures.toLayer({
 *   list: () => Effect.succeed([]),
 *   byId: ({ id }) => Effect.succeed({ id, name: 'Test' }),
 *   create: (input) => Effect.succeed({ ...input, id: 'new' }),
 * })
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core exports
// ─────────────────────────────────────────────────────────────────────────────

export * from "./core/index.js"
export { procedure } from "./core/server/procedure.js"
export { procedures, Procedures } from "./core/server/procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type { TRPCError } from "./errors/index.js"

export {
    ForbiddenError, InputValidationError, InternalError,
    NetworkError, NotFoundError, OutputValidationError, RateLimitError, TRPCErrorSchema, TypeId as TRPCErrorTypeId, TimeoutError, UnauthorizedError, isTRPCError
} from "./errors/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

export {
    // Re-export Logger from Effect
    Logger,
    // Service Tag
    TrpcLogger, TrpcLoggerDev, TrpcLoggerLive, TrpcLoggerProd,
    TrpcLoggerSilent,
    // Configuration
    defaultConfig as defaultLoggerConfig, generateRequestId, logMutation,
    // Convenience functions
    logQuery, logTrpcEvent,
    // Layers
    makeTrpcLoggerLayer,
    // Utilities
    redactSensitiveData,
    // Types
    type LogCategory, type TrpcLogEvent, type TrpcLoggerConfig, type TrpcLoggerService
} from "./shared/logging.js"

