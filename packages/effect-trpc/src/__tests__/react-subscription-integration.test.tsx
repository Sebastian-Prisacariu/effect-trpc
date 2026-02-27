// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import * as React from "react"
import { renderHook, act, waitFor } from "@testing-library/react"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { WebSocketServer, WebSocket as NodeWebSocket } from "ws"
import { createWrappedMockWebSocket } from "./test-utils/index.js"

// We need a queue to capture inputs sent from the client
const receivedMessages: any[] = []

/**
 * Enhanced MockWebSocket that wraps Node.js WebSocket for integration tests.
 *
 * This uses the shared createWrappedMockWebSocket utility which provides:
 * - Standard WebSocket API properties (readyState constants, bufferedAmount, protocol)
 * - Proper state transitions
 * - Event forwarding for browser-style handlers (onopen, onclose, onmessage, onerror)
 * - Test helper methods (__getSentMessages, __clearSentMessages, etc.)
 *
 * Additional functionality for this test file:
 * - Intercepts sent messages and stores Subscribe/ClientData/Unsubscribe for assertions
 */
const BaseMockWebSocket = createWrappedMockWebSocket(NodeWebSocket)

class MockWebSocket extends BaseMockWebSocket {
  // Static ready state constants (W3C WebSocket API)
  static readonly CONNECTING = 0 as const
  static readonly OPEN = 1 as const
  static readonly CLOSING = 2 as const
  static readonly CLOSED = 3 as const

  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols)

    // Intercept send to capture messages for test assertions
    const self = this as any
    const originalSend = self["send"].bind(this)
    self["send"] = function (data: any, cb?: any) {
      try {
        const parsed = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString())
        if (
          parsed._tag === "ClientData" ||
          parsed._tag === "Unsubscribe" ||
          parsed._tag === "Subscribe"
        ) {
          receivedMessages.push(parsed)
        }
      } catch (_e) {
        // Ignore parse errors for non-JSON messages
      }
      return originalSend(data, cb)
    }
  }
}

globalThis.WebSocket = MockWebSocket as any
if (typeof window !== "undefined") window.WebSocket = MockWebSocket as any
if (typeof global !== "undefined") global.WebSocket = MockWebSocket as any

import { procedure, procedures, Procedures, Router } from "../index.js"
import { createWebSocketHandler } from "../node/index.js"
import { useSubscription, WebSocketProvider } from "../react/subscription.js"

const EchoInput = Schema.Struct({ text: Schema.String })
const EchoOutput = Schema.Struct({ text: Schema.String })

const testProcedures = procedures("test", {
  echo: procedure.input(EchoInput).output(EchoOutput).subscription(),
  protected: procedure.input(Schema.String).output(Schema.String).subscription(),
})

const testRouterEffect = Router.make({
  test: testProcedures,
})

type TestRouter = Effect.Effect.Success<typeof testRouterEffect>

// Extract the router synchronously (Router.make returns Effect.succeed)
const testRouter: TestRouter = Effect.runSync(testRouterEffect)

const TestHandlersLive = Procedures.toLayer(testProcedures, {
  echo: {
    onSubscribe: (input: { readonly text: string }, _ctx: unknown) => {
      return Effect.succeed(
        Stream.fromEffect(Effect.succeed({ text: input.text })).pipe(Stream.concat(Stream.never)),
      )
    },
  },
  protected: {
    onSubscribe: (input: string, _ctx: unknown) =>
      Effect.succeed(Stream.fromEffect(Effect.succeed(input)).pipe(Stream.concat(Stream.never))),
  },
}) as Layer.Layer<unknown, never, never>

let wss: WebSocketServer
let wsHandler: ReturnType<typeof createWebSocketHandler>
let port: number
const connections: Set<any> = new Set()

beforeAll(async () => {
  port = 4600 + Math.floor(Math.random() * 500)

  wsHandler = createWebSocketHandler({
    router: testRouter,
    handlers: TestHandlersLive,
    auth: {
      authenticate: (token) => Effect.succeed({ userId: token }),
      canSubscribe: (auth, path) =>
        Effect.succeed(path !== "test.protected" || auth.userId === "valid"),
    },
  })

  wss = new WebSocketServer({ port })

  wss.on("connection", (ws) => {
    connections.add(ws)
    ws.on("close", () => connections.delete(ws))

    // Patch ws.on to intercept ClientData for testing WS ID Integrity
    const originalOn = ws.on.bind(ws)
    ws.on = (event: string, listener: any) => {
      return originalOn(event, listener)
    }

    Effect.runFork(wsHandler.handleConnection(ws as any))
  })

  await new Promise((resolve) => setTimeout(resolve, 100))
})

afterAll(async () => {
  await wsHandler.dispose()
  wss.close()
})

const createWrapper = (getToken: Effect.Effect<string, unknown> = Effect.succeed("test-token")) => {
  return ({ children }: { children: React.ReactNode }) => (
    <WebSocketProvider
      config={{
        url: `ws://localhost:${port}`,
        getToken,
        reconnect: {
          initialDelayMs: 100,
          maxDelayMs: 200,
          factor: 1.5,
          maxAttempts: 3,
        },
      }}
    >
      {children}
    </WebSocketProvider>
  )
}

describe("useSubscription Integration", () => {
  afterEach(() => {
    receivedMessages.length = 0
    connections.forEach((ws) => ws.terminate())
  })

  it("1. WS ID Integrity: successfully sends data and unsubscribes using the dynamically generated id", async () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => useSubscription("test.echo", { text: "hello" }), {
      wrapper,
    })

    // Debug: Log state transitions
    console.log("Initial state:", result.current.state._tag)
    console.log("Connection state:", result.current.connectionState._tag)

    await waitFor(
      () => {
        console.log(
          "Waiting... state:",
          result.current.state._tag,
          "connection:",
          result.current.connectionState._tag,
          "received:",
          receivedMessages.length,
          receivedMessages.map((m) => m._tag).join(","),
        )
        expect(result.current.isActive).toBe(true)
      },
      { timeout: 3000, interval: 100 },
    )

    // Simulate sending data from client to server
    act(() => {
      result.current.send({ clientMessage: "world" })
    })

    await waitFor(() => {
      const clientDataMsgs = receivedMessages.filter((m) => m._tag === "ClientData")
      expect(clientDataMsgs.length).toBe(1)
      expect(clientDataMsgs[0].data).toEqual({ clientMessage: "world" })
      // ID should be a dynamically generated string
      expect(typeof clientDataMsgs[0].id).toBe("string")
      expect(clientDataMsgs[0].id.length).toBeGreaterThan(0)
    })

    // Call unsubscribe manually since unmount() tears down the entire WebSocketProvider runtime
    act(() => {
      result.current.unsubscribe()
    })

    await waitFor(() => {
      // Check that an Unsubscribe message was sent
      expect(receivedMessages.some((m) => m._tag === "Unsubscribe")).toBe(true)
    })
  })

  it("2. Reconnection & State: dropping a connection transitions to Reconnecting and successfully re-establishes", async () => {
    const wrapper = createWrapper()
    const { result } = renderHook(() => useSubscription("test.echo", { text: "hello" }), {
      wrapper,
    })

    await waitFor(() => {
      expect(result.current.isActive).toBe(true)
    })

    // Drop the connection
    act(() => {
      connections.forEach((ws) => ws.terminate())
    })

    // Should transition to Reconnecting
    await waitFor(
      () => {
        expect(result.current.isReconnecting).toBe(true)
      },
      { interval: 10 },
    )

    // Should automatically reconnect and become active again
    await waitFor(
      () => {
        expect(result.current.isActive).toBe(true)
      },
      { timeout: 3000 },
    )
  })

  it("3. Stale Input Check: updating React state, then dropping connection results in new state being sent on resubscribe", async () => {
    const wrapper = createWrapper()
    const { result, rerender } = renderHook(({ input }) => useSubscription("test.echo", input), {
      wrapper,
      initialProps: { input: { text: "first" } },
    })

    await waitFor(() => {
      expect(result.current.isActive).toBe(true)
    })

    // Update input
    act(() => {
      rerender({ input: { text: "second" } })
    })

    // Wait for the new subscription to transition through Subscribing
    await waitFor(() => {
      expect(result.current.isActive).toBe(false)
    })

    // Wait for the new subscription to be active
    await waitFor(() => {
      expect(result.current.isActive).toBe(true)
    })

    // Clear received messages to only check resubscribe
    receivedMessages.length = 0

    // Drop connection
    act(() => {
      connections.forEach((ws) => ws.terminate())
    })

    // Wait for reconnect and active state
    await waitFor(
      () => {
        expect(result.current.isReconnecting).toBe(true)
      },
      { interval: 10 },
    )

    await waitFor(
      () => {
        expect(result.current.connectionState._tag).toBe("Ready")
        const subscribes = receivedMessages.filter((m) => m._tag === "Subscribe")
        expect(subscribes.length).toBeGreaterThan(0)
      },
      { timeout: 3000, interval: 10 },
    )

    // Check that the new input was sent on resubscribe
    const subscribes = receivedMessages.filter((m) => m._tag === "Subscribe")
    expect(subscribes.length).toBeGreaterThan(0)
    const lastSubscribe = subscribes[subscribes.length - 1]
    expect(lastSubscribe.input).toEqual({ text: "second" })
  })

  it("4. Auth Failure: failing canSubscribe immediately errors out the useSubscription hook", async () => {
    const wrapper = createWrapper(Effect.succeed("invalid"))
    const { result } = renderHook(() => useSubscription("test.protected", "hello"), { wrapper })

    await waitFor(
      () => {
        expect(result.current.isError).toBe(true)
        expect(result.current.state._tag).toBe("Error")
      },
      { timeout: 1000 },
    )
  })
})
