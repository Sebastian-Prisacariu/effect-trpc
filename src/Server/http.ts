/**
 * HTTP adapters for Server
 * 
 * @internal
 * @module
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type * as Layer from "effect/Layer"
import * as Router from "../Router/index.js"
import * as Transport from "../Transport/index.js"
import type { Server, HttpRequest, HttpResponse, HttpHandlerOptions, NextApiRequest, NextApiResponse } from "./types.js"

// =============================================================================
// HTTP Handler
// =============================================================================

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
  options?: HttpHandlerOptions
): (request: HttpRequest) => Effect.Effect<HttpResponse, never, R> => {
  const maxPayloadSize = options?.maxPayloadSize
  
  return (request: HttpRequest) =>
    Effect.tryPromise({
      try: () => request.json(),
      catch: () => ({ id: "", tag: "", payload: undefined }),
    }).pipe(
      Effect.flatMap((body) => {
        // Check payload size if limit is configured
        if (maxPayloadSize !== undefined) {
          const size = JSON.stringify(body).length
          if (size > maxPayloadSize) {
            return Effect.succeed<HttpResponse>({
              status: 413,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "Payload too large" }),
            })
          }
        }
        
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
        
        return server.handle(transportRequest, request.signal).pipe(
          Effect.map((response): HttpResponse => ({
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(response),
          }))
        )
      }),
      Effect.catchAll((error) =>
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

// =============================================================================
// SSE Handler
// =============================================================================

/**
 * Create an SSE (Server-Sent Events) handler for streaming responses.
 * 
 * @since 1.0.0
 * @category http
 */
export const toSSEHandler = <D extends Router.Definition, R>(
  server: Server<D, R>
): (body: unknown, signal?: AbortSignal) => Stream.Stream<Transport.StreamResponse, never, R> => {
  return (body: unknown, signal?: AbortSignal) => {
    const request = new Transport.TransportRequest({
      id: (body as any).id ?? Transport.generateRequestId(),
      tag: (body as any).tag ?? "",
      payload: (body as any).payload,
      headers: {},
    })
    
    return server.handleStream(request, signal)
  }
}

/**
 * Create a fetch-compatible SSE handler for streaming responses.
 * Returns a Response with a ReadableStream body.
 * 
 * @since 1.0.0
 * @category http
 */
export const toFetchSSEHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  layer: Layer.Layer<R>
): (request: Request) => Promise<Response> => {
  const sseHandler = toSSEHandler(server)
  
  return async (request: Request): Promise<Response> => {
    const body = await request.json()
    const stream = sseHandler(body, request.signal)
    
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    
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

// =============================================================================
// Fetch Handler
// =============================================================================

/**
 * Create a fetch-compatible handler (for Next.js App Router, Cloudflare Workers, etc.)
 * 
 * @since 1.0.0
 * @category http
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

// =============================================================================
// Next.js Handler
// =============================================================================

/**
 * Create handler for Next.js API routes (Pages Router)
 * 
 * @since 1.0.0
 * @category http
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
    
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value)
    }
    
    res.status(response.status)
    
    // Support different Next.js API response methods
    if (typeof (res as any).send === "function") {
      (res as any).send(response.body)
    } else if (typeof res.json === "function") {
      res.json(JSON.parse(response.body))
    } else {
      res.end()
    }
  }
}

/**
 * Create SSE handler for Next.js API routes (Pages Router)
 * 
 * @since 1.0.0
 * @category http
 */
export const toNextApiSSEHandler = <D extends Router.Definition, R>(
  server: Server<D, R>,
  layer: Layer.Layer<R>
): (req: NextApiRequest, res: NextApiResponse) => Promise<void> => {
  const sseHandler = toSSEHandler(server)
  
  return async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")
    
    const stream = sseHandler(req.body)
    
    await Effect.runPromise(
      stream.pipe(
        Stream.runForEach((chunk) =>
          Effect.sync(() => {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`)
          })
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            res.write(`data: [DONE]\n\n`)
            res.end()
          })
        ),
        Effect.catchAll(() =>
          Effect.sync(() => {
            res.write(`data: {"_tag":"Failure","error":"Stream error"}\n\n`)
            res.end()
          })
        ),
        Effect.provide(layer)
      )
    )
  }
}
