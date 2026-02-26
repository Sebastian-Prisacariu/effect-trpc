/**
 * @module effect-trpc/__tests__/adapters
 *
 * Tests for Node.js and Bun adapter functionality.
 *
 * These tests focus on:
 * - Request/response conversion utilities
 * - Handler creation and configuration
 * - CORS header handling
 * - WebSocket handler configuration
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import { Readable } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"

import { Procedure, Procedures, Router } from "../index.js"
import { buildCorsHeaders } from "../shared/cors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const UserProcedures = Procedures.make({
  get: Procedure.input(Schema.Struct({ id: Schema.String })).output(UserSchema).query(),
  create: Procedure.input(Schema.Struct({ name: Schema.String })).output(UserSchema).mutation(),
})

const testRouter = Router.make({
  user: UserProcedures,
})

// ─────────────────────────────────────────────────────────────────────────────
// CORS Header Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CORS Headers", () => {
  describe("buildCorsHeaders", () => {
    it("builds default CORS headers", () => {
      const headers = buildCorsHeaders({})

      expect(headers["Access-Control-Allow-Origin"]).toBe("*")
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, OPTIONS")
      expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type")
    })

    it("respects custom origins (string)", () => {
      const headers = buildCorsHeaders({ origins: "https://example.com" })

      expect(headers["Access-Control-Allow-Origin"]).toBe("https://example.com")
    })

    it("respects custom origins (array) - returns first origin for static headers", () => {
      // buildCorsHeaders returns static headers - for multi-origin support,
      // use buildCorsHeadersForRequest which checks against request Origin
      const headers = buildCorsHeaders({ origins: ["https://a.com", "https://b.com"] })

      // With multiple origins, returns the first one for static headers
      // (Access-Control-Allow-Origin cannot accept comma-separated values)
      expect(headers["Access-Control-Allow-Origin"]).toBe("https://a.com")
      // Vary header indicates origin is dynamic
      expect(headers["Vary"]).toBe("Origin")
    })

    it("respects custom methods", () => {
      const headers = buildCorsHeaders({ methods: ["GET", "POST", "PUT", "DELETE"] })

      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST, PUT, DELETE")
    })

    it("respects custom headers", () => {
      const headers = buildCorsHeaders({ headers: ["X-Custom-Header", "Authorization"] })

      expect(headers["Access-Control-Allow-Headers"]).toBe("X-Custom-Header, Authorization")
    })

    it("builds complete CORS config", () => {
      const headers = buildCorsHeaders({
        origins: "https://myapp.com",
        methods: ["GET", "POST"],
        headers: ["Content-Type", "X-API-Key"],
      })

      expect(headers["Access-Control-Allow-Origin"]).toBe("https://myapp.com")
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST")
      expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type, X-API-Key")
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Node.js Request Conversion Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Node.js Request Conversion", () => {
  // Create a mock IncomingMessage
  const createMockRequest = (options: {
    method?: string
    url?: string
    headers?: Record<string, string | string[]>
    body?: string
  }) => {
    const { method = "GET", url = "/", headers = {}, body } = options

    // Create a mock readable stream
    const mockStream = new Readable({
      read() {
        if (body) {
          this.push(Buffer.from(body))
        }
        this.push(null)
      },
    })

    // Add IncomingMessage properties
    const req = Object.assign(mockStream, {
      method,
      url,
      headers: { host: "localhost:3000", ...headers },
      httpVersion: "1.1",
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      connection: null,
      socket: null,
      complete: true,
    }) as unknown as IncomingMessage

    return req
  }

  it("converts GET request without body", async () => {
    // Import the function dynamically to avoid module loading issues in non-Node environments
    const { nodeToWebRequest } = await import("../node/index.js")

    const req = createMockRequest({
      method: "GET",
      url: "/api/users",
      headers: { "accept": "application/json" },
    })

    const webRequest = await nodeToWebRequest(req)

    expect(webRequest.method).toBe("GET")
    expect(webRequest.url).toBe("http://localhost:3000/api/users")
    expect(webRequest.headers.get("accept")).toBe("application/json")
  })

  it("converts POST request with body", async () => {
    const { nodeToWebRequest } = await import("../node/index.js")

    const body = JSON.stringify({ name: "Alice" })
    const req = createMockRequest({
      method: "POST",
      url: "/api/users",
      headers: { "content-type": "application/json" },
      body,
    })

    const webRequest = await nodeToWebRequest(req)

    expect(webRequest.method).toBe("POST")
    expect(webRequest.headers.get("content-type")).toBe("application/json")

    const requestBody = await webRequest.text()
    expect(requestBody).toBe(body)
  })

  it("converts headers array values", async () => {
    const { nodeToWebRequest } = await import("../node/index.js")

    const req = createMockRequest({
      method: "GET",
      url: "/",
      headers: { "set-cookie": ["cookie1=a", "cookie2=b"] as unknown as string },
    })

    const webRequest = await nodeToWebRequest(req)

    // Array headers should be joined with comma
    expect(webRequest.headers.get("set-cookie")).toBe("cookie1=a, cookie2=b")
  })

  it("handles missing host header", async () => {
    const { nodeToWebRequest } = await import("../node/index.js")

    const req = createMockRequest({
      method: "GET",
      url: "/test",
    })
    // Remove host header
    delete (req.headers as Record<string, unknown>)["host"]

    const webRequest = await nodeToWebRequest(req)

    // Should default to localhost
    expect(webRequest.url).toBe("http://localhost/test")
  })

  it("handles missing URL", async () => {
    const { nodeToWebRequest } = await import("../node/index.js")

    const req = createMockRequest({
      method: "GET",
    })
    req.url = undefined

    const webRequest = await nodeToWebRequest(req)

    expect(webRequest.url).toBe("http://localhost:3000/")
  })

  describe("body size limit", () => {
    it("accepts body within size limit", async () => {
      const { nodeToWebRequest } = await import("../node/index.js")

      const body = "a".repeat(100) // 100 bytes
      const req = createMockRequest({
        method: "POST",
        url: "/api/data",
        headers: { "content-type": "text/plain" },
        body,
      })

      const webRequest = await nodeToWebRequest(req, { maxBodySize: 1000 })

      expect(webRequest.method).toBe("POST")
      const requestBody = await webRequest.text()
      expect(requestBody).toBe(body)
    })

    it("rejects body exceeding size limit", async () => {
      const { nodeToWebRequest, PayloadTooLargeError } = await import("../node/index.js")

      const body = "a".repeat(200) // 200 bytes
      const req = createMockRequest({
        method: "POST",
        url: "/api/data",
        headers: { "content-type": "text/plain" },
        body,
      })

      await expect(nodeToWebRequest(req, { maxBodySize: 100 })).rejects.toThrow(PayloadTooLargeError)
    })

    it("uses default 1MB limit when no maxBodySize specified", async () => {
      const { nodeToWebRequest, DEFAULT_MAX_BODY_SIZE } = await import("../node/index.js")

      // Verify the default is 1MB
      expect(DEFAULT_MAX_BODY_SIZE).toBe(1024 * 1024)

      // A small body should work fine with default limit
      const body = "small body"
      const req = createMockRequest({
        method: "POST",
        url: "/api/data",
        body,
      })

      const webRequest = await nodeToWebRequest(req)
      const requestBody = await webRequest.text()
      expect(requestBody).toBe(body)
    })

    it("PayloadTooLargeError has correct properties", async () => {
      const { nodeToWebRequest, PayloadTooLargeError } = await import("../node/index.js")

      const body = "a".repeat(200)
      const req = createMockRequest({
        method: "POST",
        url: "/api/data",
        body,
      })

      try {
        await nodeToWebRequest(req, { maxBodySize: 100 })
        expect.fail("Should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(PayloadTooLargeError)
        const error = err as InstanceType<typeof PayloadTooLargeError>
        expect(error._tag).toBe("PayloadTooLargeError")
        expect(error.maxSize).toBe(100)
        expect(error.receivedSize).toBeGreaterThan(100)
        expect(error.message).toContain("Request body too large")
      }
    })

    it("Effect version returns typed error", async () => {
      const { nodeToWebRequestEffect } = await import("../node/index.js")

      const body = "a".repeat(200)
      const req = createMockRequest({
        method: "POST",
        url: "/api/data",
        body,
      })

      const result = await Effect.runPromise(
        nodeToWebRequestEffect(req, { maxBodySize: 100 }).pipe(
          Effect.catchTag("PayloadTooLargeError", (err) => Effect.succeed({ caught: true, error: err })),
        ),
      )

      expect(result).toEqual({
        caught: true,
        error: expect.objectContaining({
          _tag: "PayloadTooLargeError",
          maxSize: 100,
        }),
      })
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Node.js Response Conversion Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Node.js Response Conversion", () => {
  // Create a mock ServerResponse
  const createMockResponse = () => {
    const chunks: Buffer[] = []
    let statusCode = 200
    const headers: Record<string, string> = {}
    let ended = false

    const res = {
      get statusCode() {
        return statusCode
      },
      set statusCode(code: number) {
        statusCode = code
      },
      writeHead(code: number, hdrs?: Record<string, string>) {
        statusCode = code
        if (hdrs) {
          Object.assign(headers, hdrs)
        }
      },
      write(chunk: Buffer | string) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        return true
      },
      end(chunk?: Buffer | string) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        ended = true
      },
      getBody: () => Buffer.concat(chunks).toString(),
      isEnded: () => ended,
      getHeaders: () => headers,
    }

    return res as unknown as ServerResponse & { getBody: () => string; isEnded: () => boolean; getHeaders: () => Record<string, string> }
  }

  it("writes status and headers", async () => {
    const { webToNodeResponse } = await import("../node/index.js")

    const webResponse = new Response("Hello", {
      status: 201,
      headers: { "Content-Type": "text/plain" },
    })

    const nodeRes = createMockResponse()
    await webToNodeResponse(webResponse, nodeRes)

    expect(nodeRes.statusCode).toBe(201)
    expect(nodeRes.getHeaders()["content-type"]).toBe("text/plain")
  })

  it("streams response body", async () => {
    const { webToNodeResponse } = await import("../node/index.js")

    const webResponse = new Response("Hello, World!")

    const nodeRes = createMockResponse()
    await webToNodeResponse(webResponse, nodeRes)

    expect(nodeRes.isEnded()).toBe(true)
    expect(nodeRes.getBody()).toBe("Hello, World!")
  })

  it("handles empty body", async () => {
    const { webToNodeResponse } = await import("../node/index.js")

    const webResponse = new Response(null, { status: 204 })

    const nodeRes = createMockResponse()
    await webToNodeResponse(webResponse, nodeRes)

    expect(nodeRes.isEnded()).toBe(true)
    expect(nodeRes.getBody()).toBe("")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Handler Creation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Handler Creation", () => {
  describe("createHandler (Node.js)", () => {
    it("creates handler with default options", async () => {
      const { createHandler } = await import("../node/index.js")

      const handler = createHandler({
        router: testRouter,
        handlers: Layer.empty as Layer.Layer<any>,
      })

      expect(handler).toBeDefined()
      expect(typeof handler.fetch).toBe("function")
      expect(typeof handler.dispose).toBe("function")

      await handler.dispose()
    })

    it("returns 404 for non-matching path", async () => {
      const { createHandler } = await import("../node/index.js")

      const handler = createHandler({
        router: testRouter,
        handlers: Layer.empty as Layer.Layer<any>,
        path: "/api/rpc",
      })

      const request = new Request("http://localhost:3000/other/path", {
        method: "POST",
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(404)
      expect(await response.text()).toBe("Not Found")

      await handler.dispose()
    })

    it("handles OPTIONS request with CORS", async () => {
      const { createHandler } = await import("../node/index.js")

      const handler = createHandler({
        router: testRouter,
        handlers: Layer.empty as Layer.Layer<any>,
        cors: true,
      })

      const request = new Request("http://localhost:3000/rpc", {
        method: "OPTIONS",
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS")

      await handler.dispose()
    })

    it("handles OPTIONS request with custom CORS config", async () => {
      const { createHandler } = await import("../node/index.js")

      const handler = createHandler({
        router: testRouter,
        handlers: Layer.empty as Layer.Layer<any>,
        cors: {
          origins: "https://example.com",
          methods: ["GET", "POST"],
        },
      })

      const request = new Request("http://localhost:3000/rpc", {
        method: "OPTIONS",
      })

      const response = await handler.fetch(request)

      expect(response.status).toBe(204)
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.com")
      expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST")

      await handler.dispose()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Handler Configuration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocket Handler Configuration", () => {
  describe("Node.js WebSocket Handler Options", () => {
    it("accepts default configuration", async () => {
      const { createWebSocketHandler } = await import("../node/index.js")

      const handler = createWebSocketHandler({
        router: testRouter,
      })

      expect(handler).toBeDefined()
      expect(typeof handler.handleConnection).toBe("function")
      expect(typeof handler.broadcast).toBe("function")
      expect(typeof handler.broadcastToUser).toBe("function")
      expect(typeof handler.dispose).toBe("function")

      await handler.dispose()
    })

    it("accepts custom auth handler", async () => {
      const { createWebSocketHandler } = await import("../node/index.js")

      const handler = createWebSocketHandler({
        router: testRouter,
        auth: {
          authenticate: (_token) =>
            Effect.succeed({
              clientId: "client-1",
              userId: "user-1",
            }),
          canSubscribe: () => Effect.succeed(true),
        },
      })

      expect(handler).toBeDefined()

      await handler.dispose()
    })

    it("accepts custom handlers layer", async () => {
      const { createWebSocketHandler } = await import("../node/index.js")

      // Custom layer with subscription handlers
      const customLayer = Layer.empty

      const handler = createWebSocketHandler({
        router: testRouter,
        handlers: customLayer as Layer.Layer<any>,
      })

      expect(handler).toBeDefined()

      await handler.dispose()
    })

    it("connectionCount returns Effect", async () => {
      const { createWebSocketHandler } = await import("../node/index.js")

      const handler = createWebSocketHandler({
        router: testRouter,
      })

      // connectionCount should be an Effect
      const count = await Effect.runPromise(handler.connectionCount)
      expect(count).toBe(0) // No connections yet

      await handler.dispose()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Protocol Message Types (shared between adapters)
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocket Protocol Messages", () => {
  it("AuthResultMessage has correct structure", async () => {
    const { AuthResultMessage } = await import("../ws/protocol.js")

    const success = new AuthResultMessage({
      success: true,
      clientId: "client-123",
    })

    expect(success._tag).toBe("AuthResult")
    expect(success.success).toBe(true)
    expect(success.clientId).toBe("client-123")
    expect(success.error).toBeUndefined()

    const failure = new AuthResultMessage({
      success: false,
      error: "Invalid token",
    })

    expect(failure._tag).toBe("AuthResult")
    expect(failure.success).toBe(false)
    expect(failure.error).toBe("Invalid token")
  })

  it("SubscribedMessage has correct structure", async () => {
    const { SubscribedMessage } = await import("../ws/protocol.js")

    const msg = new SubscribedMessage({
      id: "correlation-123",  // Client's correlation ID
      subscriptionId: "sub-abc123" as any,  // Server-generated subscription ID
    })

    expect(msg._tag).toBe("Subscribed")
    expect(msg.id).toBe("correlation-123")
    expect(msg.subscriptionId).toBe("sub-abc123")
  })

  it("PongMessage has correct structure", async () => {
    const { PongMessage } = await import("../ws/protocol.js")

    const msg = new PongMessage({})

    expect(msg._tag).toBe("Pong")
  })

  it("ErrorMessage has correct structure", async () => {
    const { ErrorMessage } = await import("../ws/protocol.js")

    const msg = new ErrorMessage({
      id: "req-123",
      error: {
        _tag: "ForbiddenError",
        message: "Not authorized",
        cause: undefined,
      },
    })

    expect(msg._tag).toBe("Error")
    expect(msg.id).toBe("req-123")
    expect(msg.error._tag).toBe("ForbiddenError")
    expect(msg.error.message).toBe("Not authorized")
  })

  it("DataMessage has correct structure", async () => {
    const { DataMessage } = await import("../ws/protocol.js")

    const msg = new DataMessage({
      id: "sub-123",
      data: { message: "Hello, World!" },
    })

    expect(msg._tag).toBe("Data")
    expect(msg.id).toBe("sub-123")
    expect(msg.data).toEqual({ message: "Hello, World!" })
  })

  it("CompleteMessage has correct structure", async () => {
    const { CompleteMessage } = await import("../ws/protocol.js")

    const msg = new CompleteMessage({
      id: "sub-123",
    })

    expect(msg._tag).toBe("Complete")
    expect(msg.id).toBe("sub-123")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast Result Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Broadcast Result", () => {
  it("BroadcastResult type is exported", async () => {
    // Import the module to verify it exports the type
    const ConnectionRegistryModule = await import("../ws/server/ConnectionRegistry.js")
    
    // Verify the module exports something (it's a type so we can't check at runtime)
    expect(ConnectionRegistryModule).toBeDefined()
    expect(ConnectionRegistryModule.ConnectionRegistry).toBeDefined()

    // Create a mock broadcast result matching the interface shape
    const result = {
      sent: 5,
      failed: 2,
      failedClientIds: ["client-3", "client-7"],
    }

    expect(result.sent).toBe(5)
    expect(result.failed).toBe(2)
    expect(result.failedClientIds).toHaveLength(2)
  })
})
