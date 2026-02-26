/**
 * Shared API definition for the fullstack example.
 *
 * This package exports:
 * - Router type for client/server
 * - Procedures groups for type-safe implementations
 * - Schemas for validation
 */
import * as Schema from "effect/Schema"
import { Procedures, Procedure, Router } from "effect-trpc"

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.DateFromNumber,
})

export type Todo = typeof Todo.Type

export const CreateTodoInput = Schema.Struct({
  title: Schema.String,
})

export const UpdateTodoInput = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  completed: Schema.optional(Schema.Boolean),
})

export const ToggleTodoInput = Schema.Struct({
  id: Schema.String,
})

export const DeleteTodoInput = Schema.Struct({
  id: Schema.String,
})

export const GetTodoInput = Schema.Struct({
  id: Schema.String,
})

export const HealthStatus = Schema.Struct({
  status: Schema.Literal("ok"),
  timestamp: Schema.DateFromNumber,
})

// ─────────────────────────────────────────────────────────────────────────────
// Procedures
// ─────────────────────────────────────────────────────────────────────────────

export const todosProcedures = Procedures.make({
  list: Procedure
    .output(Schema.Array(Todo))
    .query(),

  get: Procedure
    .input(GetTodoInput)
    .output(Schema.NullOr(Todo))
    .query(),

  create: Procedure
    .input(CreateTodoInput)
    .output(Todo)
    .mutation(),

  update: Procedure
    .input(UpdateTodoInput)
    .output(Todo)
    .mutation(),

  toggle: Procedure
    .input(ToggleTodoInput)
    .output(Todo)
    .mutation(),

  delete: Procedure
    .input(DeleteTodoInput)
    .output(Schema.Boolean)
    .mutation(),
})

export const healthProcedures = Procedures.make({
  check: Procedure
    .output(HealthStatus)
    .query(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export const appRouter = Router.make({
  todos: todosProcedures,
  health: healthProcedures,
})

export type AppRouter = typeof appRouter
