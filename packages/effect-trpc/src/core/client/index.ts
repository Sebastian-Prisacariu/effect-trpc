import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientError from "@effect/platform/HttpClientError"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Random from "effect/Random"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import { isRpcClientError, RpcClientError, RpcResponseError } from "../rpc/errors.js"
import { RpcResponseMessageSchema } from "../rpc/messages.js"
import type { RouterRecord, RouterShape } from "../server/router.js"
import type { RouterClient } from "./proxy.js"
import { Proxy } from "./proxy.js"
import { Transport } from "./transports.js"
import { pipe } from "effect/Function"

/**
 * Error type for vanilla client RPC calls.
 * @since 1.0.0
 */
export type VanillaClientError = RpcClientError | RpcResponseError | HttpClientError.HttpClientError

// ─────────────────────────────────────────────────────────────────────────────
// TRPCClient Type (for Client.make)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A vanilla tRPC client that returns Effects requiring HttpClient.
 *
 * Created via `Client.make<TRouter>({ url })`.
 *
 * @example
 * ```ts
 * import { Client, type TRPCClient } from 'effect-trpc'
 * import type { AppRouter } from './router'
 *
 * const client = Client.make<AppRouter>({ url: '/api/trpc' })
 * // client.procedures.user.list() returns Effect<User[], Error, HttpClient>
 * ```
 */
export interface TRPCClient<TRouter extends RouterShape<RouterRecord>> {
  /**
   * Typed procedures proxy.
   * Each procedure returns an Effect that requires HttpClient.HttpClient.
   */
  readonly procedures: RouterClient<TRouter["routes"]>
}

/**
 * Options for Client.make
 */
export interface ClientMakeOptions {
  readonly url: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: RPC Request/Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RequestIdSchema = Schema.String.pipe(Schema.brand("RequestId"))
type RequestId = typeof RequestIdSchema.Type

const generateRequestId: Effect.Effect<RequestId> = Effect.gen(function* () {
  const timestamp = yield* Clock.currentTimeMillis
  const random = yield* Random.nextIntBetween(0, 1000000)
  return (String(timestamp) + String(random).padStart(6, "0")) as RequestId
})

// Helper to create RpcClientError
const createRpcClientError = (props: { message: string; cause?: unknown }) =>
  new RpcClientError(props)

// ─────────────────────────────────────────────────────────────────────────────
// Internal: createRpcEffect (for vanilla client)
// ─────────────────────────────────────────────────────────────────────────────

const createRpcRequestBody = (
  rpcName: string,
  input: unknown,
): Effect.Effect<string, RpcClientError> =>
  Effect.gen(function* () {
    const requestId = yield* generateRequestId
    return yield* Effect.try({
      try: () =>
        JSON.stringify({
          _tag: "Request",
          id: requestId,
          tag: rpcName,
          payload: input ?? {},
          headers: [],
        }) + "\n",
      catch: (e) =>
        createRpcClientError({
          message: `Failed to serialize RPC request for ${rpcName}`,
          cause: e,
        }),
    })
  })

const parseRpcResponse = <A>(text: string): Effect.Effect<A, RpcClientError> =>
  Effect.gen(function* () {
    const lines = text.trim().split("\n").filter(Boolean)

    for (const line of lines) {
      const decodeResult = yield* pipe(
        line,
        Schema.decodeUnknown(Schema.parseJson(RpcResponseMessageSchema)),

        Effect.mapError((e) =>
          createRpcClientError({ message: `Invalid RPC message format`, cause: e }),
        ),
        Effect.option,
      )

      if (decodeResult._tag === "None") continue

      const msg = decodeResult.value

      if (Predicate.isTagged(msg, "Exit")) {
        if (Predicate.isTagged(msg.exit, "Success")) {
          return msg.exit.value as A
        }
        const cause = msg.exit.cause
        if (Predicate.isTagged(cause, "Fail")) {
          const error = cause.error
          if (isRpcClientError(error)) return yield* error
          return yield* createRpcClientError({ message: "Request failed", cause: error })
        }
        if (Predicate.isTagged(cause, "Die")) {
          const defectMsg = typeof cause.defect === "string" ? cause.defect : "Unexpected error"
          return yield* createRpcClientError({ message: defectMsg, cause: cause.defect })
        }
        return yield* createRpcClientError({ message: "Request failed" })
      }

      if (Predicate.isTagged(msg, "Defect")) {
        return yield* createRpcClientError({ message: msg.defect ?? "Unknown error" })
      }
    }

    return yield* createRpcClientError({ message: "No response received" })
  })

const createRpcEffect = <A>(
  url: string,
  procedurePath: string,
  input: unknown,
): Effect.Effect<A, VanillaClientError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient
    const client = baseClient.pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({
        schedule: Schedule.exponential("200 millis"),
        times: 3,
      }),
    )

    const body = yield* createRpcRequestBody(procedurePath, input)
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/x-ndjson"),
      HttpClientRequest.accept("application/x-ndjson"),
      HttpClientRequest.bodyText(body),
    )

    const response = yield* client.execute(request).pipe(
      Effect.mapError((error): VanillaClientError => {
        if (error._tag === "ResponseError" && error.reason === "StatusCode") {
          return new RpcResponseError({
            message: `HTTP error: ${error.response.status}`,
            status: error.response.status,
          })
        }
        return error
      }),
    )

    const text = yield* response.text
    return yield* parseRpcResponse<A>(text)
  })

// ─────────────────────────────────────────────────────────────────────────────
// Client.make - Vanilla Effect Client Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a recursive proxy that returns Effects for each procedure.
 * @internal
 */
const createMakeProxy = <TRouter extends RouterShape<RouterRecord>>(
  url: string,
  pathSegments: string[] = [],
): RouterClient<TRouter["routes"]> => {
  return new globalThis.Proxy(() => {}, {
    get(_target, prop: string) {
      return createMakeProxy(url, [...pathSegments, prop])
    },
    apply(_target, _thisArg, args) {
      const procedurePath = pathSegments.join(".")
      const input = args[0] as unknown
      return createRpcEffect(url, procedurePath, input)
    },
  }) as unknown as RouterClient<TRouter["routes"]>
}

export interface ClientShape {
  readonly create: <TRouter extends RouterShape<RouterRecord>>(
    router: TRouter,
  ) => RouterClient<TRouter["routes"]>
}

export class Client extends Context.Tag("@effect-trpc/Client")<Client, ClientShape>() {
  /**
   * Create a vanilla tRPC client.
   *
   * Returns a client where each procedure call returns an Effect that
   * requires HttpClient.HttpClient. Use with ManagedRuntime or provide
   * FetchHttpClient.layer.
   *
   * @example
   * ```ts
   * import { Client } from 'effect-trpc'
   * import { FetchHttpClient } from '@effect/platform'
   * import type { AppRouter } from './router'
   *
   * const client = Client.make<AppRouter>({ url: '/api/trpc' })
   *
   * // Use with runtime that provides HttpClient
   * const runtime = ManagedRuntime.make(FetchHttpClient.layer)
   * const users = await runtime.runPromise(client.procedures.user.list())
   *
   * // Or provide the layer directly
   * const users = await Effect.runPromise(
   *   client.procedures.user.list().pipe(
   *     Effect.provide(FetchHttpClient.layer)
   *   )
   * )
   * ```
   */
  static readonly make = <TRouter extends RouterShape<RouterRecord>>(
    options: ClientMakeOptions,
  ): TRPCClient<TRouter> => {
    return {
      procedures: createMakeProxy<TRouter>(options.url),
    }
  }

  static readonly HttpLive = (url: string) => {
    const transportLive = Transport.HttpLive(url)
    const proxyLive = Proxy.Live.pipe(Layer.provide(transportLive))
    const clientLive = this.Live.pipe(Layer.provide(proxyLive))

    return Layer.mergeAll(transportLive, proxyLive, clientLive)
  }

  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const proxy = yield* Proxy

      return {
        create: (router) => proxy.createProxy(router),
      }
    }),
  )
}
