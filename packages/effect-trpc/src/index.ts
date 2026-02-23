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
