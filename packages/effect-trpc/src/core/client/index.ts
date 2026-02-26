import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { RouterShape, RouterRecord } from "../server/router.js"
import type { RouterClient } from "./proxy.js"
import { Proxy } from "./proxy.js"
import { Transport } from "./transports.js"

export interface ClientShape {
  readonly create: <TRouter extends RouterShape<RouterRecord>>(
    router: TRouter,
  ) => RouterClient<TRouter["routes"]>
}

export class Client extends Context.Tag("@effect-trpc/Client")<
  Client,
  ClientShape
>() {
  static readonly HttpLive = (url: string) => {
    const transportLive = Transport.HttpLive(url)
    const proxyLive = Proxy.Live.pipe(
      Layer.provide(transportLive),
    )
    const clientLive = this.Live.pipe(
      Layer.provide(proxyLive),
    )

    return Layer.mergeAll(
      transportLive,
      proxyLive,
      clientLive,
    )
  }

  static readonly Live = Layer.effect(this, Effect.gen(function* () {
    const proxy = yield* Proxy

    return {
      create: (router) => proxy.createProxy(router),
    }
  }))
}
