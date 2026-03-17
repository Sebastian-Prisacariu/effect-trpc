/**
 * Batching - Combine multiple RPC requests into single HTTP requests
 * 
 * Uses Effect Queue + Stream.groupedWithin for efficient batching.
 * Inspired by react-interview-test-queues-and-streams patterns.
 * 
 * @since 1.0.0
 * @module
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Queue from "effect/Queue"
import * as Chunk from "effect/Chunk"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Cause from "effect/Cause"
import * as Schema from "effect/Schema"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import { pipe } from "effect/Function"

import * as Transport from "./index.js"

// =============================================================================
// Types
// =============================================================================

/**
 * A pending request waiting to be batched
 */
interface PendingRequest {
  readonly request: Transport.TransportRequest
  readonly deferred: Deferred.Deferred<Transport.TransportResponse, Transport.TransportError>
}

/**
 * Batch request sent to server
 */
export class BatchRequest extends Schema.Class<BatchRequest>("BatchRequest")({
  batch: Schema.Array(Schema.Struct({
    id: Schema.String,
    tag: Schema.String,
    payload: Schema.Unknown,
  })),
}) {}

/**
 * Batch response from server
 */
export class BatchResponse extends Schema.Class<BatchResponse>("BatchResponse")({
  batch: Schema.Array(Schema.Union(
    Transport.Success,
    Transport.Failure
  )),
}) {}

interface BatchExecutionOptions {
  readonly headers?: Record<string, string>
  readonly signal?: AbortSignal
}

/**
 * Batching configuration
 */
export interface BatchingConfig {
  /**
   * Maximum requests per batch (default: 25)
   */
  readonly maxSize?: number
  
  /**
   * Time window to collect requests (default: 10ms)
   */
  readonly window?: Duration.DurationInput
  
  /**
   * Batch queries (default: true)
   */
  readonly queries?: boolean
  
  /**
   * Batch mutations (default: false)
   */
  readonly mutations?: boolean
}

// =============================================================================
// Batcher Service
// =============================================================================

/**
 * Batcher service interface
 */
export interface Batcher {
  /**
   * Submit a request for batching.
   * Returns a Deferred that will be resolved when the batch is processed.
   */
  readonly submit: (
    request: Transport.TransportRequest
  ) => Effect.Effect<Transport.TransportResponse, Transport.TransportError>
  
  /**
   * Pause batching (e.g., when offline)
   */
  readonly pause: Effect.Effect<void>
  
  /**
   * Resume batching
   */
  readonly resume: Effect.Effect<void>
}

/**
 * Batcher service tag
 */
export class BatcherService extends Context.Tag("@effect-trpc/Batcher")<
  BatcherService,
  Batcher
>() {}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a batcher that collects requests and sends them in batches
 */
export const make = (
  url: string,
  fetchFn: typeof globalThis.fetch,
  resolveHeaders: () => Effect.Effect<Record<string, string>>,
  config: BatchingConfig = {}
): Effect.Effect<Batcher, never, import("effect/Scope").Scope> => {
  const maxSize = config.maxSize ?? 25
  const window = config.window ?? Duration.millis(10)
  
  return Effect.gen(function* () {
    // Queue to collect pending requests
    const queue = yield* Queue.unbounded<PendingRequest>()
    
    // Latch to pause/resume batching
    const latch = yield* Effect.makeLatch(true) // Start open
    
    // Process a batch of requests
    const processBatch = (
      chunk: Chunk.Chunk<PendingRequest>
    ): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        if (Chunk.isEmpty(chunk)) return
        
        const pending = Chunk.toReadonlyArray(chunk)
        const headers = yield* resolveHeaders()
        
        yield* Effect.logDebug(`[Batcher] Processing batch of ${pending.length} requests`)
        
        // Build batch request
        const batchRequest = new BatchRequest({
          batch: pending.map(p => ({
            id: p.request.id,
            tag: p.request.tag,
            payload: p.request.payload,
          })),
        })
        
        // Send batch
        const result = yield* Effect.tryPromise({
          try: async () => {
            const response = await fetchFn(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Batch": "true",
                ...headers,
              },
              body: JSON.stringify(batchRequest),
            })
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }
            
            return response.json()
          },
          catch: (error) => new Transport.TransportError({
            reason: "Network",
            message: "Batch request failed",
            cause: error,
          }),
        })
        
        // Parse batch response
        const batchResponse = yield* Schema.decodeUnknown(BatchResponse)(result).pipe(
          Effect.mapError((error) => new Transport.TransportError({
            reason: "Protocol",
            message: "Invalid batch response",
            cause: error,
          }))
        )
        
        // Route responses back to individual deferreds
        const responseMap = new Map<string, Transport.TransportResponse>()
        for (const response of batchResponse.batch) {
          responseMap.set(response.id, response)
        }
        
        for (const p of pending) {
          const response = responseMap.get(p.request.id)
          if (response) {
            yield* Deferred.succeed(p.deferred, response)
          } else {
            yield* Deferred.fail(p.deferred, new Transport.TransportError({
              reason: "Protocol",
              message: `No response for request ${p.request.id}`,
            }))
          }
        }
      }).pipe(
        // Wait for latch to be open before processing
        latch.whenOpen,
        // Handle errors - reject all pending requests
        Effect.catchAll((error) =>
          Effect.forEach(Chunk.toReadonlyArray(chunk), (p) =>
            Deferred.fail(p.deferred, error as Transport.TransportError)
          )
        )
      )
    
    // Start the batching stream
    yield* Stream.fromQueue(queue).pipe(
      Stream.tap((p) => 
        Effect.logDebug(`[Batcher] Queued request: ${p.request.tag}`)
      ),
      Stream.groupedWithin(maxSize, window),
      Stream.mapEffect(processBatch, { concurrency: 1 }),
      Stream.catchAllCause((cause) => 
        Effect.logError(`[Batcher] Fatal error: ${Cause.squash(cause)}`)
      ),
      Stream.runDrain,
      Effect.forkScoped
    )
    
    return {
      submit: (request) =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<Transport.TransportResponse, Transport.TransportError>()
          
          yield* Queue.offer(queue, { request, deferred })
          
          return yield* Deferred.await(deferred)
        }),
      
      pause: latch.close,
      resume: latch.open,
    }
  })
}

/**
 * Create a batching transport layer
 * 
 * @since 1.0.0
 * @category constructors
 */
export const layer = (
  url: string,
  config: BatchingConfig & {
    readonly headers?: Record<string, string> | (() => Promise<Record<string, string>>)
    readonly fetch?: typeof globalThis.fetch
  } = {}
): Layer.Layer<Transport.Transport, never, never> => {
  const fetchFn = config.fetch ?? globalThis.fetch
  const batchQueries = config.queries ?? true
  const batchMutations = config.mutations ?? false
  
  return Layer.scoped(
    Transport.Transport,
    Effect.gen(function* () {
      const resolveHeaders = (): Effect.Effect<Record<string, string>> =>
        typeof config.headers === "function"
          ? Effect.promise(() => (config.headers as () => Promise<Record<string, string>>)())
          : Effect.succeed((config.headers ?? {}) as Record<string, string>)
      
      // Create batcher
      const batcher = yield* make(url, fetchFn, resolveHeaders, config)
      
      // Direct send for non-batched requests
      const sendDirect = (
        request: Transport.TransportRequest
      ): Effect.Effect<Transport.TransportResponse, Transport.TransportError> =>
        Effect.gen(function* () {
          const resolvedHeaders = yield* resolveHeaders()

          const json = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetchFn(url, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...resolvedHeaders,
                },
                body: JSON.stringify({
                  id: request.id,
                  tag: request.tag,
                  payload: request.payload,
                }),
              })
              
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
              }
              
              return response.json()
            },
            catch: (error) => new Transport.TransportError({
              reason: "Network",
              message: "Request failed",
              cause: error,
            }),
          })

          return yield* Schema.decodeUnknown(Transport.TransportResponse)(json).pipe(
            Effect.mapError((error) => new Transport.TransportError({
              reason: "Protocol",
              message: "Invalid response",
              cause: error,
            }))
          )
        })

      const sendDirectStream = (
        request: Transport.TransportRequest
      ): Stream.Stream<Transport.StreamResponse, Transport.TransportError> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const resolvedHeaders = yield* resolveHeaders()

            const body = yield* Effect.tryPromise({
              try: async () => {
              const response = await fetchFn(`${url}/stream`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "text/event-stream",
                  ...resolvedHeaders,
                },
                body: JSON.stringify({
                  id: request.id,
                  tag: request.tag,
                  payload: request.payload,
                }),
              })

              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
              }

              if (!response.body) {
                throw new Error("Response body is empty")
              }

              return response.body
              },
              catch: (error) => new Transport.TransportError({
                reason: "Network",
                message: "Failed to connect to stream",
                cause: error,
              }),
            })

            return Stream.async<Transport.StreamResponse, Transport.TransportError>((emit) => {
                const reader = body.getReader()
                const decoder = new TextDecoder()
                let buffer = ""

                const processLine = (line: string) => {
                  if (!line.startsWith("data: ")) return

                  const data = line.slice(6)
                  if (data === "[DONE]") {
                    emit.end()
                    return
                  }

                  try {
                    const parsed = JSON.parse(data) as Record<string, unknown>

                    if (parsed._tag === "StreamChunk") {
                      emit.single(new Transport.StreamChunk({
                        id: parsed.id as string,
                        chunk: parsed.chunk,
                      }))
                      return
                    }

                    if (parsed._tag === "StreamEnd") {
                      emit.end()
                      return
                    }

                    if (parsed._tag === "Failure") {
                      emit.single(new Transport.Failure({
                        id: parsed.id as string,
                        error: parsed.error,
                      }))
                      emit.end()
                    }
                  } catch {
                    // Ignore malformed event lines and keep reading.
                  }
                }

                const read = async (): Promise<void> => {
                  try {
                    while (true) {
                      const { done, value } = await reader.read()

                      if (done) {
                        if (buffer.trim()) {
                          processLine(buffer.trim())
                        }
                        emit.end()
                        break
                      }

                      buffer += decoder.decode(value, { stream: true })
                      const lines = buffer.split("\n")
                      buffer = lines.pop() ?? ""

                      for (const line of lines) {
                        if (line.trim()) {
                          processLine(line.trim())
                        }
                      }
                    }
                  } catch (error) {
                    emit.fail(new Transport.TransportError({
                      reason: "Network",
                      message: "Stream read error",
                      cause: error,
                    }))
                  }
                }

                void read()
              })
          })
        )
      
      return {
        send: (request) => {
          // Determine if this request should be batched based on procedure type
          const isQuery = request.type === "query" || request.type === undefined
          const isMutation = request.type === "mutation"
          
          const shouldBatch = 
            (isQuery && batchQueries) || 
            (isMutation && batchMutations)
          
          if (shouldBatch) {
            return batcher.submit(request)
          }
          
          return sendDirect(request)
        },
        
        sendStream: (request) => {
          // Streams are never batched
          return sendDirectStream(request)
        },
      }
    })
  )
}

// =============================================================================
// Server Support
// =============================================================================

/**
 * Check if a request is a batch request
 */
export const isBatchRequest = (body: unknown): body is BatchRequest =>
  typeof body === "object" && 
  body !== null && 
  "batch" in body && 
  Array.isArray((body as any).batch)

/**
 * Handle a batch request on the server
 */
export const handleBatch = <R>(
  handle: (
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ) => Effect.Effect<Transport.TransportResponse, never, R>
) => (
  batchRequest: BatchRequest,
  options?: BatchExecutionOptions
): Effect.Effect<BatchResponse, never, R> =>
  Effect.gen(function* () {
    // Process all requests in parallel
    const responses = yield* Effect.forEach(
      batchRequest.batch,
      (req) => handle(new Transport.TransportRequest({
        id: req.id,
        tag: req.tag,
        payload: req.payload,
        headers: options?.headers ?? {},
      }), options?.signal),
      { concurrency: "unbounded" }
    )
    
    return new BatchResponse({ batch: responses })
  })
