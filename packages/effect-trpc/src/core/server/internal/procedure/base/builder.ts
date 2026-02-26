import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type { BaseContext } from "../../../middleware.js"
import type { ProcedureDefinition } from "../../../procedure.js"
import { Middleware } from "../../middleware/pipeline.js"

export class ProcedureError extends Schema.TaggedError<ProcedureError>()(
  "ProcedureError",
  { message: Schema.String }
) { }

export interface ProcedureShape {
  readonly execute: (
    def: ProcedureDefinition<any, any, any, any, any, any, any>,
    initialContext: BaseContext,
    input: unknown
  ) => Effect.Effect<any, any, any>
}

export class Procedure extends Context.Tag("@effect-trpc/Procedure")<
  Procedure,
  ProcedureShape
>() {
  static readonly Live = Layer.effect(this, Effect.gen(function* () {
    const middlewareEngine = yield* Middleware

    return {
      execute: (def, initialContext, input) => Effect.gen(function* () {
        const parsedInput = def.inputSchema
          ? yield* Schema.decodeUnknown(def.inputSchema)(input)
          : input

        const middlewareResult = yield* middlewareEngine.execute(
          def.middlewares,
          initialContext,
          parsedInput,
        )
        const ctx = middlewareResult.context

        const service = yield* def.serviceTag

        const handlerResult = service.handler(
          ctx as never,
          parsedInput as never,
        ) as unknown

        if (def.type === "stream" || def.type === "chat") {
          let resultStream = handlerResult as Stream.Stream<unknown, unknown, unknown>

          for (const provided of middlewareResult.services) {
            resultStream = Stream.provideService(
              resultStream,
              provided.tag,
              provided.value,
            )
          }

          const encodedStream = def.outputSchema
            ? Stream.mapEffect(
              resultStream,
              (part) => Schema.encodeUnknown(def.outputSchema ?? Schema.Any)(part),
            )
            : resultStream

          return encodedStream
        }

        let effectResult = handlerResult as Effect.Effect<unknown, unknown, unknown>

        for (const provided of middlewareResult.services) {
          effectResult = Effect.provideService(
            effectResult,
            provided.tag,
            provided.value,
          )
        }

        const result = yield* effectResult

        const parsedOutput = def.outputSchema
          ? yield* Schema.encodeUnknown(def.outputSchema)(result)
          : result

        return parsedOutput
      })
    }
  }))
}
