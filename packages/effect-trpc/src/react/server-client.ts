/**
 * @module effect-trpc/react/server-client
 *
 * Utilities for using effect-trpc in React Server Components (RSC) and SSR.
 *
 * This module provides two patterns for SSR:
 *
 * 1. **Simple pattern** (`createServerClient`): Creates a ready-to-use client
 *    that executes procedures synchronously. Best for simple SSR use cases.
 *
 * 2. **Runtime-injected pattern** (`Client.InMemoryLive`): Creates a layer that
 *    can be used with `ManagedRuntime`. Best for complex apps where you want
 *    the same runtime for SSR and client-side code.
 *
 * @since 0.1.0
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

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

type AnyProcedureDefinition = ProcedureDefinition<
  unknown,
  unknown,
  unknown,
  BaseContext,
  ProcedureType
>

/**
 * Flatten nested router structure into a flat map of procedure paths.
 * @internal
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Transport Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an in-memory transport layer that executes procedures directly.
 *
 * Use this to create a `Client` service for SSR/RSC that bypasses the network.
 * This is the building block for the runtime-injected SSR pattern.
 *
 * @example
 * ```ts
 * import { ManagedRuntime, Layer } from "effect"
 * import { Client, createInMemoryClientLive } from "effect-trpc/react/server"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 *
 * // Create in-memory client layer
 * const InMemoryClientLive = createInMemoryClientLive(appRouter, AppHandlersLive)
 *
 * // Create a runtime for SSR
 * const ssrRuntime = ManagedRuntime.make(InMemoryClientLive)
 *
 * // Use in Server Components
 * export default async function Page() {
 *   const users = await ssrRuntime.runPromise(
 *     Effect.gen(function* () {
 *       const client = yield* Client
 *       const api = client.create(appRouter)
 *       return yield* api.user.list()
 *     })
 *   )
 *   return <UserList users={users} />
 * }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
export function createInMemoryClientLive<TRouter extends RouterShape<RouterRecord>, R>(
  router: TRouter,
  handlers: Layer.Layer<R, never, never>,
): Layer.Layer<Client, never, never> {
  const flatProcedures = flattenRoutes(router.routes)

  const inMemoryTransportLive = Layer.effect(
    Transport,
    Effect.gen(function* () {
      const procedureEngine = yield* ProcedureEngine

      const service: TransportShape = {
        call: (rpcName, input, descriptor) => {
          if (descriptor.stream) {
            return Effect.fail(
              new TransportError({
                message: "Stream transport is not supported in SSR",
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
            handlers,
          )
        },
      }

      return service
    }),
  )

  const procedureEngineLive = ProcedureEngine.Live.pipe(Layer.provide(MiddlewareEngine.Live))

  const transportWithEngine = inMemoryTransportLive.pipe(Layer.provide(procedureEngineLive))

  const proxyLive = Proxy.Live.pipe(Layer.provide(transportWithEngine))

  const clientLive = Client.Live.pipe(Layer.provide(proxyLive))

  return Layer.mergeAll(
    handlers,
    transportWithEngine,
    proxyLive,
    clientLive,
  ) as unknown as Layer.Layer<Client, never, never>
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple SSR Pattern (createServerClient)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateServerClientOptions<TRouter extends RouterShape<RouterRecord>, R> {
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
  /**
   * The typed procedures proxy.
   * Each procedure returns an Effect that can be executed.
   */
  readonly procedures: RouterClient<TRouter["routes"]>

  /**
   * Dispose of any resources. Currently a no-op for synchronous clients.
   */
  readonly dispose: () => Promise<void>
}

/**
 * Creates a vanilla tRPC client optimized for Server Components and SSR.
 *
 * This client bypasses the network entirely by routing requests directly
 * to your procedure handlers. It creates an in-memory transport that invokes
 * the handlers directly.
 *
 * **Note:** This is the simple SSR pattern. For apps that want to share a
 * single runtime between SSR and client-side code, use `createInMemoryClientLive`
 * with `ManagedRuntime` instead.
 *
 * @example
 * ```ts
 * // src/trpc/server.ts
 * import { createServerClient } from "effect-trpc/react/server"
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
 * // src/app/page.tsx (Server Component)
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
 *
 * @since 0.1.0
 * @category constructors
 */
export function createServerClient<TRouter extends RouterShape<RouterRecord>, R>(
  options: CreateServerClientOptions<TRouter, R>,
): ServerTRPCClient<TRouter> {
  const { router, handlers } = options

  // Use the shared helper to create the in-memory client layer
  const clientLayer = createInMemoryClientLive(router, handlers)

  const program = Effect.gen(function* () {
    const client = yield* Client
    return client.create(router)
  })

  const procedures = Effect.runSync(Effect.provide(program, clientLayer))

  return {
    procedures,
    dispose: () => Promise.resolve(),
  }
}
