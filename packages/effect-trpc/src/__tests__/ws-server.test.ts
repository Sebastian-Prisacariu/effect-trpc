/**
 * @module effect-trpc/tests/ws-server
 *
 * Tests for WebSocket server services.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as DateTime from "effect/DateTime"

import {
  WebSocketCodec,
  WebSocketCodecLive,
  WebSocketAuth,
  WebSocketAuthTest,
  makeWebSocketAuth,
  ConnectionRegistry,
  ConnectionRegistryLive,
  SubscriptionManager,
  SubscriptionManagerLive,
  type Connection,
  type RegisteredHandler,
} from "../ws/server/index.js"

/**
 * Helper to cast Effect to runnable form for tests.
 */
 
const asRunnable = <A, E>(effect: any): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>
import {
  DataMessage,
  PongMessage,
} from "../ws/protocol.js"
import type { ClientId, SubscriptionId } from "../ws/types.js"
import { WebSocketAuthError, ConnectionLimitExceededError } from "../ws/errors.js"
import { layer as connectionRegistryLayer } from "../ws/server/ConnectionRegistry.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Layers
// ─────────────────────────────────────────────────────────────────────────────

// SubscriptionManagerLive depends on ConnectionRegistry, so we provide it
const TestLayers = Layer.mergeAll(
  WebSocketCodecLive,
  WebSocketAuthTest,
  ConnectionRegistryLive,
  SubscriptionManagerLive.pipe(Layer.provide(ConnectionRegistryLive)),
)

// ─────────────────────────────────────────────────────────────────────────────
// Test: WebSocketCodec
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocketCodec", () => {
  it("decodes valid client messages", async () => {
    const program = Effect.gen(function* () {
      const codec = yield* WebSocketCodec

      const authMsg = yield* codec.decode(JSON.stringify({ _tag: "Auth", token: "test-token" }))
      expect(authMsg._tag).toBe("Auth")
      if (authMsg._tag === "Auth") {
        expect(authMsg.token).toBe("test-token")
      }

      const subMsg = yield* codec.decode(
        JSON.stringify({ _tag: "Subscribe", id: "sub-1", path: "test.path", input: { foo: "bar" } }),
      )
      expect(subMsg._tag).toBe("Subscribe")

      const pingMsg = yield* codec.decode(JSON.stringify({ _tag: "Ping" }))
      expect(pingMsg._tag).toBe("Ping")
    })

    await Effect.runPromise(program.pipe(Effect.provide(WebSocketCodecLive)))
  })

  it("encodes server messages", async () => {
    const program = Effect.gen(function* () {
      const codec = yield* WebSocketCodec

      const dataJson = yield* codec.encode(new DataMessage({ id: "sub-1", data: { count: 42 } }))
      expect(typeof dataJson).toBe("string")
      const parsed = JSON.parse(dataJson as string)
      expect(parsed._tag).toBe("Data")
      expect(parsed.id).toBe("sub-1")
      expect(parsed.data).toEqual({ count: 42 })

      const pongJson = yield* codec.encode(new PongMessage({}))
      const parsedPong = JSON.parse(pongJson as string)
      expect(parsedPong._tag).toBe("Pong")
    })

    await Effect.runPromise(program.pipe(Effect.provide(WebSocketCodecLive)))
  })

  it("fails on invalid JSON", async () => {
    const program = Effect.gen(function* () {
      const codec = yield* WebSocketCodec
      yield* codec.decode("not valid json")
    })

    const result = await Effect.runPromiseExit(program.pipe(Effect.provide(WebSocketCodecLive)))
    expect(result._tag).toBe("Failure")
  })

  it("fails on invalid message schema", async () => {
    const program = Effect.gen(function* () {
      const codec = yield* WebSocketCodec
      yield* codec.decode(JSON.stringify({ _tag: "Unknown", foo: "bar" }))
    })

    const result = await Effect.runPromiseExit(program.pipe(Effect.provide(WebSocketCodecLive)))
    expect(result._tag).toBe("Failure")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: WebSocketAuth
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocketAuth", () => {
  it("test auth accepts any token", async () => {
    const program = Effect.gen(function* () {
      const auth = yield* WebSocketAuth
      const result = yield* auth.authenticate("any-token")

      expect(result.userId).toBe("any-token")
      expect(result.clientId).toBeDefined()
      expect(result.metadata).toEqual({ test: true })
    })

    await Effect.runPromise(program.pipe(Effect.provide(WebSocketAuthTest)))
  })

  it("custom auth validates tokens", async () => {
    const validTokens = new Map([
      ["valid-token", { userId: "user-1", permissions: ["read", "write"] as const }],
    ])

    const CustomAuthLive = makeWebSocketAuth({
      authenticate: (token) =>
        Effect.gen(function* () {
          const user = validTokens.get(token)
          if (!user) {
            return yield* Effect.fail(new WebSocketAuthError({ reason: "InvalidToken" }))
          }
          return { userId: user.userId, permissions: user.permissions }
        }),
    })

    const programValid = Effect.gen(function* () {
      const auth = yield* WebSocketAuth
      const result = yield* auth.authenticate("valid-token")
      expect(result.userId).toBe("user-1")
      expect(result.permissions).toEqual(["read", "write"])
    })

    await Effect.runPromise(programValid.pipe(Effect.provide(CustomAuthLive)))

    const programInvalid = Effect.gen(function* () {
      const auth = yield* WebSocketAuth
      yield* auth.authenticate("invalid-token")
    })

    const result = await Effect.runPromiseExit(programInvalid.pipe(Effect.provide(CustomAuthLive)))
    expect(result._tag).toBe("Failure")
  })

  it("canSubscribe defaults to allowing all", async () => {
    const program = Effect.gen(function* () {
      const auth = yield* WebSocketAuth
      const authResult = yield* auth.authenticate("test")
      const canSub = yield* auth.canSubscribe(authResult, "any.path", { foo: "bar" })
      expect(canSub).toBe(true)
    })

    await Effect.runPromise(program.pipe(Effect.provide(WebSocketAuthTest)))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: ConnectionRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe("ConnectionRegistry", () => {
  it("registers and retrieves connections", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ConnectionRegistry

      // Initially empty
      const count1 = yield* registry.count
      expect(count1).toBe(0)

      // Create mock connection
      const mockConnection: Connection = {
        clientId: "client-1" as ClientId,
        auth: {
          userId: "user-1",
          clientId: "client-1" as ClientId,
          metadata: {},
        },
        connectedAt: DateTime.unsafeNow(),
        send: () => Effect.void,
        close: () => Effect.void,
      }

      // Register
      yield* registry.register(mockConnection)

      // Now has one connection
      const count2 = yield* registry.count
      expect(count2).toBe(1)

      // Can retrieve it
      const conn = yield* registry.get("client-1" as ClientId)
      expect(conn.auth.userId).toBe("user-1")

      // Unregister
      yield* registry.unregister("client-1" as ClientId, "test")

      const count3 = yield* registry.count
      expect(count3).toBe(0)
    })

    await Effect.runPromise(program.pipe(Effect.provide(ConnectionRegistryLive)))
  })

  it("broadcasts messages", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ConnectionRegistry
      const received: string[] = []

      // Create mock connections
      const conn1: Connection = {
        clientId: "client-1" as ClientId,
        auth: { userId: "user-1", clientId: "client-1" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) => Effect.sync(() => { received.push(`client-1:${msg._tag}`) }),
        close: () => Effect.void,
      }

      const conn2: Connection = {
        clientId: "client-2" as ClientId,
        auth: { userId: "user-2", clientId: "client-2" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) => Effect.sync(() => { received.push(`client-2:${msg._tag}`) }),
        close: () => Effect.void,
      }

      yield* registry.register(conn1)
      yield* registry.register(conn2)

      // Broadcast
      yield* registry.broadcast(new PongMessage({}))

      expect(received).toContain("client-1:Pong")
      expect(received).toContain("client-2:Pong")
    })

    await Effect.runPromise(program.pipe(Effect.provide(ConnectionRegistryLive)))
  })

  it("broadcasts to specific user", async () => {
    const program = Effect.gen(function* () {
      const registry = yield* ConnectionRegistry
      const received: string[] = []

      // Two connections for same user
      const conn1: Connection = {
        clientId: "client-1" as ClientId,
        auth: { userId: "user-1", clientId: "client-1" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) => Effect.sync(() => { received.push(`client-1:${msg._tag}`) }),
        close: () => Effect.void,
      }

      const conn2: Connection = {
        clientId: "client-2" as ClientId,
        auth: { userId: "user-1", clientId: "client-2" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) => Effect.sync(() => { received.push(`client-2:${msg._tag}`) }),
        close: () => Effect.void,
      }

      const conn3: Connection = {
        clientId: "client-3" as ClientId,
        auth: { userId: "user-2", clientId: "client-3" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) => Effect.sync(() => { received.push(`client-3:${msg._tag}`) }),
        close: () => Effect.void,
      }

      yield* registry.register(conn1)
      yield* registry.register(conn2)
      yield* registry.register(conn3)

      // Broadcast to user-1 only
      yield* registry.broadcastToUser("user-1", new PongMessage({}))

      expect(received).toContain("client-1:Pong")
      expect(received).toContain("client-2:Pong")
      expect(received).not.toContain("client-3:Pong")
    })

    await Effect.runPromise(program.pipe(Effect.provide(ConnectionRegistryLive)))
  })

  it("enforces connection limit", async () => {
    // Create a registry with a limit of 2 connections
    const limitedRegistry = connectionRegistryLayer({ maxConnections: 2 })

    const program = Effect.gen(function* () {
      const registry = yield* ConnectionRegistry

      // Verify max connections is set
      const maxConns = yield* registry.getMaxConnections
      expect(maxConns).toBe(2)

      // Can accept connections initially
      const canAccept1 = yield* registry.canAcceptConnection
      expect(canAccept1).toBe(true)

      // Create mock connections
      const createMockConnection = (id: string): Connection => ({
        clientId: id as ClientId,
        auth: { userId: `user-${id}`, clientId: id as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: () => Effect.void,
        close: () => Effect.void,
      })

      // Register first connection - should succeed
      yield* registry.register(createMockConnection("client-1"))
      const count1 = yield* registry.count
      expect(count1).toBe(1)

      // Register second connection - should succeed
      yield* registry.register(createMockConnection("client-2"))
      const count2 = yield* registry.count
      expect(count2).toBe(2)

      // Can no longer accept connections
      const canAccept2 = yield* registry.canAcceptConnection
      expect(canAccept2).toBe(false)

      // Third connection should fail with ConnectionLimitExceededError
      const result = yield* Effect.either(
        registry.register(createMockConnection("client-3"))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ConnectionLimitExceededError)
        expect((result.left).currentCount).toBe(2)
        expect((result.left).maxConnections).toBe(2)
        expect((result.left).clientId).toBe("client-3")
      }

      // Count should still be 2
      const count3 = yield* registry.count
      expect(count3).toBe(2)

      // Unregister one connection
      yield* registry.unregister("client-1" as ClientId)

      // Now can accept again
      const canAccept3 = yield* registry.canAcceptConnection
      expect(canAccept3).toBe(true)

      // Third connection should now succeed
      yield* registry.register(createMockConnection("client-3"))
      const count4 = yield* registry.count
      expect(count4).toBe(2)
    })

    await Effect.runPromise(program.pipe(Effect.provide(limitedRegistry)))
  })

  it("allows unlimited connections when maxConnections is 0", async () => {
    const unlimitedRegistry = connectionRegistryLayer({ maxConnections: 0 })

    const program = Effect.gen(function* () {
      const registry = yield* ConnectionRegistry

      // Verify max connections is 0 (unlimited)
      const maxConns = yield* registry.getMaxConnections
      expect(maxConns).toBe(0)

      // Can always accept connections
      const canAccept = yield* registry.canAcceptConnection
      expect(canAccept).toBe(true)

      // Register many connections
      for (let i = 0; i < 100; i++) {
        yield* registry.register({
          clientId: `client-${i}` as ClientId,
          auth: { userId: `user-${i}`, clientId: `client-${i}` as ClientId, metadata: {} },
          connectedAt: DateTime.unsafeNow(),
          send: () => Effect.void,
          close: () => Effect.void,
        })
      }

      const count = yield* registry.count
      expect(count).toBe(100)

      // Still can accept
      const canAcceptAfter = yield* registry.canAcceptConnection
      expect(canAcceptAfter).toBe(true)
    })

    await Effect.runPromise(program.pipe(Effect.provide(unlimitedRegistry)))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: SubscriptionManager
// ─────────────────────────────────────────────────────────────────────────────

describe("SubscriptionManager", () => {
  it("registers handlers and runs subscriptions", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* SubscriptionManager
      const registry = yield* ConnectionRegistry

      // Track sent messages
      const sentMessages: Array<{ id: string; tag: string }> = []

      // Register a mock connection
      const mockConnection: Connection = {
        clientId: "client-1" as ClientId,
        auth: { userId: "user-1", clientId: "client-1" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) =>
          Effect.sync(() => {
            sentMessages.push({ id: (msg as any).id ?? "", tag: msg._tag })
          }),
        close: () => Effect.void,
      }
      yield* registry.register(mockConnection)

      // Register a handler
      const handler: RegisteredHandler = {
        path: "test.counter",
        inputSchema: undefined,
        outputSchema: undefined,
        handler: {
          onSubscribe: (_input, _ctx) =>
            Effect.succeed(Stream.make(1, 2, 3)),
        },
      }
      yield* manager.registerHandler(handler)

      // Subscribe
      yield* manager.subscribe(
        "client-1" as ClientId,
        "sub-1" as SubscriptionId,
        "test.counter",
        {},
      )

      // Wait for stream to process
      yield* Effect.sleep("100 millis")

      // Should have received: Data x3, Complete
      const dataMsgs = sentMessages.filter((m) => m.tag === "Data")
      const completeMsgs = sentMessages.filter((m) => m.tag === "Complete")

      expect(dataMsgs.length).toBe(3)
      expect(completeMsgs.length).toBe(1)
    })

    await Effect.runPromise(asRunnable(program.pipe(Effect.provide(TestLayers))))
  })

  it("handles subscription errors", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* SubscriptionManager
      const registry = yield* ConnectionRegistry

      const sentMessages: Array<{ tag: string }> = []

      const mockConnection: Connection = {
        clientId: "client-1" as ClientId,
        auth: { userId: "user-1", clientId: "client-1" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: (msg) => Effect.sync(() => { sentMessages.push({ tag: msg._tag }) }),
        close: () => Effect.void,
      }
      yield* registry.register(mockConnection)

      // Register a handler that fails
      const handler: RegisteredHandler = {
        path: "test.failing",
        inputSchema: undefined,
        outputSchema: undefined,
        handler: {
          onSubscribe: (_input, _ctx) =>
            Effect.succeed(
              Stream.make(1).pipe(
                Stream.concat(Stream.fail(new Error("Stream error"))),
              ),
            ),
        },
      }
      yield* manager.registerHandler(handler)

      yield* manager.subscribe(
        "client-1" as ClientId,
        "sub-1" as SubscriptionId,
        "test.failing",
        {},
      )

      yield* Effect.sleep("100 millis")

      // Should receive Data, then Error
      const dataMsgs = sentMessages.filter((m) => m.tag === "Data")
      const errorMsgs = sentMessages.filter((m) => m.tag === "Error")

      expect(dataMsgs.length).toBe(1)
      expect(errorMsgs.length).toBe(1)
    })

    await Effect.runPromise(asRunnable(program.pipe(Effect.provide(TestLayers))))
  })

  it("cleans up client subscriptions", async () => {
    const program = Effect.gen(function* () {
      const manager = yield* SubscriptionManager
      const registry = yield* ConnectionRegistry

      const mockConnection: Connection = {
        clientId: "client-1" as ClientId,
        auth: { userId: "user-1", clientId: "client-1" as ClientId, metadata: {} },
        connectedAt: DateTime.unsafeNow(),
        send: () => Effect.void,
        close: () => Effect.void,
      }
      yield* registry.register(mockConnection)

      // Register a handler that runs forever
      const handler: RegisteredHandler = {
        path: "test.forever",
        inputSchema: undefined,
        outputSchema: undefined,
        handler: {
          onSubscribe: (_input, _ctx) =>
            Effect.succeed(
              Stream.repeatEffect(Effect.sleep("1 second").pipe(Effect.as(1))),
            ),
        },
      }
      yield* manager.registerHandler(handler)

      // Start subscription
      yield* manager.subscribe(
        "client-1" as ClientId,
        "sub-1" as SubscriptionId,
        "test.forever",
        {},
      )

      // Should have 1 subscription
      const count1 = yield* manager.count
      expect(count1).toBe(1)

      // Clean up client
      yield* manager.cleanupClient("client-1" as ClientId)

      // Should have 0 subscriptions
      const count2 = yield* manager.count
      expect(count2).toBe(0)
    })

    await Effect.runPromise(asRunnable(program.pipe(Effect.provide(TestLayers))))
  })
})
