/**
 * Batching Tests
 * 
 * Tests for request batching functionality.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, Schema, Duration, Chunk, Queue, Stream } from "effect"

import { Procedure, Router, Server, Transport } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

// =============================================================================
// Test Router & Server
// =============================================================================

const testRouter = Router.make("@api", {
  users: {
    list: Procedure.query({ success: Schema.Array(User) }),
    get: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
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
      Effect.succeed(testUsers.find(u => u.id === id) ?? testUsers[0]),
  },
  health: () => Effect.succeed("OK"),
}

const server = Server.make(testRouter, handlers)

// =============================================================================
// BatchRequest/BatchResponse Tests
// =============================================================================

describe("Batching types", () => {
  it("BatchRequest schema encodes correctly", () => {
    const request = new Transport.Batching.BatchRequest({
      batch: [
        { id: "1", tag: "@api/health", payload: undefined },
        { id: "2", tag: "@api/users/list", payload: undefined },
      ],
    })
    
    expect(request.batch).toHaveLength(2)
    expect(request.batch[0].tag).toBe("@api/health")
  })

  it("isBatchRequest detects batch requests", () => {
    expect(Transport.Batching.isBatchRequest({
      batch: [{ id: "1", tag: "@api/health", payload: undefined }],
    })).toBe(true)
    
    expect(Transport.Batching.isBatchRequest({
      id: "1",
      tag: "@api/health",
      payload: undefined,
    })).toBe(false)
    
    expect(Transport.Batching.isBatchRequest(null)).toBe(false)
    expect(Transport.Batching.isBatchRequest(undefined)).toBe(false)
  })
})

// =============================================================================
// Server Batch Handling Tests
// =============================================================================

describe("Server batch handling", () => {
  const httpHandler = Server.toHttpHandler(server)

  effectIt.effect("handles batch request", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          batch: [
            { id: "req-1", tag: "@api/health", payload: undefined },
            { id: "req-2", tag: "@api/users/list", payload: undefined },
          ],
        }),
        headers: {},
      }

      const response = yield* httpHandler(request)

      expect(response.status).toBe(200)
      
      const body = JSON.parse(response.body)
      expect(body.batch).toBeDefined()
      expect(body.batch).toHaveLength(2)
      
      // First response should be health
      expect(body.batch[0].id).toBe("req-1")
      expect(body.batch[0].value).toBe("OK")
      
      // Second response should be users list
      expect(body.batch[1].id).toBe("req-2")
      expect(body.batch[1].value).toHaveLength(2)
    })
  )

  effectIt.effect("batch requests preserve order", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          batch: [
            { id: "a", tag: "@api/users/get", payload: { id: "1" } },
            { id: "b", tag: "@api/health", payload: undefined },
            { id: "c", tag: "@api/users/get", payload: { id: "2" } },
          ],
        }),
        headers: {},
      }

      const response = yield* httpHandler(request)
      const body = JSON.parse(response.body)
      
      expect(body.batch[0].id).toBe("a")
      expect(body.batch[1].id).toBe("b")
      expect(body.batch[2].id).toBe("c")
    })
  )

  effectIt.effect("single request still works", () =>
    Effect.gen(function* () {
      const request = {
        json: () => Promise.resolve({
          id: "single-1",
          tag: "@api/health",
          payload: undefined,
        }),
        headers: {},
      }

      const response = yield* httpHandler(request)
      const body = JSON.parse(response.body)
      
      // Should be a single response, not a batch
      expect(body.batch).toBeUndefined()
      expect(body.id).toBe("single-1")
      expect(body.value).toBe("OK")
    })
  )
})

// =============================================================================
// handleBatch Function Tests
// =============================================================================

describe("handleBatch", () => {
  effectIt.effect("processes all requests in parallel", () =>
    Effect.gen(function* () {
      const batchRequest = new Transport.Batching.BatchRequest({
        batch: [
          { id: "1", tag: "@api/health", payload: undefined },
          { id: "2", tag: "@api/users/list", payload: undefined },
          { id: "3", tag: "@api/users/get", payload: { id: "1" } },
        ],
      })

      const response = yield* Transport.Batching.handleBatch(server.handle)(batchRequest)

      expect(response.batch).toHaveLength(3)
      
      // All should be Success
      for (const r of response.batch) {
        expect(r._tag).toBe("Success")
      }
    })
  )
})
