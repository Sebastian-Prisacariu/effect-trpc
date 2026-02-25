/**
 * @module effect-trpc/tests/ws-message-rate-limit
 *
 * Tests for WebSocket message rate limiting.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  MessageRateLimiter,
  MessageRateLimiterLive,
  MessageRateLimiterDisabled,
  makeMessageRateLimiterLayer,
} from "../ws/server/MessageRateLimiter.js"
import { MessageRateLimitExceededError } from "../ws/errors.js"
import { ClientId } from "../ws/types.js"

describe("WebSocket Message Rate Limiter", () => {
  const testClientId = "test-client-123" as ClientId

  describe("MessageRateLimiterLive", () => {
    it("allows messages within the rate limit", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Should allow 3 messages
        yield* limiter.checkLimit(testClientId)
        yield* limiter.checkLimit(testClientId)
        yield* limiter.checkLimit(testClientId)

        return "success"
      }).pipe(
        Effect.provide(makeMessageRateLimiterLayer({
          maxMessages: 5,
          windowMs: 60000,
        })),
      )

      const result = await Effect.runPromise(program)
      expect(result).toBe("success")
    })

    it("fails when rate limit exceeded", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Use up the limit
        yield* limiter.checkLimit(testClientId)
        yield* limiter.checkLimit(testClientId)

        // This should fail
        yield* limiter.checkLimit(testClientId)

        return "should not reach"
      }).pipe(
        Effect.provide(makeMessageRateLimiterLayer({
          maxMessages: 2,
          windowMs: 60000,
        })),
      )

      const result = await Effect.runPromiseExit(program)
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const error = result.cause
        // The error should be MessageRateLimitExceededError
        expect(error._tag).toBe("Fail")
      }
    })

    it("provides retryAfterMs in the error", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Use up the limit
        yield* limiter.checkLimit(testClientId)

        // This should fail
        yield* limiter.checkLimit(testClientId)
        
        return { tag: "should_not_reach", retryAfterMs: 0, maxMessages: 0, currentCount: 0 }
      }).pipe(
        Effect.catchTag("MessageRateLimitExceededError", (error) =>
          Effect.succeed({
            tag: error._tag,
            retryAfterMs: error.retryAfterMs,
            maxMessages: error.maxMessages,
            currentCount: error.currentCount,
          }),
        ),
        Effect.provide(makeMessageRateLimiterLayer({
          maxMessages: 1,
          windowMs: 60000,
        })),
      )

      const result = await Effect.runPromise(program)
      expect(result.tag).toBe("MessageRateLimitExceededError")
      expect(result.maxMessages).toBe(1)
      expect(result.currentCount).toBe(2)
      expect(result.retryAfterMs).toBeGreaterThan(0)
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000)
    })

    it("tracks state per client", async () => {
      const client1 = "client-1" as ClientId
      const client2 = "client-2" as ClientId

      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Client 1 uses up their limit
        yield* limiter.checkLimit(client1)
        yield* limiter.checkLimit(client1)

        // Client 2 should still be able to send
        yield* limiter.checkLimit(client2)

        // Client 1 should fail
        return yield* limiter.checkLimit(client1).pipe(
          Effect.catchTag("MessageRateLimitExceededError", () =>
            Effect.succeed("rate_limited" as const),
          ),
        )
      }).pipe(
        Effect.provide(makeMessageRateLimiterLayer({
          maxMessages: 2,
          windowMs: 60000,
        })),
      )

      const result = await Effect.runPromise(program)
      expect(result).toBe("rate_limited")
    })

    it("getState returns current rate limit state", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Initially no state
        const initialState = yield* limiter.getState(testClientId)
        expect(Option.isNone(initialState)).toBe(true)

        // Send some messages
        yield* limiter.checkLimit(testClientId)
        yield* limiter.checkLimit(testClientId)

        // Now should have state
        const state = yield* limiter.getState(testClientId)
        expect(Option.isSome(state)).toBe(true)
        if (Option.isSome(state)) {
          expect(state.value.count).toBe(2)
          expect(state.value.maxMessages).toBe(5)
          expect(state.value.remainingMs).toBeGreaterThan(0)
        }

        return "success"
      }).pipe(
        Effect.provide(makeMessageRateLimiterLayer({
          maxMessages: 5,
          windowMs: 60000,
        })),
      )

      const result = await Effect.runPromise(program)
      expect(result).toBe("success")
    })

    it("clearClient removes rate limit state", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Send messages to establish state
        yield* limiter.checkLimit(testClientId)
        yield* limiter.checkLimit(testClientId)

        // Clear the client
        yield* limiter.clearClient(testClientId)

        // State should be gone
        const state = yield* limiter.getState(testClientId)
        expect(Option.isNone(state)).toBe(true)

        // Should be able to send again
        yield* limiter.checkLimit(testClientId)

        const newState = yield* limiter.getState(testClientId)
        expect(Option.isSome(newState)).toBe(true)
        if (Option.isSome(newState)) {
          expect(newState.value.count).toBe(1)
        }

        return "success"
      }).pipe(
        Effect.provide(makeMessageRateLimiterLayer({
          maxMessages: 2,
          windowMs: 60000,
        })),
      )

      const result = await Effect.runPromise(program)
      expect(result).toBe("success")
    })
  })

  describe("MessageRateLimiterDisabled", () => {
    it("always allows messages through", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        // Should allow any number of messages
        for (let i = 0; i < 1000; i++) {
          yield* limiter.checkLimit(testClientId)
        }

        return "success"
      }).pipe(Effect.provide(MessageRateLimiterDisabled))

      const result = await Effect.runPromise(program)
      expect(result).toBe("success")
    })

    it("returns none for getState", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter

        yield* limiter.checkLimit(testClientId)

        const state = yield* limiter.getState(testClientId)
        return Option.isNone(state)
      }).pipe(Effect.provide(MessageRateLimiterDisabled))

      const result = await Effect.runPromise(program)
      expect(result).toBe(true)
    })
  })

  describe("default configuration", () => {
    it("uses 100 messages per minute by default", async () => {
      const program = Effect.gen(function* () {
        const limiter = yield* MessageRateLimiter
        return limiter.config
      }).pipe(Effect.provide(MessageRateLimiterLive))

      const config = await Effect.runPromise(program)
      expect(config.maxMessages).toBe(100)
      expect(config.windowMs).toBe(60000)
    })
  })
})
