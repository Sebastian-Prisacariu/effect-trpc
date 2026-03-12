/**
 * Transport - How requests travel between client and server
 * 
 * Transport defines how RPC requests are sent and responses received.
 * Different implementations: HTTP (with batching), WebSocket, Mock.
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * import { Duration } from "effect"
 * 
 * // HTTP transport with batching
 * const httpLayer = Transport.http("/api/trpc", {
 *   batching: {
 *     enabled: true,
 *     window: Duration.millis(10),
 *   },
 * })
 * 
 * // Mock transport for testing
 * const mockLayer = Transport.mock<AppRouter>({
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
// Models
// =============================================================================

/**
 * Request sent over transport
 * 
 * @since 1.0.0
 * @category models
 */
export interface TransportRequest {
  readonly id: string
  readonly tag: string
  readonly payload: unknown
}

/**
 * Response received from transport
 * 
 * @since 1.0.0
 * @category models
 */
export type TransportResponse =
  | { readonly _tag: "Success"; readonly id: string; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly id: string; readonly error: unknown }
  | { readonly _tag: "StreamChunk"; readonly id: string; readonly chunk: unknown }
  | { readonly _tag: "StreamEnd"; readonly id: string }

/**
 * Transport service interface
 * 
 * @since 1.0.0
 * @category models
 */
export interface TransportService {
  /**
   * Send a request and receive response(s)
   */
  readonly send: (
    request: TransportRequest
  ) => Effect.Effect<TransportResponse, TransportError>
  
  /**
   * Send a streaming request
   */
  readonly sendStream: (
    request: TransportRequest
  ) => Stream.Stream<TransportResponse, TransportError>
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
   * Batching configuration
   */
  readonly batching?: {
    /**
     * Enable batching (default: true for queries)
     */
    readonly enabled?: boolean
    
    /**
     * Time window to collect requests (default: 0 = microtask)
     */
    readonly window?: Duration.DurationInput
    
    /**
     * Maximum requests per batch (default: 50)
     */
    readonly maxSize?: number
    
    /**
     * Batch queries (default: true)
     */
    readonly queries?: boolean
    
    /**
     * Batch mutations (default: false)
     */
    readonly mutations?: boolean
  }
  
  /**
   * Custom fetch implementation
   */
  readonly fetch?: typeof globalThis.fetch
}

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
 *   batching: {
 *     enabled: true,
 *     window: Duration.millis(10),
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
    
    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new TransportError({
          reason: "Protocol",
          message: "Failed to parse response",
          cause,
        }),
    })
    
    return data as TransportResponse
  })

const sendHttpStream = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof globalThis.fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<TransportResponse, TransportError> =>
  Stream.fromEffect(
    sendHttp(url, request, fetchFn, headers, undefined)
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
        // For now, assume the path is stored somehow or derivable
        // In practice, we'd need the router to look this up
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
          return {
            _tag: "Failure" as const,
            id: request.id,
            error: result.left,
          }
        }
        
        return {
          _tag: "Success" as const,
          id: request.id,
          value: result.right,
        }
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
            () => new TransportError({
              reason: "Protocol",
              message: "Handler error",
            })
          )
          
          return {
            _tag: "Success" as const,
            id: request.id,
            value: result,
          } satisfies TransportResponse
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
