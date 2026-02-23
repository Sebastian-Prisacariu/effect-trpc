/**
 * @module effect-trpc/shared/rpc-handler
 *
 * Shared RPC handler creation utilities for all adapters (Node, Bun, Next).
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import { RpcServer, RpcSerialization } from "@effect/rpc"
import type { Router, RouterRecord } from "../core/router.js"
import { isRouter, isProceduresGroup } from "../core/router.js"
import type { ProceduresGroup, ProcedureRecord, ProceduresService } from "../core/procedures.js"
import { convertHandlers } from "../core/rpc-bridge.js"
import type { Middleware } from "../core/middleware.js"

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
  readonly handlers: Layer.Layer<any, never, R>

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
  const { router: rootRouter, handlers, disableTracing, spanPrefix } = options

  /**
   * Recursively process router entries, accumulating middleware from parent routers.
   * Router middleware runs first (outermost), then nested router middleware, then procedure middleware.
   *
   * @param entries - The router record to process
   * @param pathPrefix - Path prefix for procedure names (e.g., "user.posts.")
   * @param accumulatedMiddlewares - Middleware chain from parent routers
   * @returns Effect that yields converted handlers for all procedure groups
   */
  const processRouterEntries = (
    entries: RouterRecord,
    pathPrefix: string,
    accumulatedMiddlewares: ReadonlyArray<Middleware<any, any, any, any>>,
  ): Effect.Effect<Array<Record<string, any>>, never, any> =>
    Effect.gen(function* () {
      const handlerEntries: Array<Record<string, any>> = []

      for (const [key, entry] of Object.entries(entries)) {
        if (isRouter(entry)) {
          // Nested router - accumulate its middleware and recurse
          const nestedMiddlewares: ReadonlyArray<Middleware<any, any, any, any>> = [
            ...accumulatedMiddlewares,
            ...(entry.middlewares ?? []),
          ]
          const nestedHandlers = yield* processRouterEntries(
            entry.routes,
            `${pathPrefix}${key}.`,
            nestedMiddlewares,
          )
          handlerEntries.push(...nestedHandlers)
        } else if (isProceduresGroup(entry)) {
          // Procedure group - convert handlers with accumulated middleware
          const proceduresGroup = entry as ProceduresGroup<string, ProcedureRecord>
          const serviceTag = Context.GenericTag<ProceduresService<string, ProcedureRecord>>(
            `@effect-trpc/${proceduresGroup.name}`,
          )

          const service = yield* serviceTag
           
          const converted = convertHandlers(
            proceduresGroup,
            service.handlers,
            pathPrefix,
            accumulatedMiddlewares,
          )
          handlerEntries.push(converted)
        }
      }

      return handlerEntries
    })

  // Create an effect that extracts and converts all handlers.
  // Recursively traverses nested routers, accumulating middleware from parent routers.
  const extractHandlersEffect = Effect.gen(function* () {
    // Start processing from the root router, including its middleware
    const rootMiddlewares: ReadonlyArray<Middleware<any, any, any, any>> = rootRouter.middlewares ?? []
    const handlerEntries = yield* processRouterEntries(rootRouter.routes, "", rootMiddlewares)

    // Merge all handler objects immutably (Object.assign with {} target creates new object)
    return Object.assign({}, ...handlerEntries)
  })

  // Create the RPC handlers layer.
  // Note: `as any` is required because we build handlers dynamically at runtime.
  // @effect/rpc expects exact `RpcGroup.Handlers<TGroup>` types, but we construct
  // handlers via `convertHandlers()` from ProceduresService implementations.
  // The runtime types ARE correct - this is a TypeScript limitation with dynamic APIs.
  const rpcHandlersLayer = rootRouter.rpcGroup.toLayer(
    extractHandlersEffect as any,
  ).pipe(
    Layer.provide(handlers),
  )

  // Create the full layer with serialization
  const fullLayer = Layer.mergeAll(
    rpcHandlersLayer,
    RpcSerialization.layerNdjson,
  )

  // Create the web handler using @effect/rpc.
  // Note: Same `as any` reason - Layer type doesn't exactly match @effect/rpc expectations
  return RpcServer.toWebHandler(rootRouter.rpcGroup, {
    layer: fullLayer as any,
    disableTracing,
    spanPrefix: spanPrefix ?? "@effect-trpc",
  })
}
