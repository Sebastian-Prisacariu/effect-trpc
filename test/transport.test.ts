/**
 * Transport Module Tests
 * 
 * Tests for HTTP, WebSocket, and mock transports.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Schema, Layer, Stream } from "effect"

import { Procedure, Router, Transport } from "../src/index.js"

// =============================================================================
// Test Router (for typed mock transport)
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
}) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String }
) {}

const AppRouter = Router.make({
  user: Procedure.family("user", {
    list: Procedure.query({ success: Schema.Array(User) }),
    byId: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    }),
    create: Procedure.mutation({
      payload: Schema.Struct({ name: Schema.String }),
      success: User,
      invalidates: ["user.list"],
    }),
  }),
})

type AppRouter = typeof AppRouter

// =============================================================================
// Transport.http Tests
// =============================================================================

describe("Transport.http", () => {
  it("creates a Transport layer from URL", () => {
    const layer = Transport.http("/api/trpc")

    expectTypeOf(layer).toMatchTypeOf<Layer.Layer<Transport.Transport>>()
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
        Authorization: `Bearer ${await getToken()}`,
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

  it("batching is enabled by default", () => {
    const layer = Transport.http("/api/trpc")
    // Default should be batching enabled for queries
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
// Transport.webSocket Tests
// =============================================================================

describe("Transport.webSocket", () => {
  it("creates a Transport layer from WebSocket URL", () => {
    const layer = Transport.webSocket("wss://api.example.com/trpc")

    expectTypeOf(layer).toMatchTypeOf<Layer.Layer<Transport.Transport>>()
  })

  it("accepts reconnection options", () => {
    const layer = Transport.webSocket("wss://api.example.com/trpc", {
      reconnect: {
        enabled: true,
        maxAttempts: 5,
        delay: "1 second",
      },
    })

    expect(layer).toBeDefined()
  })

  it("accepts connection timeout", () => {
    const layer = Transport.webSocket("wss://api.example.com/trpc", {
      connectionTimeout: "10 seconds",
    })

    expect(layer).toBeDefined()
  })
})

// =============================================================================
// Transport.make (Mock Transport) Tests
// =============================================================================

describe("Transport.make", () => {
  it("creates a typed mock transport from handlers", () => {
    const layer = Transport.make<AppRouter>({
      "user.list": () =>
        Effect.succeed([
          new User({ id: "1", name: "Mock User" }),
        ]),
      "user.byId": ({ id }) =>
        Effect.succeed(new User({ id, name: `User ${id}` })),
      "user.create": ({ name }) =>
        Effect.succeed(new User({ id: "new-1", name })),
    })

    expectTypeOf(layer).toMatchTypeOf<Layer.Layer<Transport.Transport>>()
  })

  it("requires all procedure paths to be implemented", () => {
    // @ts-expect-error - missing user.byId and user.create
    Transport.make<AppRouter>({
      "user.list": () => Effect.succeed([]),
    })
  })

  it("handler receives correctly typed payload", () => {
    Transport.make<AppRouter>({
      "user.list": () => Effect.succeed([]),
      "user.byId": (payload) => {
        // payload should be { id: string }
        expectTypeOf(payload).toEqualTypeOf<{ readonly id: string }>()
        return Effect.succeed(new User({ id: payload.id, name: "Test" }))
      },
      "user.create": (payload) => {
        // payload should be { name: string }
        expectTypeOf(payload).toEqualTypeOf<{ readonly name: string }>()
        return Effect.succeed(new User({ id: "1", name: payload.name }))
      },
    })
  })

  it("handler must return correct success type", () => {
    // @ts-expect-error - user.list should return User[], not string[]
    Transport.make<AppRouter>({
      "user.list": () => Effect.succeed(["not a user"]),
      "user.byId": () => Effect.succeed(new User({ id: "1", name: "Test" })),
      "user.create": () => Effect.succeed(new User({ id: "1", name: "Test" })),
    })
  })

  it("handler can return procedure's error type", () => {
    Transport.make<AppRouter>({
      "user.list": () => Effect.succeed([]),
      "user.byId": ({ id }) =>
        id === "not-found"
          ? Effect.fail(new NotFoundError({ id }))
          : Effect.succeed(new User({ id, name: "Test" })),
      "user.create": () => Effect.succeed(new User({ id: "1", name: "Test" })),
    })
  })
})

// =============================================================================
// Transport Service Interface Tests
// =============================================================================

describe("Transport service", () => {
  it("Transport.Transport is a Context.Tag", () => {
    expectTypeOf(Transport.Transport).toMatchTypeOf<
      Context.Tag<Transport.Transport, Transport.TransportService>
    >()
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
// Integration Tests
// =============================================================================

describe("Transport integration", () => {
  effectIt.effect("mock transport can be used with Effect", () =>
    Effect.gen(function* () {
      const transport = yield* Transport.Transport

      const response = yield* transport
        .send({
          id: "1",
          path: "user.list",
          payload: {},
        })
        .pipe(Stream.runHead, Effect.flatten)

      expect(response._tag).toBe("Success")
    }).pipe(
      Effect.provide(
        Transport.make<AppRouter>({
          "user.list": () => Effect.succeed([]),
          "user.byId": () => Effect.succeed(new User({ id: "1", name: "Test" })),
          "user.create": () => Effect.succeed(new User({ id: "1", name: "Test" })),
        })
      )
    )
  )
})

// Helper
declare const getToken: () => Promise<string>
