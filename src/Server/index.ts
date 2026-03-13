/**
 * Server - Handle RPC requests with typed handlers
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Server, Router, Procedure } from "effect-trpc"
 * import { Effect, Schema } from "effect"
 * 
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: Procedure.query({ success: Schema.Array(User) }),
 *     get: Procedure.query({ 
 *       payload: Schema.Struct({ id: Schema.String }), 
 *       success: User,
 *       error: NotFoundError,
 *     }),
 *   },
 * })
 * 
 * const server = Server.make(appRouter, {
 *   users: {
 *     list: () => Effect.gen(function* () {
 *       const db = yield* Database
 *       return yield* db.getAllUsers()
 *     }),
 *     get: ({ id }) => Effect.gen(function* () {
 *       const db = yield* Database
 *       const user = yield* db.findUser(id)
 *       return user ?? yield* Effect.fail(new NotFoundError({ entity: "User", id }))
 *     }),
 *   },
 * })
 * 
 * // Provide dependencies and convert to HTTP handler
 * const httpHandler = Server.toHttpHandler(server).pipe(
 *   Effect.provide(DatabaseLive)
 * )
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Pipeable, pipeArguments } from "effect/Pipeable"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Router from "../Router/index.js"
import * as Procedure from "../Procedure/index.js"
import * as Transport from "../Transport/index.js"
import * as Middleware from "../Middleware/index.js"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const ServerTypeId: unique symbol = Symbol.for("effect-trpc/Server")

/** @internal */
export type ServerTypeId = typeof ServerTypeId

// =============================================================================
// Handler Type Helpers
// =============================================================================

/**
 * Extract handler type for a procedure or nested definition
 * 
 * @since 1.0.0
 * @category type-level
 */
export type HandlerFor<P, R = never> = 
  P extends Procedure.Query<infer Payload, infer Success, infer Error>
    ? (payload: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
  : P extends Procedure.Mutation<infer Payload, infer Success, infer Error, any>
    ? (payload: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
  : P extends Procedure.Stream<infer Payload, infer Success, infer Error>
    ? (payload: Schema.Schema.Type<Payload>) => Stream.Stream<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
  : P extends Router.Definition
    ? Handlers<P, R>
  : never

/**
 * Handlers that mirror the router structure
 * 
 * @since 1.0.0
 * @category handlers
 */
export type Handlers<D extends Router.Definition, R = never> = {
  readonly [K in keyof D]: HandlerFor<D[K], R>
}

// =============================================================================
// Server Model
// =============================================================================

/**
 * A Server that handles RPC requests
 * 
 * @since 1.0.0
 * @category models
 */
export interface Server<D extends Router.Definition, R = never> extends Pipeable {
  readonly [ServerTypeId]: ServerTypeId
  
  /**
   * The router this server handles
   */
  readonly router: Router.Router<D>
  
  /**
   * Server-level middlewares
   */
  readonly middlewares: ReadonlyArray<unknown>
  
  /**
   * Handle a single request (query/mutation)
   */
  readonly handle: (
    request: Transport.TransportRequest
  ) => Effect.Effect<Transport.TransportResponse, never, R>
  
  /**
   * Handle a streaming request
   */
  readonly handleStream: (
    request: Transport.TransportRequest
  ) => Stream.Stream<Transport.StreamResponse, never, R>
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a server from a router and handlers
 * 
 * Handlers mirror the router structure. Each handler receives the decoded
 * payload and returns an Effect (or Stream for streaming procedures).
 * 
 * @since 1.0.0
 * @category constructors
 */
export const make = <D extends Router.Definition, R = never>(
  router: Router.Router<D>,
  handlers: Handlers<D, R>
): Server<D, R> => {
  // Build a map from tag to handler + procedure + middleware
  const handlerMap = new Map<string, {
    handler: (payload: unknown) => Effect.Effect<unknown, unknown, R> | Stream.Stream<unknown, unknown, R>
    procedure: Procedure.Any
    isStream: boolean
    middlewares: ReadonlyArray<Middleware.Applicable>
  }>()
  
  const buildHandlerMap = (
    def: Router.Definition,
    handlerDef: Record<string, unknown>,
    pathParts: readonly string[],
    inheritedMiddlewares: ReadonlyArray<Middleware.Applicable>
  ): void => {
    for (const key of Object.keys(def)) {
      let entry = def[key]
      const handler = handlerDef[key]
      const newPath = [...pathParts, key]
      const tag = [router.tag, ...newPath].join("/")
      
      // Check if entry is wrapped with middleware (Router.withMiddleware)
      let groupMiddlewares: ReadonlyArray<Middleware.Applicable> = []
      if (typeof entry === "object" && entry !== null && "definition" in entry && "middlewares" in entry) {
        const wrapped = entry as unknown as Router.DefinitionWithMiddleware<Router.Definition>
        groupMiddlewares = wrapped.middlewares as ReadonlyArray<Middleware.Applicable>
        entry = wrapped.definition
      }
      
      const currentMiddlewares = [...inheritedMiddlewares, ...groupMiddlewares]
      
      if (Procedure.isProcedure(entry)) {
        // Add procedure's own middlewares
        const procedureMiddlewares = entry.middlewares as ReadonlyArray<Middleware.Applicable>
        handlerMap.set(tag, {
          handler: handler as (payload: unknown) => Effect.Effect<unknown, unknown, R>,
          procedure: entry,
          isStream: Procedure.isStream(entry),
          middlewares: [...currentMiddlewares, ...procedureMiddlewares],
        })
      } else if (typeof entry === "object" && entry !== null) {
        // Nested definition - recurse
        buildHandlerMap(
          entry as Router.Definition,
          handler as Record<string, unknown>,
          newPath,
          currentMiddlewares
        )
      }
    }
  }
  
  buildHandlerMap(router.definition, handlers as Record<string, unknown>, [], [])
  
  // Convert tag to path (e.g., "@api/users/list" → "users.list")
  const tagToPath = (tag: string): string => {
    const withoutPrefix = tag.startsWith("@") ? tag.slice(tag.indexOf("/") + 1) : tag
    return withoutPrefix.replace(/\//g, ".")
  }
  
  // Get procedure type
  const getProcedureType = (proc: Procedure.Any): Middleware.ProcedureType => {
    if (Procedure.isMutation(proc)) return "mutation"
    if (Procedure.isStream(proc)) return "stream"
    return "query"
  }
  
  // Create MiddlewareRequest from TransportRequest
  const toMiddlewareRequest = (
    request: Transport.TransportRequest,
    procedureType: Middleware.ProcedureType,
    meta: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Middleware.MiddlewareRequest => ({
    id: request.id,
    tag: request.tag,
    path: tagToPath(request.tag),
    type: procedureType,
    headers: {
      get: (name: string) => request.headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in request.headers,
    },
    payload: request.payload,
    meta,
    signal,
  })
  
  // Handle a single request
  const handle = (
    request: Transport.TransportRequest
  ): Effect.Effect<Transport.TransportResponse, never, R> => {
    const entry = handlerMap.get(request.tag)
    
    if (!entry) {
      return Effect.succeed(new Transport.Failure({
        id: request.id,
        error: { message: `Unknown procedure: ${request.tag}` },
      }))
    }
    
    const { handler, procedure, isStream, middlewares } = entry
    
    if (isStream) {
      return Effect.succeed(new Transport.Failure({
        id: request.id,
        error: { message: `Use handleStream for streaming procedures: ${request.tag}` },
      }))
    }
    
    // TODO: Add meta support to procedures
    const middlewareRequest = toMiddlewareRequest(
      request, 
      getProcedureType(procedure),
      {} // procedure.meta when implemented
    )
    
    return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      Effect.matchEffect({
        onFailure: (cause) => Effect.succeed(new Transport.Failure({
          id: request.id,
          error: { message: "Invalid payload", cause },
        })),
        onSuccess: (payload) => {
          // Build the handler effect
          const handlerEffect = (handler(payload) as Effect.Effect<unknown, unknown, R>).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Schema.encode(procedure.errorSchema)(error).pipe(
                  Effect.catchAll((encodeError) =>
                    Effect.logWarning("Failed to encode error response", {
                      tag: request.tag,
                      encodeError,
                      originalError: error,
                    }).pipe(Effect.as(error))
                  ),
                  Effect.map((encodedError) => new Transport.Failure({
                    id: request.id,
                    error: encodedError,
                  }))
                ),
              onSuccess: (value) =>
                Schema.encode(procedure.successSchema)(value).pipe(
                  Effect.catchAll((encodeError) =>
                    Effect.logWarning("Failed to encode success response", {
                      tag: request.tag,
                      encodeError,
                      originalValue: value,
                    }).pipe(Effect.as(value))
                  ),
                  Effect.map((encodedValue) => new Transport.Success({
                    id: request.id,
                    value: encodedValue,
                  }))
                ),
            })
          )
          
          // Execute procedure/group middleware chain if any
          if (middlewares.length > 0) {
            return Middleware.execute(
              middlewares,
              middlewareRequest,
              handlerEffect
            ) as Effect.Effect<Transport.TransportResponse, never, R>
          }
          
          return handlerEffect
        },
      })
    ) as Effect.Effect<Transport.TransportResponse, never, R>
  }
  
  // Handle a streaming request
  // NOTE: Middleware is applied BEFORE stream iteration starts.
  // Following Effect RPC's pattern - middleware runs once on connection setup,
  // and if it fails, no stream data flows.
  const handleStream = (
    request: Transport.TransportRequest
  ): Stream.Stream<Transport.StreamResponse, never, R> => {
    const entry = handlerMap.get(request.tag)
    
    if (!entry) {
      return Stream.succeed(new Transport.Failure({
        id: request.id,
        error: { message: `Unknown procedure: ${request.tag}` },
      }))
    }
    
    const { handler, procedure, isStream, middlewares } = entry
    
    if (!isStream) {
      return Stream.succeed(new Transport.Failure({
        id: request.id,
        error: { message: `Use handle for non-streaming procedures: ${request.tag}` },
      }))
    }
    
    // TODO: Add meta support to procedures
    const middlewareRequest = toMiddlewareRequest(
      request,
      "stream",
      {} // procedure.meta when implemented
    )
    
    const makeStream = (payload: unknown): Stream.Stream<Transport.StreamResponse, never, R> => {
      const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
      
      // Wrap stream in Effect that runs middleware first
      // Middleware executes ONCE before stream starts
      const streamWithMiddleware: Effect.Effect<Stream.Stream<Transport.StreamResponse, never, R>, unknown, R> = 
        middlewares.length > 0
          ? Middleware.execute(
              middlewares,
              middlewareRequest,
              // This Effect just returns the stream - middleware runs first
              Effect.succeed(stream)
            ).pipe(
              Effect.map((s) => s.pipe(
                Stream.map((value): Transport.StreamResponse => 
                  new Transport.StreamChunk({ id: request.id, chunk: value })
                ),
                Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
                  Stream.succeed(new Transport.Failure({ id: request.id, error }))
                ),
                Stream.concat(Stream.succeed(new Transport.StreamEnd({ id: request.id })))
              ))
            )
          : Effect.succeed(stream.pipe(
              Stream.map((value): Transport.StreamResponse => 
                new Transport.StreamChunk({ id: request.id, chunk: value })
              ),
              Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
                Stream.succeed(new Transport.Failure({ id: request.id, error }))
              ),
              Stream.concat(Stream.succeed(new Transport.StreamEnd({ id: request.id })))
            ))
      
      // If middleware fails, return failure response
      return Stream.unwrap(
        streamWithMiddleware.pipe(
          Effect.catchAll((error) => 
            Effect.succeed(
              Stream.succeed(new Transport.Failure({ id: request.id, error })) as 
                Stream.Stream<Transport.StreamResponse, never, R>
            )
          )
        )
      ) as Stream.Stream<Transport.StreamResponse, never, R>
    }
    
    const failureStream = Stream.succeed(new Transport.Failure({
      id: request.id,
      error: { message: "Invalid payload" },
    })) as Stream.Stream<Transport.StreamResponse, never, R>
    
    return Stream.unwrap(
      Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
        Effect.map(makeStream),
        Effect.catchAll((decodeError) =>
          Effect.logWarning("Stream payload validation failed", {
            tag: request.tag,
            decodeError,
          }).pipe(Effect.as(failureStream))
        )
      )
    ) as Stream.Stream<Transport.StreamResponse, never, R>
  }
  
  return {
    [ServerTypeId]: ServerTypeId,
    router,
    middlewares: [],
    handle,
    handleStream,
    pipe() {
      return pipeArguments(this, arguments)
    },
  }
}

// =============================================================================
// HTTP Adapter
// =============================================================================

/**
 * Options for HTTP handler
 * 
 * @since 1.0.0
 * @category http
 */
export interface HttpHandlerOptions {
  /**
   * Base path for the RPC endpoint (default: "/rpc")
   */
  readonly path?: string
}

/**
 * Convert a server to an HTTP request handler
 * 
 * Returns a function that takes an HTTP request and returns an Effect
 * that produces an HTTP response. Provide all dependencies before using.
 * 
 * @since 1.0.0
 * @category http
 * @example
 * ```ts
 * const server = Server.make(appRouter, handlers)
 * const httpHandler = Server.toHttpHandler(server)
 * 
 * // In Express
 * app.post('/api/trpc', async (req, res) => {
 *   const response = await Effect.runPromise(
 *     httpHandler(req).pipe(Effect.provide(AppLive))
 *   )
 *   res.status(response.status).json(JSON.parse(response.body))
 * })
 * ```
 */
export const toHttpHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  _options?: HttpHandlerOptions
): (request: HttpRequest) => Effect.Effect<HttpResponse, never, R> => {
  return (request: HttpRequest) =>
    Effect.tryPromise({
      try: () => request.json(),
      catch: () => ({ id: "", tag: "", payload: undefined }),
    }).pipe(
      Effect.flatMap((body) => {
        // Extract headers from request if available
        const headers: Record<string, string> = {}
        if (request.headers) {
          if (typeof request.headers.get === "function") {
            // Headers object with get method (fetch API)
            const commonHeaders = ["authorization", "content-type", "x-request-id", "x-batch"]
            for (const name of commonHeaders) {
              const value = (request.headers as any).get(name)
              if (value) headers[name] = value
            }
          } else if (typeof request.headers === "object") {
            // Plain object (Express, Next.js)
            for (const [key, value] of Object.entries(request.headers)) {
              if (typeof value === "string") {
                headers[key.toLowerCase()] = value
              }
            }
          }
        }
        
        // Check if this is a batch request
        if (Transport.Batching.isBatchRequest(body)) {
          return Transport.Batching.handleBatch(server.handle)(
            body as Transport.Batching.BatchRequest
          ).pipe(
            Effect.map((batchResponse): HttpResponse => ({
              status: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(batchResponse),
            }))
          )
        }
        
        const transportRequest = new Transport.TransportRequest({
          id: (body as any).id ?? Transport.generateRequestId(),
          tag: (body as any).tag ?? "",
          payload: (body as any).payload,
          headers,
        })
        
        return server.handle(transportRequest).pipe(
          Effect.map((response): HttpResponse => ({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          }))
        )
      }),
      Effect.catchAll((error) =>
        // JSON parsing errors should return 400 Bad Request
        // Other errors return 500 Internal Server Error
        Effect.logWarning("HTTP handler error", { error }).pipe(
          Effect.as({
            status: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Invalid request" }),
          })
        )
      )
    ) as Effect.Effect<HttpResponse, never, R>
}

/**
 * Create an SSE (Server-Sent Events) handler for streaming responses.
 * 
 * @since 1.0.0
 * @category http
 * @example
 * ```ts
 * // Express
 * app.post('/api/trpc/stream', async (req, res) => {
 *   res.setHeader('Content-Type', 'text/event-stream')
 *   res.setHeader('Cache-Control', 'no-cache')
 *   res.setHeader('Connection', 'keep-alive')
 *   
 *   const stream = Server.toSSEHandler(server)
 *   await Effect.runPromise(
 *     stream(req.body).pipe(
 *       Stream.runForEach((chunk) => 
 *         Effect.sync(() => res.write(`data: ${JSON.stringify(chunk)}\n\n`))
 *       ),
 *       Effect.provide(AppLive)
 *     )
 *   )
 *   res.write('data: [DONE]\n\n')
 *   res.end()
 * })
 * ```
 */
export const toSSEHandler = <D extends Router.Definition, R>(
  server: Server<D, R>
): (body: unknown) => Stream.Stream<Transport.StreamResponse, never, R> => {
  return (body: unknown) => {
    const request = new Transport.TransportRequest({
      id: (body as any).id ?? Transport.generateRequestId(),
      tag: (body as any).tag ?? "",
      payload: (body as any).payload,
      headers: {},
    })
    
    return server.handleStream(request)
  }
}

/**
 * Create a fetch-compatible SSE handler for streaming responses.
 * Returns a Response with a ReadableStream body.
 * 
 * @since 1.0.0
 * @category http
 * @example
 * ```ts
 * // Next.js App Router
 * export async function POST(request: Request) {
 *   return Server.toFetchSSEHandler(server, AppLive)(request)
 * }
 * ```
 */
export const toFetchSSEHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  layer: Layer.Layer<R>
): (request: Request) => Promise<Response> => {
  const sseHandler = toSSEHandler(server)
  
  return async (request: Request): Promise<Response> => {
    const body = await request.json()
    const stream = sseHandler(body)
    
    // Create a TransformStream to convert our stream to SSE format
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    
    // Run the stream in the background
    Effect.runPromise(
      stream.pipe(
        Stream.runForEach((chunk) =>
          Effect.promise(async () => {
            await writer.write(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
          })
        ),
        Effect.tap(() =>
          Effect.promise(async () => {
            await writer.write(encoder.encode(`data: [DONE]\n\n`))
            await writer.close()
          })
        ),
        Effect.catchAll(() =>
          Effect.promise(async () => {
            await writer.write(encoder.encode(`data: {"_tag":"Failure","error":"Stream error"}\n\n`))
            await writer.close()
          })
        ),
        Effect.provide(layer)
      )
    ).catch(() => {
      writer.close().catch(() => {})
    })
    
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    })
  }
}

/**
 * Create a fetch-compatible handler (for Next.js App Router, Cloudflare Workers, etc.)
 * 
 * @since 1.0.0
 * @category http
 * @example
 * ```ts
 * // app/api/trpc/route.ts (Next.js App Router)
 * import { Server } from "effect-trpc"
 * 
 * const handler = Server.toFetchHandler(server, AppLive)
 * export const POST = handler
 * ```
 */
export const toFetchHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  layer: Layer.Layer<R>
): (request: Request) => Promise<Response> => {
  const handler = toHttpHandler(server)
  
  return async (request: Request): Promise<Response> => {
    const httpRequest: HttpRequest = {
      json: () => request.json(),
      headers: request.headers,
    }
    
    const response = await Effect.runPromise(
      handler(httpRequest).pipe(Effect.provide(layer))
    )
    
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  }
}

/**
 * Create handler for Next.js API routes (Pages Router)
 * 
 * @since 1.0.0
 * @category http
 * @example
 * ```ts
 * // pages/api/trpc.ts
 * import { Server } from "effect-trpc"
 * 
 * export default Server.toNextApiHandler(server, AppLive)
 * ```
 */
export const toNextApiHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  layer: Layer.Layer<R>
): (req: NextApiRequest, res: NextApiResponse) => Promise<void> => {
  const handler = toHttpHandler(server)
  
  return async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    const httpRequest: HttpRequest = {
      json: () => Promise.resolve(req.body),
      headers: req.headers as Record<string, string>,
    }
    
    const response = await Effect.runPromise(
      handler(httpRequest).pipe(Effect.provide(layer))
    )
    
    res.status(response.status)
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value)
    }
    res.send(response.body)
  }
}

// Minimal HTTP types (no @effect/platform dependency)
interface HttpRequest {
  readonly json: () => Promise<unknown>
  readonly headers?: 
    | Record<string, string | string[] | undefined>
    | { get: (name: string) => string | null }
}

interface HttpResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

// Next.js types
interface NextApiRequest {
  readonly body: unknown
  readonly headers: Record<string, string | string[] | undefined>
}

interface NextApiResponse {
  status: (code: number) => NextApiResponse
  setHeader: (name: string, value: string) => void
  send: (body: string) => void
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if a value is a Server
 * 
 * @since 1.0.0
 * @category guards
 */
export const isServer = (value: unknown): value is Server<any, any> =>
  typeof value === "object" &&
  value !== null &&
  ServerTypeId in value

// =============================================================================
// Middleware
// =============================================================================

/**
 * Add middleware to a server
 * 
 * Middleware runs before all handlers in the server.
 * Multiple calls chain middlewares (outer to inner).
 * 
 * @since 1.0.0
 * @category middleware
 * @example
 * ```ts
 * const server = Server.make(appRouter, handlers).pipe(
 *   Server.middleware(LoggingMiddleware),
 *   Server.middleware(AuthMiddleware),
 * )
 * ```
 */
export const middleware = <M extends Middleware.Applicable>(m: M) => <D extends Router.Definition, R>(
  server: Server<D, R>
): Server<D, R> => {
  const newMiddlewares = [...server.middlewares, m] as ReadonlyArray<Middleware.Applicable>
  
  // Convert tag to path (e.g., "@api/users/list" → "users.list")
  const tagToPath = (tag: string): string => {
    const withoutPrefix = tag.startsWith("@") ? tag.slice(tag.indexOf("/") + 1) : tag
    return withoutPrefix.replace(/\//g, ".")
  }
  
  // Create MiddlewareRequest from TransportRequest (server-level doesn't know procedure type)
  const toMiddlewareRequest = (request: Transport.TransportRequest): Middleware.MiddlewareRequest => ({
    id: request.id,
    tag: request.tag,
    path: tagToPath(request.tag),
    type: "query", // Default - actual type determined in handler
    headers: {
      get: (name: string) => request.headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in request.headers,
    },
    payload: request.payload,
    meta: {},
    signal: undefined,
  })
  
  // Wrap the original handle with middleware execution
  const wrappedHandle = (
    request: Transport.TransportRequest
  ): Effect.Effect<Transport.TransportResponse, never, R> => {
    const middlewareRequest = toMiddlewareRequest(request)
    
    // Execute server-level middleware then delegate to original handle
    if (newMiddlewares.length > 0) {
      return Middleware.execute(
        newMiddlewares,
        middlewareRequest,
        server.handle(request)
      ) as Effect.Effect<Transport.TransportResponse, never, R>
    }
    
    return server.handle(request)
  }
  
  return {
    ...server,
    middlewares: newMiddlewares,
    handle: wrappedHandle,
    pipe() {
      return pipeArguments(this, arguments)
    },
  }
}
