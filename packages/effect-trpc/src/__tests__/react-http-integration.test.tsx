// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { NodeHttpClient } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { PropsWithChildren } from "react"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { procedure } from "../core/server/procedure.js"
import { procedures } from "../core/server/procedures.js"
import { Router } from "../core/server/router.js"
import { createHandler, nodeToWebRequest, webToNodeResponse } from "../node/http.js"
import { createTRPCReact } from "../react/index.js"

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

type AppRouter = typeof appRouter

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

describe("react client over real HTTP", () => {
  const store: Array<Todo> = []
  let server: Server | undefined
  let serverUrl = ""
  let disposeHandler: (() => Promise<void>) | undefined

  beforeAll(async () => {
    store.length = 0

    const handler = createHandler({
      router: appRouter,
      handlers: createTodoHandlers(store),
      path: "/rpc",
    })
    disposeHandler = handler.dispose

    await new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        void (async () => {
          try {
            const request = await nodeToWebRequest(req)
            const response = await handler.fetch(request)
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
    if (disposeHandler !== undefined) {
      await disposeHandler()
    }

    if (server !== undefined) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve())
      })
    }
  })

  it("runs useQuery against the real HTTP handler", async () => {
    const trpc = createTRPCReact<AppRouter>({
      url: serverUrl,
      httpClient: NodeHttpClient.layer,
    })
    const wrapper = ({ children }: PropsWithChildren) => <trpc.Provider>{children}</trpc.Provider>

    try {
      const { result } = renderHook(
        () => trpc.procedures.todo.list.useQuery(undefined),
        { wrapper },
      )

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual([])
    } finally {
      await trpc.dispose()
    }
  })

  it("runs useMutation and returns server data", async () => {
    const trpc = createTRPCReact<AppRouter>({
      url: serverUrl,
      httpClient: NodeHttpClient.layer,
    })
    const wrapper = ({ children }: PropsWithChildren) => <trpc.Provider>{children}</trpc.Provider>

    try {
      const mutation = renderHook(
        () => trpc.procedures.todo.add.useMutation(),
        { wrapper },
      )

      await act(async () => {
        const exit = await mutation.result.current.mutateAsync({
          title: "from react hook",
        })

        expect(Exit.isSuccess(exit)).toBe(true)
      })

      expect(mutation.result.current.isSuccess).toBe(true)
      expect(mutation.result.current.data?.title).toBe("from react hook")

      const query = renderHook(
        () => trpc.procedures.todo.list.useQuery(undefined),
        { wrapper },
      )

      await waitFor(() => {
        expect(query.result.current.isSuccess).toBe(true)
      })

      expect(query.result.current.data).toHaveLength(1)
      expect(query.result.current.data?.[0]?.title).toBe("from react hook")
    } finally {
      await trpc.dispose()
    }
  })
})
