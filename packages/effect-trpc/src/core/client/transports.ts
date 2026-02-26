import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from "@effect/rpc"

export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  { message: Schema.String }
) { }

export interface RpcCallDescriptor {
  readonly payloadSchema: unknown
  readonly successSchema: unknown
  readonly errorSchema: unknown
  readonly stream: boolean
}

export interface TransportShape {
  readonly call: (
    rpcName: string,
    input: unknown,
    descriptor: RpcCallDescriptor,
  ) => Effect.Effect<unknown, unknown, unknown> | Stream.Stream<unknown, unknown, unknown>
}

export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportShape
>() {
  static readonly HttpLive = (url: string) =>
    Layer.succeed(Transport, {
      call: (rpcName, input, descriptor) => {
        const rpc = Rpc.make(rpcName, {
          payload: (descriptor.payloadSchema ?? Schema.Unknown) as Schema.Schema.Any,
          success: (descriptor.successSchema ?? Schema.Unknown) as Schema.Schema.Any,
          error: (descriptor.errorSchema ?? Schema.Unknown) as Schema.Schema.All,
          ...(descriptor.stream ? { stream: true as const } : {}),
        })

        const group = RpcGroup.make(rpc)
        const protocolLayer = RpcClient.layerProtocolHttp({ url }).pipe(
          Layer.provide(RpcSerialization.layerNdjson),
          Layer.provide(FetchHttpClient.layer),
        )
        const clientEffect = RpcClient.make(group, { flatten: true }).pipe(
          Effect.provide(protocolLayer),
        )

        const invoke = (flatClient: unknown): unknown => {
          const callable = flatClient as (
            tag: string,
            payload: unknown,
          ) => unknown
          return callable(rpcName, input)
        }

        if (descriptor.stream) {
          return Stream.unwrapScoped(
            Effect.map(
              clientEffect,
              (flatClient) =>
                invoke(flatClient) as Stream.Stream<unknown, unknown>,
            ),
          )
        }

        return Effect.scoped(
          Effect.flatMap(
            clientEffect,
            (flatClient) => invoke(flatClient) as Effect.Effect<unknown, unknown>,
          ),
        )
      },
    })
}
