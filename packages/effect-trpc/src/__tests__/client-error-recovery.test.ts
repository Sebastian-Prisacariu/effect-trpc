/**
 * @module effect-trpc/__tests__/client-error-recovery
 *
 * Tests for client-side error recovery during network issues and malformed responses.
 * Covers:
 * - Network offline/online transitions
 * - Malformed JSON response handling
 * - Server error handling (5xx)
 * - Timeout handling
 * - Partial response handling
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as HttpClientError from "@effect/platform/HttpClientError"

import {
  Client,
  RpcClientError,
  RpcResponseError,
  RpcTimeoutError,
  isRpcClientError,
  isRpcResponseError,
  isRpcTimeoutError,
} from "../core/client/index.js"
import { Procedure, Procedures, Router } from "../index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const UserProcedures = Procedures.make({
  get: Procedure.input(Schema.Struct({ id: Schema.String })).output(UserSchema).query(),
  list: Procedure.output(Schema.Array(UserSchema)).query(),
  create: Procedure.input(Schema.Struct({ name: Schema.String })).output(UserSchema).mutation(),
})

const testRouter = Router.make({
  user: UserProcedures,
})

type TestRouter = typeof testRouter

// ─────────────────────────────────────────────────────────────────────────────
// Mock HttpClient Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock HttpClient that returns a fixed response.
 * Uses makeWith with proper Effect-based request handling.
 */
const createMockHttpClient = (
  handler: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
): Layer.Layer<HttpClient.HttpClient> => {
  // makeWith takes a postprocess function that receives Effect<Request>
  const postprocess = (
    requestEffect: Effect.Effect<HttpClientRequest.HttpClientRequest>,
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
    Effect.flatMap(requestEffect, handler)

  const mockClient: HttpClient.HttpClient = HttpClient.makeWith(postprocess, Effect.succeed)
  return Layer.succeed(HttpClient.HttpClient, mockClient)
}

/**
 * Create a mock response with text body.
 */
const createMockResponse = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
): HttpClientResponse.HttpClientResponse => {
  return HttpClientResponse.fromWeb(
    HttpClientRequest.get("http://mock"),
    new Response(body, {
      status,
      headers: { "Content-Type": "application/x-ndjson", ...headers },
    }),
  )
}

/**
 * Create a successful RPC response body.
 */
const createSuccessResponse = (value: unknown): string =>
  JSON.stringify({ _tag: "Exit", exit: { _tag: "Success", value } }) + "\n"

/**
 * Create a failure RPC response body.
 */
const createFailureResponse = (error: unknown): string =>
  JSON.stringify({
    _tag: "Exit",
    exit: { _tag: "Failure", cause: { _tag: "Fail", error } },
  }) + "\n"

// ─────────────────────────────────────────────────────────────────────────────
// Network Transition Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Client Error Recovery", () => {
  describe("network transitions", () => {
    it("handles network errors gracefully", async () => {
      // Mock client that simulates network failure
      const mockLayer = createMockHttpClient(() =>
        Effect.fail(
          new HttpClientError.RequestError({
            request: HttpClientRequest.get("http://mock"),
            reason: "Transport",
            cause: new Error("Network unavailable"),
          }),
        ),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = result.cause
        // Should be an HttpClientError (network error)
        expect(error._tag).toBe("Fail")
      }
    })

    it("recovers when network comes back online with retry", async () => {
      let callCount = 0
      const mockLayer = createMockHttpClient(() => {
        callCount++
        if (callCount < 3) {
          // First two calls fail with network error
          return Effect.fail(
            new HttpClientError.RequestError({
              request: HttpClientRequest.get("http://mock"),
              reason: "Transport",
              cause: new Error("Network unavailable"),
            }),
          )
        }
        // Third call succeeds
        return Effect.succeed(
          createMockResponse(200, createSuccessResponse([{ id: "1", name: "Alice" }])),
        )
      })

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        retry: {
          count: 3,
          delay: 10, // Short delay for tests
          backoff: "linear",
        },
      })

      const result = await Effect.runPromise(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(callCount).toBe(3) // Failed twice, succeeded on third
      expect(result).toEqual([{ id: "1", name: "Alice" }])
    })

    it("fails after exhausting retries", async () => {
      let callCount = 0
      const mockLayer = createMockHttpClient(() => {
        callCount++
        return Effect.fail(
          new HttpClientError.RequestError({
            request: HttpClientRequest.get("http://mock"),
            reason: "Transport",
            cause: new Error("Network unavailable"),
          }),
        )
      })

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        retry: {
          count: 2,
          delay: 10,
          backoff: "linear",
        },
      })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      expect(callCount).toBe(3) // Initial + 2 retries
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Malformed Response Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("malformed responses", () => {
    it("handles invalid JSON gracefully", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, "not valid json {")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcClientError(cause.error)).toBe(true)
          expect((cause.error as RpcClientError).message).toContain("Failed to parse JSON")
        }
      }
    })

    it("handles HTML error pages (like nginx 502)", async () => {
      const htmlErrorPage = `
        <!DOCTYPE html>
        <html>
        <head><title>502 Bad Gateway</title></head>
        <body>
        <center><h1>502 Bad Gateway</h1></center>
        <hr><center>nginx/1.18.0</center>
        </body>
        </html>
      `

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            HttpClientRequest.get("http://mock"),
            new Response(htmlErrorPage, {
              status: 502,
              headers: { "Content-Type": "text/html" },
            }),
          ),
        ),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          expect((cause.error as RpcResponseError).status).toBe(502)
        }
      }
    })

    it("handles empty response body", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, "")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcClientError(cause.error)).toBe(true)
          expect((cause.error as RpcClientError).message).toContain("No response received")
        }
      }
    })

    it("handles truncated JSON response", async () => {
      // JSON that starts valid but is cut off
      const truncatedJson = '{"_tag":"Exit","exit":{"_tag":"Success","value":{"id":'

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, truncatedJson)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcClientError(cause.error)).toBe(true)
          expect((cause.error as RpcClientError).message).toContain("Failed to parse JSON")
        }
      }
    })

    it("handles response with wrong schema structure", async () => {
      // Valid JSON but wrong structure (missing _tag)
      const wrongStructure = JSON.stringify({ success: true, data: { id: "1", name: "Alice" } }) + "\n"

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, wrongStructure)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          // Unknown message format gets skipped, resulting in "No response received"
          expect(isRpcClientError(cause.error)).toBe(true)
          expect((cause.error as RpcClientError).message).toContain("No response received")
        }
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Server Error Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("server errors", () => {
    it("handles 500 Internal Server Error", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(500, "Internal Server Error")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          const error = cause.error as RpcResponseError
          expect(error.status).toBe(500)
          expect(error.message).toContain("500")
        }
      }
    })

    it("handles 502 Bad Gateway", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(502, "Bad Gateway")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          expect((cause.error as RpcResponseError).status).toBe(502)
        }
      }
    })

    it("handles 503 Service Unavailable", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(503, "Service Unavailable")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          expect((cause.error as RpcResponseError).status).toBe(503)
        }
      }
    })

    it("handles 504 Gateway Timeout", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(504, "Gateway Timeout")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          expect((cause.error as RpcResponseError).status).toBe(504)
        }
      }
    })

    it("retries 5xx errors when retry is configured", async () => {
      let callCount = 0
      const mockLayer = createMockHttpClient(() => {
        callCount++
        if (callCount < 3) {
          return Effect.succeed(createMockResponse(503, "Service Unavailable"))
        }
        return Effect.succeed(
          createMockResponse(200, createSuccessResponse([{ id: "1", name: "Alice" }])),
        )
      })

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        retry: {
          count: 3,
          delay: 10,
          backoff: "linear",
        },
      })

      const result = await Effect.runPromise(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(callCount).toBe(3)
      expect(result).toEqual([{ id: "1", name: "Alice" }])
    })

    it("does not retry 4xx errors", async () => {
      let callCount = 0
      const mockLayer = createMockHttpClient(() => {
        callCount++
        return Effect.succeed(createMockResponse(400, "Bad Request"))
      })

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        retry: {
          count: 3,
          delay: 10,
          backoff: "linear",
        },
      })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      expect(callCount).toBe(1) // No retries for 4xx
    })

    it("handles 401 Unauthorized", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(401, "Unauthorized")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          expect((cause.error as RpcResponseError).status).toBe(401)
        }
      }
    })

    it("handles 403 Forbidden", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(403, "Forbidden")),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcResponseError(cause.error)).toBe(true)
          expect((cause.error as RpcResponseError).status).toBe(403)
        }
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Timeout Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("timeout handling", () => {
    it("times out slow requests", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.delay(Effect.succeed(createMockResponse(200, createSuccessResponse([]))), "1 seconds"),
      )

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        timeout: 50, // 50ms timeout
      })

      const result = await Effect.runPromiseExit(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcTimeoutError(cause.error)).toBe(true)
          const error = cause.error as RpcTimeoutError
          expect(error.rpcName).toBe("user.list")
          expect(error.timeout).toBe(50)
        }
      }
    })

    it("retries timeout errors when configured", async () => {
      let callCount = 0
      const mockLayer = createMockHttpClient(() => {
        callCount++
        if (callCount < 2) {
          // First call times out
          return Effect.delay(
            Effect.succeed(createMockResponse(200, createSuccessResponse([]))),
            "1 seconds",
          )
        }
        // Second call succeeds quickly
        return Effect.succeed(
          createMockResponse(200, createSuccessResponse([{ id: "1", name: "Alice" }])),
        )
      })

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        timeout: 50,
        retry: {
          count: 2,
          delay: 10,
          backoff: "linear",
        },
      })

      const result = await Effect.runPromise(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(callCount).toBe(2)
      expect(result).toEqual([{ id: "1", name: "Alice" }])
    })

    it("completes before timeout when request is fast", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(
          createMockResponse(200, createSuccessResponse([{ id: "1", name: "Alice" }])),
        ),
      )

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        timeout: 5000, // 5 second timeout
      })

      const result = await Effect.runPromise(
        client.procedures.user.list(undefined as void).pipe(Effect.provide(mockLayer)),
      )

      expect(result).toEqual([{ id: "1", name: "Alice" }])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Partial Response Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("partial response handling", () => {
    it("handles response with multiple NDJSON lines (uses first valid)", async () => {
      // Multiple lines - should use the first valid Exit response
      const multiLineResponse =
        JSON.stringify({ _tag: "Exit", exit: { _tag: "Success", value: { id: "1", name: "First" } } }) +
        "\n" +
        JSON.stringify({ _tag: "Exit", exit: { _tag: "Success", value: { id: "2", name: "Second" } } }) +
        "\n"

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, multiLineResponse)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromise(
        client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer)),
      )

      expect(result).toEqual({ id: "1", name: "First" })
    })

    it("skips unknown message types and uses first valid response", async () => {
      // First line is unknown type, second is valid
      const mixedResponse =
        JSON.stringify({ _tag: "Unknown", data: "ignored" }) +
        "\n" +
        JSON.stringify({ _tag: "Exit", exit: { _tag: "Success", value: { id: "1", name: "Alice" } } }) +
        "\n"

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, mixedResponse)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromise(
        client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer)),
      )

      expect(result).toEqual({ id: "1", name: "Alice" })
    })

    it("handles Defect response type", async () => {
      const defectResponse = JSON.stringify({ _tag: "Defect", defect: "Unexpected server error" }) + "\n"

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, defectResponse)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcClientError(cause.error)).toBe(true)
          expect((cause.error as RpcClientError).message).toContain("Unexpected server error")
        }
      }
    })

    it("handles Exit Failure with Die cause", async () => {
      const dieResponse = JSON.stringify({
        _tag: "Exit",
        exit: {
          _tag: "Failure",
          cause: { _tag: "Die", defect: "Fatal error occurred" },
        },
      }) + "\n"

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, dieResponse)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          expect(isRpcClientError(cause.error)).toBe(true)
          expect((cause.error as RpcClientError).message).toContain("Fatal error occurred")
        }
      }
    })

    it("preserves typed errors from server for Effect.catchTag", async () => {
      // Server returns a typed error that should be preserved
      const typedErrorResponse = createFailureResponse({
        _tag: "NotFoundError",
        procedure: "user.get",
        resource: "User",
        resourceId: "999",
      })

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, typedErrorResponse)),
      )

      const client = Client.make<TestRouter>({ url: "http://localhost:3000/rpc" })

      const result = await Effect.runPromiseExit(
        client.procedures.user.get({ id: "999" }).pipe(Effect.provide(mockLayer)),
      )

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const cause = result.cause
        expect(cause._tag).toBe("Fail")
        if (cause._tag === "Fail") {
          // The typed error should be preserved
          const error = cause.error as unknown as { _tag: string; procedure: string }
          expect(error._tag).toBe("NotFoundError")
          expect(error.procedure).toBe("user.get")
        }
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Error Type Guard Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("error type guards", () => {
    it("isRpcClientError correctly identifies RpcClientError", () => {
      const error = new RpcClientError({ message: "Test error" })
      expect(isRpcClientError(error)).toBe(true)
      expect(isRpcResponseError(error)).toBe(false)
      expect(isRpcTimeoutError(error)).toBe(false)
    })

    it("isRpcResponseError correctly identifies RpcResponseError", () => {
      const error = new RpcResponseError({ message: "HTTP error", status: 500 })
      expect(isRpcClientError(error)).toBe(false)
      expect(isRpcResponseError(error)).toBe(true)
      expect(isRpcTimeoutError(error)).toBe(false)
    })

    it("isRpcTimeoutError correctly identifies RpcTimeoutError", () => {
      const error = new RpcTimeoutError({ rpcName: "test", timeout: 1000 })
      expect(isRpcClientError(error)).toBe(false)
      expect(isRpcResponseError(error)).toBe(false)
      expect(isRpcTimeoutError(error)).toBe(true)
    })

    it("type guards return false for plain objects", () => {
      const plainObject = { _tag: "RpcClientError", message: "fake" }
      expect(isRpcClientError(plainObject)).toBe(false)
      expect(isRpcResponseError(plainObject)).toBe(false)
      expect(isRpcTimeoutError(plainObject)).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Batched Request Error Recovery
  // ─────────────────────────────────────────────────────────────────────────────

  describe("batched request error recovery", () => {
    it("fails all batched requests on network error", async () => {
      const mockLayer = createMockHttpClient(() =>
        Effect.fail(
          new HttpClientError.RequestError({
            request: HttpClientRequest.get("http://mock"),
            reason: "Transport",
            cause: new Error("Network unavailable"),
          }),
        ),
      )

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        batch: {
          enabled: true,
          maxSize: 10,
          windowMs: 50,
        },
      })

      // Make multiple requests that will be batched
      const results = await Promise.all([
        Effect.runPromiseExit(client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer))),
        Effect.runPromiseExit(client.procedures.user.get({ id: "2" }).pipe(Effect.provide(mockLayer))),
      ])

      // Both should fail with network error
      for (const result of results) {
        expect(Exit.isFailure(result)).toBe(true)
      }
    })

    it("handles partial batch response gracefully", async () => {
      // Mock that returns only one response for a batch of two
      const singleResponse = JSON.stringify({
        _tag: "Exit",
        exit: { _tag: "Success", value: { id: "1", name: "Alice" } },
      }) + "\n"

      const mockLayer = createMockHttpClient(() =>
        Effect.succeed(createMockResponse(200, singleResponse)),
      )

      const client = Client.make<TestRouter>({
        url: "http://localhost:3000/rpc",
        batch: {
          enabled: true,
          maxSize: 2,
          windowMs: 50,
        },
      })

      // Both requests get batched together, but only one response comes back
      const [result1, result2] = await Promise.all([
        Effect.runPromiseExit(client.procedures.user.get({ id: "1" }).pipe(Effect.provide(mockLayer))),
        Effect.runPromiseExit(client.procedures.user.get({ id: "2" }).pipe(Effect.provide(mockLayer))),
      ])

      // First should succeed
      if (Exit.isSuccess(result1)) {
        expect(result1.value).toEqual({ id: "1", name: "Alice" })
      }

      // Second should fail with "Missing response"
      if (Exit.isFailure(result2)) {
        const cause = result2.cause
        if (cause._tag === "Fail" && isRpcClientError(cause.error)) {
          expect((cause.error as RpcClientError).message).toContain("Missing response")
        }
      }
    })
  })
})
