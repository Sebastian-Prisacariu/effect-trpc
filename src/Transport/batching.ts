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
  headers: Record<string, string>,
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
      // Resolve headers
      const resolvedHeaders: Record<string, string> = typeof config.headers === "function"
        ? yield* Effect.promise(() => (config.headers as () => Promise<Record<string, string>>)())
        : (config.headers ?? {}) as Record<string, string>
      
      // Create batcher
      const batcher = yield* make(url, fetchFn, resolvedHeaders, config)
      
      // Direct send for non-batched requests
      const sendDirect = (
        request: Transport.TransportRequest
      ): Effect.Effect<Transport.TransportResponse, Transport.TransportError> =>
        Effect.tryPromise({
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
        }).pipe(
          Effect.flatMap((json) =>
            Schema.decodeUnknown(Transport.TransportResponse)(json).pipe(
              Effect.mapError((error) => new Transport.TransportError({
                reason: "Protocol",
                message: "Invalid response",
                cause: error,
              }))
            )
          )
        )
      
      return {
        send: (request) => {
          // Determine if this request should be batched
          // For now, batch all queries, skip mutations
          // TODO: Add procedure type detection
          const shouldBatch = batchQueries // Simplified for now
          
          if (shouldBatch) {
            return batcher.submit(request)
          }
          
          return sendDirect(request)
        },
        
        sendStream: (request) => {
          // Streams are never batched
          return Stream.fromEffect(sendDirect(request)).pipe(
            Stream.map((response): Transport.StreamResponse => {
              if (Schema.is(Transport.Success)(response)) {
                return new Transport.StreamChunk({ id: response.id, chunk: response.value })
              }
              return response as Transport.Failure
            })
          )
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
  handle: (request: Transport.TransportRequest) => Effect.Effect<Transport.TransportResponse, never, R>
) => (
  batchRequest: BatchRequest
): Effect.Effect<BatchResponse, never, R> =>
  Effect.gen(function* () {
    // Process all requests in parallel
    const responses = yield* Effect.forEach(
      batchRequest.batch,
      (req) => handle(new Transport.TransportRequest({
        id: req.id,
        tag: req.tag,
        payload: req.payload,
        headers: {},
      })),
      { concurrency: "unbounded" }
    )
    
    return new BatchResponse({ batch: responses })
  })
