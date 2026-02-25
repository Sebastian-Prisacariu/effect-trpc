/**
 * @module effect-trpc/__tests__/integration
 *
 * Integration tests for effect-trpc with actual HTTP server.
 * Tests the full flow from client to server using the public API.
 *
 * These tests use the same patterns that users would use:
 * - procedures.toLayer() for creating handler implementations
 * - createHandler() from effect-trpc/node for server setup
 * - createClient() for making requests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "@effect/platform/HttpClient"
import { NodeHttpClient } from "@effect/platform-node"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"

import { procedure, procedures, Router } from "../index.js"
import { Client } from "../core/client.js"
import { createHandler, nodeToWebRequest, webToNodeResponse } from "../node/index.js"

// HttpClient layer for running client effects
const HttpClientLive = NodeHttpClient.layer

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Schemas
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
})

type User = typeof UserSchema.Type

const CreateUserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Procedures (same as users would define)
// ─────────────────────────────────────────────────────────────────────────────

const UserProcedures = procedures("user", {
  list: procedure.output(Schema.Array(UserSchema)).query(),

  byId: procedure
    .input(Schema.Struct({ id: Schema.String }))
    .output(Schema.Union(UserSchema, Schema.Null))
    .query(),

  create: procedure
    .input(CreateUserSchema)
    .output(UserSchema)
    .invalidates(["user.list"])
    .mutation(),
})

const appRouter = Router.make({
  user: UserProcedures,
})

type AppRouter = typeof appRouter

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures - Mock Implementation Layer
// ─────────────────────────────────────────────────────────────────────────────

// In-memory store (simulating a database)
let userStore: User[] = []
let nextId = 1

/**
 * Create mock handlers using the public toLayer() API.
 * This is exactly how users would implement their handlers.
 */
const createMockUserHandlers = () =>
  UserProcedures.toLayer({
    list: (_ctx) => Effect.succeed(userStore),

    byId: (_ctx, { id }) =>
      Effect.succeed(userStore.find((u) => u.id === id) ?? null),

    create: (_ctx, { name, email }) =>
      Effect.sync(() => {
        const user: User = { id: String(nextId++), name, email }
        userStore.push(user)
        return user
      }),
  })

// ─────────────────────────────────────────────────────────────────────────────
// Test Server Setup
// ─────────────────────────────────────────────────────────────────────────────

let serverUrl: string
let httpServer: Server
let disposeHandler: () => Promise<void>

describe("Integration Tests", () => {
  beforeAll(async () => {
    // Reset store
    userStore = []
    nextId = 1

    // Create handlers layer using the public API
    const UserHandlersLive = createMockUserHandlers()

    // Create the fetch handler using effect-trpc/node
    const handler = createHandler({
      router: appRouter,
      handlers: UserHandlersLive,
      path: "/rpc",
      spanPrefix: "@test",
    })

    disposeHandler = handler.dispose

    // Create HTTP server using node:http
    httpServer = createServer((req, res) => {
      void (async () => {
        try {
          const request = await nodeToWebRequest(req)
          const response = await handler.fetch(request)
          await webToNodeResponse(response, res)
        } catch (error) {
          console.error("Handler error:", error)
          res.writeHead(500)
          res.end("Internal Server Error")
        }
      })()
    })

    // Start server with OS-assigned port (port 0)
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address() as AddressInfo
        const port = address.port
        serverUrl = `http://localhost:${port}/rpc`
        console.log(`Test server running on port ${port}`)
        resolve()
      })
    })
  })

  afterAll(async () => {
    if (disposeHandler) {
      await disposeHandler()
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Client Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Vanilla Client", () => {
    const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
      Effect.runPromise(Effect.provide(effect, HttpClientLive))

    it("should create a user and list users", async () => {
      const client = Client.make<AppRouter>({ url: serverUrl })

      // Create a user
      const created = await run(
        client.procedures.user.create({ name: "Alice", email: "alice@example.com" }),
      )

      expect(created).toEqual({
        id: "1",
        name: "Alice",
        email: "alice@example.com",
      })

      // List users
      const users = await run(client.procedures.user.list(undefined as void))

      expect(users).toHaveLength(1)
      expect(users[0]).toEqual({
        id: "1",
        name: "Alice",
        email: "alice@example.com",
      })
    })

    it("should get a user by ID", async () => {
      const client = Client.make<AppRouter>({ url: serverUrl })

      const user = await run(client.procedures.user.byId({ id: "1" }))

      expect(user).toEqual({
        id: "1",
        name: "Alice",
        email: "alice@example.com",
      })
    })

    it("should return null for non-existent user", async () => {
      const client = Client.make<AppRouter>({ url: serverUrl })

      const user = await run(client.procedures.user.byId({ id: "999" }))

      expect(user).toBeNull()
    })

    it("should create multiple users", async () => {
      const client = Client.make<AppRouter>({ url: serverUrl })

      const bob = await run(
        client.procedures.user.create({ name: "Bob", email: "bob@example.com" }),
      )

      expect(bob.name).toBe("Bob")

      const users = await run(client.procedures.user.list(undefined as void))

      expect(users.length).toBeGreaterThanOrEqual(2)
      expect(users.some((u) => u.name === "Alice")).toBe(true)
      expect(users.some((u) => u.name === "Bob")).toBe(true)
    })
  })

  describe("Error Handling", () => {
    it("should handle HTTP errors gracefully", async () => {
      const client = Client.make<AppRouter>({
        url: "http://localhost:1/nonexistent",
      })

      await expect(
        Effect.runPromise(
          Effect.provide(
            client.procedures.user.list(undefined as void),
            HttpClientLive,
          ),
        ),
      ).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Batching Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Request Batching", () => {
    const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
      Effect.runPromise(Effect.provide(effect, HttpClientLive))

    it("should batch multiple requests together", async () => {
      const client = Client.make<AppRouter>({
        url: serverUrl,
        batch: {
          enabled: true,
          maxSize: 10,
          windowMs: 50, // 50ms window to collect requests
        },
      })

      // Make multiple requests in parallel - they should be batched
      const [user1, _user2, users] = await Promise.all([
        run(client.procedures.user.byId({ id: "1" })),
        run(client.procedures.user.byId({ id: "2" })),
        run(client.procedures.user.list(undefined as void)),
      ])

      // Verify results are correct
      expect(user1).toEqual({
        id: "1",
        name: "Alice",
        email: "alice@example.com",
      })
      // _user2 might be null or Bob depending on test order
      expect(users).toBeInstanceOf(Array)
    })

    it("should work with a single batched request", async () => {
      const client = Client.make<AppRouter>({
        url: serverUrl,
        batch: {
          enabled: true,
          maxSize: 10,
          windowMs: 10,
        },
      })

      const users = await run(client.procedures.user.list(undefined as void))

      expect(users).toBeInstanceOf(Array)
      expect(users.length).toBeGreaterThanOrEqual(1)
    })

    it("should flush batch immediately when maxSize is reached", async () => {
      const client = Client.make<AppRouter>({
        url: serverUrl,
        batch: {
          enabled: true,
          maxSize: 2, // Small batch size - will flush after 2 requests
          windowMs: 5000, // Long window - won't be reached
        },
      })

      // Make 2 requests - should trigger immediate flush
      const start = Date.now()
      const [user1, _user2] = await Promise.all([
        run(client.procedures.user.byId({ id: "1" })),
        run(client.procedures.user.byId({ id: "2" })),
      ])
      const elapsed = Date.now() - start

      // Should complete quickly (not waiting for 5s window)
      expect(elapsed).toBeLessThan(1000)
      expect(user1).toBeDefined()
    })

    it("should handle mutations in batches", async () => {
      const client = Client.make<AppRouter>({
        url: serverUrl,
        batch: {
          enabled: true,
          maxSize: 10,
          windowMs: 50,
        },
      })

      // Create users in parallel
      const [charlie, diana] = await Promise.all([
        run(client.procedures.user.create({ name: "Charlie", email: "charlie@example.com" })),
        run(client.procedures.user.create({ name: "Diana", email: "diana@example.com" })),
      ])

      expect(charlie.name).toBe("Charlie")
      expect(diana.name).toBe("Diana")
    })
  })
})
