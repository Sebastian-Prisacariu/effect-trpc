import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Middleware as MiddlewareEngine } from "../core/server/internal/middleware/pipeline.js"
import { Procedure as ProcedureEngine } from "../core/server/internal/procedure/base/builder.js"
import { Router, type RouterRecord, type RouterShape } from "../core/server/router.js"
import { RpcBridge } from "../core/server/internal/bridge.js"

/**
 * Options for creating an RPC web handler.
 *
 * With Effect-based requirement tracking, requirements are tracked in the
 * Effect's R channel rather than phantom types.
 */
export interface CreateRpcWebHandlerOptions<Routes extends RouterRecord, HandlersOut, R> {
  /**
   * The router (can be plain RouterShape or Effect-wrapped).
   */
  readonly router: RouterShape<Routes> | Effect.Effect<RouterShape<Routes>, never, any>

  /**
   * Layer providing all procedure implementations AND middleware implementations.
   */
  readonly handlers: Layer.Layer<HandlersOut, never, R>

  readonly disableTracing?: boolean | undefined
  readonly spanPrefix?: string | undefined

  /**
   * Whether to disable the Effect logger for RPC requests.
   * When false (default), logs will be output using the Effect logger.
   * Set to true to suppress all Effect logging from RPC handlers.
   *
   * @default false
   */
  readonly disableLogger?: boolean | undefined
}

export interface RpcWebHandler {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

/**
 * Extract a value from an Effect synchronously.
 * Safe because our definitions always use Effect.succeed internally.
 */
function extractFromEffect<T>(effect: Effect.Effect<T, never, any>): T {
  let extracted: T | undefined
  Effect.runSync(
    Effect.map(effect as Effect.Effect<T, never, never>, (val) => {
      extracted = val
    }),
  )
  if (extracted === undefined) {
    throw new Error("Failed to extract router from Effect")
  }
  return extracted
}

/**
 * Check if something looks like an Effect (has pipe method and is callable).
 */
function isEffect(value: unknown): value is Effect.Effect<unknown, unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "pipe" in value &&
    typeof (value as { pipe: unknown }).pipe === "function" &&
    !("_tag" in value && (value as { _tag: string })._tag === "Router")
  )
}

/**
 * Create an RPC web handler for a router.
 *
 * The type system enforces that all services required by procedures
 * are provided in the handlers layer.
 *
 * @example
 * ```ts
 * const { GET, POST } = createRpcWebHandler({
 *   router: appRouter,
 *   handlers: Layer.mergeAll(
 *     AppProceduresLive,
 *     OrgMiddlewareLive,
 *   ),
 * })
 * ```
 */
export function createRpcWebHandler<Routes extends RouterRecord, HandlersOut, R>(
  options: CreateRpcWebHandlerOptions<Routes, HandlersOut, R>,
): RpcWebHandler {
  const {
    router: routerOrEffect,
    handlers,
    disableTracing,
    spanPrefix,
    disableLogger = false,
  } = options

  // Extract router from Effect if needed
  const router = isEffect(routerOrEffect)
    ? extractFromEffect(routerOrEffect as Effect.Effect<RouterShape<Routes>, never, any>)
    : (routerOrEffect as RouterShape<Routes>)

  const middlewareLive = MiddlewareEngine.Live
  const procedureLive = ProcedureEngine.Live.pipe(Layer.provide(middlewareLive))
  const runtimeLayer = Layer.mergeAll(
    handlers as Layer.Layer<unknown, never, unknown>,
    middlewareLive,
    procedureLive,
    RpcBridge.Live,
  )

  // Create an Effect-wrapped router for the new API
  const routerEffect = Effect.succeed(router) as Effect.Effect<RouterShape<Routes>, never, never>
  const providedRouter = Router.provide(runtimeLayer)(routerEffect)

  // Use "*" to match all requests - Next.js already routes to this handler
  const routerOptions: {
    path: "*"
    disableTracing?: boolean
    spanPrefix?: string
  } = { path: "*" }
  if (disableTracing !== undefined) {
    routerOptions.disableTracing = disableTracing
  }
  if (spanPrefix !== undefined) {
    routerOptions.spanPrefix = spanPrefix
  }

  const httpLayer = Router.toHttpLayer(routerOptions)(providedRouter)

  const webHandler = HttpLayerRouter.toWebHandler(httpLayer as any, {
    disableLogger,
  })

  return {
    handler: (request: Request) => webHandler.handler(request, {} as any),
    dispose: webHandler.dispose,
  }
}
