/**
 * @module effect-trpc/shared/rpc-handler
 *
 * Shared RPC handler creation utilities for all adapters (Node, Bun, Next).
 */

import * as Layer from "effect/Layer"
import type { Router } from "../core/server/router.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating an RPC web handler.
 */
export interface CreateRpcWebHandlerOptions<TRouter extends Router, R> {
  /**
   * The router instance.
   */
  readonly router: TRouter

  /**
   * The layer providing all procedure implementations.
   */
  readonly handlers: Layer.Layer<unknown, never, R>

  /**
   * Disable OpenTelemetry tracing.
   * @default false
   */
  readonly disableTracing?: boolean | undefined

  /**
   * Prefix for span names.
   * @default "@effect-trpc"
   */
  readonly spanPrefix?: string | undefined
}

/**
 * Result of creating an RPC web handler.
 */
export interface RpcWebHandler {
  /**
   * The fetch handler function.
   */
  readonly handler: (request: Request) => Promise<Response>

  /**
   * Dispose of handler resources.
   */
  readonly dispose: () => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an RPC web handler from a router and handlers layer.
 *
 * This is the shared implementation used by all adapters (Node, Bun, Next).
 * Each adapter wraps this to add platform-specific functionality like CORS.
 */
export function createRpcWebHandler<TRouter extends Router, R>(
  options: CreateRpcWebHandlerOptions<TRouter, R>,
): RpcWebHandler {
  const { router, handlers, disableTracing, spanPrefix } = options
  const providedRouter = router.provide(handlers as Layer.Layer<unknown, never, R>)
  const handlerOptions =
    disableTracing === undefined
      ? { spanPrefix: spanPrefix ?? "@effect-trpc" }
      : { disableTracing, spanPrefix: spanPrefix ?? "@effect-trpc" }
  return providedRouter.toHttpHandler(handlerOptions)
}
