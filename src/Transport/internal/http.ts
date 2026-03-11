/**
 * HTTP transport implementation
 * @internal
 */

import { Effect, Layer, Stream, Duration, Fiber, Ref, Deferred, pipe } from "effect"
import { Transport, type TransportService, type TransportRequest, type TransportResponse, type HttpOptions } from "../index.js"
import { TransportError } from "./error.js"

// =============================================================================
// Implementation
// =============================================================================

export const httpTransport = (
  url: string,
  options?: HttpOptions
): Layer.Layer<Transport, never, never> => {
  const fetchFn = options?.fetch ?? globalThis.fetch
  const batchingEnabled = options?.batching?.enabled ?? true
  const batchWindow = options?.batching?.window ?? Duration.millis(0)
  const batchMaxSize = options?.batching?.maxSize ?? 50

  // If batching disabled, simple implementation
  if (!batchingEnabled) {
    return Layer.succeed(Transport, {
      send: (request) => sendSingle(url, request, fetchFn, options?.headers),
    })
  }

  // With batching, we need shared state
  return Layer.scoped(
    Transport,
    Effect.gen(function* () {
      const batcher = yield* makeBatcher(url, fetchFn, options?.headers, {
        window: batchWindow,
        maxSize: batchMaxSize,
      })

      return {
        send: (request) => batcher.submit(request),
      } satisfies TransportService
    })
  )
}

// =============================================================================
// Single request (no batching)
// =============================================================================

const sendSingle = (
  url: string,
  request: TransportRequest,
  fetchFn: typeof fetch,
  headers?: HttpOptions["headers"]
): Stream.Stream<TransportResponse, TransportError> =>
  Stream.fromEffect(
    Effect.gen(function* () {
      const resolvedHeaders = typeof headers === "function"
        ? yield* Effect.promise(() => Promise.resolve(headers()))
        : headers

      const response = yield* Effect.tryPromise({
        try: () =>
          fetchFn(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...resolvedHeaders,
            },
            body: JSON.stringify({
              id: request.id,
              path: request.path,
              payload: request.payload,
            }),
          }),
        catch: (cause) =>
          new TransportError({
            reason: "Network",
            message: "Failed to send request",
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
  )

// =============================================================================
// Batching
// =============================================================================

interface PendingRequest {
  readonly request: TransportRequest
  readonly deferred: Deferred.Deferred<TransportResponse, TransportError>
}

interface BatcherConfig {
  readonly window: Duration.DurationInput
  readonly maxSize: number
}

const makeBatcher = (
  url: string,
  fetchFn: typeof fetch,
  headers: HttpOptions["headers"],
  config: BatcherConfig
) =>
  Effect.gen(function* () {
    const pending = yield* Ref.make<Array<PendingRequest>>([])
    const flushFiber = yield* Ref.make<Fiber.Fiber<void, never> | null>(null)

    const flush = Effect.gen(function* () {
      const requests = yield* Ref.getAndSet(pending, [])
      if (requests.length === 0) return

      // Reset flush fiber
      yield* Ref.set(flushFiber, null)

      // Send batch
      const result = yield* sendBatch(url, requests.map((r) => r.request), fetchFn, headers).pipe(
        Effect.either
      )

      // Distribute results
      if (result._tag === "Left") {
        for (const req of requests) {
          yield* Deferred.fail(req.deferred, result.left)
        }
      } else {
        const responses = result.right as Array<TransportResponse>
        const responseMap = new Map(responses.map((r) => [r.id, r]))
        
        for (const req of requests) {
          const response = responseMap.get(req.request.id)
          if (response) {
            yield* Deferred.succeed(req.deferred, response)
          } else {
            yield* Deferred.fail(
              req.deferred,
              new TransportError({
                reason: "Protocol",
                message: `No response for request ${req.request.id}`,
              })
            )
          }
        }
      }
    })

    const scheduleFlush = Effect.gen(function* () {
      const existing = yield* Ref.get(flushFiber)
      if (existing !== null) return

      const windowMs = Duration.toMillis(config.window)
      
      if (windowMs === 0) {
        // Microtask batching
        const fiber = yield* Effect.fork(
          Effect.yieldNow().pipe(Effect.flatMap(() => flush))
        )
        yield* Ref.set(flushFiber, fiber)
      } else {
        // Timed batching
        const fiber = yield* Effect.fork(
          Effect.sleep(config.window).pipe(Effect.flatMap(() => flush))
        )
        yield* Ref.set(flushFiber, fiber)
      }
    })

    const submit = (request: TransportRequest): Stream.Stream<TransportResponse, TransportError> =>
      Stream.fromEffect(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<TransportResponse, TransportError>()
          
          yield* Ref.update(pending, (arr) => [...arr, { request, deferred }])
          
          // Check if we hit max size
          const currentSize = yield* Ref.get(pending).pipe(Effect.map((arr) => arr.length))
          if (currentSize >= config.maxSize) {
            yield* flush
          } else {
            yield* scheduleFlush
          }

          return yield* Deferred.await(deferred)
        })
      )

    return { submit, flush }
  })

const sendBatch = (
  url: string,
  requests: ReadonlyArray<TransportRequest>,
  fetchFn: typeof fetch,
  headers?: HttpOptions["headers"]
): Effect.Effect<ReadonlyArray<TransportResponse>, TransportError> =>
  Effect.gen(function* () {
    const resolvedHeaders = typeof headers === "function"
      ? yield* Effect.promise(() => Promise.resolve(headers()))
      : headers

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...resolvedHeaders,
          },
          body: JSON.stringify(
            requests.map((r) => ({
              id: r.id,
              path: r.path,
              payload: r.payload,
            }))
          ),
        }),
      catch: (cause) =>
        new TransportError({
          reason: "Network",
          message: "Failed to send batch request",
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

    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new TransportError({
          reason: "Protocol",
          message: "Failed to parse batch response",
          cause,
        }),
    })

    return data as ReadonlyArray<TransportResponse>
  })
