/**
 * Mock transport implementation
 * @internal
 */

import { Effect, Layer, Stream } from "effect"
import { Transport, type TransportService, type TransportRequest, type TransportResponse } from "../index.js"
import { TransportError } from "./error.js"

type MockHandler = (payload: unknown) => Effect.Effect<unknown, unknown>

/**
 * Create a mock transport from handlers
 */
export const mockTransport = (
  handlers: Record<string, MockHandler>
): Layer.Layer<Transport, never, never> => {
  const service: TransportService = {
    send: (request: TransportRequest) =>
      Stream.fromEffect(
        Effect.gen(function* () {
          const handler = handlers[request.path]
          
          if (!handler) {
            return {
              _tag: "Failure" as const,
              id: request.id,
              error: new TransportError({
                reason: "Protocol",
                message: `No mock handler for path: ${request.path}`,
              }),
            }
          }
          
          const result = yield* handler(request.payload).pipe(Effect.either)
          
          if (result._tag === "Left") {
            return {
              _tag: "Failure" as const,
              id: request.id,
              error: result.left,
            }
          }
          
          return {
            _tag: "Success" as const,
            id: request.id,
            value: result.right,
          } satisfies TransportResponse
        })
      ),
  }
  
  return Layer.succeed(Transport, service)
}
