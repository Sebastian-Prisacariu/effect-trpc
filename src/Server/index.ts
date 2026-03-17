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
 * ```
 */

import * as Effect from "effect/Effect"
import { Pipeable, pipeArguments } from "effect/Pipeable"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

import * as Router from "../Router/index.js"
import * as Transport from "../Transport/index.js"
import * as Procedure from "../Procedure/index.js"
import * as Middleware from "../Middleware/index.js"

// Re-export types from submodule
export {
  ServerTypeId,
  type Server,
  type HttpRequest,
  type HttpResponse,
  type HttpHandlerOptions,
  type NextApiRequest,
  type NextApiResponse,
} from "./types.js"

// Re-export HTTP handlers from submodule
export {
  toHttpHandler,
  toSSEHandler,
  toFetchSSEHandler,
  toFetchHandler,
  toNextApiHandler,
  toNextApiSSEHandler,
} from "./http.js"

import { ServerTypeId, type Server } from "./types.js"

// =============================================================================
// Handler Types
// =============================================================================

/**
 * Handler function type for a procedure
 * 
 * @since 1.0.0
 * @category models
 */
export type HandlerFor<P, R = never> = 
  P extends Procedure.Query<infer Payload, infer Success, infer Error>
    ? (payload: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
    : P extends Procedure.Mutation<any, infer Payload, infer Success, infer Error>
    ? (payload: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
    : P extends Procedure.Stream<infer Payload, infer Success, infer Error>
    ? (payload: Schema.Schema.Type<Payload>) => Stream.Stream<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, R>
    : never

/**
 * Handlers object matching a router definition
 * 
 * @since 1.0.0
 * @category models
 */
export type Handlers<D extends Router.Definition, R = never> = {
  readonly [K in keyof D]: Router.UnwrapDefinitionEntry<D[K]> extends Procedure.Any
    ? HandlerFor<Router.UnwrapDefinitionEntry<D[K]>, R>
    : Router.UnwrapDefinitionEntry<D[K]> extends Router.Definition
    ? Handlers<Router.UnwrapDefinitionEntry<D[K]>, R>
    : never
}

// =============================================================================
// Constructor
// =============================================================================

/**
 * Create a server from a router and handlers
 * 
 * @since 1.0.0
 * @category constructors
 */
export const make = <D extends Router.Definition, R = never>(
  router: Router.Router<D>,
  handlers: Handlers<D, R>
): Server<D, R> => {
  // Build a flat map of tag -> handler for O(1) lookup
  type HandlerEntry = {
    readonly handler: (payload: unknown) => Effect.Effect<unknown, unknown, R> | Stream.Stream<unknown, unknown, R>
    readonly procedure: Procedure.Any
    readonly isStream: boolean
    readonly middlewares: ReadonlyArray<Middleware.Applicable>
  }
  
  const handlerMap = new Map<string, HandlerEntry>()
  
  const buildHandlerMap = (
    def: Router.Definition,
    handlers: Record<string, unknown>,
    prefix: string,
    parentMiddlewares: ReadonlyArray<Middleware.Applicable>
  ) => {
    for (const [key, value] of Object.entries(def)) {
      const definitionMiddlewares = Router.getDefinitionMiddlewares(value)
      const entry = Router.unwrapDefinitionEntry(value)
      const tag = `${prefix}/${key}`
      const handler = handlers[key]
      
      if (Procedure.isProcedure(entry)) {
        // Combine parent middlewares with procedure middlewares
        const procedureMiddlewares = entry.middlewares as ReadonlyArray<Middleware.Applicable>
        const allMiddlewares = [...parentMiddlewares, ...definitionMiddlewares, ...procedureMiddlewares]
        
        handlerMap.set(tag, {
          handler: handler as (payload: unknown) => Effect.Effect<unknown, unknown, R>,
          procedure: entry,
          isStream: Procedure.isStream(entry),
          middlewares: allMiddlewares,
        })
      } else if (typeof entry === "object" && entry !== null) {
        // Nested definition
        buildHandlerMap(
          entry as Router.Definition,
          handler as Record<string, unknown>,
          tag,
          [...parentMiddlewares, ...definitionMiddlewares]
        )
      }
    }
  }
  
  buildHandlerMap(router.definition, handlers as Record<string, unknown>, router.tag, [])
  
  /** @internal */
  const getProcedureType = (procedure: Procedure.Any): Middleware.ProcedureType => {
    if (Procedure.isQuery(procedure)) return "query"
    if (Procedure.isMutation(procedure)) return "mutation"
    return "stream"
  }
  
  /** @internal */
  const tagToPath = (tag: string): string => {
    const withoutPrefix = tag.startsWith("@") ? tag.slice(tag.indexOf("/") + 1) : tag
    return withoutPrefix.replace(/\//g, ".")
  }
  
  /** @internal */
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
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ): Effect.Effect<Transport.TransportResponse, never, R> => {
    // Check if already aborted
    if (signal?.aborted) {
      return Effect.succeed(new Transport.Failure({
        id: request.id,
        error: { message: "Request aborted" },
      }))
    }
    
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
    
    const middlewareRequest = toMiddlewareRequest(
      request, 
      getProcedureType(procedure),
      procedure.meta ?? {},
      signal
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
                  Effect.map((encoded) => new Transport.Failure({ id: request.id, error: encoded }))
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
                  Effect.map((encoded) => new Transport.Success({ id: request.id, value: encoded }))
                ),
            })
          )
          
          // Execute middleware chain, then handler
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
  
  // Handle streaming request
  const handleStream = (
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ): Stream.Stream<Transport.StreamResponse, never, R> => {
    // Check if already aborted
    if (signal?.aborted) {
      return Stream.succeed(new Transport.Failure({
        id: request.id,
        error: { message: "Request aborted" },
      }))
    }
    
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
    
    const middlewareRequest = toMiddlewareRequest(
      request,
      "stream",
      procedure.meta ?? {},
      signal
    )
    
    const makeStream = (payload: unknown): Stream.Stream<Transport.StreamResponse, never, R> => {
      const stream = handler(payload) as Stream.Stream<unknown, unknown, R>
      
      const streamWithMiddleware: Effect.Effect<Stream.Stream<Transport.StreamResponse, never, R>, unknown, R> = 
        middlewares.length > 0
          ? Middleware.execute(
              middlewares,
              middlewareRequest,
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
      
      // Build the final stream
      let resultStream = Stream.unwrap(
        streamWithMiddleware.pipe(
          Effect.catchAll((error) => 
            Effect.succeed(
              Stream.succeed(new Transport.Failure({ id: request.id, error })) as 
                Stream.Stream<Transport.StreamResponse, never, R>
            )
          )
        )
      ) as Stream.Stream<Transport.StreamResponse, never, R>
      
      // Add cancellation via AbortSignal if provided
      if (signal) {
        resultStream = resultStream.pipe(
          Stream.interruptWhen(
            Effect.async<never, never>((resume) => {
              if (signal.aborted) {
                resume(Effect.interrupt)
              } else {
                signal.addEventListener("abort", () => resume(Effect.interrupt), { once: true })
              }
            })
          )
        )
      }
      
      return resultStream
    }
    
    // Validate payload, then create stream
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
// Guards
// =============================================================================

/**
 * Check if a value is a Server
 * 
 * @since 1.0.0
 * @category guards
 */
export const isServer = (value: unknown): value is Server<any, any> =>
  typeof value === "object" && value !== null && ServerTypeId in value

// =============================================================================
// Middleware
// =============================================================================

/**
 * Add middleware to a server.
 * 
 * Server-level middleware runs for ALL requests before procedure handlers.
 * 
 * @since 1.0.0
 * @category middleware
 */
export const middleware = <M extends Middleware.Applicable>(m: M) => <D extends Router.Definition, R>(
  server: Server<D, R>
): Server<D, R | Middleware.Provides<M>> => {
  const newMiddlewares = [...server.middlewares, m] as ReadonlyArray<Middleware.Applicable>
  
  /** @internal */
  const tagToPath = (tag: string): string => {
    const withoutPrefix = tag.startsWith("@") ? tag.slice(tag.indexOf("/") + 1) : tag
    return withoutPrefix.replace(/\//g, ".")
  }
  
  /** @internal */
  const toMiddlewareRequest = (
    request: Transport.TransportRequest,
    type: Middleware.ProcedureType,
    signal?: AbortSignal
  ): Middleware.MiddlewareRequest => ({
    id: request.id,
    tag: request.tag,
    path: tagToPath(request.tag),
    type,
    headers: {
      get: (name: string) => request.headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in request.headers,
    },
    payload: request.payload,
    meta: {},
    signal,
  })
  
  // Wrap the original handle with middleware execution
  const wrappedHandle = (
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ): Effect.Effect<Transport.TransportResponse, never, R> => {
    const middlewareRequest = toMiddlewareRequest(request, "query", signal)
    
    if (newMiddlewares.length > 0) {
      return Middleware.execute(
        newMiddlewares,
        middlewareRequest,
        server.handle(request, signal)
      ) as Effect.Effect<Transport.TransportResponse, never, R>
    }
    
    return server.handle(request, signal)
  }
  
  // Wrap the original handleStream with middleware execution
  const wrappedHandleStream = (
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ): Stream.Stream<Transport.StreamResponse, never, R> => {
    const middlewareRequest = toMiddlewareRequest(request, "stream", signal)
    
    if (newMiddlewares.length > 0) {
      return Stream.unwrap(
        Middleware.execute(
          newMiddlewares,
          middlewareRequest,
          Effect.succeed(server.handleStream(request, signal))
        ) as Effect.Effect<Stream.Stream<Transport.StreamResponse, never, R>, never, R>
      )
    }
    
    return server.handleStream(request, signal)
  }
  
  return {
    ...server,
    middlewares: newMiddlewares,
    handle: wrappedHandle,
    handleStream: wrappedHandleStream,
    pipe() {
      return pipeArguments(this, arguments)
    },
  }
}
