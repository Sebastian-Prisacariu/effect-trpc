import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter"
import { Rpc, RpcGroup, RpcSchema, RpcSerialization, RpcServer } from "@effect/rpc"
import { Array, pipe } from "effect"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type { BaseContext } from "../middleware.js"
import type { ProcedureRecord, ProceduresGroup } from "../procedures.js"
import type { ProcedureDefinition } from "../procedure.js"
import type { ProcedureType } from "../procedure.js"
import type { RouterRecord, RouterShape } from "../router.js"
import { Procedure } from "./procedure/base/builder.js"

export class RpcBridgeError extends Schema.TaggedError<RpcBridgeError>()(
  "RpcBridgeError",
  { message: Schema.String }
) { }

export interface RpcBridgeShape {
  readonly toHttpLayer: (
    router: RouterShape<RouterRecord>,
    options?: {
      path?: `/${string}` | "*"
      disableTracing?: boolean
      spanPrefix?: string
    },
  ) => Layer.Layer<never, never, HttpLayerRouter.HttpRouter>
}

type AnyProcedureDefinition = ProcedureDefinition<
  unknown,
  unknown,
  unknown,
  BaseContext,
  ProcedureType,
  unknown,
  unknown
>

type BridgeRpc =
  | Rpc.Rpc<string, Schema.Schema.Any, Schema.Schema.Any, Schema.Schema.All>
  | Rpc.Rpc<
    string,
    Schema.Schema.Any,
    RpcSchema.Stream<Schema.Schema.Any, Schema.Schema.All>,
    Schema.Schema.All
  >

export class RpcBridge extends Context.Tag("@effect-trpc/RpcBridge")<
  RpcBridge,
  RpcBridgeShape
>() {
  static readonly Live = Layer.succeed(this, (() => {
    const flattenRoutes = <Routes extends Record<string, unknown>>(
      routes: Routes,
      prefix = ""
    ): Record<string, AnyProcedureDefinition> => {
      let flat: Record<string, AnyProcedureDefinition> = {}
      for (const [key, value] of Object.entries(routes)) {
        const newPrefix = prefix ? `${prefix}.${key}` : key

        Match.value(value).pipe(
          Match.when(
            (candidate: unknown): candidate is AnyProcedureDefinition =>
              Predicate.isTagged(candidate, "ProcedureDefinition"),
            (def) => {
              flat[newPrefix] = def
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

    return {
      toHttpLayer: (
        router: RouterShape<RouterRecord>,
        options: {
          path?: `/${string}` | "*"
          disableTracing?: boolean
          spanPrefix?: string
        } = {},
      ) => {
        const path = options.path ?? "/rpc"
        const flatProcedures = flattenRoutes(router.routes)

        const rpcDefs: Record<string, BridgeRpc> = {}
        for (const [name, def] of Object.entries(flatProcedures)) {
          if (def.type === "query" || def.type === "mutation") {
            rpcDefs[name] = Rpc.make(name, {
              payload: def.inputSchema ?? Schema.Unknown,
              success: def.outputSchema ?? Schema.Unknown,
              error: def.errorSchema ?? Schema.Unknown,
            })
          } else {
            rpcDefs[name] = Rpc.make(name, {
              payload: def.inputSchema ?? Schema.Unknown,
              success: def.outputSchema ?? Schema.Unknown,
              error: def.errorSchema ?? Schema.Unknown,
              stream: true,
            })
          }
        }

        const group = RpcGroup.make(...pipe(Array.fromRecord(rpcDefs), Array.map(([_name, rpc]) => rpc)))

        const handlers: Record<string, Rpc.ToHandlerFn<BridgeRpc, Procedure>> = {}
        for (const [name, def] of Object.entries(flatProcedures)) {
          handlers[name] = (input) =>
            Effect.flatMap(Procedure, (procedureService) =>
              procedureService.execute(
                def,
                {
                  procedure: name,
                  headers: new Headers(),
                  signal: new AbortController().signal,
                  clientId: 0,
                },
                input,
              ),
            )
        }

        const handlersLayer = group.toLayer(handlers)

        return RpcServer.layerHttpRouter({
          group,
          path,
          protocol: "http",
          disableTracing: options.disableTracing,
          spanPrefix: options.spanPrefix,
        }).pipe(
          Layer.provide(handlersLayer),
          Layer.provide(RpcSerialization.layerNdjson),
        ) as Layer.Layer<never, never, HttpLayerRouter.HttpRouter>
      },
    }
  })())
}
