/**
 * @module effect-trpc/react/server-client
 *
 * Utilities for using effect-trpc in React Server Components (RSC) and SSR.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import { Client } from "../core/client/index.js"
import { type RouterClient, Proxy } from "../core/client/proxy.js"
import { Transport, TransportError, type TransportShape } from "../core/client/transports.js"
import type { BaseContext } from "../core/server/middleware.js"
import { Middleware as MiddlewareEngine } from "../core/server/internal/middleware/pipeline.js"
import { Procedure as ProcedureEngine } from "../core/server/internal/procedure/base/builder.js"
import type { ProcedureDefinition, ProcedureType } from "../core/server/procedure.js"
import type { ProcedureRecord, ProceduresGroup } from "../core/server/procedures.js"
import type { RouterRecord, RouterShape } from "../core/server/router.js"

export interface CreateServerClientOptions<
  TRouter extends RouterShape<RouterRecord>,
  R,
> {
  /**
   * The router instance.
   */
  readonly router: TRouter

  /**
   * The layer providing all procedure implementations.
   */
  readonly handlers: Layer.Layer<R, never, never>
}

export interface ServerTRPCClient<TRouter extends RouterShape<RouterRecord>> {
  readonly procedures: RouterClient<TRouter["routes"]>
  readonly dispose: () => Promise<void>
}

/**
 * Creates a vanilla tRPC client optimized for Server Components and SSR.
 * 
 * This client bypasses the network entirely by routing requests directly 
 * to your procedure handlers. It creates a mock HttpClient that invokes
 * the handlers via a Web Request/Response lifecycle in-memory.
 *
 * @example
 * ```ts
 * // src/trpc/server.js
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
 * // src/app/page.jsx (Server Component)
 * import { Effect } from "effect"
 * import { serverClient } from "~/trpc/server"
 * 
 * export default async function Page() {
 *   // Call your procedures directly - no HTTP request is made!
 *   const users = await Effect.runPromise(
 *     serverClient.procedures.user.list()
 *   )
 *   
 *   return <UserList users={users} />
 * }
 * ```
 */
export function createServerClient<
  TRouter extends RouterShape<RouterRecord>,
  R,
>(
  options: CreateServerClientOptions<TRouter, R>,
): ServerTRPCClient<TRouter> {
  const { router, handlers } = options

  type AnyProcedureDefinition = ProcedureDefinition<
    unknown,
    unknown,
    unknown,
    BaseContext,
    ProcedureType,
    unknown,
    unknown
  >

  const flattenRoutes = (
    routes: Record<string, unknown>,
    prefix = "",
  ): Record<string, AnyProcedureDefinition> => {
    let flat: Record<string, AnyProcedureDefinition> = {}
    for (const [key, value] of Object.entries(routes)) {
      const newPrefix = prefix ? `${prefix}.${key}` : key
      Match.value(value).pipe(
        Match.when(
          (candidate: unknown): candidate is AnyProcedureDefinition =>
            Predicate.isTagged(candidate, "ProcedureDefinition"),
          (definition) => {
            flat[newPrefix] = definition
          },
        ),
        Match.when(
          (candidate: unknown): candidate is RouterShape<RouterRecord> =>
            Predicate.isTagged(candidate, "Router"),
          (nestedRouter) => {
            flat = { ...flat, ...flattenRoutes(nestedRouter.routes, newPrefix) }
          },
        ),
        Match.when(
          (candidate: unknown): candidate is ProceduresGroup<string, ProcedureRecord> =>
            Predicate.isTagged(candidate, "ProceduresGroup"),
          (group) => {
            flat = { ...flat, ...flattenRoutes(group.procedures, newPrefix) }
          },
        ),
        Match.when(Predicate.isRecord, (record) => {
          flat = { ...flat, ...flattenRoutes(record, newPrefix) }
        }),
        Match.orElse(() => undefined),
      )
    }
    return flat
  }

  const makeInMemoryTransportLive = (
    appRouter: RouterShape<RouterRecord>,
    handlersLayer: Layer.Layer<R, never, never>,
  ): Layer.Layer<Transport, never, ProcedureEngine> => {
    const flatProcedures = flattenRoutes(appRouter.routes)

    return Layer.effect(Transport, Effect.gen(function* () {
      const procedureEngine = yield* ProcedureEngine

      const service: TransportShape = {
        call: (rpcName, input, descriptor) => {
          if (descriptor.stream) {
            return Effect.fail(
              new TransportError({
                message: "Stream transport is not supported in createServerClient",
              }),
            )
          }

          const definition = flatProcedures[rpcName]
          if (definition === undefined) {
            return Effect.fail(
              new TransportError({
                message: `Unknown procedure path: ${rpcName}`,
              }),
            )
          }

          const initialContext: BaseContext = {
            procedure: rpcName,
            headers: new Headers(),
            signal: new AbortController().signal,
            clientId: 1,
          }

          return Effect.provide(
            procedureEngine.execute(definition, initialContext, input),
            handlersLayer,
          )
        },
      }

      return service
    }))
  }

  const procedureEngineLive = ProcedureEngine.Live.pipe(
    Layer.provide(MiddlewareEngine.Live),
  )
  const transportLive = makeInMemoryTransportLive(router, handlers).pipe(
    Layer.provide(procedureEngineLive),
  )
  const proxyLive = Proxy.Live.pipe(
    Layer.provide(transportLive),
  )
  const clientLive = Client.Live.pipe(
    Layer.provide(proxyLive),
  )

  const runtimeLayer = Layer.mergeAll(
    handlers,
    transportLive,
    proxyLive,
    clientLive,
  )

  const program = Effect.gen(function* () {
    const client = yield* Client
    return client.create(router)
  })

  const procedures = Effect.runSync(
    Effect.provide(program, runtimeLayer),
  )

  return {
    procedures,
    dispose: () => Promise.resolve(),
  }
}
