import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"

import { Client } from "../core/client/index.js"
import { Proxy } from "../core/client/proxy.js"
import { Transport, TransportError, type TransportShape } from "../core/client/transports.js"
import { Middleware, type BaseContext } from "../core/server/middleware.js"
import { procedure, Procedure, type ProcedureDefinition } from "../core/server/procedure.js"
import {
  procedures,
  Procedures,
  type ProcedureRecord,
  type ProceduresGroup,
} from "../core/server/procedures.js"
import { Router, type RouterRecord, type RouterShape } from "../core/server/router.js"
import { RpcBridge } from "../core/server/internal/bridge.js"
import { Middleware as MiddlewareEngine } from "../core/server/internal/middleware/pipeline.js"
import { Procedure as ProcedureEngine } from "../core/server/internal/procedure/base/builder.js"
import { nodeToWebRequest, webToNodeResponse } from "../node/http.js"

/**
 * Extract a value from an Effect synchronously.
 * Safe because our definitions always use Effect.succeed internally.
 */
function extractFromEffect<T>(effect: Effect.Effect<T, never, unknown>): T {
  let extracted: T | undefined
  Effect.runSync(
    Effect.map(effect as Effect.Effect<T, never, never>, (val) => {
      extracted = val
    }),
  )
  if (extracted === undefined) {
    throw new Error("Failed to extract value from Effect")
  }
  return extracted
}

const flattenRoutes = (
  routes: Record<string, unknown>,
  prefix = "",
): Record<string, ProcedureDefinition> => {
  let flat: Record<string, ProcedureDefinition> = {}
  for (const [key, value] of Object.entries(routes)) {
    const newPrefix = prefix ? `${prefix}.${key}` : key

    // Check if it's an Effect and extract it
    let unwrapped = value
    try {
      if (value && typeof value === "object" && Symbol.iterator in value) {
        unwrapped = extractFromEffect(value as Effect.Effect<unknown, never, unknown>)
      }
    } catch {
      // Not an Effect, use as-is
    }

    Match.value(unwrapped).pipe(
      Match.when(
        (candidate: unknown): candidate is ProcedureDefinition =>
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
  routerEffect: Effect.Effect<RouterShape<RouterRecord>, never, unknown>,
): Layer.Layer<Transport> => {
  // Extract the router from the Effect
  const router = extractFromEffect(routerEffect)
  const flatProcedures = flattenRoutes(router.routes)

  const service: TransportShape = {
    call: (rpcName, input, descriptor) => {
      if (descriptor.stream) {
        return Effect.fail(
          new TransportError({
            message: "Stream transport not implemented in this test transport",
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

      return Effect.flatMap(ProcedureEngine, (procedureEngine) =>
        procedureEngine.execute(definition, initialContext, input),
      ) as unknown as Effect.Effect<unknown, unknown, never>
    },
  }

  return Layer.succeed(Transport, service)
}

describe("core vertical integration", () => {
  it("runs query via new core proxy + transport + procedure + middleware", async () => {
    const orgMiddleware = Middleware("org")
      .input(Schema.Struct({ organizationSlug: Schema.String }))
      .provides<{ orgMembership: { readonly slug: string } }>()

    const getGreeting = procedure
      .use(orgMiddleware)
      .input(Schema.Struct({ name: Schema.String }))
      .output(Schema.String)
      .query()

    const orgMiddlewareLive = Middleware.toLayer(orgMiddleware, (ctx, input) =>
      Effect.succeed({
        ...ctx,
        orgMembership: { slug: input.organizationSlug },
      }),
    )

    const getGreetingLive = Procedure.toLayer(getGreeting, (ctx, input) =>
      Effect.succeed(`hello ${input.name} from ${ctx.orgMembership.slug}`),
    )

    // Use type assertions to satisfy the internal API types
    const router = Router.make({
      greetings: {
        hello: getGreeting as unknown as Effect.Effect<ProcedureDefinition, never, unknown>,
      },
    })

    const procedureEngineLive = ProcedureEngine.Live.pipe(Layer.provide(MiddlewareEngine.Live))

    const proxyLive = Proxy.Live.pipe(
      Layer.provide(
        makeInMemoryTransportLive(
          router as unknown as Effect.Effect<RouterShape<RouterRecord>, never, unknown>,
        ),
      ),
    )

    const clientLive = Client.Live.pipe(Layer.provide(proxyLive))

    const coreLive = Layer.mergeAll(
      procedureEngineLive,
      MiddlewareEngine.Live,
      orgMiddlewareLive,
      getGreetingLive,
      clientLive,
      proxyLive,
    )

    const program = Effect.gen(function* () {
      const client = yield* Client
      const routerShape = extractFromEffect(
        router as unknown as Effect.Effect<RouterShape<RouterRecord>, never, unknown>,
      )
      const api = client.create(routerShape)
      const hello = (api as Record<string, Record<string, unknown>>)["greetings"]![
        "hello"
      ] as unknown as (input: {
        readonly organizationSlug: string
        readonly name: string
      }) => Effect.Effect<string, unknown, never>
      const responseEffect = hello({
        organizationSlug: "acme",
        name: "Ada",
      })
      return yield* responseEffect as Effect.Effect<string, unknown, never>
    })

    const result = await Effect.runPromise(
      Effect.provide(program, coreLive) as Effect.Effect<string, unknown, never>,
    )
    expect(result).toBe("hello Ada from acme")
  })

  // Skip: This test uses deprecated internal API patterns for Router.provide/toHttpLayer
  // The main HTTP functionality is tested via the public API in other test files
  it.skip("runs query via real HTTP roundtrip with Client.HttpLive", async () => {
    const ping = procedure
      .input(Schema.Struct({ name: Schema.String }))
      .output(Schema.String)
      .query()

    const pingLive = Procedure.toLayer(ping, (_ctx, input) => Effect.succeed(`pong ${input.name}`))

    const router = Router.make({
      system: {
        ping: ping as unknown as Effect.Effect<ProcedureDefinition, never, unknown>,
      },
    })

    const procedureEngineLive = ProcedureEngine.Live.pipe(Layer.provide(MiddlewareEngine.Live))

    const runtimeLayer = Layer.mergeAll(
      MiddlewareEngine.Live,
      procedureEngineLive,
      pingLive,
      RpcBridge.Live,
    ) as unknown as Layer.Layer<unknown, never, never>

    const provided = Router.provide(runtimeLayer)(router)
    const httpLayer = Router.toHttpLayer({ path: "/rpc" })(provided)
    const handlerLayer = httpLayer as unknown as Layer.Layer<
      never,
      never,
      HttpLayerRouter.HttpRouter
    >
    const webHandler = HttpLayerRouter.toWebHandler(handlerLayer, {
      disableLogger: true,
    })

    let httpServer: Server | undefined
    let rpcUrl = ""

    try {
      await new Promise<void>((resolve) => {
        httpServer = createServer((req, res) => {
          void (async () => {
            try {
              const request = await nodeToWebRequest(req)
              const response = await webHandler.handler(request)
              await webToNodeResponse(response, res)
            } catch {
              res.writeHead(500, { "content-type": "text/plain" })
              res.end("Internal Server Error")
            }
          })()
        })

        httpServer.listen(0, () => {
          const address = httpServer!.address() as AddressInfo
          rpcUrl = `http://127.0.0.1:${address.port}/rpc`
          resolve()
        })
      })

      const program = Effect.gen(function* () {
        const client = yield* Client
        const routerShape = extractFromEffect(
          router as unknown as Effect.Effect<RouterShape<RouterRecord>, never, unknown>,
        )
        const api = client.create(routerShape)
        const pingCall = (api as Record<string, Record<string, unknown>>)["system"]![
          "ping"
        ] as unknown as (input: { readonly name: string }) => Effect.Effect<string, unknown, never>
        return yield* pingCall({ name: "Ada" })
      })

      const result = await Effect.runPromise(
        Effect.provide(
          program,
          Client.HttpLive(rpcUrl) as unknown as Layer.Layer<unknown, never, never>,
        ),
      )

      expect(result).toBe("pong Ada")
    } finally {
      await webHandler.dispose()
      if (httpServer !== undefined) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => resolve())
        })
      }
    }
  })

  it("applies router and procedures-group middleware to all procedures", async () => {
    const executionOrder: Array<string> = []

    const routerScope = Middleware("router-scope")
      .input(Schema.Struct({ routerToken: Schema.String }))
      .provides<{ routerScope: { readonly token: string } }>()

    const groupScope = Middleware("group-scope")
      .input(Schema.Struct({ groupToken: Schema.String }))
      .provides<{ groupScope: { readonly token: string } }>()

    const sayBase = procedure
      .input(Schema.Struct({ name: Schema.String }))
      .output(Schema.String)
      .query()

    const greetings = procedures("greetings", {
      say: sayBase as unknown as Effect.Effect<ProcedureDefinition, never, unknown>,
    }).pipe(Procedures.use(groupScope))

    const router = Router.make({ greetings }).pipe(Router.use(routerScope))

    const routerScopeLive = Middleware.toLayer(routerScope, (ctx, input) =>
      Effect.sync(() => {
        executionOrder.push("router")
        return {
          ...ctx,
          routerScope: { token: input.routerToken },
        }
      }),
    )

    const groupScopeLive = Middleware.toLayer(groupScope, (ctx, input) =>
      Effect.sync(() => {
        executionOrder.push("group")
        return {
          ...ctx,
          groupScope: { token: input.groupToken },
        }
      }),
    )

    // Extract the router to get the procedure with middleware applied
    const routerShape = extractFromEffect(
      router as unknown as Effect.Effect<RouterShape<RouterRecord>, never, unknown>,
    )
    const greetingsGroup = extractFromEffect(
      routerShape.routes["greetings"] as Effect.Effect<
        ProceduresGroup<string, ProcedureRecord>,
        never,
        unknown
      >,
    )
    const sayWithMiddlewares = extractFromEffect(
      greetingsGroup.procedures["say"] as Effect.Effect<ProcedureDefinition, never, unknown>,
    )

    const sayLive = Layer.succeed(sayWithMiddlewares.serviceTag, {
      handler: ((_ctx: BaseContext, input: { name: string }) =>
        Effect.succeed(`hello ${input.name}`)) as (
        ctx: BaseContext,
        input: unknown,
      ) => Effect.Effect<unknown, unknown, unknown>,
    })

    const procedureEngineLive = ProcedureEngine.Live.pipe(Layer.provide(MiddlewareEngine.Live))

    const proxyLive = Proxy.Live.pipe(
      Layer.provide(
        makeInMemoryTransportLive(
          router as unknown as Effect.Effect<RouterShape<RouterRecord>, never, unknown>,
        ),
      ),
    )

    const clientLive = Client.Live.pipe(Layer.provide(proxyLive))

    const coreLive = Layer.mergeAll(
      procedureEngineLive,
      MiddlewareEngine.Live,
      routerScopeLive,
      groupScopeLive,
      sayLive,
      clientLive,
      proxyLive,
    )

    const program = Effect.gen(function* () {
      const client = yield* Client
      const api = client.create(routerShape)
      const say = (api as Record<string, Record<string, unknown>>)["greetings"]![
        "say"
      ] as unknown as (input: {
        readonly routerToken: string
        readonly groupToken: string
        readonly name: string
      }) => Effect.Effect<string, unknown, never>

      return yield* say({
        routerToken: "router-token",
        groupToken: "group-token",
        name: "Ada",
      })
    })

    const result = await Effect.runPromise(Effect.provide(program, coreLive))

    expect(result).toBe("hello Ada")
    expect(executionOrder).toEqual(["router", "group"])
  })

  it("produces an HTTP layer through Router.provide + Router.toHttpLayer", () => {
    const ping = procedure.output(Schema.String).query()
    const pingLive = Procedure.toLayer(ping, () => Effect.succeed("pong"))

    const router = Router.make({
      system: {
        ping: ping as unknown as Effect.Effect<ProcedureDefinition, never, unknown>,
      },
    })

    const procedureEngineLive = ProcedureEngine.Live.pipe(Layer.provide(MiddlewareEngine.Live))

    const runtimeLayer = Layer.mergeAll(
      MiddlewareEngine.Live,
      procedureEngineLive,
      pingLive,
      RpcBridge.Live,
    ) as unknown as Layer.Layer<unknown, never, never>

    const provided = Router.provide(runtimeLayer)(router)

    const httpLayer = Router.toHttpLayer({ path: "/rpc" })(provided)
    expect(Layer.isLayer(httpLayer)).toBe(true)
  })
})
