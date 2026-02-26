import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type {
  AnyMiddlewareDefinition,
  BaseContext,
  MiddlewareDefinition,
} from "../../middleware.js"
import {
  isMiddlewareDefinition,
} from "../../middleware.js"

export class MiddlewareError extends Schema.TaggedError<MiddlewareError>()(
  "MiddlewareError",
  { message: Schema.String }
) { }

export interface MiddlewareExecutionResult {
  readonly context: BaseContext
  readonly services: ReadonlyArray<{ readonly tag: Context.Tag<any, any>; readonly value: any }>
}

export interface MiddlewareShape {
  readonly execute: (
    middlewares: ReadonlyArray<AnyMiddlewareDefinition>,
    initialContext: BaseContext,
    input: unknown,
  ) => Effect.Effect<MiddlewareExecutionResult, unknown, unknown>
}

export class Middleware extends Context.Tag("@effect-trpc/Middleware")<
  Middleware,
  MiddlewareShape
>() {
  static readonly Live = Layer.succeed(this, {
    execute: (middlewares, initialContext, input) =>
      Effect.gen(function* () {
        let context: BaseContext = initialContext

        for (const middlewareDef of middlewares) {
          if (isMiddlewareDefinition(middlewareDef)) {
            const def = middlewareDef as MiddlewareDefinition<any, any, any, any>
            const service = yield* def.serviceTag
            context = (yield* service.handler(
              context as never,
              input as never,
            )) as BaseContext
          } else {
            yield* Effect.fail(
              new MiddlewareError({
                message: "Unknown middleware definition",
              }),
            )
          }
        }

        return {
          context,
          services: [],
        } satisfies MiddlewareExecutionResult
      }),
  })
}
