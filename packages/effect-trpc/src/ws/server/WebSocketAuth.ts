/**
 * @module effect-trpc/ws/server/WebSocketAuth
 *
 * Service for WebSocket authentication.
 * Users must provide their own implementation.
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"

import type { ClientId } from "../types.js"
import { generateClientId } from "../types.js"
import type { WebSocketAuthError } from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Auth Result
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of successful authentication.
 *
 * @since 0.1.0
 * @category Models
 */
export interface AuthResult {
  /** Unique user identifier */
  readonly userId: string
  /** Generated client connection ID */
  readonly clientId: ClientId
  /** Optional metadata to attach to the connection */
  readonly metadata: Record<string, unknown>
  /** Optional permissions for authorization checks */
  readonly permissions?: ReadonlyArray<string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service for WebSocket authentication.
 *
 * @example
 * ```ts
 * import { WebSocketAuth, makeWebSocketAuth } from 'effect-trpc/ws/server'
 *
 * // Create custom auth
 * const MyAuthLive = makeWebSocketAuth({
 *   authenticate: (token) => Effect.gen(function* () {
 *     // Validate token and return auth result
 *   }),
 *   canSubscribe: (path, auth) => Effect.succeed(true)
 * })
 *
 * // For development/testing
 * const program = Effect.gen(function* () {
 *   const auth = yield* WebSocketAuth
 *   // ...
 * }).pipe(Effect.provide(WebSocketAuth.Test))
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class WebSocketAuth extends Context.Tag("@effect-trpc/WebSocketAuth")<
  WebSocketAuth,
  WebSocketAuth.Service
>() {
  /**
   * Test layer that accepts any token.
   * Uses the token as the userId.
   *
   * @warning DO NOT use in production!
   *
   * @since 0.1.0
   * @category Layers
   */
  static Test: Layer.Layer<WebSocketAuth>
}

/**
 * @since 0.1.0
 */
export declare namespace WebSocketAuth {
  /**
   * The service interface for WebSocketAuth.
   *
   * @since 0.1.0
   * @category Models
   */
  export interface Service {
    /**
     * Validate a token and return auth result.
     * Called when client sends Auth message after connecting.
     */
    readonly authenticate: (
      token: string,
    ) => Effect.Effect<AuthResult, WebSocketAuthError>

    /**
     * Check if a user can subscribe to a specific procedure.
     * Called before starting each subscription.
     *
     * @param auth - The authenticated user's info
     * @param path - Procedure path (e.g., "notifications.watch")
     * @param input - The subscription input
     * @returns true if allowed, false if denied
     */
    readonly canSubscribe: (
      auth: AuthResult,
      path: string,
      input: unknown,
    ) => Effect.Effect<boolean, WebSocketAuthError>

    /**
     * Generate a unique client ID.
     * Default implementation uses timestamp + random string.
     */
    readonly generateClientId: Effect.Effect<ClientId>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Handler Type (for user convenience)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User-provided authentication handler.
 * Simplified interface - only requires authenticate function.
 *
 * @since 0.1.0
 * @category Models
 */
export interface WebSocketAuthHandler {
  /**
   * Validate a token and return user info.
   */
  readonly authenticate: (
    token: string,
  ) => Effect.Effect<
    { readonly userId: string; readonly metadata?: Record<string, unknown>; readonly permissions?: ReadonlyArray<string> },
    WebSocketAuthError
  >

  /**
   * Optional: Check if user can subscribe to a procedure.
   * Defaults to allowing all subscriptions.
   */
  readonly canSubscribe?: (
    auth: AuthResult,
    path: string,
    input: unknown,
  ) => Effect.Effect<boolean, WebSocketAuthError>
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a WebSocketAuth layer from a handler.
 *
 * @example
 * ```ts
 * import { makeWebSocketAuth } from 'effect-trpc/ws/server'
 *
 * const AuthLive = makeWebSocketAuth({
 *   authenticate: (token) =>
 *     Effect.gen(function* () {
 *       const jwt = yield* JwtService
 *       const payload = yield* jwt.verify(token)
 *       return {
 *         userId: payload.sub,
 *         metadata: { role: payload.role },
 *         permissions: payload.permissions,
 *       }
 *     }),
 *
 *   canSubscribe: (auth, path, _input) =>
 *     Effect.succeed(
 *       path.startsWith("admin.")
 *         ? auth.permissions?.includes("admin") ?? false
 *         : true
 *     ),
 * })
 * ```
 *
 * @since 0.1.0
 * @category Constructors
 */
export const makeWebSocketAuth = (
  handler: WebSocketAuthHandler,
): Layer.Layer<WebSocketAuth> =>
  Layer.succeed(
    WebSocketAuth,
    {
      authenticate: (token) =>
        Effect.gen(function* () {
          const result = yield* handler.authenticate(token)
          const clientId = yield* generateClientId
          const authResult: AuthResult = {
            userId: result.userId,
            clientId,
            metadata: result.metadata ?? {},
          }
          // Only add permissions if defined
          if (result.permissions !== undefined) {
            return { ...authResult, permissions: result.permissions }
          }
          return authResult
        }),

      canSubscribe: handler.canSubscribe !== undefined
        ? handler.canSubscribe
        : (_auth, _path, _input) => Effect.succeed(true),

      generateClientId,
    },
  )

// ─────────────────────────────────────────────────────────────────────────────
// Test/Development Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a simple auth layer for testing.
 * Accepts any token and uses it as the userId.
 *
 * @warning DO NOT use in production!
 *
 * @since 0.1.0
 * @category Layers
 */
export const WebSocketAuthTest: Layer.Layer<WebSocketAuth> = Layer.succeed(
  WebSocketAuth,
  {
    authenticate: (token) =>
      Effect.gen(function* () {
        const clientId = yield* generateClientId
        return {
          userId: token,
          clientId,
          metadata: { test: true },
        }
      }),

    canSubscribe: () => Effect.succeed(true),

    generateClientId,
  },
)

// Assign static property after layer is defined
WebSocketAuth.Test = WebSocketAuthTest
