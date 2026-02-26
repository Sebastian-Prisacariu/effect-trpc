/**
 * @module effect-trpc
 *
 * tRPC-style ergonomics for Effect-based applications.
 *
 * @example
 * ```ts
 * import { Procedures, Procedure, Router } from 'effect-trpc'
 * import * as Schema from 'effect/Schema'
 *
 * // Define procedures
 * const UserProcedures = Procedures.make({
 *   list: Procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: Procedure.input(IdSchema).output(UserSchema).query(),
 *   create: Procedure.input(CreateSchema).invalidates(['user.list']).mutation(),
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
// Core exports - re-export everything from core
// This preserves type+value pairs like Router, Middleware
// ─────────────────────────────────────────────────────────────────────────────

export * from "./core/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type { TRPCError } from "./errors/index.js"

export {
  TypeId as TRPCErrorTypeId,
  isTRPCError,
  InputValidationError,
  OutputValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  TimeoutError,
  InternalError,
  NetworkError,
  TRPCErrorSchema,
} from "./errors/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Types
  type LogCategory,
  type TrpcLoggerConfig,
  type TrpcLogEvent,
  type TrpcLoggerService,
  // Service Tag
  TrpcLogger,
  // Configuration
  defaultConfig as defaultLoggerConfig,
  // Layers
  makeTrpcLoggerLayer,
  TrpcLoggerLive,
  TrpcLoggerDev,
  TrpcLoggerProd,
  TrpcLoggerSilent,
  // Utilities
  redactSensitiveData,
  generateRequestId,
  // Convenience functions
  logQuery,
  logMutation,
  logTrpcEvent,
  // Re-export Logger from Effect
  Logger,
} from "./shared/logging.js"
