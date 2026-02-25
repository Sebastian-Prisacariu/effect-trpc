/**
 * @module effect-trpc/next
 *
 * Next.js integration for effect-trpc.
 * Provides route handlers and SSR/RSC helpers.
 *
 * @example
 * ```ts
 * // src/app/api/trpc/[...trpc]/route.ts
 * import { createRouteHandler } from 'effect-trpc/next'
 * import { appRouter, AppRouterLive } from '~/server/trpc'
 *
 * const { GET, POST } = createRouteHandler({
 *   router: appRouter,
 *   handlers: AppRouterLive,
 * })
 *
 * export { GET, POST }
 * ```
 */

import type * as Layer from "effect/Layer"
import type { Router } from "../core/router.js"
import {
  type CorsOptions,
  buildCorsHeaders,
  createRpcWebHandler,
} from "../shared/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateRouteHandlerOptions<TRouter extends Router, R> {
  /**
   * The router instance.
   */
  readonly router: TRouter

  /**
   * The layer providing all procedure implementations.
   *
   * @remarks
   * **Why `any` for the provided type?**
   *
   * The Layer's provided type is `any` because the handlers layer is constructed
   * dynamically from router procedure definitions. TypeScript cannot infer the
   * exact union of all procedure handler services at this generic interface level.
   *
   * Type safety is maintained through:
   * 1. The `TRouter` generic constrains which procedures exist
   * 2. The handlers implementation is type-checked when created
   * 3. Only the `R` (requirements) type matters for composition
   */
  readonly handlers: Layer.Layer<any, never, R>

  /**
   * Disable OpenTelemetry tracing.
   * @default false
   */
  readonly disableTracing?: boolean

  /**
   * Prefix for span names.
   * @default '@effect-trpc'
   */
  readonly spanPrefix?: string

  /**
   * Enable CORS headers.
   * Pass `true` for defaults or a `CorsOptions` object to customize.
   *
   * When enabled:
   * - OPTIONS preflight requests return 204 with CORS headers
   * - All responses include CORS headers
   *
   * @default false
   */
  readonly cors?: boolean | CorsOptions
}

// Re-export CorsOptions for convenience
export type { CorsOptions }

export interface RouteHandler {
  (request: Request): Promise<Response>
}

export interface RouteHandlers {
  readonly GET: RouteHandler
  readonly POST: RouteHandler
  /**
   * Dispose of the handler resources.
   * Call this when shutting down the server.
   */
  readonly dispose: () => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create Next.js App Router route handlers for effect-trpc.
 *
 * @remarks
 * **Streaming Support**: Stream procedures (type: "stream" or "chat") are
 * automatically handled with NDJSON streaming. The underlying @effect/rpc
 * WebHandler sets appropriate headers (`Transfer-Encoding: chunked`) and
 * handles client disconnect via fiber interruption.
 *
 * **Edge Runtime**: These handlers are compatible with both Node.js and Edge
 * Runtime. Add `export const runtime = "edge"` to your route file for edge
 * deployment.
 *
 * @example
 * ```ts
 * // src/app/api/trpc/[...trpc]/route.ts
 * import { createRouteHandler } from 'effect-trpc/next'
 * import { appRouter } from '~/server/trpc/router'
 * import { AppHandlersLive } from '~/server/trpc/handlers'
 *
 * const { GET, POST } = createRouteHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * export { GET, POST }
 *
 * // Optional: Enable edge runtime
 * // export const runtime = "edge"
 * ```
 */
export function createRouteHandler<TRouter extends Router, R>(
  options: CreateRouteHandlerOptions<TRouter, R>,
): RouteHandlers {
  const { router, handlers, disableTracing, spanPrefix, cors } = options

  // Create the web handler using shared utility
  const webHandler = createRpcWebHandler({ router, handlers, disableTracing, spanPrefix })

  // Build CORS headers if enabled
  const corsHeaders = cors ? buildCorsHeaders(cors === true ? {} : cors) : null

  // Create handler with CORS support
  const handleRequest = async (request: Request): Promise<Response> => {
    // Handle preflight for CORS
    if (corsHeaders && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    // Handle RPC request
    const response = await webHandler.handler(request)

    // Add CORS headers if enabled
    if (corsHeaders) {
      const headers = new Headers(response.headers)
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value)
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return response
  }

  return {
    GET: handleRequest,
    POST: handleRequest,
    dispose: webHandler.dispose,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSR/RSC Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For SSR and React Server Components (RSC), you can use the `createServerClient`
 * utility from `effect-trpc/react`.
 *
 * It allows you to call your procedures directly without making HTTP requests,
 * while maintaining the exact same API as the client.
 *
 * @example
 * ```ts
 * // src/trpc/server.ts
 * import { createServerClient } from "effect-trpc/react"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 *
 * export const serverClient = createServerClient({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 * ```
 *
 * ```tsx
 * // src/app/page.tsx
 * import { Effect } from "effect"
 * import { serverClient } from "~/trpc/server"
 *
 * export default async function UsersPage() {
 *   // Direct call - no HTTP request!
 *   const users = await Effect.runPromise(
 *     serverClient.procedures.user.list()
 *   )
 *
 *   return <UserList users={users} />
 * }
 * ```
 */
