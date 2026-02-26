/**
 * @module effect-trpc/tests/ws-integration
 *
 * Integration tests for WebSocket subscriptions.
 * Uses actual WebSocket connections to test end-to-end flow.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { WebSocketServer, WebSocket } from "ws"

import { Procedure } from "../core/index.js"
import { Procedures } from "../core/index.js"
import { Router } from "../core/server/router.js"
import { createWebSocketHandler } from "../node/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Router with Subscription Procedures
// ─────────────────────────────────────────────────────────────────────────────

// Counter subscription - emits numbers at interval
const CounterInput = Schema.Struct({
  start: Schema.Number,
  count: Schema.Number,
})

const CounterOutput = Schema.Struct({
  value: Schema.Number,
  timestamp: Schema.Number,
})

// Chat message types
const ChatInput = Schema.Struct({
  roomId: Schema.String,
})

const ChatMessage = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  userId: Schema.String,
  timestamp: Schema.Number,
})

// Define procedures
const testProcedures = Procedures.make({
  counter: Procedure
    .input(CounterInput)
    .output(CounterOutput)
    .subscription(),

  chat: Procedure
    .input(ChatInput)
    .output(ChatMessage)
    .subscription(),

  echo: Procedure
    .input(Schema.String)
    .output(Schema.String)
    .subscription(),
})

const testRouter = Router.make({
  test: testProcedures,
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let wss: WebSocketServer
let wsHandler: ReturnType<typeof createWebSocketHandler>
let port: number

beforeAll(async () => {
  // Find available port
  port = 4500 + Math.floor(Math.random() * 500)

  // Create WebSocket handler
  wsHandler = createWebSocketHandler({
    router: testRouter,
    // Use test auth - accepts any token as userId
  })

  // Create WebSocket server and wait for it to be listening
  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port }, () => resolve())
  })

  wss.on("connection", (ws) => {
    Effect.runFork(wsHandler.handleConnection(ws))
  })
})

afterAll(async () => {
  await wsHandler.dispose()
  wss.close()
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function createClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    ws.on("open", () => resolve(ws))
    ws.on("error", reject)
  })
}

function sendMessage(ws: WebSocket, message: object): void {
  ws.send(JSON.stringify(message))
}

function waitForMessage(ws: WebSocket, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout")), timeout)

    ws.once("message", (data: Buffer) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
  })
}

/**
 * Wait for a condition to become true, polling at intervals.
 * Much more reliable than fixed delays.
 */
async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  { timeout = 5000, interval = 10 } = {},
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) return
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Wait for connection count to reach expected value.
 */
async function waitForConnectionCount(expected: number, timeout = 5000): Promise<void> {
  await waitForCondition(
    async () => {
      const count = await Effect.runPromise(wsHandler.connectionCount)
      return count === expected
    },
    { timeout },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocket Integration", () => {
  describe("Connection", () => {
    it("connects and authenticates successfully", async () => {
      const ws = await createClient()

      // Send auth message
      sendMessage(ws, { _tag: "Auth", token: "test-user-123" })

      // Wait for auth result
      const result = await waitForMessage(ws)

      expect(result._tag).toBe("AuthResult")
      expect(result.success).toBe(true)
      expect(result.clientId).toBeDefined()

      ws.close()
    })

    it("rejects unauthenticated subscribe attempts", async () => {
      const ws = await createClient()

      // Try to subscribe without auth
      sendMessage(ws, {
        _tag: "Subscribe",
        id: "sub-1",
        path: "test.counter",
        input: { start: 0, count: 5 },
      })

      // Should get auth error
      const result = await waitForMessage(ws)

      expect(result._tag).toBe("AuthResult")
      expect(result.success).toBe(false)
      expect(result.error).toContain("Not authenticated")

      ws.close()
    })

    it("responds to ping with pong", async () => {
      const ws = await createClient()

      // Authenticate first
      sendMessage(ws, { _tag: "Auth", token: "test-user" })
      await waitForMessage(ws) // Auth result

      // Send ping
      sendMessage(ws, { _tag: "Ping" })

      // Should get pong
      const result = await waitForMessage(ws)

      expect(result._tag).toBe("Pong")

      ws.close()
    })
  })

  describe("Subscriptions", () => {
    it("subscribes and receives Subscribed confirmation", async () => {
      const ws = await createClient()

      // Authenticate
      sendMessage(ws, { _tag: "Auth", token: "test-user" })
      await waitForMessage(ws)

      // Subscribe
      sendMessage(ws, {
        _tag: "Subscribe",
        id: "sub-counter-1",
        path: "test.counter",
        input: { start: 0, count: 3 },
      })

      // Should get Subscribed confirmation
      const result = await waitForMessage(ws)

      expect(result._tag).toBe("Subscribed")
      expect(result.id).toBe("sub-counter-1")

      ws.close()
    })

    it("can unsubscribe from active subscription", async () => {
      const ws = await createClient()

      // Authenticate
      sendMessage(ws, { _tag: "Auth", token: "test-user" })
      await waitForMessage(ws)

      // Subscribe
      sendMessage(ws, {
        _tag: "Subscribe",
        id: "sub-to-unsub",
        path: "test.echo",
        input: "test",
      })

      await waitForMessage(ws) // Subscribed

      // Unsubscribe
      sendMessage(ws, {
        _tag: "Unsubscribe",
        id: "sub-to-unsub",
      })

      // Connection should still work - ping/pong verifies server is responsive
      sendMessage(ws, { _tag: "Ping" })
      const pong = await waitForMessage(ws)
      expect(pong._tag).toBe("Pong")

      ws.close()
    })
  })

  describe("Multiple Connections", () => {
    it("handles multiple simultaneous connections", async () => {
      const clients = await Promise.all([
        createClient(),
        createClient(),
        createClient(),
      ])

      // Authenticate all and wait for results
      const authPromises = clients.map(async (ws) => {
        sendMessage(ws, { _tag: "Auth", token: `user-${Math.random()}` })
        return waitForMessage(ws)
      })

      const results = await Promise.all(authPromises)

      // All should succeed
      for (const result of results) {
        expect(result._tag).toBe("AuthResult")
        expect(result.success).toBe(true)
      }

      // Wait for connection count to reach 3
      await waitForConnectionCount(3)

      // Connection count should be 3
      const count = await Effect.runPromise(wsHandler.connectionCount)
      expect(count).toBe(3)

      // Clean up
      for (const ws of clients) {
        ws.close()
      }

      // Wait for connection count to reach 0
      await waitForConnectionCount(0)

      // Connection count should be 0
      const countAfter = await Effect.runPromise(wsHandler.connectionCount)
      expect(countAfter).toBe(0)
    })
  })

  describe("Protocol Edge Cases", () => {
    it("handles invalid JSON gracefully", async () => {
      const ws = await createClient()

      // Send invalid JSON
      ws.send("not valid json {{{")

      // Should receive error message about parse failure
      const errorMsg = await waitForMessage(ws)
      expect(errorMsg._tag).toBe("Error")
      expect(errorMsg.id).toBe("parse-error")
      expect(errorMsg.error._tag).toBe("ParseError")

      // Should not crash - send valid message after
      sendMessage(ws, { _tag: "Auth", token: "test" })
      const result = await waitForMessage(ws)

      expect(result._tag).toBe("AuthResult")
      expect(result.success).toBe(true)

      ws.close()
    })

    it("handles unknown message types gracefully", async () => {
      const ws = await createClient()

      // Authenticate first
      sendMessage(ws, { _tag: "Auth", token: "test" })
      await waitForMessage(ws)

      // Send unknown message type
      sendMessage(ws, { _tag: "UnknownType", data: "test" })

      // Should receive error message about parse failure
      const errorMsg = await waitForMessage(ws)
      expect(errorMsg._tag).toBe("Error")
      expect(errorMsg.id).toBe("parse-error")
      expect(errorMsg.error._tag).toBe("ParseError")

      // Should not crash - ping still works
      sendMessage(ws, { _tag: "Ping" })
      const pong = await waitForMessage(ws)

      expect(pong._tag).toBe("Pong")

      ws.close()
    })

    it("handles connection close during subscription", async () => {
      // Wait for any previous test connections to clean up
      await waitForConnectionCount(0)

      const ws = await createClient()

      // Authenticate
      sendMessage(ws, { _tag: "Auth", token: "test" })
      await waitForMessage(ws)

      // Subscribe
      sendMessage(ws, {
        _tag: "Subscribe",
        id: "sub-close-test",
        path: "test.counter",
        input: { start: 0, count: 100 },
      })

      await waitForMessage(ws) // Subscribed

      // Close abruptly
      ws.terminate()

      // Wait for server to clean up the connection
      await waitForConnectionCount(0)

      // Should not throw - server should handle cleanup
      const count = await Effect.runPromise(wsHandler.connectionCount)
      expect(count).toBe(0)
    })
  })
})
