import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"

interface Db { query: () => Effect.Effect<string> }
const Db = Context.GenericTag<Db>("Db")

interface MyService {
  run: () => Effect.Effect<string, never, never>
}
const MyService = Context.GenericTag<MyService>("MyService")

const MyServiceLive = Layer.effect(MyService, Effect.context<Db>().pipe(
  Effect.map((context) => ({
    run: () => Effect.provide(
      Effect.gen(function*() {
        const db = yield* Db
        return yield* db.query()
      }),
      context
    )
  }))
))
