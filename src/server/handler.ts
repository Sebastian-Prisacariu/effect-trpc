/**
 * @module effect-trpc/server/handler
 * 
 * Server-side request handler for Effect RPC.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Context from "effect/Context"
import type { RouterDefinition, RouterRecord } from "../core/router.js"
import type { ProceduresGroup, ProcedureRecord, ProceduresService } from "../core/procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HandlerConfig<Routes extends RouterRecord, R> {
  readonly router: RouterDefinition<Routes>
  readonly handlers: Layer.Layer<any, never, R>
  readonly runtime?: "edge" | "nodejs"
}

export interface RequestContext {
  readonly headers: Headers
  readonly url: URL
}

interface RpcRequest {
  readonly path: string
  readonly input: unknown
  readonly type: "query" | "mutation"
}

interface RpcResponse {
  readonly result?: unknown
  readonly error?: {
    readonly code: string
    readonly message: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a route handler for Next.js App Router.
 * 
 * @example
 * ```ts
 * // app/api/trpc/[...trpc]/route.ts
 * import { createRouteHandler } from 'effect-trpc/server'
 * 
 * export const { GET, POST } = createRouteHandler({
 *   router: appRouter,
 *   handlers: Layer.mergeAll(
 *     UserProceduresLive,
 *     PostProceduresLive,
 *   ),
 * })
 * ```
 */
export const createRouteHandler = <Routes extends RouterRecord, R>(
  config: HandlerConfig<Routes, R>
): {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
} => {
  const handleRequest = async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const rpcRequest = await parseRequest(request, url)
      
      const result = await executeRpc(config, rpcRequest)
      
      return new Response(JSON.stringify(result), {
        status: "error" in result ? 400 : 200,
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      )
    }
  }
  
  return {
    GET: handleRequest,
    POST: handleRequest,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

const parseRequest = async (request: Request, url: URL): Promise<RpcRequest> => {
  // Extract path from URL (e.g., /api/trpc/user.list -> user.list)
  const pathMatch = url.pathname.match(/\/api\/trpc\/(.+)$/)
  const path = pathMatch?.[1] ?? ""
  
  let input: unknown = undefined
  
  if (request.method === "GET") {
    // Query params for GET
    const inputParam = url.searchParams.get("input")
    if (inputParam) {
      input = JSON.parse(inputParam)
    }
  } else {
    // Body for POST
    const body = await request.text()
    if (body) {
      const parsed = JSON.parse(body)
      input = parsed.input
    }
  }
  
  return {
    path,
    input,
    type: request.method === "GET" ? "query" : "mutation",
  }
}

const executeRpc = async <Routes extends RouterRecord, R>(
  config: HandlerConfig<Routes, R>,
  rpcRequest: RpcRequest
): Promise<RpcResponse> => {
  const { router, handlers } = config
  const { path, input } = rpcRequest
  
  // Find the procedure
  const parts = path.split(".")
  if (parts.length < 2) {
    return { error: { code: "NOT_FOUND", message: `Invalid path: ${path}` } }
  }
  
  const groupName = parts[0]
  const procedureName = parts.slice(1).join(".")
  
  // Find the procedures group
  const entry = router.routes[groupName]
  if (!entry || (entry as any)._tag !== "ProceduresGroup") {
    return { error: { code: "NOT_FOUND", message: `Group not found: ${groupName}` } }
  }
  
  const group = entry as ProceduresGroup<string, ProcedureRecord>
  const procedure = group.procedures[procedureName]
  
  if (!procedure) {
    return { error: { code: "NOT_FOUND", message: `Procedure not found: ${path}` } }
  }
  
  // Validate input
  if (procedure.inputSchema) {
    const parseResult = Schema.decodeUnknownEither(procedure.inputSchema)(input)
    if (parseResult._tag === "Left") {
      return {
        error: {
          code: "INPUT_VALIDATION",
          message: `Invalid input: ${parseResult.left.message}`,
        },
      }
    }
  }
  
  // Execute handler
  const program = Effect.gen(function* () {
    const service = yield* group.tag as Context.Tag<ProceduresService<string, ProcedureRecord>, ProceduresService<string, ProcedureRecord>>
    const handler = service.handlers[procedureName]
    
    if (!handler) {
      return yield* Effect.fail(new Error(`Handler not found: ${procedureName}`))
    }
    
    return yield* handler(input)
  }).pipe(
    Effect.provide(handlers as Layer.Layer<any, never, never>)
  )
  
  try {
    const result = await Effect.runPromise(program)
    
    // Validate output
    if (procedure.outputSchema) {
      const encodeResult = Schema.encodeUnknownEither(procedure.outputSchema)(result)
      if (encodeResult._tag === "Left") {
        return {
          error: {
            code: "OUTPUT_VALIDATION",
            message: `Invalid output: ${encodeResult.left.message}`,
          },
        }
      }
      return { result: encodeResult.right }
    }
    
    return { result }
  } catch (error) {
    return {
      error: {
        code: "HANDLER_ERROR",
        message: error instanceof Error ? error.message : "Handler failed",
      },
    }
  }
}
