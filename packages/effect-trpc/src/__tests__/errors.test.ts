import { describe, it, expect } from "vitest"
import {
  isTRPCError,
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  TimeoutError,
  InternalError,
  NetworkError,
} from "../errors/index.js"

describe("TRPCError types", () => {
  it("InputValidationError has correct properties", () => {
    const error = new InputValidationError({
      procedure: "user.create",
      field: "email",
      description: "Invalid email format",
    })

    expect(error._tag).toBe("InputValidationError")
    expect(error.procedure).toBe("user.create")
    expect(error.field).toBe("email")
    expect(error.isRetryable).toBe(false)
    expect(error.httpStatus).toBe(400)
    expect(error.message).toContain("user.create")
    expect(error.message).toContain("email")
    expect(isTRPCError(error)).toBe(true)
  })

  it("NotFoundError has correct properties", () => {
    const error = new NotFoundError({
      procedure: "user.byId",
      resource: "User",
      resourceId: "123",
    })

    expect(error._tag).toBe("NotFoundError")
    expect(error.httpStatus).toBe(404)
    expect(error.isRetryable).toBe(false)
    expect(error.message).toContain("User")
    expect(error.message).toContain("123")
    expect(isTRPCError(error)).toBe(true)
  })

  it("UnauthorizedError has correct properties", () => {
    const error = new UnauthorizedError({
      procedure: "user.update",
    })

    expect(error._tag).toBe("UnauthorizedError")
    expect(error.httpStatus).toBe(401)
    expect(error.isRetryable).toBe(false)
    expect(error.message).toContain("Authentication required")
    expect(isTRPCError(error)).toBe(true)
  })

  it("ForbiddenError has correct properties", () => {
    const error = new ForbiddenError({
      procedure: "admin.delete",
      requiredPermission: "admin:delete",
    })

    expect(error._tag).toBe("ForbiddenError")
    expect(error.httpStatus).toBe(403)
    expect(error.isRetryable).toBe(false)
    expect(error.message).toContain("Access denied")
    expect(error.message).toContain("admin:delete")
    expect(isTRPCError(error)).toBe(true)
  })

  it("RateLimitError is retryable", () => {
    const error = new RateLimitError({
      procedure: "api.call",
      retryAfterMs: 30000,
    })

    expect(error._tag).toBe("RateLimitError")
    expect(error.httpStatus).toBe(429)
    expect(error.isRetryable).toBe(true)
    expect(error.message).toContain("Rate limit exceeded")
    expect(error.message).toContain("30s")
    expect(isTRPCError(error)).toBe(true)
  })

  it("TimeoutError is retryable", () => {
    const error = new TimeoutError({
      procedure: "slow.query",
      timeoutMs: 5000,
    })

    expect(error._tag).toBe("TimeoutError")
    expect(error.httpStatus).toBe(504)
    expect(error.isRetryable).toBe(true)
    expect(error.message).toContain("5000ms")
    expect(isTRPCError(error)).toBe(true)
  })

  it("InternalError has correct properties", () => {
    const error = new InternalError({
      procedure: "user.create",
      description: "Database connection failed",
    })

    expect(error._tag).toBe("InternalError")
    expect(error.httpStatus).toBe(500)
    expect(error.isRetryable).toBe(false)
    expect(error.message).toContain("Database connection failed")
    expect(isTRPCError(error)).toBe(true)
  })

  it("NetworkError is client-side and retryable", () => {
    const error = new NetworkError({
      procedure: "user.list",
      reason: "Offline",
    })

    expect(error._tag).toBe("NetworkError")
    expect(error.httpStatus).toBe(0) // No HTTP response
    expect(error.isRetryable).toBe(true)
    expect(error.message).toContain("Offline")
    expect(isTRPCError(error)).toBe(true)
  })

  it("isTRPCError returns false for non-TRPC errors", () => {
    expect(isTRPCError(new Error("regular error"))).toBe(false)
    expect(isTRPCError(null)).toBe(false)
    expect(isTRPCError(undefined)).toBe(false)
    expect(isTRPCError({ _tag: "SomeError" })).toBe(false)
  })
})
