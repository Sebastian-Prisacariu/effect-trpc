import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type {
  BaseContext,
} from "../server/middleware.js"
import type {
  ProcedureRecord,
  ProceduresGroup,
} from "../server/procedures.js"
import type {
  ProcedureDefinition,
  ProcedureType,
} from "../server/procedure.js"
import type { RouterShape, RouterRecord } from "../server/router.js"
import type { RpcError } from "../rpc/errors.js"
import type { Stream } from "effect/Stream"
import { Transport } from "./transports.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryProcedureClient<I, A, E> {
  (input: I): Effect.Effect<A, E | RpcError>
}

export interface MutationProcedureClient<I, A, E> {
  (input: I): Effect.Effect<A, E | RpcError>
}

export interface StreamProcedureClient<I, A, E> {
  (input: I): Stream<A, E | RpcError>
}

export interface SubscriptionProcedureClient<I, A, E> {
  (input: I): Stream<A, E | RpcError>
}

export type ProcedureClient<P> =
  P extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx extends BaseContext, "query", infer _R, infer _Provides>
  ? QueryProcedureClient<unknown extends I ? void : I, A, E>
  : P extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx extends BaseContext, "mutation", infer _R, infer _Provides>
  ? MutationProcedureClient<unknown extends I ? void : I, A, E>
  : P extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx extends BaseContext, "stream" | "chat", infer _R, infer _Provides>
  ? StreamProcedureClient<unknown extends I ? void : I, A, E>
  : P extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx extends BaseContext, "subscription", infer _R, infer _Provides>
  ? SubscriptionProcedureClient<unknown extends I ? void : I, A, E>
  : never

export type RouterClient<R extends RouterRecord> = {
  [K in keyof R]: R[K] extends RouterShape<infer NestedRoutes>
  ? RouterClient<NestedRoutes>
  : R[K] extends ProceduresGroup<string, infer P>
  ? { [PK in keyof P]: ProcedureClient<P[PK]> }
  : R[K] extends AnyProcedureDefinition
  ? ProcedureClient<R[K]>
  : R[K] extends Record<string, AnyProcedureDefinition>
  ? { [PK in keyof R[K]]: ProcedureClient<R[K][PK]> }
  : never
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Engine Service
// ─────────────────────────────────────────────────────────────────────────────

type AnyProcedureDefinition = ProcedureDefinition<
  unknown,
  unknown,
  unknown,
  BaseContext,
  ProcedureType,
  unknown,
  unknown
>

export class ProxyInvocationError extends Schema.TaggedError<ProxyInvocationError>()(
  "ProxyInvocationError",
  { rpcName: Schema.String, message: Schema.String },
) { }

export interface ProxyShape {
  readonly createProxy: <TRouter extends RouterShape<RouterRecord>>(
    router: TRouter,
  ) => RouterClient<TRouter["routes"]>
}

export class Proxy extends Context.Tag("@effect-trpc/Proxy")<
  Proxy,
  ProxyShape
>() {
  static readonly Live = Layer.effect(this, Effect.gen(function* () {
    const transport = yield* Transport

    const flattenRoutes = <Routes extends Record<string, unknown>>(
      routes: Routes,
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

    const createRecursiveProxy = (
      flatProcedures: Record<string, AnyProcedureDefinition>,
      pathSegments: string[] = [],
    ): unknown => {
      return new globalThis.Proxy(() => { }, {
        get(_target, prop: string) {
          return createRecursiveProxy(flatProcedures, [...pathSegments, prop])
        },
        apply(_target, _thisArg, args) {
          const rpcName = pathSegments.join(".")
          const input = args[0] as unknown
          const definition = flatProcedures[rpcName]

          if (definition === undefined) {
            return Effect.fail(
              new ProxyInvocationError({
                rpcName,
                message: `Procedure not found at path '${rpcName}'`,
              }),
            )
          }

          const stream =
            definition.type === "stream" ||
            definition.type === "subscription" ||
            definition.type === "chat"

          return transport.call(rpcName, input, {
            payloadSchema: definition.inputSchema,
            successSchema: definition.outputSchema,
            errorSchema: definition.errorSchema,
            stream,
          })
        }
      })
    }

    return {
      createProxy: (router) => {
        const flatProcedures = flattenRoutes(router.routes)
        return createRecursiveProxy(
          flatProcedures,
        ) as RouterClient<typeof router.routes>
      },
    }
  }))
}
