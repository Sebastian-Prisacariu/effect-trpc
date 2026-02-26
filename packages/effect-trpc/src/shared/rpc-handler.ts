import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter"
import * as Layer from "effect/Layer"
import { Middleware as MiddlewareEngine } from "../core/server/internal/middleware/pipeline.js"
import { Procedure as ProcedureEngine } from "../core/server/internal/procedure/base/builder.js"
import {
  Router,
  type RouterRecord,
  type RouterShape,
} from "../core/server/router.js"
import { RpcBridge } from "../core/server/internal/bridge.js"

export interface CreateRpcWebHandlerOptions<
  TRouter extends RouterShape<RouterRecord>,
  HandlersOut,
  R,
> {
  readonly router: TRouter
  readonly handlers: Layer.Layer<HandlersOut, never, R>
  readonly disableTracing?: boolean | undefined
  readonly spanPrefix?: string | undefined
}

export interface RpcWebHandler {
  readonly handler: (request: Request) => Promise<Response>
  readonly dispose: () => Promise<void>
}

export function createRpcWebHandler<
  TRouter extends RouterShape<RouterRecord>,
  HandlersOut,
  R,
>(
  options: CreateRpcWebHandlerOptions<TRouter, HandlersOut, R>,
): RpcWebHandler {
  const { router, handlers, disableTracing, spanPrefix } = options

  const middlewareLive = MiddlewareEngine.Live
  const procedureLive = ProcedureEngine.Live.pipe(
    Layer.provide(middlewareLive),
  )
  const runtimeLayer = Layer.mergeAll(
    handlers,
    middlewareLive,
    procedureLive,
    RpcBridge.Live,
  )
  const providedRouter = Router.provide(runtimeLayer)(router)
  const routerOptions: {
    path: "/rpc"
    disableTracing?: boolean
    spanPrefix?: string
  } = { path: "/rpc" }
  if (disableTracing !== undefined) {
    routerOptions.disableTracing = disableTracing
  }
  if (spanPrefix !== undefined) {
    routerOptions.spanPrefix = spanPrefix
  }

  const httpLayer = Router.toHttpLayer(routerOptions)(providedRouter)

  return HttpLayerRouter.toWebHandler(
    httpLayer,
    {
      disableLogger: true,
    },
  )
}
