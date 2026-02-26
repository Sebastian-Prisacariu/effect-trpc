/**
 * @module effect-trpc/tests/ws-types
 *
 * Tests for WebSocket types, protocol, and errors.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import {
  // Types
  type ClientId,
  ClientIdSchema,
  SubscriptionIdSchema,
  ConnectionStateCtor,
  SubscriptionStateCtor,
  generateClientId,
  generateSubscriptionId,
  // Protocol
  AuthMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientDataMessage,
  PingMessage,
  FromClientMessage,
  AuthResultMessage,
  DataMessage,
  ErrorMessage,
  CompleteMessage,
  PongMessage,
  isAuthMessage,
  isSubscribeMessage,
  isDataMessage,
  // Errors
  WebSocketConnectionError,
  WebSocketAuthError,
  WebSocketSubscriptionError,
  WebSocketProtocolError,
  ConnectionNotFoundError,
  SubscriptionNotFoundError,
  HandlerNotFoundError,
  ReconnectGaveUpError,
  HeartbeatTimeoutError,
  isWebSocketError,
} from "../ws/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test: Branded IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("branded IDs", () => {
  it("generateClientId creates valid client IDs", () => {
    const id1 = Effect.runSync(generateClientId)
    const id2 = Effect.runSync(generateClientId)

    expect(id1).toMatch(/^client_\d+_[a-z0-9]+$/)
    expect(id2).toMatch(/^client_\d+_[a-z0-9]+$/)
    expect(id1).not.toBe(id2)
  })

  it("generateSubscriptionId creates valid subscription IDs", () => {
    const id1 = Effect.runSync(generateSubscriptionId)
    const id2 = Effect.runSync(generateSubscriptionId)

    expect(id1).toMatch(/^sub_\d+_[a-z0-9]+$/)
    expect(id2).toMatch(/^sub_\d+_[a-z0-9]+$/)
    expect(id1).not.toBe(id2)
  })

  it("ClientId schema validates strings", async () => {
    const result = ClientIdSchema("test-client")
    expect(result).toBe("test-client")
  })

  it("SubscriptionId schema validates strings", async () => {
    const result = SubscriptionIdSchema("test-sub")
    expect(result).toBe("test-sub")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: Connection State
// ─────────────────────────────────────────────────────────────────────────────

describe("ConnectionState", () => {
  it("has all constructors", () => {
    const connecting = ConnectionStateCtor.Connecting
    const authenticating = ConnectionStateCtor.Authenticating
    const connected = ConnectionStateCtor.Connected("client-1" as ClientId)
    const reconnecting = ConnectionStateCtor.Reconnecting(3)
    const disconnected = ConnectionStateCtor.Disconnected("timeout")
    const disconnectedNoReason = ConnectionStateCtor.Disconnected()

    expect(connecting._tag).toBe("Connecting")
    expect(authenticating._tag).toBe("Authenticating")
    expect(connected._tag).toBe("Connected")
    if (connected._tag === "Connected") {
      expect(connected.clientId).toBe("client-1")
    }
    expect(reconnecting._tag).toBe("Reconnecting")
    if (reconnecting._tag === "Reconnecting") {
      expect(reconnecting.attempt).toBe(3)
    }
    expect(disconnected._tag).toBe("Disconnected")
    if (disconnected._tag === "Disconnected") {
      expect(disconnected.reason).toBe("timeout")
    }
    expect(disconnectedNoReason._tag).toBe("Disconnected")
    if (disconnectedNoReason._tag === "Disconnected") {
      expect(disconnectedNoReason.reason).toBeUndefined()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: Subscription State
// ─────────────────────────────────────────────────────────────────────────────

describe("SubscriptionState", () => {
  it("has all constructors", () => {
    const subscribing = SubscriptionStateCtor.Subscribing
    const active = SubscriptionStateCtor.Active({ count: 5 })
    const activeNoData = SubscriptionStateCtor.Active()
    const error = SubscriptionStateCtor.Error(new Error("test"))
    const completed = SubscriptionStateCtor.Completed
    const unsubscribed = SubscriptionStateCtor.Unsubscribed

    expect(subscribing._tag).toBe("Subscribing")
    expect(active._tag).toBe("Active")
    if (active._tag === "Active") {
      expect(active.lastData).toEqual({ count: 5 })
    }
    expect(activeNoData._tag).toBe("Active")
    if (activeNoData._tag === "Active") {
      expect(activeNoData.lastData).toBeUndefined()
    }
    expect(error._tag).toBe("Error")
    if (error._tag === "Error") {
      expect(error.error).toBeInstanceOf(Error)
    }
    expect(completed._tag).toBe("Completed")
    expect(unsubscribed._tag).toBe("Unsubscribed")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: Protocol Messages
// ─────────────────────────────────────────────────────────────────────────────

describe("protocol messages", () => {
  describe("client → server", () => {
    it("AuthMessage", () => {
      const msg = new AuthMessage({ token: "jwt-token" })
      expect(msg._tag).toBe("Auth")
      expect(msg.token).toBe("jwt-token")
      expect(isAuthMessage(msg)).toBe(true)
    })

    it("SubscribeMessage", () => {
      const msg = new SubscribeMessage({
        id: "sub-1",
        path: "notifications.watch",
        input: { userId: "user-1" },
      })
      expect(msg._tag).toBe("Subscribe")
      expect(msg.path).toBe("notifications.watch")
      expect(isSubscribeMessage(msg)).toBe(true)
    })

    it("UnsubscribeMessage", () => {
      const msg = new UnsubscribeMessage({ id: "sub-1" })
      expect(msg._tag).toBe("Unsubscribe")
      expect(msg.id).toBe("sub-1")
    })

    it("ClientDataMessage", () => {
      const msg = new ClientDataMessage({
        id: "sub-1",
        data: { text: "hello" },
      })
      expect(msg._tag).toBe("ClientData")
    })

    it("PingMessage", () => {
      const msg = new PingMessage({})
      expect(msg._tag).toBe("Ping")
    })

    it("FromClientMessage schema validates all types", async () => {
      const authResult = await Effect.runPromise(
        Schema.decodeUnknown(FromClientMessage)({ _tag: "Auth", token: "test" })
      )
      expect(authResult._tag).toBe("Auth")

      const subResult = await Effect.runPromise(
        Schema.decodeUnknown(FromClientMessage)({
          _tag: "Subscribe",
          id: "sub-1",
          path: "test.path",
          input: {},
        })
      )
      expect(subResult._tag).toBe("Subscribe")
    })
  })

  describe("server → client", () => {
    it("AuthResultMessage", () => {
      const success = new AuthResultMessage({
        success: true,
        clientId: "client-1",
      })
      expect(success._tag).toBe("AuthResult")
      expect(success.success).toBe(true)

      const failure = new AuthResultMessage({
        success: false,
        error: "Invalid token",
      })
      expect(failure.success).toBe(false)
      expect(failure.error).toBe("Invalid token")
    })

    it("DataMessage", () => {
      const msg = new DataMessage({
        id: "sub-1",
        data: { count: 42 },
      })
      expect(msg._tag).toBe("Data")
      expect(isDataMessage(msg)).toBe(true)
    })

    it("ErrorMessage", () => {
      const msg = new ErrorMessage({
        id: "sub-1",
        error: { _tag: "HandlerError", message: "Something went wrong" },
      })
      expect(msg._tag).toBe("Error")
    })

    it("CompleteMessage", () => {
      const msg = new CompleteMessage({ id: "sub-1" })
      expect(msg._tag).toBe("Complete")
    })

    it("PongMessage", () => {
      const msg = new PongMessage({})
      expect(msg._tag).toBe("Pong")
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: Errors
// ─────────────────────────────────────────────────────────────────────────────

describe("WebSocket errors", () => {
  it("WebSocketConnectionError", () => {
    const err = new WebSocketConnectionError({
      url: "wss://example.com/ws",
      reason: "ConnectionFailed",
      code: 1006,
    })
    expect(err._tag).toBe("WebSocketConnectionError")
    expect(err.message).toContain("ConnectionFailed")
    expect(err.message).toContain("1006")
    expect(isWebSocketError(err)).toBe(true)
  })

  it("WebSocketAuthError", () => {
    const err = new WebSocketAuthError({ reason: "InvalidToken" })
    expect(err._tag).toBe("WebSocketAuthError")
    expect(err.message).toContain("InvalidToken")
    expect(isWebSocketError(err)).toBe(true)
  })

  it("WebSocketSubscriptionError", () => {
    const err = new WebSocketSubscriptionError({
      subscriptionId: "sub-1",
      path: "test.events",
      reason: "HandlerError",
      description: "Database unavailable",
    })
    expect(err._tag).toBe("WebSocketSubscriptionError")
    expect(err.message).toContain("test.events")
    expect(err.message).toContain("HandlerError")
    expect(err.message).toContain("Database unavailable")
  })

  it("WebSocketProtocolError", () => {
    const err = new WebSocketProtocolError({
      reason: "ParseError",
      description: "Invalid JSON",
    })
    expect(err._tag).toBe("WebSocketProtocolError")
    expect(err.message).toContain("ParseError")
  })

  it("ConnectionNotFoundError", () => {
    const err = new ConnectionNotFoundError({ clientId: "client-123" })
    expect(err._tag).toBe("ConnectionNotFoundError")
    expect(err.message).toContain("client-123")
  })

  it("SubscriptionNotFoundError", () => {
    const err = new SubscriptionNotFoundError({
      subscriptionId: "sub-456",
      clientId: "client-123",
    })
    expect(err._tag).toBe("SubscriptionNotFoundError")
    expect(err.message).toContain("sub-456")
    expect(err.message).toContain("client-123")
  })

  it("HandlerNotFoundError", () => {
    const err = new HandlerNotFoundError({ path: "unknown.procedure" })
    expect(err._tag).toBe("HandlerNotFoundError")
    expect(err.message).toContain("unknown.procedure")
  })

  it("ReconnectGaveUpError", () => {
    const err = new ReconnectGaveUpError({
      attempts: 5,
      lastError: new Error("Network unavailable"),
    })
    expect(err._tag).toBe("ReconnectGaveUpError")
    expect(err.message).toContain("5 attempts")
  })

  it("HeartbeatTimeoutError", () => {
    const err = new HeartbeatTimeoutError({ clientId: "client-789" })
    expect(err._tag).toBe("HeartbeatTimeoutError")
    expect(err.message).toContain("client-789")
  })

  it("isWebSocketError type guard", () => {
    const wsError = new WebSocketConnectionError({ url: "wss://test.com", reason: "Timeout" })
    const regularError = new Error("regular")

    expect(isWebSocketError(wsError)).toBe(true)
    expect(isWebSocketError(regularError)).toBe(false)
    expect(isWebSocketError(null)).toBe(false)
    expect(isWebSocketError(undefined)).toBe(false)
  })
})
