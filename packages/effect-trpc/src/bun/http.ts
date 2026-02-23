/**
 * @module effect-trpc/bun/http
 *
 * HTTP-only Bun adapter for effect-trpc.
 * Use this if you don't need WebSocket support to reduce bundle size.
 *
 * @example
 * ```ts
 * import { createFetchHandler, createServer } from "effect-trpc/bun/http"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 *
 * // Option 1: Use createServer for simple setup
 * const server = createServer({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 *   port: 3000,
 * })
 *
 * // Option 2: Use with Bun.serve directly
 * const handler = createFetchHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * Bun.serve({
 *   port: 3000,
 *   fetch: handler.fetch,
 * })
 * ```
 */

import * as Layer from "effect/Layer"
import * as BunContext from "@effect/platform-bun/BunContext"
import * as BunHttpPlatform from "@effect/platform-bun/BunHttpPlatform"
import type { Router } from "../core/router.js"
import { type CorsOptions, buildCorsHeaders, createRpcWebHandler } from "../shared/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateServerOptions<TRouter extends Router, R> {
  /**
   * The router instance.
   */
  readonly router: TRouter

  /**
   * The layer providing all procedure implementations.
   */
  readonly handlers: Layer.Layer<any, never, R>

  /**
   * Port to listen on.
   * @default 3000
   */
  readonly port?: number

  /**
   * Host to bind to.
   * @default "0.0.0.0"
   */
  readonly host?: string

  /**
   * Path for the RPC endpoint.
   * @default "/rpc"
   */
  readonly path?: string

  /**
   * Disable OpenTelemetry tracing.
   * @default false
   */
  readonly disableTracing?: boolean

  /**
   * Prefix for span names.
   * @default "@effect-trpc"
   */
  readonly spanPrefix?: string

  /**
   * Enable CORS headers.
   * @default false
   */
  readonly cors?: boolean | CorsOptions
}

// Re-export CorsOptions for convenience
export type { CorsOptions }

export interface FetchHandler {
  /**
   * The fetch handler for Bun.serve().
   */
  readonly fetch: (request: Request) => Promise<Response>

  /**
   * Dispose of handler resources.
   */
  readonly dispose: () => Promise<void>
}

export interface BunServerInstance {
  /**
   * The Bun server instance.
   */
  readonly server: ReturnType<typeof Bun.serve>

  /**
   * The port the server is listening on.
   */
  readonly port: number

  /**
   * Dispose of server resources.
   */
  readonly dispose: () => Promise<void>

  /**
   * Stop the server.
   */
  readonly stop: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Bun type declarations (available at runtime in Bun)
// ─────────────────────────────────────────────────────────────────────────────

declare const Bun: {
  serve(options: {
    port?: number
    hostname?: string
    fetch: (request: Request) => Response | Promise<Response> | undefined
  }): {
    port: number
    hostname: string
    stop(): void
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch Handler Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a fetch handler for use with Bun.serve().
 *
 * @example
 * ```ts
 * import { createFetchHandler } from "effect-trpc/bun/http"
 *
 * const handler = createFetchHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * Bun.serve({
 *   port: 3000,
 *   fetch: handler.fetch,
 * })
 * ```
 */
export function createFetchHandler<TRouter extends Router, R>(
  options: Omit<CreateServerOptions<TRouter, R>, "port" | "host">,
): FetchHandler {
  const { router, handlers, path = "/rpc", disableTracing, spanPrefix, cors } = options

  const handlersWithBunRuntime = handlers.pipe(
    Layer.provide(BunHttpPlatform.layer),
    Layer.provide(BunContext.layer),
  )

  // Create the web handler using shared utility
  const webHandler = createRpcWebHandler({
    router,
    handlers: handlersWithBunRuntime,
    disableTracing,
    spanPrefix,
  })

  // Build CORS headers if enabled
  const corsHeaders = cors ? buildCorsHeaders(cors === true ? {} : cors) : null

  if (corsHeaders) {
    return {
      fetch: async (request: Request) => {
        // Handle preflight
        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders })
        }

        // Check path - must be exact match or have path separator after
        // This prevents "/rpc-admin" from matching when path is "/rpc"
        const url = new URL(request.url)
        const pathname = url.pathname
        const pathMatches =
          pathname === path || pathname.startsWith(path + "/") || pathname.startsWith(path + "?")

        if (!pathMatches) {
          return new Response("Not Found", { status: 404 })
        }

        // Handle RPC request
        const response = await webHandler.handler(request)

        // Add CORS headers to response
        const headers = new Headers(response.headers)
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value)
        }

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      },
      dispose: webHandler.dispose,
    }
  }

  // No CORS - just check path
  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      const pathname = url.pathname
      const pathMatches =
        pathname === path || pathname.startsWith(path + "/") || pathname.startsWith(path + "?")

      if (!pathMatches) {
        return new Response("Not Found", { status: 404 })
      }
      return webHandler.handler(request)
    },
    dispose: webHandler.dispose,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Bun server with the effect-trpc handler.
 *
 * @example
 * ```ts
 * import { createServer } from "effect-trpc/bun/http"
 *
 * const server = createServer({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 *   port: 3000,
 * })
 *
 * console.log(`Server running on http://localhost:${server.port}`)
 * ```
 */
export function createServer<TRouter extends Router, R>(
  options: CreateServerOptions<TRouter, R>,
): BunServerInstance {
  const { port = 3000, host = "0.0.0.0", ...handlerOptions } = options

  const handler = createFetchHandler(handlerOptions)

  const server = Bun.serve({
    port,
    hostname: host,
    fetch: handler.fetch,
  })

  return {
    server,
    port: server.port,
    stop: () => server.stop(),
    dispose: handler.dispose,
  }
}
