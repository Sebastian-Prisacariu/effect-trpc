/**
 * @module effect-trpc/react/server-client
 *
 * Utilities for using effect-trpc in React Server Components (RSC) and SSR.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as HttpClientError from "@effect/platform/HttpClientError"
import type { Router } from "../core/router.js"
import { Client, type TRPCClient } from "../core/client.js"
import { createRpcWebHandler } from "../shared/rpc-handler.js"

export interface CreateServerClientOptions<TRouter extends Router, R> {
  /**
   * The router instance.
   */
  readonly router: TRouter

  /**
   * The layer providing all procedure implementations.
   */
  readonly handlers: Layer.Layer<any, never, R>
}

/**
 * Creates a vanilla tRPC client optimized for Server Components and SSR.
 * 
 * This client bypasses the network entirely by routing requests directly 
 * to your procedure handlers. It creates a mock HttpClient that invokes
 * the handlers via a Web Request/Response lifecycle in-memory.
 *
 * @example
 * ```ts
 * // src/trpc/server.ts
 * import { createServerClient } from "effect-trpc/react"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 * 
 * export const serverClient = createServerClient({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 * ```
 * 
 * ```tsx
 * // src/app/page.tsx (Server Component)
 * import { Effect } from "effect"
 * import { serverClient } from "~/trpc/server"
 * 
 * export default async function Page() {
 *   // Call your procedures directly - no HTTP request is made!
 *   const users = await Effect.runPromise(
 *     serverClient.procedures.user.list()
 *   )
 *   
 *   return <UserList users={users} />
 * }
 * ```
 */
export function createServerClient<TRouter extends Router, R>(
  options: CreateServerClientOptions<TRouter, R>
): TRPCClient<TRouter> {
  const { router, handlers } = options

  // Create the web handler which contains our RPC routing logic
  const webHandler = createRpcWebHandler({ router, handlers })

  // Create a mock HttpClient that routes requests directly to the web handler,
  // bypassing the network entirely.
  const mockHttpClient = HttpClient.make((request) =>
    Effect.tryPromise({
      try: async () => {
        // The core client sends NdJson string body, but platform HttpClientRequest
        // serializes it to a Uint8Array body for transport.
        const requestBody = request.body._tag === "Uint8Array" ? request.body.body : undefined
        
        // We use a dummy local URL since this doesn't go over the network
        const init: RequestInit = {
          method: request.method,
          headers: request.headers as Record<string, string>,
        }
        if (requestBody) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          init.body = requestBody as any
        }

        const webRequest = new Request(`http://localhost${request.url}`, init)
        
        // Invoke the handler directly
        const webResponse = await webHandler.handler(webRequest)
        
        return HttpClientResponse.fromWeb(request, webResponse)
      },
      catch: (e) => new HttpClientError.RequestError({
        request,
        reason: "Transport",
        cause: e
      }) as HttpClientError.HttpClientError
    })
  )

  const httpClientLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient)

  // Return the vanilla client configured to use our mock HTTP client
  return Client.make<TRouter>({
    url: "/api/trpc", // Dummy URL, used by the mock client
    httpClient: httpClientLayer,
  })
}
