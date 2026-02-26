/**
 * Shared API definition for the fullstack example.
 *
 * This package exports:
 * - Router type for client/server
 * - Procedures groups for type-safe implementations
 * - Schemas for validation
 */
import * as Schema from "effect/Schema"
import { procedures, procedure, Router } from "effect-trpc"

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
// Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error when a todo is not found.
 *
 * Uses Schema.TaggedError for wire serializability.
 * Use Effect.fail(new TodoNotFoundError(...)) for expected errors,
 * NOT Effect.die() which is for unrecoverable defects.
 */
export class TodoNotFoundError extends Schema.TaggedError<TodoNotFoundError>()(
  "TodoNotFoundError",
  {
    id: Schema.String,
  }
) {
  get message(): string {
    return `Todo ${this.id} not found`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedures
// ─────────────────────────────────────────────────────────────────────────────

export const todosProcedures = procedures("todos", {
  list: procedure
    .output(Schema.Array(Todo))
    .query(),

  get: procedure
    .input(GetTodoInput)
    .output(Schema.NullOr(Todo))
    .query(),

  create: procedure
    .input(CreateTodoInput)
    .output(Todo)
    .mutation(),

  update: procedure
    .input(UpdateTodoInput)
    .output(Todo)
    .error(TodoNotFoundError)
    .mutation(),

  toggle: procedure
    .input(ToggleTodoInput)
    .output(Todo)
    .error(TodoNotFoundError)
    .mutation(),

  delete: procedure
    .input(DeleteTodoInput)
    .output(Schema.Boolean)
    .mutation(),
})

export const healthProcedures = procedures("health", {
  check: procedure
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
