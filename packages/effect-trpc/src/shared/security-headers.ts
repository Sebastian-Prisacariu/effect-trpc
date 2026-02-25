/**
 * @module effect-trpc/shared/security-headers
 *
 * Security headers utilities for HTTP responses.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for configuring security headers.
 * @since 0.1.0
 * @category Types
 */
export interface SecurityHeadersOptions {
  /**
   * X-Content-Type-Options header value.
   * Prevents MIME type sniffing.
   * @default "nosniff"
   */
  readonly contentTypeOptions?: string | false

  /**
   * X-Frame-Options header value.
   * Prevents clickjacking attacks.
   * @default "DENY"
   */
  readonly frameOptions?: string | false

  /**
   * X-XSS-Protection header value.
   * Legacy XSS protection for older browsers.
   * @default "1; mode=block"
   */
  readonly xssProtection?: string | false

  /**
   * Referrer-Policy header value.
   * Controls how much referrer information is sent.
   * @default "strict-origin-when-cross-origin"
   */
  readonly referrerPolicy?: string | false

  /**
   * Content-Security-Policy header value.
   * Not set by default - should be configured per application.
   * @default undefined
   */
  readonly contentSecurityPolicy?: string

  /**
   * Additional custom headers to add.
   */
  readonly customHeaders?: Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Headers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default security headers applied to all responses.
 * These can be overridden or disabled via SecurityHeadersOptions.
 */
export const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build security headers from options.
 *
 * @param options - Security headers configuration. Pass `true` for defaults,
 *                  `false` to disable, or an object to customize.
 * @returns Record of header name to value, or null if disabled
 *
 * @example
 * ```ts
 * // Use all defaults
 * const headers = buildSecurityHeaders(true)
 *
 * // Disable security headers
 * const headers = buildSecurityHeaders(false)
 *
 * // Customize
 * const headers = buildSecurityHeaders({
 *   frameOptions: "SAMEORIGIN",
 *   contentSecurityPolicy: "default-src 'self'",
 * })
 *
 * // Disable specific header
 * const headers = buildSecurityHeaders({
 *   xssProtection: false, // Don't set X-XSS-Protection
 * })
 * ```
 */
export function buildSecurityHeaders(
  options: boolean | SecurityHeadersOptions,
): Record<string, string> | null {
  // Disabled
  if (options === false) {
    return null
  }

  // Default headers
  if (options === true) {
    return { ...DEFAULT_SECURITY_HEADERS }
  }

  // Custom configuration
  const headers: Record<string, string> = {}

  // X-Content-Type-Options
  if (options.contentTypeOptions !== false) {
    headers["X-Content-Type-Options"] =
      options.contentTypeOptions ?? DEFAULT_SECURITY_HEADERS["X-Content-Type-Options"]!
  }

  // X-Frame-Options
  if (options.frameOptions !== false) {
    headers["X-Frame-Options"] =
      options.frameOptions ?? DEFAULT_SECURITY_HEADERS["X-Frame-Options"]!
  }

  // X-XSS-Protection
  if (options.xssProtection !== false) {
    headers["X-XSS-Protection"] =
      options.xssProtection ?? DEFAULT_SECURITY_HEADERS["X-XSS-Protection"]!
  }

  // Referrer-Policy
  if (options.referrerPolicy !== false) {
    headers["Referrer-Policy"] =
      options.referrerPolicy ?? DEFAULT_SECURITY_HEADERS["Referrer-Policy"]!
  }

  // Content-Security-Policy (only if explicitly set)
  if (options.contentSecurityPolicy) {
    headers["Content-Security-Policy"] = options.contentSecurityPolicy
  }

  // Custom headers
  if (options.customHeaders) {
    Object.assign(headers, options.customHeaders)
  }

  return headers
}

/**
 * Add security headers to an existing Headers object.
 * Only sets headers that are not already present (user-provided headers take precedence).
 *
 * @param headers - The Headers object to modify (mutated in place)
 * @param securityHeaders - The security headers to add
 * @returns The same Headers object for chaining
 */
export function addSecurityHeaders(
  headers: Headers,
  securityHeaders: Record<string, string>,
): Headers {
  for (const [key, value] of Object.entries(securityHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  }
  return headers
}
