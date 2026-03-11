/**
 * Request handler implementation
 * @internal
 */

import { Effect, Layer, Schema } from "effect"
import * as Router from "../../Router/index.js"
import type * as Procedure from "../../Procedure/index.js"

interface RpcRequest {
  readonly id: string
  readonly path: string
  readonly payload: unknown
}

interface RpcResponse {
  readonly _tag: "Success" | "Failure"
  readonly id: string
  readonly value?: unknown
  readonly error?: unknown
}

/**
 * Handle a single RPC request
 */
export const handleRequest = <D extends Router.Definition, R>(
  router: Router.Router<D>,
  request: RpcRequest,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<RpcResponse, never, never> =>
  Effect.gen(function* () {
    const procedure = Router.get(router, request.path)

    if (!procedure) {
      return {
        _tag: "Failure" as const,
        id: request.id,
        error: { message: `Procedure not found: ${request.path}` },
      }
    }

    // Decode payload
    const decodeResult = yield* Schema.decodeUnknown(procedure.payload)(request.payload).pipe(
      Effect.either
    )

    if (decodeResult._tag === "Left") {
      return {
        _tag: "Failure" as const,
        id: request.id,
        error: { message: "Invalid payload", cause: decodeResult.left },
      }
    }

    // Execute handler
    const handlerResult = yield* (procedure.handler as (p: unknown) => Effect.Effect<unknown, unknown, R>)(
      decodeResult.right
    ).pipe(
      Effect.provide(layer),
      Effect.either
    )

    if (handlerResult._tag === "Left") {
      return {
        _tag: "Failure" as const,
        id: request.id,
        error: handlerResult.left,
      }
    }

    // Encode success
    const encodeResult = yield* Schema.encode(procedure.success)(handlerResult.right).pipe(
      Effect.either
    )

    if (encodeResult._tag === "Left") {
      return {
        _tag: "Failure" as const,
        id: request.id,
        error: { message: "Failed to encode response" },
      }
    }

    return {
      _tag: "Success" as const,
      id: request.id,
      value: encodeResult.right,
    }
  })

/**
 * Handle a batch of RPC requests
 */
export const handleBatch = <D extends Router.Definition, R>(
  router: Router.Router<D>,
  requests: ReadonlyArray<RpcRequest>,
  layer: Layer.Layer<R, never, never>
): Effect.Effect<ReadonlyArray<RpcResponse>, never, never> =>
  Effect.all(
    requests.map((request) => handleRequest(router, request, layer)),
    { concurrency: "unbounded" }
  )
