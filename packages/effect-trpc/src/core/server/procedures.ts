import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import type { AnyMiddlewareDefinition, BaseContext } from "./middleware.js"
import type {
  ApplyMiddlewareToProcedure,
  ProcedureDefinition,
  ProcedureHandlerResult,
  ProcedureType,
} from "./procedure.js"
import { applyMiddlewareToProcedure } from "./procedure.js"

export type ProcedureRecord = Record<string, unknown>

export interface SubscriptionContext {
  readonly subscriptionId: string
  readonly clientId: string
  readonly userId: string
  readonly metadata: unknown
  readonly path: string
}

export type UnsubscribeReason =
  | { readonly _tag: "ClientUnsubscribed" }
  | { readonly _tag: "ClientDisconnected" }
  | { readonly _tag: "StreamCompleted" }
  | { readonly _tag: "StreamErrored"; readonly cause: unknown }
  | { readonly _tag: "ServerShutdown" }

export const UnsubscribeReason = {
  ClientUnsubscribed: { _tag: "ClientUnsubscribed" } as const,
  ClientDisconnected: { _tag: "ClientDisconnected" } as const,
  StreamCompleted: { _tag: "StreamCompleted" } as const,
  StreamErrored: (cause: unknown): UnsubscribeReason => ({ _tag: "StreamErrored", cause }),
  ServerShutdown: { _tag: "ServerShutdown" } as const,
}

export interface SubscriptionHandler<
  I,
  A,
  E,
  R,
> {
  readonly onSubscribe: (
    input: I,
    context: SubscriptionContext,
  ) => Effect.Effect<Stream.Stream<A, E>, E, R>
  readonly onUnsubscribe?: (
    context: SubscriptionContext,
    reason: UnsubscribeReason,
  ) => Effect.Effect<void, never, unknown>
  readonly onClientMessage?: (
    message: unknown,
    context: SubscriptionContext,
  ) => Effect.Effect<void, never, unknown>
}

type ProcedureImplementation<T> =
  T extends ProcedureDefinition<
    infer I,
    infer A,
    infer E,
    infer Ctx extends BaseContext,
    infer Type extends ProcedureType,
    infer R,
    infer _Provides
  >
    ? Type extends "subscription"
      ? SubscriptionHandler<I, A, E, R>
      : (
        ctx: Ctx,
        input: I,
      ) => ProcedureHandlerResult<A, E, Type, unknown>
    : never

export type ProceduresService<
  Name extends string = string,
  P extends ProcedureRecord = ProcedureRecord,
> = {
  readonly name: Name
  readonly handlers: {
    readonly [K in keyof P]: ProcedureImplementation<P[K]>
  }
}

export interface ProceduresGroup<
  Name extends string = string,
  P extends ProcedureRecord = ProcedureRecord,
> {
  readonly _tag: "ProceduresGroup"
  readonly name: Name
  readonly procedures: P
  toLayer(
    handlers: {
      readonly [K in keyof P]: ProcedureImplementation<P[K]>
    },
  ): Layer.Layer<unknown, never, unknown>

  use<M extends AnyMiddlewareDefinition>(
    middleware: M,
  ): ProceduresGroup<
    Name,
    ApplyMiddlewareToProcedureRecord<P, M>
  >
}

export type AnyProceduresGroup = ProceduresGroup<string, ProcedureRecord>

export type ApplyMiddlewareToProcedureRecord<
  P extends ProcedureRecord,
  M,
> = {
  readonly [K in keyof P]: ApplyMiddlewareToProcedure<P[K], M>
}

export const isProceduresGroup = (value: unknown): value is AnyProceduresGroup =>
  Predicate.isTagged(value, "ProceduresGroup")

type ProcedureDefinitionRuntime = {
  readonly _tag: "ProcedureDefinition"
  readonly toLayer: (
    handler: (
      ctx: BaseContext,
      input: unknown,
    ) => unknown,
  ) => Layer.Layer<unknown, never, unknown>
}

const isProcedureDefinitionRuntime = (value: unknown): value is ProcedureDefinitionRuntime =>
  Predicate.isTagged(value, "ProcedureDefinition") &&
  typeof (value as { readonly toLayer?: unknown }).toLayer === "function"

const applyMiddlewareToRecord = <
  P extends ProcedureRecord,
  M extends AnyMiddlewareDefinition,
>(
  definitions: P,
  middleware: M,
): ApplyMiddlewareToProcedureRecord<P, M> => {
  const next: Record<string, unknown> = {}
  for (const [procedureName, definition] of Object.entries(definitions)) {
    if (isProcedureDefinitionRuntime(definition)) {
      next[procedureName] = applyMiddlewareToProcedure(
        definition as ProcedureDefinition,
        middleware,
      )
    } else {
      next[procedureName] = definition
    }
  }
  return next as ApplyMiddlewareToProcedureRecord<P, M>
}

export const procedures = <
  const Name extends string,
  P extends ProcedureRecord,
>(
  name: Name,
  definitions: P,
): ProceduresGroup<Name, P> => ({
  _tag: "ProceduresGroup",
  name,
  procedures: definitions,
  toLayer(handlers) {
    const serviceTag = Context.GenericTag<ProceduresService<Name, P>>(
      `@effect-trpc/${name}`,
    )
    const layers: Array<Layer.Layer<unknown, never, unknown>> = []

    for (const [procedureName, definition] of Object.entries(definitions)) {
      const handler = handlers[procedureName as keyof P]
      if (isProcedureDefinitionRuntime(definition) && typeof handler === "function") {
        const typedLayer = definition.toLayer(
          handler as (
            ctx: BaseContext,
            input: unknown,
          ) => ProcedureHandlerResult<unknown, unknown, ProcedureType, unknown>,
        )
        layers.push(typedLayer as unknown as Layer.Layer<unknown, never, unknown>)
      }
    }

    return Layer.mergeAll(
      Layer.succeed(serviceTag, { name, handlers }),
      ...layers,
    )
  },
  use(middleware) {
    return procedures(
      name,
      applyMiddlewareToRecord(definitions, middleware),
    )
  },
})

export const Procedures = {
  make: procedures,
  use: <M extends AnyMiddlewareDefinition>(
    middleware: M,
  ) => <Name extends string, P extends ProcedureRecord>(
    group: ProceduresGroup<Name, P>,
  ): ProceduresGroup<
    Name,
    ApplyMiddlewareToProcedureRecord<P, M>
  > =>
    group.use(middleware),
  prefix: <const Prefix extends string, P extends ProcedureRecord>(
    _prefix: Prefix,
    definitions: P,
  ): P => definitions,
}

