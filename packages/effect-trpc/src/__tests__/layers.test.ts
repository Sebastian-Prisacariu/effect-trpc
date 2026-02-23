/**
 * @module effect-trpc/__tests__/layers
 *
 * Tests for layer composition patterns.
 * Validates that the service layer architecture works correctly
 * with different dependency injection scenarios.
 *
 * Note: Type assertions are used here due to TypeScript inference limitations
 * with complex Effect compositions under `exactOptionalPropertyTypes: true`.
 * See procedures.test.ts for details.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import { procedure } from "../core/procedure.js"
import { procedures, type ProceduresService } from "../core/procedures.js"
import { Router } from "../core/router.js"
import type { BaseContext } from "../core/middleware.js"

// Mock context for testing handlers directly
const mockCtx: BaseContext = {
  procedure: "test",
  headers: new Headers(),
  signal: new AbortController().signal,
  clientId: 1,
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Services
// ─────────────────────────────────────────────────────────────────────────────

interface Logger {
  readonly log: (message: string) => Effect.Effect<void>
}

const Logger = Context.GenericTag<Logger>("Logger")

interface Database {
  readonly query: <T>(sql: string) => Effect.Effect<T[]>
  readonly execute: (sql: string) => Effect.Effect<void>
}

const Database = Context.GenericTag<Database>("Database")

interface Cache {
  readonly get: <T>(key: string) => Effect.Effect<T | null>
  readonly set: <T>(key: string, value: T) => Effect.Effect<void>
}

const Cache = Context.GenericTag<Cache>("Cache")

// ─────────────────────────────────────────────────────────────────────────────
// Test Types
// ─────────────────────────────────────────────────────────────────────────────

interface Todo {
  id: string
  title: string
  completed: boolean
}

const TodoSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
})

const TodoProcedures = procedures("todo", {
  list: procedure.output(Schema.Array(TodoSchema)).query(),
  create: procedure
    .input(Schema.Struct({ title: Schema.String }))
    .output(TodoSchema)
    .mutation(),
  toggle: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(TodoSchema)
    .mutation(),
})

const TodoService = Context.GenericTag<ProceduresService<"todo", typeof TodoProcedures.procedures>>(
  "@effect-trpc/todo",
)

// ─────────────────────────────────────────────────────────────────────────────
// Layer Composition Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("layer composition", () => {
  it("provides handlers with no dependencies", async () => {
    const todos: Todo[] = []
    let nextId = 1

    const TodoHandlers = TodoProcedures.toLayer({
      list: (_ctx) => Effect.succeed(todos),
      create: (_ctx, { title }) =>
        Effect.sync(() => {
          const todo: Todo = { id: String(nextId++), title, completed: false }
          todos.push(todo)
          return todo
        }),
      toggle: (_ctx, { id }) =>
        Effect.sync(() => {
          const todo = todos.find((t) => t.id === id)
          if (!todo) throw new Error("Not found")
          todo.completed = !todo.completed
          return todo
        }),
    })

    const program = TodoService.pipe(
      Effect.flatMap((service) =>
        service.handlers.create(mockCtx, { title: "Test" }).pipe(
          Effect.flatMap(() => service.handlers.list(mockCtx, undefined)),
        ),
      ),
      Effect.provide(TodoHandlers),
    ) as Effect.Effect<readonly Todo[], never, never>

    const result = await Effect.runPromise(program)
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe("Test")
  })

  it("provides handlers with single dependency", async () => {
    const logs: string[] = []

    const MockLogger = Layer.succeed(Logger, {
      log: (message) =>
        Effect.sync(() => {
          logs.push(message)
        }),
    })

    const TodoHandlers = TodoProcedures.toLayer(
      Effect.gen(function* () {
        const logger = yield* Logger

        const todos: Todo[] = []
        let nextId = 1

        return {
          list: (_ctx) => logger.log("Listing todos").pipe(Effect.as(todos)),
          create: (_ctx, { title }) =>
            logger.log(`Creating todo: ${title}`).pipe(
              Effect.map(() => {
                const todo: Todo = { id: String(nextId++), title, completed: false }
                todos.push(todo)
                return todo
              }),
            ),
          toggle: (_ctx, { id }) =>
            logger.log(`Toggling todo: ${id}`).pipe(
              Effect.flatMap(() => {
                const todo = todos.find((t) => t.id === id)
                if (!todo) return Effect.die("Not found")
                todo.completed = !todo.completed
                return Effect.succeed(todo)
              }),
            ),
        }
      }),
    )

    const TestLayer = TodoHandlers.pipe(Layer.provide(MockLogger))

    const program = TodoService.pipe(
      Effect.flatMap((service) =>
        service.handlers.create(mockCtx, { title: "With logging" }).pipe(
          Effect.flatMap(() => service.handlers.list(mockCtx, undefined)),
        ),
      ),
      Effect.provide(TestLayer),
    ) as Effect.Effect<readonly Todo[], never, never>

    const result = await Effect.runPromise(program)
    expect(result).toHaveLength(1)
    expect(logs).toContain("Creating todo: With logging")
    expect(logs).toContain("Listing todos")
  })

  it("provides handlers with multiple dependencies", async () => {
    const logs: string[] = []
    const cache = new Map<string, unknown>()

    const MockLogger = Layer.succeed(Logger, {
      log: (message) =>
        Effect.sync(() => {
          logs.push(message)
        }),
    })

    const MockCache = Layer.succeed(Cache, {
      get: <T>(key: string) =>
        Effect.sync(() => (cache.get(key) as T) ?? null),
      set: <T>(key: string, value: T) =>
        Effect.sync(() => {
          cache.set(key, value)
        }),
    })

    const TodoHandlers = TodoProcedures.toLayer(
      Effect.gen(function* () {
        const logger = yield* Logger
        const cacheService = yield* Cache

        const todos: Todo[] = []
        let nextId = 1

        return {
          list: (_ctx) =>
            cacheService.get<Todo[]>("todos:list").pipe(
              Effect.flatMap((cached) => {
                if (cached) {
                  return logger.log("Cache hit for todos:list").pipe(Effect.as(cached))
                }
                return logger.log("Cache miss for todos:list").pipe(
                  Effect.flatMap(() => cacheService.set("todos:list", todos)),
                  Effect.as(todos),
                )
              }),
            ),
          create: (_ctx, { title }) =>
            logger.log(`Creating: ${title}`).pipe(
              Effect.map(() => {
                const todo: Todo = { id: String(nextId++), title, completed: false }
                todos.push(todo)
                return todo
              }),
              Effect.tap(() => cacheService.set("todos:list", todos)),
            ),
          toggle: (_ctx, { id }) =>
            Effect.sync(() => {
              const todo = todos.find((t) => t.id === id)
              if (!todo) throw new Error("Not found")
              todo.completed = !todo.completed
              return todo
            }).pipe(Effect.tap(() => cacheService.set("todos:list", todos))),
        }
      }),
    )

    const TestLayer = TodoHandlers.pipe(
      Layer.provide(Layer.mergeAll(MockLogger, MockCache)),
    )

    const program = TodoService.pipe(
      Effect.flatMap((service) =>
        service.handlers.create(mockCtx, { title: "Cached" }).pipe(
          Effect.flatMap(() => service.handlers.list(mockCtx, undefined)),
          Effect.flatMap(() => service.handlers.list(mockCtx, undefined)),
        ),
      ),
      Effect.provide(TestLayer),
    ) as Effect.Effect<readonly Todo[], never, never>

    await Effect.runPromise(program)
    expect(logs).toContain("Creating: Cached")
    expect(logs.filter((l) => l.includes("Cache hit")).length).toBe(2)
  })
})

describe("layer replacement for testing", () => {
  it("replaces production layer with mock layer", async () => {
    const ProductionTodoHandlers = TodoProcedures.toLayer(
      Effect.gen(function* () {
        const db = yield* Database

        return {
          list: (_ctx) => db.query<Todo>("SELECT * FROM todos"),
          create: (_ctx, { title }) =>
            db.execute(`INSERT INTO todos (title) VALUES ('${title}')`).pipe(
              Effect.as({ id: "db-id", title, completed: false }),
            ),
          toggle: (_ctx, { id }) =>
            db.execute(`UPDATE todos SET completed = NOT completed WHERE id = '${id}'`).pipe(
              Effect.as({ id, title: "mock", completed: true }),
            ),
        }
      }),
    )

    const mockTodos: Todo[] = [{ id: "1", title: "From mock DB", completed: false }]

    const MockDatabase = Layer.succeed(Database, {
      query: <T>() => Effect.succeed(mockTodos as T[]),
      execute: () => Effect.void,
    })

    const TestLayer = ProductionTodoHandlers.pipe(Layer.provide(MockDatabase))

    const program = TodoService.pipe(
      Effect.flatMap((service) => service.handlers.list(mockCtx, undefined)),
      Effect.provide(TestLayer),
    ) as Effect.Effect<readonly Todo[], never, never>

    const result = await Effect.runPromise(program)
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe("From mock DB")
  })

  it("allows configurable mock behavior", async () => {
    const createMockTodoHandlers = (options: {
      initialTodos?: Todo[]
      failOnCreate?: boolean
    }) =>
      TodoProcedures.toLayer({
        list: (_ctx) => Effect.succeed(options.initialTodos ?? []),
        create: (_ctx, { title }) =>
          options.failOnCreate
            ? Effect.die("Database connection failed")
            : Effect.succeed({ id: "mock", title, completed: false }),
        toggle: (_ctx, { id }) =>
          Effect.succeed({ id, title: "toggled", completed: true }),
      })

    const withData = createMockTodoHandlers({
      initialTodos: [
        { id: "1", title: "Existing", completed: true },
        { id: "2", title: "Another", completed: false },
      ],
    })

    const listProgram = TodoService.pipe(
      Effect.flatMap((service) => service.handlers.list(mockCtx, undefined)),
      Effect.provide(withData),
    ) as Effect.Effect<readonly Todo[], never, never>

    const todos = await Effect.runPromise(listProgram)
    expect(todos).toHaveLength(2)

    const empty = createMockTodoHandlers({})
    const emptyProgram = TodoService.pipe(
      Effect.flatMap((service) => service.handlers.list(mockCtx, undefined)),
      Effect.provide(empty),
    ) as Effect.Effect<readonly Todo[], never, never>

    const emptyTodos = await Effect.runPromise(emptyProgram)
    expect(emptyTodos).toHaveLength(0)
  })
})

describe("router with layers", () => {
  interface User {
    id: string
    name: string
  }

  const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })

  const UserProcedures = procedures("user", {
    list: procedure.output(Schema.Array(UserSchema)).query(),
  })

  const UserService = Context.GenericTag<ProceduresService<"user", typeof UserProcedures.procedures>>(
    "@effect-trpc/user",
  )

  it("creates router with multiple procedure group layers", async () => {
    const _router = Router.make({
      user: UserProcedures,
      todo: TodoProcedures,
    })

    const UserHandlers = UserProcedures.toLayer({
      list: (_ctx) => Effect.succeed([{ id: "1", name: "Alice" }]),
    })

    const TodoHandlers = TodoProcedures.toLayer({
      list: (_ctx) => Effect.succeed([]),
      create: (_ctx, { title }) => Effect.succeed({ id: "1", title, completed: false }),
      toggle: (_ctx, { id }) => Effect.succeed({ id, title: "", completed: true }),
    })

    const AllHandlers = Layer.mergeAll(UserHandlers, TodoHandlers)

    const program = Effect.all([UserService, TodoService]).pipe(
      Effect.flatMap(([userService, todoService]) =>
        Effect.all({
          users: userService.handlers.list(mockCtx, undefined),
          created: todoService.handlers.create(mockCtx, { title: "Test" }),
        }),
      ),
      Effect.provide(AllHandlers),
    ) as Effect.Effect<{ users: readonly User[]; created: Todo }, never, never>

    const result = await Effect.runPromise(program)
    expect(result.users).toHaveLength(1)
    expect(result.users[0]?.name).toBe("Alice")
    expect(result.created.title).toBe("Test")
  })
})
