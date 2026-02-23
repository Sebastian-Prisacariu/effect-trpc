import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { procedure, procedures, Router } from "../index.js"
import { createHandler as createNodeHandler } from "../node/index.js"
import { createRouteHandler as createNextHandler } from "../next/index.js"
import { createFetchHandler as createBunHandler } from "../bun/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

class MyError extends Schema.TaggedError<MyError>()("MyError", {
  message: Schema.String
}) {}

const TestProcedures = procedures("test", {
  hello: procedure
    .input(Schema.Struct({ name: Schema.String }))
    .output(Schema.String)
    .query(),

  fail: procedure
    .output(Schema.Never)
    .error(MyError)
    .mutation(),
})

const appRouter = Router.make({
  test: TestProcedures,
})

const HandlersLive = TestProcedures.toLayer({
  hello: (_ctx, { name }) => Effect.succeed(`Hello, ${name}!`),
  fail: () => Effect.fail(new MyError({ message: "Task failed successfully" })),
})

// ─────────────────────────────────────────────────────────────────────────────
// Integration Test
// ─────────────────────────────────────────────────────────────────────────────

describe("Adapter Payload Parity", () => {
  let nodeHandler: ReturnType<typeof createNodeHandler>
  let nextHandler: ReturnType<typeof createNextHandler>
  let bunHandler: ReturnType<typeof createBunHandler>

  beforeAll(() => {
    // Create the handlers for all adapters using the same router and layer
    nodeHandler = createNodeHandler({
      router: appRouter,
      handlers: HandlersLive,
      path: "/rpc",
    })

    nextHandler = createNextHandler({
      router: appRouter,
      handlers: HandlersLive,
    })

    bunHandler = createBunHandler({
      router: appRouter,
      handlers: HandlersLive,
      path: "/rpc",
    })
  })

  afterAll(async () => {
    await nodeHandler.dispose()
    await nextHandler.dispose()
    await bunHandler.dispose()
  })

  const makeRequest = (tag: string, payload: unknown) => {
    const body = JSON.stringify({
      _tag: "Request",
      id: "123",
      tag,
      payload,
      headers: [],
    }) + "\n"

    // Create a fresh request for each handler because reading body consumes it
    return () => new Request("http://localhost:3000/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/ndjson" },
      body,
    })
  }

  const getResponseData = async (response: Response) => {
    const text = await response.text()
    // Parse the NDJSON response
    const lines = text.trim().split("\n").filter(Boolean)
    return lines.map((line) => JSON.parse(line))
  }

  it("should return identical success payload across Node, Next, and Bun adapters", async () => {
    const getReq = makeRequest("test.hello", { name: "Alice" })

    const nodeRes = await nodeHandler.fetch(getReq())
    const nextRes = await nextHandler.POST(getReq())
    const bunRes = await bunHandler.fetch(getReq())

    // Ensure status codes are equal and successful
    expect(nodeRes.status).toBe(200)
    expect(nextRes.status).toBe(200)
    expect(bunRes.status).toBe(200)

    // Ensure headers are comparable
    expect(nodeRes.headers.get("content-type")).toContain("application/ndjson")
    expect(nextRes.headers.get("content-type")).toContain("application/ndjson")
    expect(bunRes.headers.get("content-type")).toContain("application/ndjson")

    // Parse bodies
    const nodeData = await getResponseData(nodeRes)
    const nextData = await getResponseData(nextRes)
    const bunData = await getResponseData(bunRes)

    // Assert exact parity
    expect(nodeData).toEqual(nextData)
    expect(nextData).toEqual(bunData)

    // Verify expected payload format
    expect(nodeData).toEqual([
      {
        _tag: "Exit",
        requestId: "123",
        exit: {
          _tag: "Success",
          value: "Hello, Alice!"
        }
      }
    ])
  })

  it("should return identical error payload across Node, Next, and Bun adapters", async () => {
    const getReq = makeRequest("test.fail", {})

    const nodeRes = await nodeHandler.fetch(getReq())
    const nextRes = await nextHandler.POST(getReq())
    const bunRes = await bunHandler.fetch(getReq())

    // Ensure status codes are equal and successful (RPC protocol errors are 200)
    expect(nodeRes.status).toBe(200)
    expect(nextRes.status).toBe(200)
    expect(bunRes.status).toBe(200)

    // Parse bodies
    const nodeData = await getResponseData(nodeRes)
    const nextData = await getResponseData(nextRes)
    const bunData = await getResponseData(bunRes)

    // Assert exact parity
    expect(nodeData).toEqual(nextData)
    expect(nextData).toEqual(bunData)

    // Verify expected error payload format
    expect(nodeData).toEqual([
      {
        _tag: "Exit",
        requestId: "123",
        exit: {
          _tag: "Failure",
          cause: {
            _tag: "Fail",
            error: {
              _tag: "MyError",
              message: "Task failed successfully"
            }
          }
        }
      }
    ])
  })
})
