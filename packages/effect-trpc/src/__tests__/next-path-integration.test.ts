import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Client } from "../core/client/index.js"
import { procedure } from "../core/server/procedure.js"
import { procedures } from "../core/server/procedures.js"
import { Router } from "../core/server/router.js"
import { createRouteHandler } from "../next/index.js"
import { nodeToWebRequest, webToNodeResponse } from "../node/index.js"
import { createServerClient } from "../react/server-client.js"

const TodoSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
})

const AddTodoInputSchema = Schema.Struct({
  title: Schema.String,
})

type Todo = typeof TodoSchema.Type

const TodoProcedures = procedures("todo", {
  list: procedure.output(Schema.Array(TodoSchema)).query(),
  add: procedure.input(AddTodoInputSchema).output(TodoSchema).mutation(),
})

const appRouter = Router.make({
  todo: TodoProcedures,
})

const createTodoHandlers = (store: Array<Todo>) =>
  Layer.mergeAll(
    TodoProcedures.procedures.list.toLayer(() => Effect.succeed(store)),
    TodoProcedures.procedures.add.toLayer((_ctx, input) =>
      Effect.sync(() => {
        const next: Todo = {
          id: String(store.length + 1),
          title: input.title,
        }
        store.push(next)
        return next
      }),
    ),
  )

describe("next integration path", () => {
  describe("createRouteHandler", () => {
    let server: Server | undefined
    let serverUrl = ""
    let disposeRouteHandlers: (() => Promise<void>) | undefined
    const store: Array<Todo> = []

    beforeAll(async () => {
      store.length = 0
      const routeHandlers = createRouteHandler({
        router: appRouter,
        handlers: createTodoHandlers(store),
        cors: true,
      })
      disposeRouteHandlers = routeHandlers.dispose

      await new Promise<void>((resolve) => {
        server = createServer((req, res) => {
          void (async () => {
            try {
              const request = await nodeToWebRequest(req)
              const response =
                req.method === "GET"
                  ? await routeHandlers.GET(request)
                  : await routeHandlers.POST(request)

              await webToNodeResponse(response, res)
            } catch {
              res.writeHead(500, { "content-type": "text/plain" })
              res.end("Internal Server Error")
            }
          })()
        })

        server.listen(0, () => {
          const address = server!.address() as AddressInfo
          serverUrl = `http://127.0.0.1:${address.port}/rpc`
          resolve()
        })
      })
    })

    afterAll(async () => {
      if (disposeRouteHandlers !== undefined) {
        await disposeRouteHandlers()
      }

      if (server !== undefined) {
        await new Promise<void>((resolve) => {
          server!.close(() => resolve())
        })
      }
    })

    it("serves mutation and query through the Next route handler", async () => {
      const program = Effect.gen(function* () {
        const client = yield* Client
        const api = client.create(appRouter)
        const created = yield* api.todo.add({ title: "Ship Next path" })
        const todos = yield* api.todo.list(undefined)
        return { created, todos }
      })

      const result = await Effect.runPromise(
        Effect.provide(program, Client.HttpLive(serverUrl)),
      )

      expect(result.created.title).toBe("Ship Next path")
      expect(result.todos).toHaveLength(1)
      expect(result.todos[0]?.title).toBe("Ship Next path")
    })

    it("handles CORS preflight with 204 response", async () => {
      const response = await fetch(serverUrl, {
        method: "OPTIONS",
        headers: {
          Origin: "http://example.com",
          "Access-Control-Request-Method": "POST",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
    })
  })

  describe("createServerClient", () => {
    it("executes procedures in-memory with the same router API", async () => {
      const store: Array<Todo> = []
      const serverClient = createServerClient({
        router: appRouter,
        handlers: createTodoHandlers(store),
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const created = yield* serverClient.procedures.todo.add({
            title: "RSC direct call",
          })
          const todos = yield* serverClient.procedures.todo.list(undefined)
          return { created, todos }
        }),
      )

      expect(result.created.title).toBe("RSC direct call")
      expect(result.todos).toHaveLength(1)
      expect(result.todos[0]?.title).toBe("RSC direct call")

      await serverClient.dispose()
    })
  })
})
