/**
 * @module effect-trpc/shared/cors
 *
 * Shared CORS utilities for Node.js and Bun adapters.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CORS Options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CORS configuration options.
 */
export interface CorsOptions {
  /**
   * Allowed origins. Can be:
   * - `"*"` to allow all origins
   * - A single origin string (e.g., `"https://example.com"`)
   * - An array of allowed origins (will check against request Origin header)
   *
   * @default "*"
   */
  readonly origins?: string | readonly string[]

  /**
   * Allowed methods.
   * @default ["GET", "POST", "OPTIONS"]
   */
  readonly methods?: readonly string[]

  /**
   * Allowed headers.
   * @default ["Content-Type"]
   */
  readonly headers?: readonly string[]

  /**
   * Whether to include credentials (cookies, authorization headers).
   * @default false
   */
  readonly credentials?: boolean

  /**
   * Max age in seconds for preflight cache.
   */
  readonly maxAge?: number

  /**
   * Headers to expose to the client.
   */
  readonly exposedHeaders?: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS Header Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build static CORS headers from options.
 * For multiple origins, use `buildCorsHeadersForRequest` instead.
 *
 * @remarks
 * `Access-Control-Allow-Origin` cannot accept comma-separated values.
 * If you have multiple allowed origins, pass the request to
 * `buildCorsHeadersForRequest` which will check the Origin header.
 */
export function buildCorsHeaders(options: CorsOptions): Record<string, string> {
  const origins = options.origins ?? "*"
  const methods = options.methods ?? ["GET", "POST", "OPTIONS"]
  const headers = options.headers ?? ["Content-Type"]

  // For single origin or wildcard, return static headers
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const origin = Array.isArray(origins) ? origins[0] ?? "*" : String(origins)

  const result: Record<string, string> = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": headers.join(", "),
  }

  if (options.credentials) {
    result["Access-Control-Allow-Credentials"] = "true"
  }

  if (options.maxAge !== undefined) {
    result["Access-Control-Max-Age"] = String(options.maxAge)
  }

  if (options.exposedHeaders && options.exposedHeaders.length > 0) {
    result["Access-Control-Expose-Headers"] = options.exposedHeaders.join(", ")
  }

  // If multiple origins configured, add Vary header
  if (Array.isArray(origins) && origins.length > 1) {
    result["Vary"] = "Origin"
  }

  return result
}

/**
 * Build CORS headers for a specific request.
 * Checks the request's Origin header against allowed origins.
 *
 * @param options - CORS configuration
 * @param requestOrigin - The Origin header from the request
 * @returns CORS headers with the correct origin, or null if origin not allowed
 */
export function buildCorsHeadersForRequest(
  options: CorsOptions,
  requestOrigin: string | null,
): Record<string, string> | null {
  const origins = options.origins ?? "*"
  const methods = options.methods ?? ["GET", "POST", "OPTIONS"]
  const headers = options.headers ?? ["Content-Type"]

  // Determine the allowed origin for this request
  let allowedOrigin: string | null = null

  if (origins === "*") {
    // Allow all origins
    allowedOrigin = "*"
  } else if (Array.isArray(origins)) {
    // Check if request origin is in the allowed list
    if (requestOrigin && origins.includes(requestOrigin)) {
      allowedOrigin = requestOrigin
    }
  } else {
    // Single origin - must match exactly
    if (requestOrigin === origins || origins === "*") {
      allowedOrigin = origins
    }
  }

  // If origin not allowed, return null
  if (!allowedOrigin) {
    return null
  }

  const result: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": methods.join(", "),
    "Access-Control-Allow-Headers": headers.join(", "),
  }

  if (options.credentials) {
    result["Access-Control-Allow-Credentials"] = "true"
  }

  if (options.maxAge !== undefined) {
    result["Access-Control-Max-Age"] = String(options.maxAge)
  }

  if (options.exposedHeaders && options.exposedHeaders.length > 0) {
    result["Access-Control-Expose-Headers"] = options.exposedHeaders.join(", ")
  }

  // Add Vary header when origin is dynamic (not wildcard)
  if (allowedOrigin !== "*") {
    result["Vary"] = "Origin"
  }

  return result
}
