/**
 * @module effect-trpc/shared/http-rate-limit
 *
 * HTTP-level rate limiting for the RPC endpoint.
 * This runs BEFORE the RPC handler and returns proper 429 responses with Retry-After header.
 *
 * This is separate from procedure-level rate limiting (MiddlewareRateLimitError)
 * which is part of the RPC protocol and serializes errors in the response body.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for HTTP-level rate limiting.
 *
 * @since 0.1.0
 * @category types
 */
export interface HttpRateLimitOptions {
  /**
   * Maximum number of requests allowed per window.
   */
  readonly maxRequests: number

  /**
   * Time window in milliseconds.
   */
  readonly windowMs: number

  /**
   * Function to extract a rate limit key from the request.
   * Defaults to using the client IP address.
   *
   * @param request - The incoming request
   * @returns The rate limit key (e.g., IP address, API key)
   */
  readonly keyFn?: (request: Request) => string

  /**
   * Maximum number of keys to track.
   * When exceeded, expired entries are cleaned up.
   * @default 10000
   */
  readonly maxKeys?: number
}

/**
 * State for tracking rate limit entries.
 */
interface RateLimitEntry {
  count: number
  resetAt: number
}

/**
 * Result of a rate limit check.
 */
interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default key extraction function.
 * Extracts client IP from common headers or falls back to "unknown".
 */
const defaultKeyFn = (request: Request): string => {
  // Check common forwarding headers
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]
    if (firstIp) {
      return firstIp.trim()
    }
  }

  const realIp = request.headers.get("x-real-ip")
  if (realIp) {
    return realIp
  }

  // Cloudflare
  const cfIp = request.headers.get("cf-connecting-ip")
  if (cfIp) {
    return cfIp
  }

  return "unknown"
}

/**
 * Create an HTTP-level rate limiter.
 *
 * Unlike the procedure-level rate limiting middleware, this operates at the HTTP level
 * and returns proper 429 responses with Retry-After headers before any RPC processing.
 *
 * @example
 * ```ts
 * const rateLimiter = createHttpRateLimiter({
 *   maxRequests: 100,
 *   windowMs: 60000, // 1 minute
 * })
 *
 * // In your handler:
 * const rateLimitResponse = rateLimiter.check(request)
 * if (rateLimitResponse) {
 *   return rateLimitResponse // Returns 429 with Retry-After
 * }
 * // Continue with RPC handling...
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export function createHttpRateLimiter(options: HttpRateLimitOptions): {
  /**
   * Check if a request is rate limited.
   * Returns a 429 Response if rate limited, or null if allowed.
   */
  readonly check: (request: Request) => Response | null

  /**
   * Clear all rate limit state.
   * Useful for testing.
   */
  readonly clear: () => void
} {
  const { maxRequests, windowMs, keyFn = defaultKeyFn, maxKeys = 10000 } = options

  const state = new Map<string, RateLimitEntry>()

  /**
   * Clean up expired entries when the map gets too large.
   */
  const cleanup = (nowMs: number): void => {
    if (state.size <= maxKeys) return

    for (const [key, entry] of state) {
      if (entry.resetAt <= nowMs) {
        state.delete(key)
      }
    }
  }

  /**
   * Check rate limit for a given key.
   */
  const checkRateLimit = (key: string, nowMs: number): RateLimitResult => {
    // Clean up if we have too many keys
    cleanup(nowMs)

    const entry = state.get(key)

    // No entry or window expired - create new entry
    if (!entry || nowMs > entry.resetAt) {
      state.set(key, { count: 1, resetAt: nowMs + windowMs })
      return { allowed: true, retryAfterMs: 0 }
    }

    // Check if over limit
    const newCount = entry.count + 1
    if (newCount > maxRequests) {
      return { allowed: false, retryAfterMs: entry.resetAt - nowMs }
    }

    // Increment count
    entry.count = newCount
    return { allowed: true, retryAfterMs: 0 }
  }

  return {
    check: (request: Request): Response | null => {
      const key = keyFn(request)
      const nowMs = Date.now()
      const result = checkRateLimit(key, nowMs)

      if (result.allowed) {
        return null
      }

      // Calculate Retry-After in seconds (rounded up)
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000)

      return new Response(
        JSON.stringify({
          error: "Too Many Requests",
          message: `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
          retryAfterMs: result.retryAfterMs,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSeconds),
          },
        },
      )
    },

    clear: (): void => {
      state.clear()
    },
  }
}

/**
 * Type for the rate limiter instance.
 *
 * @since 0.1.0
 * @category types
 */
export type HttpRateLimiter = ReturnType<typeof createHttpRateLimiter>
