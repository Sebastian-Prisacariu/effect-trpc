import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

import {
  Network,
  NetworkBrowserLive,
  NetworkAlwaysOnline,
  isOnline,
  getState,
  awaitOnline,
  whenOnline,
  NetworkOfflineError,
} from "../core/network/index.js"

describe("Network", () => {
  describe("NetworkAlwaysOnline layer", () => {
    it("always reports online", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return yield* network.isOnline
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(true)
    })

    it("state shows online with timestamp", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return yield* network.state
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result.isOnline).toBe(true)
      expect(result.lastOnlineAt).toBeTypeOf("number")
      expect(result.lastOfflineAt).toBe(null)
    })

    it("awaitOnline completes immediately", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          yield* network.awaitOnline
          return "completed"
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("completed")
    })

    it("whenOnline executes immediately", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return yield* network.whenOnline(Effect.succeed(42))
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(42)
    })

    it("subscribe returns noop cleanup", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const cleanup = network.subscribe(() => {})
          expect(typeof cleanup).toBe("function")
          cleanup() // Should not throw
          return "ok"
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("ok")
    })

    it("subscribeToReconnect returns noop cleanup", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          const cleanup = network.subscribeToReconnect(() => {})
          expect(typeof cleanup).toBe("function")
          cleanup() // Should not throw
          return "ok"
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("ok")
    })

    it("exposes the underlying gate", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return network.gate._tag
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("Gate")
    })
  })

  describe("NetworkBrowserLive layer", () => {
    // Note: In Node.js test environment, navigator.onLine is undefined
    // so it defaults to online (SSR-safe behavior)

    it("defaults to online in Node.js environment", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return yield* network.isOnline
        }).pipe(Effect.provide(NetworkBrowserLive)),
      )

      expect(result).toBe(true)
    })

    it("state shows online with timestamp", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return yield* network.state
        }).pipe(Effect.provide(NetworkBrowserLive)),
      )

      expect(result.isOnline).toBe(true)
      expect(result.lastOnlineAt).toBeTypeOf("number")
      expect(result.lastOfflineAt).toBe(null)
    })

    it("awaitOnline completes immediately when online", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          yield* network.awaitOnline
          return "completed"
        }).pipe(Effect.provide(NetworkBrowserLive)),
      )

      expect(result).toBe("completed")
    })

    it("whenOnline executes immediately when online", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return yield* network.whenOnline(Effect.succeed(42))
        }).pipe(Effect.provide(NetworkBrowserLive)),
      )

      expect(result).toBe(42)
    })

    it("exposes the underlying gate", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const network = yield* Network
          return network.gate._tag
        }).pipe(Effect.provide(NetworkBrowserLive)),
      )

      expect(result).toBe("Gate")
    })
  })

  describe("convenience accessors", () => {
    it("isOnline accessor works", async () => {
      const result = await Effect.runPromise(isOnline.pipe(Effect.provide(NetworkAlwaysOnline)))

      expect(result).toBe(true)
    })

    it("getState accessor works", async () => {
      const result = await Effect.runPromise(getState.pipe(Effect.provide(NetworkAlwaysOnline)))

      expect(result.isOnline).toBe(true)
    })

    it("awaitOnline accessor works", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* awaitOnline
          return "completed"
        }).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe("completed")
    })

    it("whenOnline accessor works", async () => {
      const result = await Effect.runPromise(
        whenOnline(Effect.succeed(42)).pipe(Effect.provide(NetworkAlwaysOnline)),
      )

      expect(result).toBe(42)
    })
  })

  describe("NetworkOfflineError", () => {
    it("has correct properties", () => {
      const error = new NetworkOfflineError({
        lastOnlineAt: 12345,
      })

      expect(error._tag).toBe("NetworkOfflineError")
      expect(error.lastOnlineAt).toBe(12345)
      expect(error.isRetryable).toBe(true)
      expect(error.message).toContain("offline")
    })

    it("works without optional fields", () => {
      const error = new NetworkOfflineError({})

      expect(error._tag).toBe("NetworkOfflineError")
      expect(error.lastOnlineAt).toBe(undefined)
      expect(error.isRetryable).toBe(true)
    })

    it("message includes time since last online", () => {
      const error = new NetworkOfflineError({
        lastOnlineAt: Date.now() - 5000, // 5 seconds ago
      })

      expect(error.message).toContain("5s ago")
    })
  })
})
