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
  
  // Create MiddlewareRequest from TransportRequest
  const toMiddlewareRequest = (request: Transport.TransportRequest): Middleware.MiddlewareRequest => ({
    id: request.id,
    tag: request.tag,
    headers: {
      get: (name: string) => request.headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in request.headers,
    },
    payload: request.payload,
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
    
    const middlewareRequest = toMiddlewareRequest(request)
    
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
                  Effect.orElseSucceed(() => error),
                  Effect.map((encodedError) => new Transport.Failure({
                    id: request.id,
                    error: encodedError,
                  }))
                ),
              onSuccess: (value) =>
                Schema.encode(procedure.successSchema)(value).pipe(
                  Effect.orElseSucceed(() => value),
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
    
    const { handler, procedure, isStream } = entry
    
    if (!isStream) {
      return Stream.succeed(new Transport.Failure({
        id: request.id,
        error: { message: `Use handle for non-streaming procedures: ${request.tag}` },
      }))
    }
    
    const makeStream = (payload: unknown): Stream.Stream<Transport.StreamResponse, never, R> => {
      const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
      
      return stream.pipe(
        Stream.map((value): Transport.StreamResponse => 
          new Transport.StreamChunk({
            id: request.id,
            chunk: value,
          })
        ),
        Stream.catchAll((error): Stream.Stream<Transport.StreamResponse, never, R> =>
          Stream.succeed(new Transport.Failure({
            id: request.id,
            error,
          }))
        ),
        Stream.concat(Stream.succeed(new Transport.StreamEnd({ id: request.id })))
      )
    }
    
    const failureStream = Stream.succeed(new Transport.Failure({
      id: request.id,
      error: { message: "Invalid payload" },
    })) as Stream.Stream<Transport.StreamResponse, never, R>
    
    return Stream.unwrap(
      Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
        Effect.map(makeStream),
        Effect.orElseSucceed(() => failureStream)
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
        const transportRequest = new Transport.TransportRequest({
          id: (body as any).id ?? Transport.generateRequestId(),
          tag: (body as any).tag ?? "",
          payload: (body as any).payload,
        })
        
        return server.handle(transportRequest)
      }),
      Effect.map((response) => ({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      })),
      Effect.catchAll(() => Effect.succeed({
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid request" }),
      }))
    ) as Effect.Effect<HttpResponse, never, R>
}

// Minimal HTTP types (no @effect/platform dependency)
interface HttpRequest {
  readonly json: () => Promise<unknown>
}

interface HttpResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
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
  
  // Create MiddlewareRequest from TransportRequest
  const toMiddlewareRequest = (request: Transport.TransportRequest): Middleware.MiddlewareRequest => ({
    id: request.id,
    tag: request.tag,
    headers: {
      get: (name: string) => request.headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in request.headers,
    },
    payload: request.payload,
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
