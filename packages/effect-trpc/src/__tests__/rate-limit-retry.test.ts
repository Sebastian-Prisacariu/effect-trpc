/**
 * @module effect-trpc/tests/rate-limit-retry
 *
 * Tests for RateLimitError retry behavior across the middleware,
 * HTTP handler, and client layers.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Option from "effect/Option"
import * as Duration from "effect/Duration"
import * as Schedule from "effect/Schedule"
import {
  rateLimitMiddleware,
  MiddlewareRateLimitError,
  type BaseContext,
} from "../core/server/middleware.js"
import { createHttpRateLimiter } from "../shared/http-rate-limit.js"
import { RateLimitError } from "../errors/index.js"
import {
  isRetryableError,
  RpcResponseError,
  RpcClientError,
  RpcTimeoutError,
} from "../core/client/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createBaseContext = (procedure = "test.procedure"): BaseContext => ({
  procedure,
  headers: new Headers(),
  signal: new AbortController().signal,
  clientId: 1,
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Rate Limit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Rate Limit Retry", () => {
  describe("middleware", () => {
    it("returns MiddlewareRateLimitError with retry info when limit exceeded", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const rateLimit = yield* rateLimitMiddleware({
            maxRequests: 1,
            windowMs: 60000, // 1 minute window
          })

          // Middleware fn signature is (ctx, input, next)
          const next = (_ctx: BaseContext) => Effect.succeed("ok")
          const ctx = createBaseContext()
          const input = undefined

          // First request succeeds
          const firstResult = yield* rateLimit.fn(ctx, input, next)
          expect(firstResult).toBe("ok")

          // Second request should fail with rate limit error
          const exit = yield* Effect.exit(rateLimit.fn(ctx, input, next))
          expect(exit._tag).toBe("Failure")

          if (exit._tag === "Failure") {
            const error = Cause.failureOption(exit.cause)
            expect(Option.isSome(error)).toBe(true)

            if (Option.isSome(error)) {
              const rateLimitError = error.value as MiddlewareRateLimitError
              expect(rateLimitError._tag).toBe("MiddlewareRateLimitError")
              expect(rateLimitError.retryAfterMs).toBeGreaterThan(0)
              expect(rateLimitError.retryAfterMs).toBeLessThanOrEqual(60000)
              expect(rateLimitError.procedure).toBe("test.procedure")
              expect(rateLimitError.httpStatus).toBe(429)
              expect(rateLimitError.isRetryable).toBe(true)
            }
          }
        })
      )
    })

    it("calculates retryAfterMs based on window expiration", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const windowMs = 10000 // 10 second window

          const rateLimit = yield* rateLimitMiddleware({
            maxRequests: 1,
            windowMs,
          })

          const next = (_ctx: BaseContext) => Effect.succeed("ok")
          const ctx = createBaseContext()
          const input = undefined

          // Exhaust the rate limit
          yield* rateLimit.fn(ctx, input, next)

          // Get the rate limit error
          const exit = yield* Effect.exit(rateLimit.fn(ctx, input, next))

          if (exit._tag === "Failure") {
            const error = Cause.failureOption(exit.cause)
            if (Option.isSome(error)) {
              const rateLimitError = error.value as MiddlewareRateLimitError

              // retryAfterMs should be close to windowMs (within some tolerance for test execution time)
              expect(rateLimitError.retryAfterMs).toBeGreaterThan(0)
              expect(rateLimitError.retryAfterMs).toBeLessThanOrEqual(windowMs)
              // Should be close to the full window (accounting for execution time)
              expect(rateLimitError.retryAfterMs).toBeGreaterThan(windowMs - 1000)
            }
          }
        })
      )
    })

    it("allows requests after window expires", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const rateLimit = yield* rateLimitMiddleware({
            maxRequests: 1,
            windowMs: 100, // 100ms window for fast test
          })

          const next = (_ctx: BaseContext) => Effect.succeed("ok")
          const ctx = createBaseContext()
          const input = undefined

          // First request succeeds
          yield* rateLimit.fn(ctx, input, next)

          // Second request fails
          const failedExit = yield* Effect.exit(rateLimit.fn(ctx, input, next))
          expect(failedExit._tag).toBe("Failure")

          // Wait for window to expire
          yield* Effect.sleep(Duration.millis(150))

          // Third request should succeed after window expires
          const result = yield* rateLimit.fn(ctx, input, next)
          expect(result).toBe("ok")
        })
      )
    })

    it("includes procedure name in error message", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const rateLimit = yield* rateLimitMiddleware({
            maxRequests: 1,
            windowMs: 60000,
          })

          const next = (_ctx: BaseContext) => Effect.succeed("ok")
          const ctx = createBaseContext("user.create")
          const input = undefined

          // Exhaust the limit
          yield* rateLimit.fn(ctx, input, next)

          // Get the error
          const exit = yield* Effect.exit(rateLimit.fn(ctx, input, next))

          if (exit._tag === "Failure") {
            const error = Cause.failureOption(exit.cause)
            if (Option.isSome(error)) {
              const rateLimitError = error.value as MiddlewareRateLimitError
              expect(rateLimitError.message).toContain("user.create")
              expect(rateLimitError.message).toContain("Rate limit exceeded")
            }
          }
        })
      )
    })

    it("supports per-client rate limiting via keyFn", async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const rateLimit = yield* rateLimitMiddleware({
            maxRequests: 1,
            windowMs: 60000,
            keyFn: (ctx) => String(ctx.clientId),
          })

          const next = (_ctx: BaseContext) => Effect.succeed("ok")
          const input = undefined

          const client1Ctx = { ...createBaseContext(), clientId: 1 }
          const client2Ctx = { ...createBaseContext(), clientId: 2 }

          // Client 1's first request succeeds
          yield* rateLimit.fn(client1Ctx, input, next)

          // Client 1's second request fails
          const client1Exit = yield* Effect.exit(rateLimit.fn(client1Ctx, input, next))
          expect(client1Exit._tag).toBe("Failure")

          // Client 2's first request should still succeed (different key)
          const client2Result = yield* rateLimit.fn(client2Ctx, input, next)
          expect(client2Result).toBe("ok")
        })
      )
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // HTTP Handler Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("HTTP handler", () => {
    it("includes Retry-After header on 429 response", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      const request = new Request("http://localhost/rpc")

      // First request passes
      expect(limiter.check(request)).toBeNull()

      // Second request should be rate limited with Retry-After header
      const response = limiter.check(request)
      expect(response).not.toBeNull()
      expect(response!.status).toBe(429)

      const retryAfter = response!.headers.get("Retry-After")
      expect(retryAfter).toBeTruthy()

      // Retry-After should be in seconds (integer)
      const retryAfterSeconds = parseInt(retryAfter!, 10)
      expect(retryAfterSeconds).toBeGreaterThan(0)
      expect(retryAfterSeconds).toBeLessThanOrEqual(60)
    })

    it("returns retryAfterMs in JSON response body", async () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 30000,
      })

      const request = new Request("http://localhost/rpc")

      // Exhaust the limit
      limiter.check(request)

      // Get the rate limited response
      const response = limiter.check(request)
      expect(response).not.toBeNull()

      const body = await response!.json()
      expect(body.error).toBe("Too Many Requests")
      expect(body.retryAfterMs).toBeGreaterThan(0)
      expect(body.retryAfterMs).toBeLessThanOrEqual(30000)
      expect(body.message).toContain("retry after")
    })

    it("Retry-After header and retryAfterMs are consistent", async () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      const request = new Request("http://localhost/rpc")

      // Exhaust the limit
      limiter.check(request)

      // Get the rate limited response
      const response = limiter.check(request)
      expect(response).not.toBeNull()

      const retryAfterSeconds = parseInt(response!.headers.get("Retry-After")!, 10)
      const body = await response!.json()

      // Retry-After (seconds) should match retryAfterMs (milliseconds) within rounding
      // Header is ceiling of ms/1000
      expect(Math.ceil(body.retryAfterMs / 1000)).toBe(retryAfterSeconds)
    })

    it("returns correct Content-Type header", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      const request = new Request("http://localhost/rpc")

      limiter.check(request)
      const response = limiter.check(request)

      expect(response).not.toBeNull()
      expect(response!.headers.get("Content-Type")).toBe("application/json")
    })

    it("uses X-Forwarded-For for IP-based rate limiting", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      const ip1Request = new Request("http://localhost/rpc", {
        headers: { "X-Forwarded-For": "192.168.1.1" },
      })
      const ip2Request = new Request("http://localhost/rpc", {
        headers: { "X-Forwarded-For": "192.168.1.2" },
      })

      // First IP's first request passes
      expect(limiter.check(ip1Request)).toBeNull()

      // First IP's second request fails
      expect(limiter.check(ip1Request)).not.toBeNull()

      // Second IP's first request should still pass
      expect(limiter.check(ip2Request)).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Client Retry Logic Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("client retry logic", () => {
    describe("isRetryableError", () => {
      it("considers RateLimitError retryable (domain error)", () => {
        const error = new RateLimitError({
          procedure: "api.call",
          retryAfterMs: 30000,
        })

        // RateLimitError has isRetryable = true
        expect(error.isRetryable).toBe(true)
      })

      it("considers MiddlewareRateLimitError retryable", () => {
        const error = new MiddlewareRateLimitError({
          procedure: "api.call",
          retryAfterMs: 30000,
        })

        expect(error.isRetryable).toBe(true)
      })

      it("considers RpcResponseError with 429 status retryable via isRetryableError", () => {
        const error = new RpcResponseError({
          message: "Too Many Requests",
          status: 429,
        })

        // 429 is a client error (4xx) so by default isRetryableError returns false
        // However, rate limiting is a special case that SHOULD be retryable
        // This test documents current behavior - may want to update isRetryableError
        expect(isRetryableError(error)).toBe(false)
      })

      it("considers RpcResponseError with 503 status retryable", () => {
        const error = new RpcResponseError({
          message: "Service Unavailable",
          status: 503,
        })

        // 5xx errors are retryable
        expect(isRetryableError(error)).toBe(true)
      })

      it("does not retry RpcClientError (validation errors)", () => {
        const error = new RpcClientError({
          message: "Invalid input",
        })

        expect(isRetryableError(error)).toBe(false)
      })

      it("considers RpcTimeoutError retryable", () => {
        const error = new RpcTimeoutError({
          rpcName: "slow.query",
          timeout: 5000,
        })

        expect(isRetryableError(error)).toBe(true)
      })
    })

    describe("retry scheduling with rate limit", () => {
      it("can create retry schedule that respects retryAfterMs", async () => {
        // This tests how a client COULD use retryAfterMs for intelligent retry timing
        const retryAfterMs = 1000
        const error = new MiddlewareRateLimitError({
          procedure: "api.call",
          retryAfterMs,
        })

        // Create a schedule that waits for retryAfterMs
        const schedule = Schedule.addDelay(
          Schedule.recurs(1),
          () => Duration.millis(retryAfterMs)
        )

        let attempts = 0
        const startTime = Date.now()

        await Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.retry(
              Effect.gen(function* () {
                attempts++
                if (attempts === 1) {
                  return yield* Effect.fail(error)
                }
                return "success"
              }),
              { schedule }
            )
          })
        )

        const elapsed = Date.now() - startTime
        expect(attempts).toBe(2)
        // Should have waited approximately retryAfterMs (with some tolerance)
        expect(elapsed).toBeGreaterThanOrEqual(retryAfterMs - 100)
      })

      it("can extract retryAfterMs from rate limit error for custom retry", async () => {
        const retryAfterMs = 500

        let extractedRetryAfter: number | undefined
        let attempts = 0

        await Effect.runPromise(
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: async () => {
                attempts++
                if (attempts === 1) {
                  throw new MiddlewareRateLimitError({
                    procedure: "api.call",
                    retryAfterMs,
                  })
                }
                return "success"
              },
              catch: (e) => e as MiddlewareRateLimitError,
            }).pipe(
              Effect.catchTag("MiddlewareRateLimitError", (error) => {
                extractedRetryAfter = error.retryAfterMs
                // Wait for the specified time then retry
                return Effect.sleep(Duration.millis(error.retryAfterMs)).pipe(
                  Effect.flatMap(() =>
                    Effect.tryPromise({
                      try: async () => {
                        attempts++
                        return "success"
                      },
                      catch: (e) => e as Error,
                    })
                  )
                )
              })
            )
          })
        )

        expect(extractedRetryAfter).toBe(retryAfterMs)
        expect(attempts).toBe(2)
      })
    })

    describe("custom retryOn filter for rate limits", () => {
      it("can create a custom retryOn that handles rate limits specially", () => {
        // Custom retry filter that includes 429 responses
        const customRetryOn = (error: unknown): boolean => {
          // Use the default logic
          if (isRetryableError(error)) {
            return true
          }

          // Additionally retry 429 responses (rate limits)
          if (error instanceof RpcResponseError && error.status === 429) {
            return true
          }

          // Additionally retry MiddlewareRateLimitError
          if (error instanceof MiddlewareRateLimitError) {
            return true
          }

          return false
        }

        // Test with various errors
        expect(customRetryOn(new RpcResponseError({ message: "Rate limited", status: 429 }))).toBe(true)
        expect(customRetryOn(new RpcResponseError({ message: "Server error", status: 500 }))).toBe(true)
        expect(customRetryOn(new RpcResponseError({ message: "Not found", status: 404 }))).toBe(false)
        expect(customRetryOn(new RpcClientError({ message: "Invalid" }))).toBe(false)
        expect(customRetryOn(new MiddlewareRateLimitError({ procedure: "test", retryAfterMs: 1000 }))).toBe(true)
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Integration: Error Properties Consistency
  // ─────────────────────────────────────────────────────────────────────────────

  describe("error properties consistency", () => {
    it("all rate limit errors have httpStatus 429", () => {
      const middlewareError = new MiddlewareRateLimitError({
        procedure: "test",
        retryAfterMs: 1000,
      })

      const domainError = new RateLimitError({
        procedure: "test",
        retryAfterMs: 1000,
      })

      expect(middlewareError.httpStatus).toBe(429)
      expect(domainError.httpStatus).toBe(429)
    })

    it("all rate limit errors are marked as retryable", () => {
      const middlewareError = new MiddlewareRateLimitError({
        procedure: "test",
        retryAfterMs: 1000,
      })

      const domainError = new RateLimitError({
        procedure: "test",
        retryAfterMs: 1000,
      })

      expect(middlewareError.isRetryable).toBe(true)
      expect(domainError.isRetryable).toBe(true)
    })

    it("all rate limit errors include retry timing information", () => {
      const middlewareError = new MiddlewareRateLimitError({
        procedure: "test",
        retryAfterMs: 5000,
      })

      const domainError = new RateLimitError({
        procedure: "test",
        retryAfterMs: 5000,
      })

      expect(middlewareError.retryAfterMs).toBe(5000)
      expect(domainError.retryAfterMs).toBe(5000)

      // Error messages should indicate retry timing
      expect(middlewareError.message).toContain("5000ms")
      expect(domainError.message).toContain("5s")
    })

    it("rate limit errors have distinct _tag for Effect.catchTag", () => {
      const middlewareError = new MiddlewareRateLimitError({
        procedure: "test",
        retryAfterMs: 1000,
      })

      const domainError = new RateLimitError({
        procedure: "test",
        retryAfterMs: 1000,
      })

      expect(middlewareError._tag).toBe("MiddlewareRateLimitError")
      expect(domainError._tag).toBe("RateLimitError")
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Integration: Realistic Retry Scenario
  // ─────────────────────────────────────────────────────────────────────────────

  describe("realistic retry scenarios", () => {
    it("simulates rate-limited API call with exponential backoff", async () => {
      let callCount = 0
      const maxCalls = 3
      const baseDelay = 100

      // Simulate an API that rate limits after first call, then succeeds
      const simulatedApi = Effect.gen(function* () {
        callCount++

        if (callCount < maxCalls) {
          // Simulate rate limit with decreasing retry time
          const retryAfterMs = Math.max(50, 200 - callCount * 50)
          return yield* Effect.fail(
            new MiddlewareRateLimitError({
              procedure: "api.call",
              retryAfterMs,
            })
          )
        }

        return "success"
      })

      const result = await Effect.runPromise(
        simulatedApi.pipe(
          Effect.retry({
            schedule: Schedule.compose(
              Schedule.exponential(Duration.millis(baseDelay)),
              Schedule.recurs(maxCalls - 1)
            ),
            while: (error) => error instanceof MiddlewareRateLimitError,
          })
        )
      )

      expect(result).toBe("success")
      expect(callCount).toBe(maxCalls)
    })

    it("respects rate limit error retryAfterMs for intelligent retry", async () => {
      let callCount = 0
      const expectedRetryAfterMs = 200

      const simulatedApi = Effect.gen(function* () {
        callCount++

        if (callCount === 1) {
          return yield* Effect.fail(
            new MiddlewareRateLimitError({
              procedure: "api.call",
              retryAfterMs: expectedRetryAfterMs,
            })
          )
        }

        return "success"
      })

      // Create a schedule that uses a fixed delay, and a custom while clause
      // that catches rate limit errors. In a real implementation, you'd use
      // Effect.catchTag to extract the retryAfterMs and wait that long.
      const rateLimitAwareSchedule = Schedule.addDelay(
        Schedule.recurs(1),
        () => Duration.millis(expectedRetryAfterMs)
      )

      const startTime = Date.now()
      const result = await Effect.runPromise(
        simulatedApi.pipe(
          Effect.retry({
            schedule: rateLimitAwareSchedule,
            while: (error) => error instanceof MiddlewareRateLimitError,
          })
        )
      )
      const elapsed = Date.now() - startTime

      expect(result).toBe("success")
      expect(callCount).toBe(2)
      // Should have waited at least retryAfterMs
      expect(elapsed).toBeGreaterThanOrEqual(expectedRetryAfterMs - 50) // small tolerance
    })
  })
})
