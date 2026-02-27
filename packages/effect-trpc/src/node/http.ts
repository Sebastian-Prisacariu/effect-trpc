/**
 * @module effect-trpc/node/http
 *
 * HTTP-only Node.js adapter for effect-trpc.
 * Use this if you don't need WebSocket support to reduce bundle size.
 *
 * @example
 * ```ts
 * import { createHandler, nodeToWebRequest, webToNodeResponse } from "effect-trpc/node/http"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 * import * as http from "node:http"
 *
 * const handler = createHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * const server = http.createServer(async (req, res) => {
 *   const request = await nodeToWebRequest(req)
 *   const response = await handler.fetch(request)
 *   await webToNodeResponse(response, res)
 * })
 *
 * server.listen(3000)
 * ```
 */

import * as NodeContext from "@effect/platform-node/NodeContext"
import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform"
import * as NodeStream from "@effect/platform-node/NodeStream"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Layer from "effect/Layer"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { RouterRecord, RouterShape } from "../core/server/router.js"
import {
  type CorsOptions,
  type SecurityHeadersOptions,
  addSecurityHeaders,
  buildCorsHeaders,
  buildSecurityHeaders,
  createRpcWebHandler,
} from "../shared/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default maximum request body size (1MB).
 * This prevents DoS attacks via large request bodies.
 */
export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024 // 1MB

/**
 * Error thrown when request body exceeds the maximum allowed size.
 * @since 0.1.0
 * @category Errors
 */
export class PayloadTooLargeError extends Error {
  readonly _tag = "PayloadTooLargeError"
  readonly maxSize: number
  readonly receivedSize: number

  constructor(options: { maxSize: number; receivedSize: number }) {
    super(
      `Request body too large: received ${options.receivedSize} bytes, max ${options.maxSize} bytes`,
    )
    this.name = "PayloadTooLargeError"
    this.maxSize = options.maxSize
    this.receivedSize = options.receivedSize
  }
}

/**
 * Options for converting a Node.js request to a web Request.
 * @since 0.1.0
 * @category Types
 */
export interface NodeToWebRequestOptions {
  /**
   * Maximum request body size in bytes.
   * If the body exceeds this limit, a PayloadTooLargeError is thrown.
   * @default 1048576 (1MB)
   */
  readonly maxBodySize?: number
}

export interface CreateHandlerOptions<
  Routes extends RouterRecord,
  HandlersOut,
  HandlersR,
  RouterR,
> {
  /**
   * The router wrapped in an Effect.
   * Requirements are tracked via Effect's R channel.
   */
  readonly router: Effect.Effect<RouterShape<Routes>, never, RouterR>

  /**
   * The layer providing all procedure AND middleware implementations.
   * Must satisfy all requirements from the router.
   */
  readonly handlers: Layer.Layer<HandlersOut, never, HandlersR>

  /**
   * Path for the RPC endpoint.
   * @default "/rpc"
   */
  readonly path?: string

  /**
   * Maximum request body size in bytes.
   * Requests exceeding this limit will receive a 413 Payload Too Large response.
   * @default 1048576 (1MB)
   */
  readonly maxBodySize?: number

  /**
   * Disable OpenTelemetry tracing.
   * @default false
   */
  readonly disableTracing?: boolean

  /**
   * Prefix for span names.
   * @default "@effect-trpc"
   */
  readonly spanPrefix?: string

  /**
   * Enable CORS headers.
   * @default false
   */
  readonly cors?: boolean | CorsOptions

  /**
   * Enable security headers on responses.
   * Pass `true` for defaults, `false` to disable, or an object to customize.
   *
   * Default headers:
   * - X-Content-Type-Options: nosniff
   * - X-Frame-Options: DENY
   * - X-XSS-Protection: 1; mode=block
   * - Referrer-Policy: strict-origin-when-cross-origin
   *
   * @default true
   */
  readonly securityHeaders?: boolean | SecurityHeadersOptions
}

// Re-export CorsOptions and SecurityHeadersOptions for convenience
export type { CorsOptions, SecurityHeadersOptions }

export interface FetchHandler {
  /**
   * Handle a web standard Request and return a Response.
   */
  readonly fetch: (request: Request) => Promise<Response>

  /**
   * Dispose of handler resources.
   */
  readonly dispose: () => Promise<void>
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a fetch handler for use with Node.js HTTP server.
 *
 * Returns a handler with a `fetch` function that takes a web standard Request
 * and returns a Promise<Response>. This can be used with Node.js http.createServer
 * by converting the Node request to a web Request.
 *
 * @example
 * ```ts
 * import { createHandler } from "effect-trpc/node/http"
 * import * as http from "node:http"
 *
 * const handler = createHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * const server = http.createServer(async (req, res) => {
 *   const request = nodeToWebRequest(req) // Convert Node to web Request
 *   const response = await handler.fetch(request)
 *   webToNodeResponse(response, res) // Convert web Response to Node
 * })
 * ```
 */
/**
 * Extract a value from an Effect synchronously.
 * Safe because our definitions always use Effect.succeed internally.
 */
function extractFromEffect<T>(effect: Effect.Effect<T, never, any>): T {
  let extracted: T | undefined
  Effect.runSync(
    Effect.map(effect as Effect.Effect<T, never, never>, (val) => {
      extracted = val
    }),
  )
  if (extracted === undefined) {
    throw new Error("Failed to extract router from Effect")
  }
  return extracted
}

export function createHandler<Routes extends RouterRecord, HandlersOut, HandlersR, RouterR>(
  options: CreateHandlerOptions<Routes, HandlersOut, HandlersR, RouterR>,
): FetchHandler {
  const {
    router: routerEffect,
    handlers,
    path = "/rpc",
    disableTracing,
    spanPrefix,
    cors,
    securityHeaders: securityHeadersOption = true,
  } = options

  // Extract the router from the Effect
  const router = extractFromEffect(routerEffect)

  const handlersWithNodeRuntime = handlers.pipe(
    Layer.provide(NodeHttpPlatform.layer),
    Layer.provide(NodeContext.layer),
  )

  // Create the web handler using shared utility
  const webHandler = createRpcWebHandler({
    router: router as RouterShape<RouterRecord>,
    handlers: handlersWithNodeRuntime,
    disableTracing,
    spanPrefix,
  })

  // Build CORS headers if enabled
  const corsHeaders = cors ? buildCorsHeaders(cors === true ? {} : cors) : null

  // Build security headers (enabled by default)
  const securityHeaders = buildSecurityHeaders(securityHeadersOption)

  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url)

      // Handle preflight for CORS
      if (corsHeaders && request.method === "OPTIONS") {
        const preflightHeaders = new Headers(corsHeaders)
        if (securityHeaders) {
          addSecurityHeaders(preflightHeaders, securityHeaders)
        }
        return new Response(null, { status: 204, headers: preflightHeaders })
      }

      // Check path - must be exact match or have path separator after
      // This prevents "/rpc-admin" from matching when path is "/rpc"
      const pathname = url.pathname
      const pathMatches =
        pathname === path || pathname.startsWith(path + "/") || pathname.startsWith(path + "?")

      if (!pathMatches) {
        const notFoundHeaders = new Headers()
        if (securityHeaders) {
          addSecurityHeaders(notFoundHeaders, securityHeaders)
        }
        return new Response("Not Found", { status: 404, headers: notFoundHeaders })
      }

      // Handle RPC request
      const response = await webHandler.handler(request)

      // Add headers if needed (CORS and/or security)
      if (corsHeaders || securityHeaders) {
        const headers = new Headers(response.headers)
        if (corsHeaders) {
          for (const [key, value] of Object.entries(corsHeaders)) {
            headers.set(key, value)
          }
        }
        if (securityHeaders) {
          addSecurityHeaders(headers, securityHeaders)
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }

      return response
    },
    dispose: webHandler.dispose,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Node.js Request/Response Conversion Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Node.js IncomingMessage to a web standard Request.
 *
 * @param req - The Node.js IncomingMessage
 * @param options - Optional configuration including maxBodySize
 * @throws {PayloadTooLargeError} If the request body exceeds maxBodySize
 *
 * @example
 * ```ts
 * import { nodeToWebRequest } from "effect-trpc/node/http"
 *
 * server.on("request", async (req, res) => {
 *   try {
 *     const request = await nodeToWebRequest(req, { maxBodySize: 1024 * 1024 })
 *     const response = await handler.fetch(request)
 *     // ...
 *   } catch (err) {
 *     if (err instanceof PayloadTooLargeError) {
 *       res.writeHead(413, { "Content-Type": "text/plain" })
 *       res.end("Payload Too Large")
 *     }
 *   }
 * })
 * ```
 */
export async function nodeToWebRequest(
  req: IncomingMessage,
  options?: NodeToWebRequestOptions,
): Promise<Request> {
  const maxBodySize = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`
  const method = req.method ?? "GET"

  const toBodyReadError = (error: unknown): Error | PayloadTooLargeError => {
    if (error instanceof Error && error.message === "maxBytes exceeded") {
      return new PayloadTooLargeError({
        maxSize: maxBodySize,
        receivedSize: maxBodySize + 1,
      })
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  const body =
    method !== "GET" && method !== "HEAD"
      ? await Effect.runPromise(
          Effect.either(
            NodeStream.toUint8Array(() => req, {
              maxBytes: maxBodySize,
              onFailure: toBodyReadError,
            }),
          ),
        ).then((result) => {
          if (Either.isLeft(result)) {
            throw result.left
          }
          return result.right
        })
      : undefined

  // Convert headers
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(", ") : value
    }
  }

  if (body !== undefined) {
    const requestBody = Uint8Array.from(body)
    return new Request(url, { method, headers, body: requestBody })
  }

  return new Request(url, { method, headers })
}

/**
 * Convert a Node.js IncomingMessage to a web standard Request (Effect version).
 * Returns a typed error instead of throwing.
 *
 * @param req - The Node.js IncomingMessage
 * @param options - Optional configuration including maxBodySize
 * @returns Effect that succeeds with Request or fails with PayloadTooLargeError
 *
 * @example
 * ```ts
 * import { nodeToWebRequestEffect } from "effect-trpc/node/http"
 *
 * const program = Effect.gen(function* () {
 *   const request = yield* nodeToWebRequestEffect(req, { maxBodySize: 1024 * 1024 })
 *   const response = yield* handler.fetchEffect(request)
 *   yield* webToNodeResponseEffect(response, res)
 * }).pipe(
 *   Effect.catchTag("PayloadTooLargeError", (err) =>
 *     Effect.sync(() => {
 *       res.writeHead(413, { "Content-Type": "text/plain" })
 *       res.end("Payload Too Large")
 *     })
 *   )
 * )
 * ```
 */
export const nodeToWebRequestEffect = (
  req: IncomingMessage,
  options?: NodeToWebRequestOptions,
): Effect.Effect<Request, PayloadTooLargeError> =>
  Effect.tryPromise({
    try: () => nodeToWebRequest(req, options),
    catch: (error) => {
      if (error instanceof PayloadTooLargeError) {
        return error
      }
      // Re-throw unexpected errors as defects
      throw error
    },
  })

/**
 * Write a web standard Response to a Node.js ServerResponse (Effect version).
 *
 * @example
 * ```ts
 * import { webToNodeResponseEffect } from "effect-trpc/node/http"
 *
 * const program = Effect.gen(function* () {
 *   const response = yield* handler.fetchEffect(request)
 *   yield* webToNodeResponseEffect(response, res)
 * })
 * ```
 */
export const webToNodeResponseEffect = (
  response: Response,
  res: ServerResponse,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    // Convert headers
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })

    res.writeHead(response.status, headers)

    // Stream the body using acquireUseRelease for proper cleanup
    // Implements backpressure: if res.write() returns false, wait for 'drain' event
    // This prevents OOM when clients are slow to consume data
    if (response.body) {
      yield* Effect.acquireUseRelease(
        Effect.sync(() => response.body!.getReader()),
        (reader) =>
          Effect.gen(function* () {
            let done = false
            while (!done) {
              const result = yield* Effect.tryPromise(() => reader.read()).pipe(
                Effect.catchAllCause(() => Effect.succeed({ done: true, value: undefined })),
              )
              done = result.done
              if (result.value) {
                // Check if the internal buffer is full
                const canContinue = res.write(result.value)
                if (!canContinue) {
                  // Buffer is full, wait for drain event before continuing
                  yield* Effect.async<void>((resume) => {
                    res.once("drain", () => resume(Effect.void))
                  })
                }
              }
            }
          }),
        (reader) => Effect.sync(() => reader.releaseLock()),
      )
    }

    res.end()
  })

/**
 * Write a web standard Response to a Node.js ServerResponse.
 *
 * @example
 * ```ts
 * import { webToNodeResponse } from "effect-trpc/node/http"
 *
 * server.on("request", async (req, res) => {
 *   const request = await nodeToWebRequest(req)
 *   const response = await handler.fetch(request)
 *   await webToNodeResponse(response, res)
 * })
 * ```
 */
export function webToNodeResponse(response: Response, res: ServerResponse): Promise<void> {
  // Effect.runPromise is appropriate here - this is a bridge function
  // that converts from Effect-land to Promise-land for Node.js HTTP APIs
  return Effect.runPromise(webToNodeResponseEffect(response, res))
}
