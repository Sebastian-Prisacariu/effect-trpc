/**
 * Transport - How requests travel between client and server
 * 
 * Transport defines how RPC requests are sent and responses received.
 * Implementations: HTTP, Mock, Loopback (for testing).
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * import { Duration } from "effect"
 * 
 * // HTTP transport
 * const httpLayer = Transport.http("/api/trpc", {
 *   timeout: Duration.seconds(30),
 * })
 * 
 * // Mock transport for testing
 * const mockLayer = Transport.mock({
 *   "users.list": () => Effect.succeed([]),
 *   "users.get": ({ id }) => Effect.succeed({ id, name: "Test" }),
 * })
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Schema from "effect/Schema"
import * as Duration from "effect/Duration"
import * as Ref from "effect/Ref"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { Pipeable, pipeArguments } from "effect/Pipeable"
import type * as Router from "../Router/index.js"
import type * as Procedure from "../Procedure/index.js"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const TransportTypeId: unique symbol = Symbol.for("effect-trpc/Transport")

/** @internal */
export type TransportTypeId = typeof TransportTypeId

// =============================================================================
// Errors
// =============================================================================

/**
 * Transport-level errors
 * 
 * @since 1.0.0
 * @category errors
 */
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

// =============================================================================
// Response Schemas
// =============================================================================

/**
 * Successful response envelope
 * 
 * @since 1.0.0
 * @category models
 */
export class Success extends Schema.TaggedClass<Success>()("Success", {
  id: Schema.String,
  value: Schema.Unknown,
}) {}

/**
 * Failure response envelope
 * 
 * @since 1.0.0
 * @category models
 */
export class Failure extends Schema.TaggedClass<Failure>()("Failure", {
  id: Schema.String,
  error: Schema.Unknown,
}) {}

/**
 * Stream chunk response
 * 
 * @since 1.0.0
 * @category models
 */
export class StreamChunk extends Schema.TaggedClass<StreamChunk>()("StreamChunk", {
  id: Schema.String,
  chunk: Schema.Unknown,
}) {}

/**
 * Stream end signal
 * 
 * @since 1.0.0
 * @category models
 */
export class StreamEnd extends Schema.TaggedClass<StreamEnd>()("StreamEnd", {
  id: Schema.String,
}) {}

/**
 * Response for query/mutation (single response)
 * 
 * @since 1.0.0
 * @category models
 */
export const TransportResponse = Schema.Union(Success, Failure)
export type TransportResponse = typeof TransportResponse.Type

/**
 * Response for streams (multiple responses)
 * 
 * @since 1.0.0
 * @category models
 */
export const StreamResponse = Schema.Union(StreamChunk, StreamEnd, Failure)
export type StreamResponse = typeof StreamResponse.Type

// =============================================================================
// Request
// =============================================================================

/**
 * Request sent over transport
 * 
 * @since 1.0.0
 * @category models
 */
export class TransportRequest extends Schema.Class<TransportRequest>("TransportRequest")({
  id: Schema.String,
  tag: Schema.String,
  payload: Schema.Unknown,
  headers: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), { default: () => ({}) }),
}) {}

/**
 * Transport service interface
 * 
 * @since 1.0.0
 * @category models
 */
export interface TransportService {
  /**
   * Send a query/mutation request and receive a single response
   */
  readonly send: (
    request: TransportRequest
  ) => Effect.Effect<TransportResponse, TransportError>
  
  /**
   * Send a streaming request and receive multiple responses
   */
  readonly sendStream: (
    request: TransportRequest
  ) => Stream.Stream<StreamResponse, TransportError>
}

/**
 * Transport service tag
 * 
 * @since 1.0.0
 * @category context
 */
export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}

// =============================================================================
// HTTP Transport
// =============================================================================

/**
 * HTTP transport configuration
 * 
 * @since 1.0.0
 * @category models
 */
export interface HttpOptions {
  /**
   * Request headers (static or dynamic)
   */
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  
  /**
   * Request timeout
   */
  readonly timeout?: Duration.DurationInput
  
  /**
   * Custom fetch implementation
   */
  readonly fetch?: typeof globalThis.fetch
}

// Note: Batching is planned but not yet implemented.
// See /plans/batching.md for the implementation roadmap.

/**
 * Create an HTTP transport layer
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * import { Duration } from "effect"
 * 
 * const layer = Transport.http("/api/trpc", {
 *   timeout: Duration.seconds(30),
 *   headers: {
 *     "Authorization": "Bearer token",
 *   },
 * })
 * ```
 */
export const http = (
  url: string,
  options?: HttpOptions
): Layer.Layer<Transport, never, never> => {
  const fetchFn = options?.fetch ?? globalThis.fetch
  const timeout = options?.timeout ? Duration.toMillis(options.timeout) : 30000
  
  return Layer.succeed(Transport, {
    send: (request) => sendHttp(url, request, fetchFn, options?.headers, timeout),
    sendStream: (request) => sendHttpStream(url, request, fetchFn, options?.headers),
  })
}

const sendHttp = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"],
  timeout?: number
): Effect.Effect<TransportResponse, TransportError> =>
  Effect.gen(function* () {
    const resolvedHeaders = typeof headers === "function"
      ? yield* Effect.promise(() => Promise.resolve(headers()))
      : headers ?? {}
    
    const controller = new globalThis.AbortController()
    const timeoutId = timeout
      ? globalThis.setTimeout(() => controller.abort(), timeout)
      : undefined
    
    const response = yield* Effect.tryPromise({
      try: () =>
        fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(resolvedHeaders as Record<string, string>),
          },
          body: JSON.stringify({
            id: request.id,
            tag: request.tag,
            payload: request.payload,
          }),
          signal: controller.signal,
        }),
      catch: (cause) =>
        new TransportError({
          reason: controller.signal.aborted ? "Timeout" : "Network",
          message: controller.signal.aborted
            ? "Request timed out"
            : "Failed to send request",
          cause,
        }),
    })
    
    if (timeoutId) globalThis.clearTimeout(timeoutId)
    
    if (!response.ok) {
      return yield* Effect.fail(
        new TransportError({
          reason: "Protocol",
          message: `HTTP ${response.status}: ${response.statusText}`,
        })
      )
    }
    
    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new TransportError({
          reason: "Protocol",
          message: "Failed to parse response JSON",
          cause,
        }),
    })
    
    // Validate response envelope
    const decoded = yield* Schema.decodeUnknown(TransportResponse)(json).pipe(
      Effect.mapError((cause) =>
        new TransportError({
          reason: "Protocol",
          message: "Invalid response envelope",
          cause,
        })
      )
    )
    
    return decoded
  })

const sendHttpStream = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<StreamResponse, TransportError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      // Resolve headers
      const resolvedHeaders = typeof headers === "function"
        ? yield* Effect.promise(() => Promise.resolve(headers()))
        : headers ?? {}
      
      // Make SSE request
      const response = yield* Effect.tryPromise({
        try: () =>
          fetchFn(`${url}/stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "text/event-stream",
              ...(resolvedHeaders as Record<string, string>),
            },
            body: JSON.stringify({
              id: request.id,
              tag: request.tag,
              payload: request.payload,
            }),
          }),
        catch: (cause) =>
          new TransportError({
            reason: "Network",
            message: "Failed to connect to stream",
            cause,
          }),
      })
      
      if (!response.ok) {
        return yield* Effect.fail(
          new TransportError({
            reason: "Protocol",
            message: `HTTP ${response.status}: ${response.statusText}`,
          })
        )
      }
      
      if (!response.body) {
        return yield* Effect.fail(
          new TransportError({
            reason: "Protocol",
            message: "Response body is empty",
          })
        )
      }
      
      // Create stream from SSE response
      return Stream.async<StreamResponse, TransportError>((emit) => {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        
        const processLine = (line: string) => {
          if (line.startsWith("data: ")) {
            const data = line.slice(6)
            if (data === "[DONE]") {
              emit.end()
              return
            }
            
            try {
              const parsed = JSON.parse(data)
              
              // Handle different message types
              if (parsed._tag === "StreamChunk") {
                emit.single(new StreamChunk({ 
                  id: parsed.id, 
                  chunk: parsed.chunk 
                }))
              } else if (parsed._tag === "StreamEnd") {
                emit.end()
              } else if (parsed._tag === "Failure") {
                emit.single(new Failure({
                  id: parsed.id,
                  error: parsed.error,
                }))
                emit.end()
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
        
        const read = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read()
              
              if (done) {
                // Process remaining buffer
                if (buffer.trim()) {
                  processLine(buffer.trim())
                }
                emit.end()
                break
              }
              
              buffer += decoder.decode(value, { stream: true })
              
              // Process complete lines
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""
              
              for (const line of lines) {
                if (line.trim()) {
                  processLine(line.trim())
                }
              }
            }
          } catch (error) {
            emit.fail(new TransportError({
              reason: "Network",
              message: "Stream read error",
              cause: error,
            }))
          }
        }
        
        read()
        
        // Return cleanup function
        return Effect.sync(() => {
          reader.cancel().catch(() => {})
        })
      })
    })
  )

// =============================================================================
// Mock Transport
// =============================================================================

/**
 * Mock handlers for testing
 * 
 * @since 1.0.0
 * @category models
 */
export type MockHandlers<D extends Router.Definition> = {
  [Path in Router.Paths<D>]: (
    payload: MockPayload<D, Path>
  ) => Effect.Effect<MockSuccess<D, Path>, MockError<D, Path>>
}

// Type helpers for mock
type MockPayload<D extends Router.Definition, Path extends string> = 
  Router.ProcedureAt<D, Path> extends Procedure.Any
    ? Procedure.Payload<Router.ProcedureAt<D, Path>>
    : never

type MockSuccess<D extends Router.Definition, Path extends string> =
  Router.ProcedureAt<D, Path> extends Procedure.Any
    ? Procedure.Success<Router.ProcedureAt<D, Path>>
    : never

type MockError<D extends Router.Definition, Path extends string> =
  Router.ProcedureAt<D, Path> extends Procedure.Any
    ? Procedure.Error<Router.ProcedureAt<D, Path>>
    : never

/**
 * Create a mock transport for testing
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * import { Effect } from "effect"
 * 
 * const mockLayer = Transport.mock<AppRouter>({
 *   "users.list": () => Effect.succeed([
 *     { id: "1", name: "Test User", email: "test@example.com" },
 *   ]),
 *   "users.get": ({ id }) => 
 *     id === "not-found"
 *       ? Effect.fail(new NotFoundError({ entity: "User", id }))
 *       : Effect.succeed({ id, name: `User ${id}`, email: `${id}@example.com` }),
 * })
 * ```
 */
export const mock = <D extends Router.Definition>(
  handlers: MockHandlers<D>
): Layer.Layer<Transport, never, never> => {
  const handlerMap = handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>
  
  return Layer.succeed(Transport, {
    send: (request) =>
      Effect.gen(function* () {
        // Convert tag to path (e.g., "@api/users/list" → "users.list")
        const path = tagToPath(request.tag)
        const handler = handlerMap[path]
        
        if (!handler) {
          return yield* Effect.fail(
            new TransportError({
              reason: "Protocol",
              message: `No mock handler for: ${request.tag} (path: ${path})`,
            })
          )
        }
        
        const result = yield* handler(request.payload).pipe(Effect.either)
        
        if (result._tag === "Left") {
          return new Failure({ id: request.id, error: result.left })
        }
        
        return new Success({ id: request.id, value: result.right })
      }),
      
    sendStream: (request) =>
      Stream.fromEffect(
        Effect.gen(function* () {
          const path = tagToPath(request.tag)
          const handler = handlerMap[path]
          
          if (!handler) {
            return yield* Effect.fail(
              new TransportError({
                reason: "Protocol",
                message: `No mock handler for: ${request.tag}`,
              })
            )
          }
          
          const result = yield* Effect.mapError(
            handler(request.payload),
            (err) => new TransportError({
              reason: "Protocol",
              message: "Handler error",
              cause: err,
            })
          )
          
          return new StreamChunk({ id: request.id, chunk: result })
        })
      ),
  })
}

// Helper to convert tag to path
// "@api/users/list" → "users.list"
const tagToPath = (tag: string): string => {
  // Remove the root prefix (everything up to first /)
  const parts = tag.split("/")
  // Skip the first part (root tag like "@api")
  return parts.slice(1).join(".")
}

// =============================================================================
// Custom Transport
// =============================================================================

/**
 * Create a custom transport from a service implementation
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * 
 * const customLayer = Transport.make({
 *   send: (request) => Effect.succeed({
 *     _tag: "Success",
 *     id: request.id,
 *     value: { ... },
 *   }),
 *   sendStream: (request) => Stream.empty,
 * })
 * ```
 */
export const make = (
  service: TransportService
): Layer.Layer<Transport, never, never> =>
  Layer.succeed(Transport, service)

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if an error is transient (worth retrying)
 * 
 * @since 1.0.0
 * @category utilities
 */
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransportError) {
    return error.reason === "Network" || error.reason === "Timeout"
  }
  return false
}

/**
 * Generate a unique request ID
 * 
 * @since 1.0.0
 * @category utilities
 */
export const generateRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

// =============================================================================
// Loopback Transport (for testing)
// =============================================================================

/**
 * Create a loopback transport that connects directly to a Server
 * 
 * This is useful for testing Client ↔ Server communication without
 * actual HTTP. The transport calls Server.handle() directly.
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport, Server, Client } from "effect-trpc"
 * 
 * const server = Server.make(router, handlers)
 * const loopbackLayer = Transport.loopback(server)
 * 
 * const api = Client.make(router)
 * const boundApi = api.provide(loopbackLayer)
 * 
 * // Now boundApi calls go directly to server handlers
 * await boundApi.users.list.runPromise()
 * ```
 */
export const loopback = <D extends Router.Definition, R>(
  server: {
    readonly handle: (request: TransportRequest) => Effect.Effect<TransportResponse, never, R>
    readonly handleStream: (request: TransportRequest) => Stream.Stream<StreamResponse, never, R>
  }
): Layer.Layer<Transport, never, R> =>
  Layer.effect(
    Transport,
    Effect.gen(function* () {
      return {
        send: (request: TransportRequest) => 
          server.handle(request).pipe(
            Effect.mapError(() => new TransportError({ 
              reason: "Protocol", 
              message: "Server error" 
            }))
          ) as Effect.Effect<TransportResponse, TransportError>,
        sendStream: (request: TransportRequest) => 
          server.handleStream(request).pipe(
            Stream.mapError(() => new TransportError({ 
              reason: "Protocol", 
              message: "Server stream error" 
            }))
          ) as Stream.Stream<StreamResponse, TransportError>,
      }
    })
  )

// =============================================================================
// Batching (re-export)
// =============================================================================

export * as Batching from "./batching.js"
