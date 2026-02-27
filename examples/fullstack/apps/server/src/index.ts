/**
 * Node.js server using effect-trpc/node adapter.
 */
import * as http from "node:http"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createHandler, nodeToWebRequest, webToNodeResponse } from "effect-trpc/node"
import { appRouter, todosProcedures, healthProcedures, TodoNotFoundError, type Todo } from "@example/api"

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Database
// ─────────────────────────────────────────────────────────────────────────────

const todos = new Map<string, Todo>()

// Add some initial data
const initialTodos: Todo[] = [
  { id: "1", title: "Learn Effect", completed: true, createdAt: new Date() },
  { id: "2", title: "Build with effect-trpc", completed: false, createdAt: new Date() },
  { id: "3", title: "Deploy to production", completed: false, createdAt: new Date() },
]

for (const todo of initialTodos) {
  todos.set(todo.id, todo)
}

let nextId = 4

// ─────────────────────────────────────────────────────────────────────────────
// Handlers Implementation
// ─────────────────────────────────────────────────────────────────────────────

const TodosHandlersLive = todosProcedures.toLayer({
  list: (_ctx) =>
    Effect.sync(() => Array.from(todos.values())),

  get: (_ctx, { id }) =>
    Effect.sync(() => todos.get(id) ?? null),

  create: (_ctx, { title }) =>
    Effect.sync(() => {
      const todo: Todo = {
        id: String(nextId++),
        title,
        completed: false,
        createdAt: new Date(),
      }
      todos.set(todo.id, todo)
      return todo
    }),

  update: (_ctx, { id, title, completed }) =>
    Effect.gen(function* () {
      const existing = todos.get(id)
      if (!existing) {
        // Use Effect.fail for expected errors (not found is recoverable)
        // NOT Effect.die which is for unrecoverable defects
        return yield* new TodoNotFoundError({ id })
      }
      const updated: Todo = {
        ...existing,
        title: title ?? existing.title,
        completed: completed ?? existing.completed,
      }
      todos.set(id, updated)
      return updated
    }),

  toggle: (_ctx, { id }) =>
    Effect.gen(function* () {
      const existing = todos.get(id)
      if (!existing) {
        // Use Effect.fail for expected errors (not found is recoverable)
        // NOT Effect.die which is for unrecoverable defects
        return yield* new TodoNotFoundError({ id })
      }
      const updated: Todo = { ...existing, completed: !existing.completed }
      todos.set(id, updated)
      return updated
    }),

  delete: (_ctx, { id }) =>
    Effect.sync(() => todos.delete(id)),
})

const HealthHandlersLive = healthProcedures.toLayer({
  check: (_ctx) =>
    Effect.succeed({
      status: "ok" as const,
      timestamp: new Date(),
    }),
})

// Combine all handlers
const AppHandlersLive = Layer.mergeAll(TodosHandlersLive, HealthHandlersLive)

// ─────────────────────────────────────────────────────────────────────────────
// Server Setup
// ─────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001

const handler = createHandler({
  router: appRouter,
  handlers: AppHandlersLive,
  cors: {
    origins: ["http://localhost:5173", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    headers: ["Content-Type"],
  },
})

const server = http.createServer(async (req, res) => {
  try {
    const request = await nodeToWebRequest(req)
    const response = await handler.fetch(request)
    await webToNodeResponse(response, res)
  } catch (error) {
    console.error("Server error:", error)
    res.writeHead(500)
    res.end("Internal Server Error")
  }
})

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`RPC endpoint: http://localhost:${PORT}/rpc`)
})

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...")
  await handler.dispose()
  server.close()
  process.exit(0)
})
