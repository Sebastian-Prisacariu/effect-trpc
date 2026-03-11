/**
 * @module effect-trpc/server
 * 
 * Next.js App Router handler for Effect RPC.
 */

import { RpcServer, RpcSerialization } from "@effect/rpc"
import type { RpcGroup } from "@effect/rpc"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Layer, Runtime, Scope } from "effect"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteHandlerConfig<TGroup extends RpcGroup.Any, R> {
  /**
   * The RPC group definition.
   */
  readonly rpcs: TGroup
  
  /**
   * Layer providing all RPC handlers.
   */
  readonly handlers: Layer.Layer<RpcGroup.Handlers<TGroup>, never, R>
  
  /**
   * Additional dependencies for the handlers.
   */
  readonly dependencies?: Layer.Layer<R, never, never>
  
  /**
   * Serialization format (default: ndjson)
   */
  readonly serialization?: "ndjson" | "json"
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Next.js route handler for Effect RPC.
 * 
 * @example
 * ```ts
 * // app/api/rpc/route.ts
 * import { createRouteHandler } from "effect-trpc/server"
 * import { UserRpcs, UserRpcsLive, DatabaseLive } from "./rpc"
 * 
 * export const POST = createRouteHandler({
 *   rpcs: UserRpcs,
 *   handlers: UserRpcsLive,
 *   dependencies: DatabaseLive,
 * })
 * ```
 */
export const createRouteHandler = <TGroup extends RpcGroup.Any, R>(
  config: RouteHandlerConfig<TGroup, R>
): ((request: Request) => Promise<Response>) => {
  const { rpcs, handlers, dependencies, serialization = "ndjson" } = config
  
  // Build the full layer
  const RpcLayer = RpcServer.layer(rpcs).pipe(
    Layer.provide(handlers),
    dependencies ? Layer.provide(dependencies) : (l) => l,
  )
  
  const SerializationLayer = serialization === "ndjson"
    ? RpcSerialization.layerNdjson
    : RpcSerialization.layerJson
  
  // Create a runtime for handling requests
  const makeRuntime = Effect.gen(function* () {
    const scope = yield* Scope.make()
    
    const layer = Layer.mergeAll(
      RpcLayer,
      SerializationLayer,
    )
    
    const context = yield* Layer.buildWithScope(layer, scope)
    const runtime = yield* Effect.runtime<RpcGroup.Handlers<TGroup>>()
    
    return { runtime, scope, context }
  })
  
  // The actual request handler
  return async (request: Request): Promise<Response> => {
    try {
      const body = await request.text()
      
      // Parse the RPC request
      const program = Effect.gen(function* () {
        const server = yield* RpcServer.RpcServer
        
        // Process the request
        const response = yield* server.handle(body)
        
        return new Response(response, {
          status: 200,
          headers: {
            "Content-Type": serialization === "ndjson" 
              ? "application/x-ndjson" 
              : "application/json",
          },
        })
      })
      
      // Run with the full layer
      const result = await Effect.runPromise(
        program.pipe(
          Effect.provide(RpcLayer as any),
          Effect.provide(SerializationLayer),
        )
      )
      
      return result
    } catch (error) {
      console.error("[effect-trpc] Server error:", error)
      
      return new Response(
        JSON.stringify({
          _tag: "Error",
          error: {
            message: error instanceof Error ? error.message : "Internal server error",
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      )
    }
  }
}
