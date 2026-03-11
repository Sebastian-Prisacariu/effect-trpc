/**
 * Server module - Handle incoming RPC requests
 * 
 * @since 1.0.0
 */

import { Effect, Layer } from "effect"
import type { Router, RouterDefinition } from "./Router.js"

// =============================================================================
// Route Handler Types
// =============================================================================

/**
 * Next.js App Router handler
 * 
 * @since 1.0.0
 * @category models
 */
export interface NextRouteHandler {
  readonly GET: (request: Request) => Promise<Response>
  readonly POST: (request: Request) => Promise<Response>
}

/**
 * Generic HTTP handler
 * 
 * @since 1.0.0
 * @category models
 */
export interface HttpHandler {
  readonly handle: (request: Request) => Promise<Response>
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Configuration for route handler
 * 
 * @since 1.0.0
 * @category models
 */
export interface RouteHandlerConfig<Requirements> {
  /**
   * Layer providing all procedure requirements
   */
  readonly layer: Layer.Layer<Requirements, never, never>
  
  /**
   * Base path for the handler (default: "/")
   */
  readonly basePath?: string
  
  /**
   * Custom error handler
   */
  readonly onError?: (error: unknown, path: string) => void
  
  /**
   * Request timeout
   */
  readonly timeout?: number
}

/**
 * Create a Next.js App Router handler
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * // app/api/trpc/[...trpc]/route.ts
 * import { Server } from "effect-trpc/server"
 * import { AppRouter } from "@/lib/router"
 * import { LiveLayer } from "@/lib/layers"
 * 
 * export const { GET, POST } = Server.createRouteHandler(AppRouter, {
 *   layer: LiveLayer,
 * })
 * ```
 */
export const createRouteHandler = <R extends RouterDefinition, Requirements>(
  router: Router<R, Requirements>,
  config: RouteHandlerConfig<Requirements>
): NextRouteHandler => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

/**
 * Create a generic HTTP handler
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Server } from "effect-trpc/server"
 * 
 * const handler = Server.createHandler(AppRouter, {
 *   layer: LiveLayer,
 * })
 * 
 * // Use with any HTTP server
 * server.on("request", async (req, res) => {
 *   const response = await handler.handle(req)
 *   res.writeHead(response.status, response.headers)
 *   res.end(await response.text())
 * })
 * ```
 */
export const createHandler = <R extends RouterDefinition, Requirements>(
  router: Router<R, Requirements>,
  config: RouteHandlerConfig<Requirements>
): HttpHandler => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

// =============================================================================
// Server-side Client
// =============================================================================

/**
 * Create a server-side caller for direct procedure invocation
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Server } from "effect-trpc/server"
 * 
 * const caller = Server.createCaller(AppRouter, {
 *   layer: LiveLayer,
 * })
 * 
 * // Call procedures directly (no HTTP)
 * const users = await caller.user.list.run({})
 * ```
 */
export const createCaller = <R extends RouterDefinition, Requirements>(
  router: Router<R, Requirements>,
  config: {
    readonly layer: Layer.Layer<Requirements, never, never>
  }
): CallerClient<R> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

/**
 * Server-side caller client type
 */
export type CallerClient<R extends RouterDefinition> = {
  readonly [K in keyof R]: R[K] extends RouterDefinition
    ? CallerClient<R[K]>
    : R[K] extends { readonly handler: (payload: infer P) => Effect.Effect<infer A, infer E, any> }
      ? {
          readonly run: (payload: P) => Promise<A>
          readonly runEffect: (payload: P) => Effect.Effect<A, E>
        }
      : never
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Extract context from request (for middleware)
 * 
 * @since 1.0.0
 * @category utilities
 */
export const extractContext = (request: Request): {
  readonly headers: Headers
  readonly url: URL
  readonly method: string
} => ({
  headers: request.headers,
  url: new URL(request.url),
  method: request.method,
})
