/**
 * @module effect-trpc/tests/http-rate-limit
 *
 * Tests for HTTP-level rate limiting with Retry-After header.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createHttpRateLimiter } from "../shared/http-rate-limit.js"

describe("HTTP Rate Limiter", () => {
  describe("createHttpRateLimiter", () => {
    it("allows requests within the rate limit", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 3,
        windowMs: 60000,
      })

      const request = new Request("http://localhost/rpc")

      // First 3 requests should pass
      expect(limiter.check(request)).toBeNull()
      expect(limiter.check(request)).toBeNull()
      expect(limiter.check(request)).toBeNull()
    })

    it("returns 429 response when rate limit exceeded", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 2,
        windowMs: 60000,
      })

      const request = new Request("http://localhost/rpc")

      // First 2 requests pass
      expect(limiter.check(request)).toBeNull()
      expect(limiter.check(request)).toBeNull()

      // Third request should be rate limited
      const response = limiter.check(request)
      expect(response).not.toBeNull()
      expect(response!.status).toBe(429)
    })

    it("includes Retry-After header in 429 response", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000, // 60 seconds
      })

      const request = new Request("http://localhost/rpc")

      // First request passes
      expect(limiter.check(request)).toBeNull()

      // Second request should be rate limited
      const response = limiter.check(request)
      expect(response).not.toBeNull()
      expect(response!.headers.get("Retry-After")).toBeDefined()

      // Retry-After should be a number (in seconds)
      const retryAfter = parseInt(response!.headers.get("Retry-After")!, 10)
      expect(retryAfter).toBeGreaterThan(0)
      expect(retryAfter).toBeLessThanOrEqual(60) // Should be at most 60 seconds
    })

    it("returns JSON error body with retryAfterMs", async () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 30000, // 30 seconds
      })

      const request = new Request("http://localhost/rpc")

      // First request passes
      limiter.check(request)

      // Second request should be rate limited
      const response = limiter.check(request)
      expect(response).not.toBeNull()

      const body = await response!.json()
      expect(body.error).toBe("Too Many Requests")
      expect(body.retryAfterMs).toBeGreaterThan(0)
      expect(body.retryAfterMs).toBeLessThanOrEqual(30000)
    })

    it("uses custom key function for rate limiting", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 2,
        windowMs: 60000,
        keyFn: (request) => request.headers.get("X-API-Key") ?? "anonymous",
      })

      const request1 = new Request("http://localhost/rpc", {
        headers: { "X-API-Key": "key-1" },
      })
      const request2 = new Request("http://localhost/rpc", {
        headers: { "X-API-Key": "key-2" },
      })

      // Each key gets its own quota
      expect(limiter.check(request1)).toBeNull()
      expect(limiter.check(request1)).toBeNull()
      expect(limiter.check(request2)).toBeNull()
      expect(limiter.check(request2)).toBeNull()

      // Third request from key-1 should be rate limited
      expect(limiter.check(request1)).not.toBeNull()
      // Third request from key-2 should also be rate limited
      expect(limiter.check(request2)).not.toBeNull()
    })

    it("extracts IP from X-Forwarded-For header by default", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      // Different IPs should have separate rate limits
      const request1 = new Request("http://localhost/rpc", {
        headers: { "X-Forwarded-For": "192.168.1.1" },
      })
      const request2 = new Request("http://localhost/rpc", {
        headers: { "X-Forwarded-For": "192.168.1.2" },
      })

      expect(limiter.check(request1)).toBeNull()
      expect(limiter.check(request2)).toBeNull()

      // Second request from same IP should be rate limited
      expect(limiter.check(request1)).not.toBeNull()
      expect(limiter.check(request2)).not.toBeNull()
    })

    it("extracts first IP from comma-separated X-Forwarded-For", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      const request1 = new Request("http://localhost/rpc", {
        headers: { "X-Forwarded-For": "192.168.1.1, 10.0.0.1, 172.16.0.1" },
      })
      const request2 = new Request("http://localhost/rpc", {
        headers: { "X-Forwarded-For": "192.168.1.1" },
      })

      expect(limiter.check(request1)).toBeNull()
      // Same first IP should be rate limited
      expect(limiter.check(request2)).not.toBeNull()
    })

    it("clears rate limit state", () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 60000,
      })

      const request = new Request("http://localhost/rpc")

      expect(limiter.check(request)).toBeNull()
      expect(limiter.check(request)).not.toBeNull()

      // Clear the state
      limiter.clear()

      // Should be allowed again
      expect(limiter.check(request)).toBeNull()
    })

    it("returns Content-Type: application/json", () => {
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
  })

  describe("window expiration", () => {
    it("allows requests after window expires", async () => {
      const limiter = createHttpRateLimiter({
        maxRequests: 1,
        windowMs: 100, // 100ms window
      })

      const request = new Request("http://localhost/rpc")

      expect(limiter.check(request)).toBeNull()
      expect(limiter.check(request)).not.toBeNull()

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should be allowed again
      expect(limiter.check(request)).toBeNull()
    })
  })
})
