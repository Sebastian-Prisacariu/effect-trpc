/**
 * Server - Handle RPC requests with typed handlers
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Server, Router, Procedure } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: Procedure.query({ success: Schema.Array(User) }),
 *     get: Procedure.query({ payload: Schema.Struct({ id: Schema.String }), success: User }),
 *   },
 * })
 * 
 * const server = Server.make(appRouter, {
 *   users: {
 *     list: () => Effect.succeed([]),
 *     get: ({ id }) => Effect.succeed(new User({ id, name: "Test", email: "test@example.com" })),
 *   },
 * })
 * 
 * // Handle a request
 * const response = await Effect.runPromise(server.handle(request))
 * 
 * // Convert to HTTP app
 * const httpApp = server.toHttpApp()
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Chunk from "effect/Chunk"
import type * as Scope from "effect/Scope"
import * as Router from "../Router/index.js"
import * as Procedure from "../Procedure/index.js"
import * as Transport from "../Transport/index.js"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const ServerTypeId: unique symbol = Symbol.for("effect-trpc/Server")

/** @internal */
export type ServerTypeId = typeof ServerTypeId

// =============================================================================
// Handler Types
// =============================================================================

/**
 * Handler for a query procedure
 * 
 * @since 1.0.0
 * @category handlers
 */
export type QueryHandler<
  Payload,
  Success,
  Error,
  R = never
> = (payload: Payload) => Effect.Effect<Success, Error, R>

/**
 * Handler for a mutation procedure
 * 
 * @since 1.0.0
 * @category handlers
 */
export type MutationHandler<
  Payload,
  Success,
  Error,
  R = never
> = (payload: Payload) => Effect.Effect<Success, Error, R>

/**
 * Handler for a stream procedure
 * 
 * @since 1.0.0
 * @category handlers
 */
export type StreamHandler<
  Payload,
  Success,
  Error,
  R = never
> = (payload: Payload) => Stream.Stream<Success, Error, R>

/**
 * Handlers that mirror the router structure
 * 
 * @since 1.0.0
 * @category handlers
 */
export type Handlers<D extends Router.Definition, R = never> = {
  readonly [K in keyof D]: D[K] extends Procedure.Query<infer P, infer S, infer E>
    ? QueryHandler<Schema.Schema.Type<P>, Schema.Schema.Type<S>, Schema.Schema.Type<E>, R>
    : D[K] extends Procedure.Mutation<infer P, infer S, infer E, any>
      ? MutationHandler<Schema.Schema.Type<P>, Schema.Schema.Type<S>, Schema.Schema.Type<E>, R>
      : D[K] extends Procedure.Stream<infer P, infer S, infer E>
        ? StreamHandler<Schema.Schema.Type<P>, Schema.Schema.Type<S>, Schema.Schema.Type<E>, R>
        : D[K] extends Router.Definition
          ? Handlers<D[K], R>
          : never
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
export interface Server<D extends Router.Definition, R = never> {
  readonly [ServerTypeId]: ServerTypeId
  
  /**
   * The router this server handles
   */
  readonly router: Router.Router<D>
  
  /**
   * Handle a single request
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
  
  /**
   * Get a Layer that provides this server
   */
  readonly layer: Layer.Layer<ServerService, never, R>
}

/**
 * Server service for dependency injection
 * 
 * @since 1.0.0
 * @category services
 */
export interface ServerService {
  readonly handle: (
    request: Transport.TransportRequest
  ) => Effect.Effect<Transport.TransportResponse>
  
  readonly handleStream: (
    request: Transport.TransportRequest
  ) => Stream.Stream<Transport.StreamResponse>
}

/**
 * ServerService tag
 * 
 * @since 1.0.0
 * @category services
 */
export class ServerServiceTag extends Context.Tag("@effect-trpc/ServerService")<
  ServerServiceTag,
  ServerService
>() {}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a server from a router and handlers
 * 
 * @since 1.0.0
 * @category constructors
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
 *   health: Procedure.query({ success: Schema.String }),
 * })
 * 
 * const server = Server.make(appRouter, {
 *   users: {
 *     list: () => Effect.succeed([
 *       new User({ id: "1", name: "Alice", email: "alice@example.com" }),
 *     ]),
 *     get: ({ id }) => 
 *       id === "not-found"
 *         ? Effect.fail(new NotFoundError({ entity: "User", id }))
 *         : Effect.succeed(new User({ id, name: "Test", email: "test@example.com" })),
 *   },
 *   health: () => Effect.succeed("OK"),
 * })
 * ```
 */
export const make = <D extends Router.Definition, R = never>(
  router: Router.Router<D>,
  handlers: Handlers<D, R>
): Server<D, R> => {
  // Build a map from tag to handler
  const handlerMap = new Map<string, {
    handler: (payload: unknown) => Effect.Effect<unknown, unknown, R> | Stream.Stream<unknown, unknown, R>
    procedure: Procedure.Any
    isStream: boolean
  }>()
  
  const buildHandlerMap = (
    def: Router.Definition,
    handlerDef: Record<string, unknown>,
    pathParts: readonly string[]
  ): void => {
    for (const key of Object.keys(def)) {
      const procedure = def[key]
      const handler = handlerDef[key]
      const newPath = [...pathParts, key]
      const tag = [router.tag, ...newPath].join("/")
      
      if (Procedure.isProcedure(procedure)) {
        handlerMap.set(tag, {
          handler: handler as (payload: unknown) => Effect.Effect<unknown, unknown, R>,
          procedure,
          isStream: Procedure.isStream(procedure),
        })
      } else {
        // Nested definition
        buildHandlerMap(
          procedure as Router.Definition,
          handler as Record<string, unknown>,
          newPath
        )
      }
    }
  }
  
  buildHandlerMap(router.definition, handlers as Record<string, unknown>, [])
  
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
    
    const { handler, procedure, isStream } = entry
    
    if (isStream) {
      return Effect.succeed(new Transport.Failure({
        id: request.id,
        error: { message: `Use handleStream for streaming procedures: ${request.tag}` },
      }))
    }
    
    return Schema.decodeUnknown(procedure.payloadSchema)(request.payload).pipe(
      Effect.matchEffect({
        onFailure: (cause) => Effect.succeed(new Transport.Failure({
          id: request.id,
          error: { message: "Invalid payload", cause },
        })),
        onSuccess: (payload) =>
          (handler(payload) as Effect.Effect<unknown, unknown, R>).pipe(
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
          ),
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
    handle,
    handleStream,
    layer: Layer.effect(
      ServerServiceTag,
      Effect.succeed({
        handle: (req) => handle(req) as Effect.Effect<Transport.TransportResponse>,
        handleStream: (req) => handleStream(req) as Stream.Stream<Transport.StreamResponse>,
      })
    ) as unknown as Layer.Layer<ServerService, never, R>,
  }
}

// =============================================================================
// HTTP Integration
// =============================================================================

/**
 * Options for HTTP app
 * 
 * @since 1.0.0
 * @category http
 */
export interface HttpAppOptions {
  /**
   * Base path for the RPC endpoint (default: "/rpc")
   */
  readonly path?: string
}

/**
 * Convert a server to an Effect HTTP app handler
 * 
 * This returns a function that can be used with @effect/platform HttpServer.
 * 
 * @since 1.0.0
 * @category http
 * @example
 * ```ts
 * import { Server } from "effect-trpc"
 * import { HttpServer } from "@effect/platform"
 * 
 * const server = Server.make(appRouter, handlers)
 * const handler = Server.toHttpHandler(server)
 * 
 * // Use with HttpServer
 * HttpServer.serve(handler)
 * ```
 */
export const toHttpHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  options?: HttpAppOptions
): (request: HttpRequest) => Effect.Effect<HttpResponse, never, R> => {
  const _path = options?.path ?? "/rpc"
  
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

// Minimal HTTP types (avoid importing @effect/platform which might not be installed)
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
