/**
 * Server - Handle incoming RPC requests
 * 
 * @since 1.0.0
 * @module
 */

import { Effect, Layer, Stream } from "effect"
import type * as Router from "../Router/index.js"
import { handleRequest, handleBatch } from "./internal/handler.js"

// =============================================================================
// Types
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

/**
 * @since 1.0.0
 * @category models
 */
export interface HandlerConfig<Requirements> {
  readonly layer: Layer.Layer<Requirements, never, never>
  readonly basePath?: string
  readonly onError?: (error: unknown, path: string) => void
}

// =============================================================================
// Constructors
// =============================================================================

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
export const createRouteHandler = <D extends Router.Definition, R>(
  router: Router.Router<D>,
  config: HandlerConfig<R>
): NextRouteHandler => {
  const handle = async (request: Request): Promise<Response> => {
    try {
      const body = await request.json()
      const isArray = Array.isArray(body)

      const program = isArray
        ? handleBatch(router, body, config.layer)
        : handleRequest(router, body, config.layer)

      const result = await Effect.runPromise(program)

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      config.onError?.(error, request.url)

      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  }

  return {
    GET: handle,
    POST: handle,
  }
}

/**
 * Create a generic HTTP handler
 * 
 * @since 1.0.0
 * @category constructors
 */
export const createHandler = <D extends Router.Definition, R>(
  router: Router.Router<D>,
  config: HandlerConfig<R>
): HttpHandler => ({
  handle: createRouteHandler(router, config).POST,
})

// =============================================================================
// Server-side Caller
// =============================================================================

/**
 * Create a server-side caller for direct procedure invocation
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const caller = Server.createCaller(AppRouter, { layer: LiveLayer })
 * const users = await caller.user.list()
 * ```
 */
export const createCaller = <D extends Router.Definition, R>(
  _router: Router.Router<D>,
  _config: { readonly layer: Layer.Layer<R, never, never> }
): Caller<D> => {
  throw new Error("Not implemented")
}

/**
 * Caller client type
 */
export type Caller<D extends Router.Definition> = {
  readonly [K in keyof D]: D[K] extends Router.Definition
    ? Caller<D[K]>
    : D[K] extends { readonly handler: (p: infer P) => Effect.Effect<infer A, infer E, any> }
      ? (payload: P) => Promise<A>
      : never
}
