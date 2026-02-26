import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Pipeable from "effect/Pipeable"
import * as Data from "effect/Data"
import * as Predicate from "effect/Predicate"
import type { AnyMiddlewareDefinition, BaseContext } from "./middleware.js"
import type {
  ProcedureDefinition,
  ProcedureType,
} from "./procedure.js"
import { applyMiddlewareToProcedure } from "./procedure.js"
import type {
  ProcedureRecord,
  ProceduresGroup,
} from "./procedures.js"
import { RpcBridge } from "./internal/bridge.js"

type AnyProcedureDefinition = ProcedureDefinition<
  unknown,
  unknown,
  unknown,
  BaseContext,
  ProcedureType,
  unknown,
  unknown
>

export type RouterEntry = 
  | AnyProcedureDefinition
  | ProceduresGroup<string, ProcedureRecord>
  | RouterShape<RouterRecord>
  | Record<string, AnyProcedureDefinition>

export type RouterRecord = Record<string, RouterEntry>

export type ExtractProcedures<Routes extends RouterRecord, Prefix extends string = ""> = {
  [K in keyof Routes]: Routes[K] extends RouterShape<infer R>
    ? ExtractProcedures<R, `${Prefix}${K & string}.`>
    : Routes[K] extends AnyProcedureDefinition
      ? { [PK in `${Prefix}${K & string}`]: Routes[K] }
      : Routes[K] extends ProceduresGroup<string, infer P>
        ? { [PK in keyof P as `${Prefix}${K & string}.${PK & string}`]: P[PK] }
      : Routes[K] extends Record<string, AnyProcedureDefinition>
        ? { [PK in keyof Routes[K] as `${Prefix}${K & string}.${PK & string}`]: Routes[K][PK] }
        : never
}[keyof Routes]

export type AnyRouter = RouterShape<RouterRecord>

export type InferInput<T> = T extends ProcedureDefinition<infer I, any, any, any, any, any, any> ? I : never
export type InferOutput<T> = T extends ProcedureDefinition<any, infer A, any, any, any, any, any> ? A : never
export type InferError<T> = T extends ProcedureDefinition<any, any, infer E, any, any, any, any> ? E : never
export type InferRequirements<T> = T extends ProcedureDefinition<any, any, any, any, any, infer R, any> ? R : never
export type InferProvides<T> = T extends ProcedureDefinition<any, any, any, any, any, any, infer P> ? P : never

const applyMiddlewareToRouterEntry = <
  M extends AnyMiddlewareDefinition,
>(
  entry: RouterEntry,
  middleware: M,
): RouterEntry => {
  if (Predicate.isTagged(entry, "ProcedureDefinition")) {
    return applyMiddlewareToProcedure(
      entry,
      middleware,
    )
  }

  if (Predicate.isTagged(entry, "ProceduresGroup")) {
    return entry.use(middleware)
  }

  if (Predicate.isTagged(entry, "Router")) {
    return new RouterShape({
      routes: applyMiddlewareToRouterRecord(entry.routes, middleware),
    })
  }

  if (Predicate.isRecord(entry)) {
    const next: Record<string, AnyProcedureDefinition> = {}
    for (const [key, value] of Object.entries(entry)) {
      next[key] = applyMiddlewareToRouterEntry(
        value as RouterEntry,
        middleware,
      ) as AnyProcedureDefinition
    }
    return next
  }

  return entry
}

const applyMiddlewareToRouterRecord = <
  M extends AnyMiddlewareDefinition,
>(
  routes: RouterRecord,
  middleware: M,
): RouterRecord => {
  const next: Record<string, RouterEntry> = {}
  for (const [key, entry] of Object.entries(routes)) {
    next[key] = applyMiddlewareToRouterEntry(
      entry,
      middleware,
    )
  }

  return next
}

export class RouterShape<Routes extends RouterRecord = RouterRecord> extends Data.TaggedClass("Router")<{
  readonly routes: Routes
}> implements Pipeable.Pipeable {
  use<M extends AnyMiddlewareDefinition>(
    middleware: M,
  ): RouterShape<Routes> {
    return new RouterShape({
      routes: applyMiddlewareToRouterRecord(this.routes, middleware) as Routes,
    })
  }

  pipe() {
    return Pipeable.pipeArguments(this, arguments)
  }
}

export interface ProvidedRouter<
  Routes extends RouterRecord = RouterRecord,
  HandlersOut = unknown,
  Requirements = unknown,
> {
  readonly router: RouterShape<Routes>
  readonly layer: Layer.Layer<HandlersOut, never, Requirements>
}

export const Router = {
  make: <T extends RouterRecord>(routes: T): RouterShape<T> => new RouterShape({
    routes
  }),
  provide: <HandlersOut, R>(layer: Layer.Layer<HandlersOut, never, R>) =>
    <Routes extends RouterRecord>(router: RouterShape<Routes>): ProvidedRouter<Routes, HandlersOut, R> => ({ router, layer }),
  toHttpLayer: (options?: {
    path?: `/${string}` | "*"
    disableTracing?: boolean
    spanPrefix?: string
  }) =>
    <Routes extends RouterRecord, HandlersOut, R>(
      provided: ProvidedRouter<Routes, HandlersOut, R>,
    ): Layer.Layer<never, never, HttpLayerRouter.HttpRouter> =>
      Layer.unwrapEffect(
        Effect.provide(
          Effect.map(
            RpcBridge,
            (bridge) =>
              bridge.toHttpLayer(provided.router, options).pipe(
                Layer.provide(provided.layer),
              ),
          ),
          provided.layer,
        ),
      ) as unknown as Layer.Layer<never, never, HttpLayerRouter.HttpRouter>,
  use: <M extends AnyMiddlewareDefinition>(
    middleware: M,
  ) => <Routes extends RouterRecord>(
    router: RouterShape<Routes>,
  ): RouterShape<Routes> =>
    router.use(middleware),
  mergeDeep: <A extends RouterRecord, B extends RouterRecord>(
    routerA: RouterShape<A>,
    routerB: RouterShape<B>,
    options?: { onConflict?: 'error' | 'overwrite' | 'skip' }
  ): RouterShape<A & B> => new RouterShape({
    routes: { ...routerA.routes, ...routerB.routes }
  }),
  prefix: <P extends string, R extends RouterShape<RouterRecord>>(prefix: P, router: R): R => router
}
