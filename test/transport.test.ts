/**
 * Transport Module Tests
 * 
 * Tests for HTTP transport and transport protocol types.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { Effect, Schema, Layer, Stream, Context } from "effect"

import { Transport } from "../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

// =============================================================================
// Transport.http Tests
// =============================================================================

describe("Transport.http", () => {
  it("creates a Transport layer from URL", () => {
    const layer = Transport.http("/api/trpc")

    expect(layer).toBeDefined()
    expect(Layer.isLayer(layer)).toBe(true)
  })

  it("accepts configuration options", () => {
    const layer = Transport.http("/api/trpc", {
      timeout: "30 seconds",
      headers: {
        "X-Custom-Header": "value",
      },
    })

    expect(layer).toBeDefined()
  })

  it("accepts async headers function", () => {
    const layer = Transport.http("/api/trpc", {
      headers: async () => ({
        Authorization: `Bearer token`,
      }),
    })

    expect(layer).toBeDefined()
  })

  it("accepts batching configuration", () => {
    const layer = Transport.http("/api/trpc", {
      batching: {
        enabled: true,
        window: "10 millis",
        maxSize: 50,
        queries: true,
        mutations: false,
      },
    })

    expect(layer).toBeDefined()
  })

  it("accepts custom fetch implementation", () => {
    const customFetch = globalThis.fetch
    
    const layer = Transport.http("/api/trpc", {
      fetch: customFetch,
    })

    expect(layer).toBeDefined()
  })
})

// =============================================================================
// Transport.mock Tests
// =============================================================================

describe("Transport.mock", () => {
  it("creates a mock transport from handlers", () => {
    const layer = Transport.mock({
      "users.list": () => Effect.succeed([new User({ id: "1", name: "Test" })]),
    })

    expect(layer).toBeDefined()
    expect(Layer.isLayer(layer)).toBe(true)
  })

  it("handlers can return failures", () => {
    const layer = Transport.mock({
      "users.get": (payload: { id: string }) => 
        Effect.fail({ _tag: "NotFound", id: payload.id }),
    })

    expect(layer).toBeDefined()
  })
})

// =============================================================================
// Transport Service Interface Tests
// =============================================================================

describe("Transport service", () => {
  it("Transport.Transport is a Context.Tag", () => {
    expect(Transport.Transport).toBeDefined()
  })

  it("TransportService has send method", () => {
    type Service = Transport.TransportService

    expectTypeOf<Service>().toHaveProperty("send")
  })

  it("send returns Stream of responses", () => {
    type SendFn = Transport.TransportService["send"]
    type Return = ReturnType<SendFn>

    expectTypeOf<Return>().toMatchTypeOf<
      Stream.Stream<Transport.TransportResponse, Transport.TransportError>
    >()
  })
})

// =============================================================================
// TransportError Tests
// =============================================================================

describe("TransportError", () => {
  it("has Network, Timeout, Protocol, Closed reasons", () => {
    const networkError = new Transport.TransportError({
      reason: "Network",
      message: "Connection failed",
    })

    expect(networkError.reason).toBe("Network")

    const timeoutError = new Transport.TransportError({
      reason: "Timeout",
      message: "Request timed out",
    })

    expect(timeoutError.reason).toBe("Timeout")
  })

  it("isTransientError identifies retryable errors", () => {
    const networkError = new Transport.TransportError({
      reason: "Network",
      message: "Connection failed",
    })

    const protocolError = new Transport.TransportError({
      reason: "Protocol",
      message: "Invalid response",
    })

    expect(Transport.isTransientError(networkError)).toBe(true)
    expect(Transport.isTransientError(protocolError)).toBe(false)
  })
})

// =============================================================================
// Transport Protocol Types Tests
// =============================================================================

describe("Transport protocol types", () => {
  it("TransportRequest has required fields", () => {
    const request: Transport.TransportRequest = {
      id: "req-1",
      tag: "@api/users/list",
      payload: { filter: "active" },
    }

    expect(request.id).toBe("req-1")
    expect(request.tag).toBe("@api/users/list")
  })

  it("Success response has value", () => {
    const success = new Transport.Success({
      id: "req-1",
      value: { data: "test" },
    })

    expect(success._tag).toBe("Success")
    expect(success.id).toBe("req-1")
    expect(success.value).toEqual({ data: "test" })
  })

  it("Failure response has error", () => {
    const failure = new Transport.Failure({
      id: "req-1",
      error: { message: "Not found" },
    })

    expect(failure._tag).toBe("Failure")
    expect(failure.error).toEqual({ message: "Not found" })
  })

  it("StreamChunk response has chunk", () => {
    const chunk = new Transport.StreamChunk({
      id: "req-1",
      chunk: { item: 1 },
    })

    expect(chunk._tag).toBe("StreamChunk")
    expect(chunk.chunk).toEqual({ item: 1 })
  })

  it("StreamEnd response marks stream completion", () => {
    const end = new Transport.StreamEnd({
      id: "req-1",
    })

    expect(end._tag).toBe("StreamEnd")
    expect(end.id).toBe("req-1")
  })
})

// =============================================================================
// Type Guard Tests
// =============================================================================

describe("Transport type guards", () => {
  it("Schema.is works for Success", () => {
    const success = new Transport.Success({ id: "1", value: {} })
    const failure = new Transport.Failure({ id: "1", error: {} })
    
    expect(Schema.is(Transport.Success)(success)).toBe(true)
    expect(Schema.is(Transport.Success)(failure)).toBe(false)
  })

  it("Schema.is works for Failure", () => {
    const success = new Transport.Success({ id: "1", value: {} })
    const failure = new Transport.Failure({ id: "1", error: {} })
    
    expect(Schema.is(Transport.Failure)(failure)).toBe(true)
    expect(Schema.is(Transport.Failure)(success)).toBe(false)
  })

  it("Schema.is works for StreamChunk", () => {
    const chunk = new Transport.StreamChunk({ id: "1", chunk: {} })
    const end = new Transport.StreamEnd({ id: "1" })
    
    expect(Schema.is(Transport.StreamChunk)(chunk)).toBe(true)
    expect(Schema.is(Transport.StreamChunk)(end)).toBe(false)
  })

  it("Schema.is works for StreamEnd", () => {
    const chunk = new Transport.StreamChunk({ id: "1", chunk: {} })
    const end = new Transport.StreamEnd({ id: "1" })
    
    expect(Schema.is(Transport.StreamEnd)(end)).toBe(true)
    expect(Schema.is(Transport.StreamEnd)(chunk)).toBe(false)
  })
})
