/**
 * HTTP Adapter Tests
 * 
 * Tests for Server.toHttpHandler, toFetchHandler, toNextApiHandler
 */

import { describe, it, expect } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Schema, Layer } from "effect"

import { Procedure, Router, Server } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String }
) {}

// =============================================================================
// Test Router & Server
// =============================================================================

const testRouter = Router.make("@api", {
  users: {
    list: Procedure.query({ success: Schema.Array(User) }),
    get: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    }),
  },
  health: Procedure.query({ success: Schema.String }),
})

const testUsers = [
  new User({ id: "1", name: "Alice" }),
  new User({ id: "2", name: "Bob" }),
]

const handlers = {
  users: {
    list: () => Effect.succeed(testUsers),
    get: ({ id }: { id: string }) =>
      id === "1"
        ? Effect.succeed(testUsers[0])
        : Effect.fail(new NotFoundError({ id })),
  },
  health: () => Effect.succeed("OK"),
}

const server = Server.make(testRouter, handlers)

// =============================================================================
// toHttpHandler Tests
// =============================================================================

describe("Server.toHttpHandler", () => {
  const httpHandler = Server.toHttpHandler(server)

  effectIt.effect("returns Success for valid query", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          id: "req-1",
          tag: "@api/health",
          payload: undefined,
        }),
      }

      const response = yield* httpHandler(request)

      expect(response.status).toBe(200)
      expect(response.headers["Content-Type"]).toBe("application/json")
      
      const body = JSON.parse(response.body)
      expect(body._tag).toBe("Success")
      expect(body.value).toBe("OK")
    })
  )

  effectIt.effect("returns Success with data for list query", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          id: "req-2",
          tag: "@api/users/list",
          payload: undefined,
        }),
      }

      const response = yield* httpHandler(request)

      expect(response.status).toBe(200)
      const body = JSON.parse(response.body)
      expect(body._tag).toBe("Success")
      expect(body.value).toHaveLength(2)
    })
  )

  effectIt.effect("returns Failure for error", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          id: "req-3",
          tag: "@api/users/get",
          payload: { id: "not-found" },
        }),
      }

      const response = yield* httpHandler(request)

      expect(response.status).toBe(200) // HTTP 200, but body has Failure
      const body = JSON.parse(response.body)
      expect(body._tag).toBe("Failure")
      expect(body.error._tag).toBe("NotFoundError")
    })
  )

  effectIt.effect("returns Failure for unknown procedure", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          id: "req-4",
          tag: "@api/unknown",
          payload: undefined,
        }),
      }

      const response = yield* httpHandler(request)

      const body = JSON.parse(response.body)
      expect(body._tag).toBe("Failure")
    })
  )

  effectIt.effect("passes headers to transport request", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          id: "req-5",
          tag: "@api/health",
          payload: undefined,
        }),
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
      }

      const response = yield* httpHandler(request)

      // Should succeed - headers are passed through
      expect(response.status).toBe(200)
    })
  )

  effectIt.effect("handles invalid JSON gracefully", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.reject(new Error("Invalid JSON")),
      }

      const response = yield* httpHandler(request)

      // Server returns 400 for invalid requests
      expect(response.status).toBe(400)
    })
  )
})

// =============================================================================
// toFetchHandler Tests
// =============================================================================

describe("Server.toFetchHandler", () => {
  const fetchHandler = Server.toFetchHandler(server, Layer.empty)

  it("returns Response for valid query", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        id: "req-1",
        tag: "@api/health",
        payload: undefined,
      }),
    })

    const response = await fetchHandler(request)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/json")
    
    const body = await response.json()
    expect(body._tag).toBe("Success")
    expect(body.value).toBe("OK")
  })

  it("returns Response with data for list", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        id: "req-2",
        tag: "@api/users/list",
        payload: undefined,
      }),
    })

    const response = await fetchHandler(request)
    const body = await response.json()

    expect(body._tag).toBe("Success")
    expect(body.value).toHaveLength(2)
  })

  it("returns Failure for errors", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        id: "req-3",
        tag: "@api/users/get",
        payload: { id: "missing" },
      }),
    })

    const response = await fetchHandler(request)
    const body = await response.json()

    expect(body._tag).toBe("Failure")
    expect(body.error._tag).toBe("NotFoundError")
  })
})

// =============================================================================
// toNextApiHandler Tests
// =============================================================================

describe("Server.toNextApiHandler", () => {
  const nextApiHandler = Server.toNextApiHandler(server, Layer.empty)

  it("handles Next.js API request/response", async () => {
    // Mock Next.js req/res
    let responseStatus = 0
    let responseBody = ""
    const headers: Record<string, string> = {}

    const req = {
      body: {
        id: "req-1",
        tag: "@api/health",
        payload: undefined,
      },
      headers: {},
    }

    const res = {
      status: (code: number) => {
        responseStatus = code
        return res
      },
      setHeader: (name: string, value: string) => {
        headers[name] = value
      },
      send: (body: string) => {
        responseBody = body
      },
    }

    await nextApiHandler(req as any, res as any)

    expect(responseStatus).toBe(200)
    expect(headers["Content-Type"]).toBe("application/json")
    
    const body = JSON.parse(responseBody)
    expect(body._tag).toBe("Success")
    expect(body.value).toBe("OK")
  })

  it("passes headers from Next.js request", async () => {
    let responseBody = ""

    const req = {
      body: {
        id: "req-2",
        tag: "@api/users/list",
        payload: undefined,
      },
      headers: {
        authorization: "Bearer token",
      },
    }

    const res = {
      status: () => res,
      setHeader: () => {},
      send: (body: string) => { responseBody = body },
    }

    await nextApiHandler(req as any, res as any)

    const body = JSON.parse(responseBody)
    expect(body._tag).toBe("Success")
  })
})
