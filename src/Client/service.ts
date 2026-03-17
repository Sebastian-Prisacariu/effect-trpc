/**
 * Client Service - Internal Effect service for RPC calls
 * 
 * @internal
 * @module
 */

import * as Reactivity from "@effect/experimental/Reactivity"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

import { normalizePath } from "../Reactivity/index.js"
import * as Transport from "../Transport/index.js"

// =============================================================================
// ClientService
// =============================================================================

/** @internal */
export const ClientTypeId: unique symbol = Symbol.for("effect-trpc/Client")

/** @internal */
export type ClientTypeId = typeof ClientTypeId

/**
 * Internal service that handles RPC calls
 * 
 * @since 1.0.0
 * @category services
 */
export declare namespace ClientService {
  export interface Service {
    readonly send: <S, E>(
      tag: string,
      payload: unknown,
      successSchema: Schema.Schema<S, unknown>,
      errorSchema: Schema.Schema<E, unknown>,
      type?: Transport.ProcedureType
    ) => Effect.Effect<S, E | Transport.TransportError>

    readonly sendStream: <S, E>(
      tag: string,
      payload: unknown,
      successSchema: Schema.Schema<S, unknown>,
      errorSchema: Schema.Schema<E, unknown>
    ) => Stream.Stream<S, E | Transport.TransportError>

    readonly invalidate: (tags: readonly string[]) => Effect.Effect<void>
  }
}

/**
 * ClientService tag for dependency injection
 * 
 * @since 1.0.0
 * @category services
 */
export class ClientService extends Context.Tag("@effect-trpc/ClientService")<
  ClientService,
  ClientService.Service
>() {
  /**
   * Layer that provides ClientService from Transport
   * 
   * @since 1.0.0
   * @category layers
   */
  static Live: Layer.Layer<ClientService, never, Transport.Transport> = Layer.effect(
    this,
    Effect.gen(function* () {
      const transport = yield* Transport.Transport

      return {
        send: (tag, payload, successSchema, errorSchema, type) =>
          Effect.gen(function* () {
            const request = new Transport.TransportRequest({
              id: Transport.generateRequestId(),
              tag,
              payload,
              type: type ?? "query",
            })

            const response = yield* transport.send(request)

            if (Schema.is(Transport.Success)(response)) {
              return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
                Effect.mapError((e) => new Transport.TransportError({
                  reason: "Protocol",
                  message: "Failed to decode success response",
                  cause: e,
                }))
              )
            } else {
              const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
                Effect.mapError((e) => new Transport.TransportError({
                  reason: "Protocol",
                  message: "Failed to decode error response",
                  cause: e,
                }))
              )
              return yield* Effect.fail(error)
            }
          }),

        sendStream: <S, E>(
          tag: string,
          payload: unknown,
          successSchema: Schema.Schema<S, unknown>,
          errorSchema: Schema.Schema<E, unknown>
        ): Stream.Stream<S, E | Transport.TransportError> => {
          const request = new Transport.TransportRequest({
            id: Transport.generateRequestId(),
            tag,
            payload,
            type: "stream",
          })

          return transport.sendStream(request).pipe(
            // Take until StreamEnd
            Stream.takeWhile((response) => !Schema.is(Transport.StreamEnd)(response)),
            // Map each response
            Stream.mapEffect((response): Effect.Effect<S, E | Transport.TransportError> => {
              if (Schema.is(Transport.StreamChunk)(response)) {
                return Schema.decodeUnknown(successSchema)(response.chunk).pipe(
                  Effect.mapError((e) => new Transport.TransportError({
                    reason: "Protocol",
                    message: "Failed to decode stream chunk",
                    cause: e,
                  }))
                )
              }

              if (Schema.is(Transport.Failure)(response)) {
                // Decode the domain error, then fail with it
                // Only wrap in TransportError if decode itself fails
                return Schema.decodeUnknown(errorSchema)(response.error).pipe(
                  Effect.mapError((decodeError) =>
                    new Transport.TransportError({
                      reason: "Protocol",
                      message: "Failed to decode stream error",
                      cause: decodeError,
                    })
                  ),
                  Effect.flatMap((err) => Effect.fail(err as E))
                ) as Effect.Effect<S, E | Transport.TransportError>
              }
              // Should not reach here
              return Effect.fail(new Transport.TransportError({
                reason: "Protocol",
                message: "Unexpected stream response type",
              }))
            })
          )
        },

        invalidate: (paths) =>
          Effect.serviceOption(Reactivity.Reactivity).pipe(
            Effect.flatMap((opt) => {
              if (opt._tag === "None") return Effect.void
              return opt.value.invalidate(paths.map(normalizePath))
            }),
            Effect.catchAll(() => Effect.logWarning("No reactivity service available").pipe(Effect.asVoid))
          ),
      }
    })
  )
}
