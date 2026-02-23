/**
 * @module effect-trpc/core/client
 *
 * Vanilla (non-React) client for effect-trpc.
 * Use this for server-to-server calls or non-React environments.
 * Uses Effect and @effect/platform throughout.
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Data from "effect/Data"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import type * as Layer from "effect/Layer"
import * as Duration from "effect/Duration"
import * as Schedule from "effect/Schedule"
import * as Deferred from "effect/Deferred"
import * as Ref from "effect/Ref"
import * as Predicate from "effect/Predicate"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import * as HttpClientError from "@effect/platform/HttpClientError"
import type { Router, RouterRecord } from "./router.js"
import type { ProceduresGroup, ProcedureRecord } from "./procedures.js"
import type { ProcedureDefinition } from "./procedure.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for automatic retries on failed requests.
 *
 * @since 0.1.0
 * @category Config
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  readonly count?: number

  /**
   * Base delay between retries in milliseconds.
   * @default 1000
   */
  readonly delay?: number

  /**
   * Backoff strategy for retry delays.
   * - "linear": Fixed delay between retries
   * - "exponential": Delay doubles after each retry
   * @default "exponential"
   */
  readonly backoff?: "linear" | "exponential"

  /**
   * Custom filter function to determine if an error is retryable.
   * If not provided, uses default `isRetryableError` which retries
   * network errors but not validation/auth errors.
   */
  readonly retryOn?: (error: unknown) => boolean
}

/**
 * Configuration for request batching.
 * When enabled, multiple procedure calls are collected and sent as a single HTTP request.
 *
 * @since 0.1.0
 * @category Config
 */
export interface BatchConfig {
  /**
   * Enable request batching.
   * @default false
   */
  readonly enabled?: boolean

  /**
   * Maximum number of requests per batch.
   * When reached, the batch is sent immediately.
   * @default 10
   */
  readonly maxSize?: number

  /**
   * Batch window in milliseconds.
   * Requests are collected during this window before being sent.
   * @default 10
   */
  readonly windowMs?: number
}

/**
 * Options for creating a tRPC client.
 *
 * @since 0.1.0
 * @category Config
 */
export interface CreateClientOptions {
  /**
   * Base URL for the RPC endpoint.
   * @example 'http://localhost:3000/api/trpc'
   */
  readonly url: string

  /**
   * Additional headers to send with each request.
   */
  readonly headers?: Record<string, string> | (() => Record<string, string>)

  /**
   * Optional custom HttpClient Layer for the client.
   * If provided, the client will use this layer instead of requiring one in the environment.
   */
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>

  /**
   * Request timeout in milliseconds.
   * If a request takes longer than this, it will fail with RpcTimeoutError.
   */
  readonly timeout?: number

  /**
   * Configuration for automatic retries on failed requests.
   * If not provided, no retries are attempted.
   */
  readonly retry?: RetryConfig

  /**
   * Configuration for request batching.
   * When enabled, multiple procedure calls are collected and sent as a single HTTP request.
   *
   * @remarks
   * Batching reduces network overhead by combining multiple RPC calls into a single
   * HTTP request. This is particularly useful for:
   * - Reducing latency when making many small requests
   * - Optimizing connection usage
   * - Working with connection-limited environments
   *
   * Note: Stream/chat procedures are NOT batched - they use their own connections.
   */
  readonly batch?: BatchConfig
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Type Identification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TypeId for RPC client errors.
 *
 * @since 0.1.0
 * @category symbols
 */
export const RpcClientErrorTypeId: unique symbol = Symbol.for("@effect-trpc/RpcClientError")
export type RpcClientErrorTypeId = typeof RpcClientErrorTypeId

/**
 * TypeId for RPC response errors.
 *
 * @since 0.1.0
 * @category symbols
 */
export const RpcResponseErrorTypeId: unique symbol = Symbol.for("@effect-trpc/RpcResponseError")
export type RpcResponseErrorTypeId = typeof RpcResponseErrorTypeId

/**
 * TypeId for RPC timeout errors.
 *
 * @since 0.1.0
 * @category symbols
 */
export const RpcTimeoutErrorTypeId: unique symbol = Symbol.for("@effect-trpc/RpcTimeoutError")
export type RpcTimeoutErrorTypeId = typeof RpcTimeoutErrorTypeId

/**
 * Type predicate for RpcClientError.
 *
 * @since 0.1.0
 * @category guards
 */
export const isRpcClientError = (u: unknown): u is RpcClientError =>
  Predicate.hasProperty(u, RpcClientErrorTypeId)

/**
 * Type predicate for RpcResponseError.
 *
 * @since 0.1.0
 * @category guards
 */
export const isRpcResponseError = (u: unknown): u is RpcResponseError =>
  Predicate.hasProperty(u, RpcResponseErrorTypeId)

/**
 * Type predicate for RpcTimeoutError.
 *
 * @since 0.1.0
 * @category guards
 */
export const isRpcTimeoutError = (u: unknown): u is RpcTimeoutError =>
  Predicate.hasProperty(u, RpcTimeoutErrorTypeId)

/**
 * Type predicate for any RPC error.
 *
 * @since 0.1.0
 * @category guards
 */
export const isRpcError = (u: unknown): u is RpcClientError | RpcResponseError | RpcTimeoutError =>
  isRpcClientError(u) || isRpcResponseError(u) || isRpcTimeoutError(u)

// ─────────────────────────────────────────────────────────────────────────────
// Error Classes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error for RPC client-side failures (serialization, parsing, etc).
 *
 * @since 0.1.0
 * @category errors
 */
export class RpcClientError extends Data.TaggedError("RpcClientError")<{
  readonly message: string
  readonly cause?: unknown
}> {
  readonly [RpcClientErrorTypeId]: RpcClientErrorTypeId = RpcClientErrorTypeId
}

/**
 * Error for HTTP response failures from the RPC server.
 *
 * @since 0.1.0
 * @category errors
 */
export class RpcResponseError extends Data.TaggedError("RpcResponseError")<{
  readonly message: string
  readonly status: number
}> {
  readonly [RpcResponseErrorTypeId]: RpcResponseErrorTypeId = RpcResponseErrorTypeId
}

/**
 * Error when an RPC call times out.
 *
 * @since 0.1.0
 * @category errors
 */
export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  readonly rpcName: string
  readonly timeout: number
}> {
  readonly [RpcTimeoutErrorTypeId]: RpcTimeoutErrorTypeId = RpcTimeoutErrorTypeId

  override get message(): string {
    return `RPC call '${this.rpcName}' timed out after ${this.timeout}ms`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Error Union Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of all RPC error types that can occur during RPC calls.
 * Includes both effect-trpc errors and HTTP client errors.
 * Useful for type guards and exhaustive error handling.
 *
 * @example
 * ```ts
 * import { RpcError, isRpcClientError, isRpcResponseError, isRpcTimeoutError } from 'effect-trpc'
 *
 * const handleError = (error: RpcError) => {
 *   if (isRpcClientError(error)) {
 *     console.log('Client error:', error.message)
 *   } else if (isRpcResponseError(error)) {
 *     console.log('Server responded with:', error.status)
 *   } else if (isRpcTimeoutError(error)) {
 *     console.log('Timeout after:', error.timeout, 'ms')
 *   } else {
 *     // HttpClientError - network issues, connection failures, etc.
 *     console.log('HTTP error:', error)
 *   }
 * }
 * ```
 *
 * @since 0.1.0
 * @category errors
 */
export type RpcError =
  | RpcClientError
  | RpcResponseError
  | RpcTimeoutError
  | HttpClientError.HttpClientError

// ─────────────────────────────────────────────────────────────────────────────
// Retry Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default predicate for determining if an error is retryable.
 *
 * Retries:
 * - HttpClientError (network errors, connection issues)
 * - RpcTimeoutError (request timeouts)
 *
 * Does NOT retry:
 * - RpcClientError (validation errors, parse errors)
 * - RpcResponseError with 4xx status (client errors like auth failures)
 * - RpcResponseError with 5xx status ARE retried (server errors)
 *
 * @since 0.1.0
 * @category Retry
 */
export const isRetryableError = (error: unknown): boolean => {
  // Network errors are retryable
  if (HttpClientError.isHttpClientError(error)) {
    return true
  }

  // Timeout errors are retryable
  if (error instanceof RpcTimeoutError) {
    return true
  }

  // Server errors (5xx) are retryable, client errors (4xx) are not
  if (error instanceof RpcResponseError) {
    return error.status >= 500
  }

  // RpcClientError (validation, parse errors) are not retryable
  if (error instanceof RpcClientError) {
    return false
  }

  // Unknown errors - don't retry by default
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Client Types
// ─────────────────────────────────────────────────────────────────────────────

// Note: RpcError is exported above and used throughout this file

interface QueryProcedureClient<I, A, E> {
  (input: I): Effect.Effect<A, E | RpcError, HttpClient.HttpClient>
}

interface MutationProcedureClient<I, A, E> {
  (input: I): Effect.Effect<A, E | RpcError, HttpClient.HttpClient>
}

interface StreamProcedureClient<I, A, E> {
  (input: I): Stream.Stream<A, E | RpcError, HttpClient.HttpClient>
}

interface SubscriptionProcedureClient<I, A, E> {
  (input: I): Stream.Stream<A, E | RpcError, HttpClient.HttpClient>
}

type ProcedureClient<P> =
  P extends ProcedureDefinition<infer I, infer O, infer E, any, "query">
    ? QueryProcedureClient<unknown extends I ? void : I, O, E>
    : P extends ProcedureDefinition<infer I, infer O, infer E, any, "mutation">
      ? MutationProcedureClient<unknown extends I ? void : I, O, E>
      : P extends ProcedureDefinition<infer I, infer O, infer E, any, "stream">
        ? StreamProcedureClient<unknown extends I ? void : I, O, E>
        : P extends ProcedureDefinition<infer I, infer O, infer E, any, "chat">
          ? StreamProcedureClient<unknown extends I ? void : I, O, E>
          : P extends ProcedureDefinition<infer I, infer O, infer E, any, "subscription">
            ? SubscriptionProcedureClient<unknown extends I ? void : I, O, E>
            : never

type ProceduresClient<P extends ProcedureRecord> = {
  [K in keyof P]: ProcedureClient<P[K]>
}

/**
 * Recursive client type that supports nested routers.
 * For each entry in the router record:
 * - If it's a ProceduresGroup, return a ProceduresClient for its procedures
 * - If it's a nested Router, recurse into its routes
 *
 * @since 0.1.0
 * @category Types
 */
type RouterClient<R extends RouterRecord> = {
  [K in keyof R]: R[K] extends ProceduresGroup<any, infer P>
    ? ProceduresClient<P>
    : R[K] extends Router<infer NestedRoutes>
      ? RouterClient<NestedRoutes>
      : never
}

/**
 * A tRPC client instance with typed procedure access.
 *
 * @since 0.1.0
 * @category Client
 */
export interface TRPCClient<TRouter extends Router> {
  readonly procedures: RouterClient<TRouter["routes"]>
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Message Schemas for type-safe parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for the Cause structure in failure responses.
 */
const RpcCauseSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Fail"),
    error: Schema.Unknown,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Die"),
    defect: Schema.Unknown,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Interrupt"),
    fiberId: Schema.optional(Schema.Unknown),
  }),
)

/**
 * Schema for successful exit in RPC responses.
 */
const RpcExitSuccessSchema = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Unknown,
})

/**
 * Schema for failed exit in RPC responses.
 */
const RpcExitFailureSchema = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  cause: Schema.optional(RpcCauseSchema),
})

/**
 * Schema for Exit message wrapper.
 */
const RpcExitMessageSchema = Schema.Struct({
  _tag: Schema.Literal("Exit"),
  exit: Schema.Union(RpcExitSuccessSchema, RpcExitFailureSchema),
})

/**
 * Schema for Defect messages.
 */
const RpcDefectMessageSchema = Schema.Struct({
  _tag: Schema.Literal("Defect"),
  defect: Schema.optional(Schema.String),
})

/**
 * Schema for stream part messages.
 */
const RpcStreamPartSchema = Schema.Struct({
  _tag: Schema.Union(Schema.Literal("StreamPart"), Schema.Literal("Part")),
  value: Schema.Unknown,
})

/**
 * Schema for stream end messages.
 */
const RpcStreamEndSchema = Schema.Struct({
  _tag: Schema.Union(Schema.Literal("StreamEnd"), Schema.Literal("Complete")),
})

/**
 * Schema for stream error messages.
 */
const RpcStreamErrorSchema = Schema.Struct({
  _tag: Schema.Union(Schema.Literal("Error"), Schema.Literal("Failure")),
  error: Schema.optional(Schema.Unknown),
})

/**
 * Union of all RPC response message types.
 */
const RpcResponseMessageSchema = Schema.Union(RpcExitMessageSchema, RpcDefectMessageSchema)

/**
 * Union of all stream message types.
 */
const RpcStreamMessageSchema = Schema.Union(
  RpcStreamPartSchema,
  RpcStreamEndSchema,
  RpcStreamErrorSchema,
)

// ─────────────────────────────────────────────────────────────────────────────
// Request ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branded type for RPC request IDs.
 * Ensures request IDs are not confused with other string types.
 *
 * @since 0.1.0
 * @category Types
 */
const RequestIdSchema = Schema.String.pipe(Schema.brand("RequestId"))
type RequestId = typeof RequestIdSchema.Type

/**
 * Generate a unique request ID.
 * Format: timestamp + 6-digit random number (e.g., "1708451234567000123")
 *
 * @remarks
 * Uses Effect.sync to generate a unique ID and Effect.flatMap with Schema.decode
 * to safely create a branded RequestId. The brand is purely for type safety -
 * it ensures RequestIds are not confused with other string types at compile time.
 *
 * We use `orDie` because the decode cannot fail - our string construction
 * always produces a valid string that matches the RequestIdSchema.
 *
 * @since 0.1.0
 * @category Request ID
 */
const generateRequestId: Effect.Effect<RequestId> = Effect.sync(
  () => String(Date.now()) + String(Math.floor(Math.random() * 1000000)).padStart(6, "0"),
).pipe(Effect.flatMap(Schema.decode(RequestIdSchema)), Effect.orDie)

// ─────────────────────────────────────────────────────────────────────────────
// Batching Types and Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A batched request waiting to be sent.
 */
interface BatchedRequest {
  readonly id: RequestId
  readonly rpcName: string
  readonly input: unknown
  readonly deferred: Deferred.Deferred<unknown, RpcError>
}

/**
 * State for the request batcher.
 */
interface BatcherState {
  readonly queue: ReadonlyArray<BatchedRequest>
  readonly scheduled: boolean
}

/**
 * Creates a single RPC request object (without JSON serialization).
 */
// const createRpcRequestObject = (
//   id: RequestId,
//   rpcName: string,
//   input: unknown
// ): { _tag: string; id: RequestId; tag: string; payload: unknown; headers: never[] } => ({
//   _tag: "Request",
//   id,
//   tag: rpcName,
//   payload: input ?? {},
//   headers: [],
// })

/**
 * Schema for batch response items.
 * Each line in the response corresponds to a request in the batch.
 */
const BatchResponseItemSchema = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("Exit"),
    exit: Schema.Union(
      Schema.Struct({
        _tag: Schema.Literal("Success"),
        value: Schema.Unknown,
      }),
      Schema.Struct({
        _tag: Schema.Literal("Failure"),
        cause: Schema.optional(
          Schema.Union(
            Schema.Struct({
              _tag: Schema.Literal("Fail"),
              error: Schema.Unknown,
            }),
            Schema.Struct({
              _tag: Schema.Literal("Die"),
              defect: Schema.Unknown,
            }),
            Schema.Struct({
              _tag: Schema.Literal("Interrupt"),
              fiberId: Schema.optional(Schema.Unknown),
            }),
          ),
        ),
      }),
    ),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Defect"),
    defect: Schema.optional(Schema.String),
  }),
)

type BatchResponseItem = typeof BatchResponseItemSchema.Type

/**
 * Parse a batch response item and extract the result or error.
 */
const parseBatchResponseItem = (
  item: BatchResponseItem,
): Effect.Effect<unknown, RpcClientError> => {
  if (item._tag === "Exit") {
    if (item.exit._tag === "Success") {
      return Effect.succeed(item.exit.value)
    }
    // Failure case
    const cause = item.exit.cause
    if (cause?._tag === "Fail") {
      return Effect.fail(new RpcClientError({ message: "Request failed", cause: cause.error }))
    }
    if (cause?._tag === "Die") {
      const defectMsg = typeof cause.defect === "string" ? cause.defect : "Unexpected error"
      return Effect.fail(new RpcClientError({ message: defectMsg, cause: cause.defect }))
    }
    return Effect.fail(new RpcClientError({ message: "Request failed" }))
  }

  if (item._tag === "Defect") {
    return Effect.fail(new RpcClientError({ message: item.defect ?? "Unknown error" }))
  }

  return Effect.fail(new RpcClientError({ message: "Unknown response type" }))
}

/**
 * Request batcher that collects multiple RPC calls and sends them as a single HTTP request.
 *
 * @remarks
 * **Implementation Details:**
 *
 * The batcher uses a Ref to manage state (queue of pending requests) and Deferred
 * for synchronization. When a request comes in:
 *
 * 1. A Deferred is created for the response
 * 2. The request is added to the queue
 * 3. If not already scheduled, a flush is scheduled after `windowMs`
 * 4. The caller waits on the Deferred
 *
 * When flushing:
 * 1. Take up to `maxSize` requests from the queue
 * 2. Send them as a batch HTTP request
 * 3. Parse NDJSON response (one line per request)
 * 4. Complete each Deferred with its corresponding response
 *
 * **Error Handling:**
 * - If the batch request fails, all pending Deferreds fail with the same error
 * - Individual request failures within the batch are distributed to their Deferreds
 */
interface RequestBatcher {
  readonly enqueue: (
    rpcName: string,
    input: unknown,
  ) => Effect.Effect<unknown, RpcError, HttpClient.HttpClient>
}

const createRequestBatcher = (
  url: string,
  getHeaders: () => Record<string, string>,
  config: Required<Pick<BatchConfig, "maxSize" | "windowMs">>,
): Effect.Effect<RequestBatcher, never, never> =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<BatcherState>({ queue: [], scheduled: false })

    /**
     * Flush the batch - send queued requests and distribute responses.
     */
    const flush = Effect.gen(function* () {
      // Atomically take requests from the queue
      const batch = yield* Ref.getAndUpdate(stateRef, (state) => ({
        queue: state.queue.slice(config.maxSize),
        scheduled: state.queue.length > config.maxSize, // Reschedule if more requests remain
      })).pipe(Effect.map((state) => state.queue.slice(0, config.maxSize)))

      if (batch.length === 0) {
        return
      }

      // Build batch request body - array of RPC requests as NDJSON
      const requestObjects = batch.map((req) => ({
        _tag: "Request" as const,
        id: req.id,
        tag: req.rpcName,
        payload: req.input ?? {},
        headers: [],
      }))

      const bodyResult = yield* Effect.try({
        try: () => requestObjects.map((obj) => JSON.stringify(obj)).join("\n") + "\n",
        catch: (e) =>
          new RpcClientError({
            message: "Failed to serialize batch request",
            cause: e,
          }),
      })

      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeader("Content-Type", "application/x-ndjson"),
        HttpClientRequest.setHeaders(getHeaders()),
        HttpClientRequest.bodyText(bodyResult),
      )

      // Send the batch request
      const client = yield* HttpClient.HttpClient
      const responseResult = yield* client.execute(request).pipe(
        Effect.catchAll((error) => {
          // On network error, fail all pending requests
          return Effect.forEach(batch, (req) => Deferred.fail(req.deferred, error), {
            discard: true,
          }).pipe(Effect.flatMap(() => Effect.fail(error)))
        }),
      )

      if (responseResult.status >= 400) {
        const error = new RpcResponseError({
          message: `HTTP error: ${responseResult.status}`,
          status: responseResult.status,
        })
        // Fail all requests in the batch
        yield* Effect.forEach(batch, (req) => Deferred.fail(req.deferred, error), { discard: true })
        return
      }

      // Parse NDJSON response - one line per request
      const text = yield* responseResult.text
      const lines = text.trim().split("\n").filter(Boolean)

      // Distribute responses to their corresponding Deferreds
      yield* Effect.forEach(
        batch,
        (req, index) => {
          const line = lines[index]
          if (!line) {
            return Deferred.fail(
              req.deferred,
              new RpcClientError({ message: `Missing response for request ${index}` }),
            )
          }

          return Effect.gen(function* () {
            // Parse the response line
            const rawJson = yield* Effect.try({
              try: () => JSON.parse(line) as unknown,
              catch: (e) =>
                new RpcClientError({ message: `Failed to parse response: ${line}`, cause: e }),
            })

            const decoded = yield* Schema.decodeUnknown(BatchResponseItemSchema)(rawJson).pipe(
              Effect.mapError(
                (e) => new RpcClientError({ message: "Invalid batch response format", cause: e }),
              ),
            )

            // Extract result or error and complete the Deferred
            yield* parseBatchResponseItem(decoded).pipe(
              Effect.matchEffect({
                onSuccess: (value) => Deferred.succeed(req.deferred, value),
                onFailure: (error) => Deferred.fail(req.deferred, error),
              }),
            )
          })
        },
        { discard: true },
      )

      // If there are more requests queued, schedule another flush
      const state = yield* Ref.get(stateRef)
      if (state.queue.length > 0 && !state.scheduled) {
        yield* Ref.update(stateRef, (s) => ({ ...s, scheduled: true }))
        yield* scheduleFlush
      }
    })

    /**
     * Schedule a flush after the batch window expires.
     */
    const scheduleFlush: Effect.Effect<void, never, HttpClient.HttpClient> = Effect.sleep(
      Duration.millis(config.windowMs),
    ).pipe(
      Effect.flatMap(() => flush),
      // Log flush errors but don't propagate to the scheduler
      // Individual request errors are already handled via Deferred.fail
      Effect.catchAll((error) =>
        Effect.logWarning("Batch flush error (ignored)", { error }).pipe(Effect.asVoid),
      ),
      Effect.forkDaemon, // Run in background
      Effect.asVoid,
    )

    const enqueue = (
      rpcName: string,
      input: unknown,
    ): Effect.Effect<unknown, RpcError, HttpClient.HttpClient> =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<unknown, RpcError>()
        const id = yield* generateRequestId

        const request: BatchedRequest = {
          id,
          rpcName,
          input,
          deferred,
        }

        // Add to queue and check if we need to schedule or flush immediately
        const { shouldFlush, shouldSchedule } = yield* Ref.modify(stateRef, (state) => {
          const newQueue = [...state.queue, request]
          const shouldFlush = newQueue.length >= config.maxSize
          const shouldSchedule = !state.scheduled && !shouldFlush

          return [
            { shouldFlush, shouldSchedule },
            {
              queue: newQueue,
              scheduled: state.scheduled || shouldSchedule,
            },
          ]
        })

        if (shouldFlush) {
          // Max batch size reached - flush immediately
          yield* flush.pipe(Effect.forkDaemon, Effect.asVoid)
        } else if (shouldSchedule) {
          // Schedule flush after window
          yield* scheduleFlush
        }

        // Wait for the response
        return yield* Deferred.await(deferred)
      })

    return { enqueue }
  })

// ─────────────────────────────────────────────────────────────────────────────
// Request/Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create RPC request body with safe JSON serialization.
 * Uses Effect.try to properly handle serialization errors.
 */
const createRpcRequestBody = (
  rpcName: string,
  input: unknown,
): Effect.Effect<string, RpcClientError> =>
  Effect.gen(function* () {
    const id = yield* generateRequestId
    return yield* Effect.try({
      try: () =>
        JSON.stringify({
          _tag: "Request",
          id,
          tag: rpcName,
          payload: input ?? {},
          headers: [],
        }) + "\n",
      catch: (e) =>
        new RpcClientError({
          message: `Failed to serialize RPC request for ${rpcName}`,
          cause: e,
        }),
    })
  })

/**
 * Parse a single line of RPC response using Schema validation.
 * Returns Option.some with the result/error, or Option.none to continue parsing.
 *
 * @remarks
 * **Why two-step parsing (JSON.parse + Schema.decodeUnknown)?**
 *
 * We use a two-step approach instead of `Schema.parseJson` because:
 * 1. Different error messages for JSON syntax errors vs schema validation errors
 * 2. Unknown message types can be skipped with `Effect.option` without failing
 * 3. The RPC protocol may include messages we don't recognize (forward compatibility)
 */
const parseRpcLine = <A>(line: string): Effect.Effect<Option.Option<A>, RpcClientError> =>
  Effect.gen(function* () {
    // Step 1: Parse JSON (may fail on syntax errors)
    const rawJson = yield* Effect.try({
      try: () => JSON.parse(line) as unknown,
      catch: (e) => new RpcClientError({ message: `Failed to parse JSON: ${line}`, cause: e }),
    })

    // Step 2: Validate against schema (unknown messages become Option.none)
    const decodeResult = yield* Schema.decodeUnknown(RpcResponseMessageSchema)(rawJson).pipe(
      Effect.mapError(
        (e) => new RpcClientError({ message: `Invalid RPC message format`, cause: e }),
      ),
      Effect.option, // Convert to Option instead of failing
    )

    if (Option.isNone(decodeResult)) {
      // Message doesn't match known response schema - skip it
      return Option.none()
    }

    const msg = decodeResult.value

    if (msg._tag === "Exit") {
      if (msg.exit._tag === "Success") {
        return Option.some(msg.exit.value as A)
      }
      // Failure case
      const cause = msg.exit.cause
      if (cause?._tag === "Fail") {
        return yield* Effect.fail(
          new RpcClientError({ message: "Request failed", cause: cause.error }),
        )
      }
      if (cause?._tag === "Die") {
        const defectMsg = typeof cause.defect === "string" ? cause.defect : "Unexpected error"
        return yield* Effect.fail(new RpcClientError({ message: defectMsg, cause: cause.defect }))
      }
      return yield* Effect.fail(new RpcClientError({ message: "Request failed" }))
    }

    if (msg._tag === "Defect") {
      return yield* Effect.fail(new RpcClientError({ message: msg.defect ?? "Unknown error" }))
    }

    return Option.none()
  })

/**
 * Parse RPC response text (NDJSON format) with Schema validation.
 *
 * @remarks
 * Uses a for-loop with early return for efficiency - we stop parsing
 * as soon as we find the first valid response. A functional approach
 * like `Effect.forEach` + `Array.findFirst` would parse all lines.
 */
const parseRpcResponse = <A>(text: string): Effect.Effect<A, RpcClientError> =>
  Effect.gen(function* () {
    const lines = text.trim().split("\n").filter(Boolean)

    // Early return on first valid response (more efficient than parsing all lines)
    for (const line of lines) {
      const result = yield* parseRpcLine<A>(line)
      if (Option.isSome(result)) {
        return result.value
      }
    }

    return yield* Effect.fail(new RpcClientError({ message: "No response received" }))
  })

// ─────────────────────────────────────────────────────────────────────────────
// RPC Effect Creation
// ─────────────────────────────────────────────────────────────────────────────

interface RpcEffectOptions {
  readonly timeout?: number | undefined
  readonly retry?: RetryConfig | undefined
}

/**
 * Create a retry schedule based on the retry configuration.
 */
const createRetrySchedule = (config: RetryConfig): Schedule.Schedule<number, unknown, never> => {
  const delay = config.delay ?? 1000
  const count = config.count ?? 3

  const baseSchedule =
    config.backoff === "linear"
      ? Schedule.spaced(Duration.millis(delay))
      : Schedule.exponential(Duration.millis(delay))

  return Schedule.compose(baseSchedule, Schedule.recurs(count))
}

const createRpcEffect = <A>(
  url: string,
  rpcName: string,
  input: unknown,
  headers: Record<string, string>,
  options: RpcEffectOptions = {},
): Effect.Effect<A, RpcError, HttpClient.HttpClient> => {
  const baseEffect = Effect.gen(function* () {
    const body = yield* createRpcRequestBody(rpcName, input)

    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/x-ndjson"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyText(body),
    )

    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(request)

    if (response.status >= 400) {
      return yield* Effect.fail(
        new RpcResponseError({
          message: `HTTP error: ${response.status}`,
          status: response.status,
        }),
      )
    }

    const text = yield* response.text
    return yield* parseRpcResponse<A>(text)
  })

  // Apply timeout if configured
  const withTimeout =
    options.timeout !== undefined
      ? baseEffect.pipe(
          Effect.timeoutFail({
            duration: Duration.millis(options.timeout),
            onTimeout: () => new RpcTimeoutError({ rpcName, timeout: options.timeout! }),
          }),
        )
      : baseEffect

  // Apply retry if configured
  const withRetry =
    options.retry !== undefined
      ? withTimeout.pipe(
          Effect.retry({
            schedule: createRetrySchedule(options.retry),
            while: options.retry.retryOn ?? isRetryableError,
          }),
        )
      : withTimeout

  return withRetry
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming RPC
// ─────────────────────────────────────────────────────────────────────────────

type StreamError = RpcError

// Internal stream message types for parsing NDJSON responses
class StreamPart<A> extends Data.TaggedClass("StreamPart")<{ readonly value: A }> {}
class StreamEnd extends Data.TaggedClass("StreamEnd")<NonNullable<unknown>> {}
class StreamSkip extends Data.TaggedClass("StreamSkip")<NonNullable<unknown>> {}

type _StreamMessage<A> = StreamPart<A> | StreamEnd | StreamSkip

const _createStreamEffect = <A>(
  url: string,
  rpcName: string,
  input: unknown,
  headers: Record<string, string>,
): Stream.Stream<A, StreamError, HttpClient.HttpClient> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const body = yield* createRpcRequestBody(rpcName, input)

      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeader("Content-Type", "application/x-ndjson"),
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyText(body),
      )

      const client = yield* HttpClient.HttpClient
      const response = yield* client.execute(request)

      if (response.status >= 400) {
        return Stream.fail<StreamError>(
          new RpcResponseError({
            message: `HTTP error: ${response.status}`,
            status: response.status,
          }),
        )
      }

      const stream: Stream.Stream<A, StreamError, never> = response.stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim().length > 0),
        // Parse each line using two-step approach (see parseRpcLine for rationale)
        Stream.mapEffect((line) =>
          Effect.gen(function* () {
            // Step 1: Parse JSON (may fail on syntax errors)
             
            const rawJson = yield* Effect.try({
               
              try: () => JSON.parse(line),
              catch: (e) =>
                new RpcClientError({ message: `Failed to parse stream line: ${line}`, cause: e }),
            })

            // Step 2: Validate against schema (unknown messages become Option.none)
            const decodeResult = yield* Schema.decodeUnknown(RpcStreamMessageSchema)(rawJson).pipe(
              Effect.option,
            )

            if (Option.isNone(decodeResult)) {
              // Unknown message type - skip it
              return new StreamSkip()
            }

            const msg = decodeResult.value

            if (msg._tag === "StreamPart" || msg._tag === "Part") {
              return new StreamPart({ value: msg.value as A })
            }
            if (msg._tag === "StreamEnd" || msg._tag === "Complete") {
              return new StreamEnd()
            }
            if (msg._tag === "Error" || msg._tag === "Failure") {
              return yield* Effect.fail(
                new RpcClientError({ message: "Stream error", cause: msg.error }),
              )
            }

            return new StreamSkip()
          }),
        ),
        Stream.takeWhile((msg): msg is StreamPart<A> | StreamSkip => msg._tag !== "StreamEnd"),
        Stream.filter((msg): msg is StreamPart<A> => msg._tag === "StreamPart"),
        Stream.map((msg) => msg.value),
        // Type annotation for error - helps TypeScript infer the StreamError union
        // Without this, the error type would be inferred as a complex union
        Stream.mapError((e): StreamError => e),
      )

      return stream
    }),
  )

// ─────────────────────────────────────────────────────────────────────────────
// Client Factory (Internal Implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal implementation of the client factory.
 */
const makeClientImpl = <TRouter extends Router>(
  options: CreateClientOptions,
): TRPCClient<TRouter> => {
  const { url, headers: headerOption, timeout, retry, batch } = options

  const getHeaders = (): Record<string, string> => {
    if (!headerOption) return {}
    if (typeof headerOption === "function") return headerOption()
    return headerOption
  }

  const rpcOptions: RpcEffectOptions = {
    timeout,
    retry,
  }

  // Batching configuration with defaults
  const batchingEnabled = batch?.enabled ?? false
  const batchConfig = {
    maxSize: batch?.maxSize ?? 10,
    windowMs: batch?.windowMs ?? 10,
  }

  // Lazy batcher initialization using memoization
  // The batcher is created once on first use and cached for subsequent calls
  //
  // NOTE: We use a mutable reference here because:
  // 1. Client.make() is a synchronous factory function (returns TRPCClient, not Effect<TRPCClient>)
  // 2. Effect.cached returns Effect<Effect<A>>, requiring the outer effect to be run first
  // 3. We can't run effects in a synchronous context without Effect.runSync (which has its own issues)
  //
  // This is a pragmatic compromise - the batcher itself uses proper Effect patterns internally.
  // A future API could make Client.make() return Effect<TRPCClient> for full Effect-idiomatic usage.
  let batcherInstance: RequestBatcher | null = null
  let batcherCreating: Effect.Effect<RequestBatcher, never, never> | null = null

  /**
   * Get the request batcher (created lazily on first use).
   *
   * @remarks
   * Uses memoization to ensure the batcher is created once and reused.
   * The first call creates the batcher, subsequent calls return the cached instance.
   */
  const getBatcher: Effect.Effect<RequestBatcher, never, never> = Effect.suspend(() => {
    // Fast path: already created
    if (batcherInstance !== null) {
      return Effect.succeed(batcherInstance)
    }

    // Slow path: create or wait for creation
    if (batcherCreating === null) {
      batcherCreating = createRequestBatcher(url, getHeaders, batchConfig).pipe(
        Effect.tap((batcher) =>
          Effect.sync(() => {
            batcherInstance = batcher
          }),
        ),
      )
    }

    return batcherCreating
  })

  /**
   * Creates a recursive proxy that handles nested routers.
   *
   * For a nested router structure like:
   *   router({ user: router({ posts: procedures("posts", { list: ... }) }) })
   *
   * The client access pattern is:
   *   client.procedures.user.posts.list(input)
   *
   * Which resolves to RPC name: "user.posts.list"
   *
   * The proxy tracks the path segments and only creates the RPC call
   * when we reach a procedure invocation (function call).
   */
  const createRecursiveProxy = (pathSegments: string[] = []): any => {
     
    return new Proxy(() => {}, {
      // Handle property access - either navigate deeper or return a procedure caller
      get(_target, prop: string) {
        // Navigate deeper - append the property to path segments
        return createRecursiveProxy([...pathSegments, prop])
      },
      // Handle function call - this is a procedure invocation
      apply(_target, _thisArg, args) {
        // Build the full RPC name from path segments
        // e.g., ["user", "posts", "list"] -> "user.posts.list"
        const rpcName = pathSegments.join(".")
        const input = args[0] as unknown

        let effect: Effect.Effect<unknown, RpcError, HttpClient.HttpClient>

        if (batchingEnabled) {
          // Use batched request
          effect = Effect.gen(function* () {
            const batcher = yield* getBatcher
            const result = yield* batcher.enqueue(rpcName, input)

            // Apply timeout if configured (batched requests handle timeout per-request)
            return result
          })

          // Apply timeout if configured
          if (rpcOptions.timeout !== undefined) {
            effect = effect.pipe(
              Effect.timeoutFail({
                duration: Duration.millis(rpcOptions.timeout),
                onTimeout: () => new RpcTimeoutError({ rpcName, timeout: rpcOptions.timeout! }),
              }),
            )
          }

          // Apply retry if configured
          if (rpcOptions.retry !== undefined) {
            effect = effect.pipe(
              Effect.retry({
                schedule: createRetrySchedule(rpcOptions.retry),
                while: rpcOptions.retry.retryOn ?? isRetryableError,
              }),
            )
          }
        } else {
          // Use direct request (existing behavior)
          effect = createRpcEffect(url, rpcName, input, getHeaders(), rpcOptions)
        }

        return options.httpClient ? Effect.provide(effect, options.httpClient) : effect
      },
    })
  }

  const createProceduresProxy = (): RouterClient<TRouter["routes"]> => {
    return createRecursiveProxy() as RouterClient<TRouter["routes"]>
  }

  return {
    procedures: createProceduresProxy(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client namespace providing factory functions for creating tRPC clients.
 *
 * @example
 * ```ts
 * import { Client } from 'effect-trpc'
 * import { FetchHttpClient } from '@effect/platform'
 * import type { appRouter } from './server/trpc'
 *
 * const client = Client.make<typeof appRouter>({
 *   url: 'http://localhost:3000/api/trpc',
 * })
 *
 * // Run with HttpClient provided (browser)
 * const program = client.procedures.user.list().pipe(
 *   Effect.provide(FetchHttpClient.layer),
 * )
 *
 * const users = await Effect.runPromise(program)
 * ```
 *
 * @since 0.1.0
 * @category Client
 */
export const Client = {
  /**
   * Create a vanilla (non-React) tRPC client.
   *
   * Returns Effects that require HttpClient in their environment.
   * Provide HttpClient.layer to run them.
   *
   * @remarks
   * **Current Limitation: Stream/Chat Procedures**
   *
   * The vanilla client currently treats all procedures as query/mutation (returning Effect).
   * This is because the client proxy doesn't have access to procedure definitions at runtime -
   * it only has type information.
   *
   * For stream/chat procedures, use the React client with `useStream`/`useChat` hooks,
   * or call the server's RPC endpoint directly with `createStreamEffect`.
   *
   * **TODO:** Add explicit method calls like `client.stream("user.feed", input)` for
   * stream support in the vanilla client.
   *
   * @example
   * ```ts
   * import { Client } from 'effect-trpc'
   * import { FetchHttpClient } from '@effect/platform'
   * import { NodeHttpClient } from '@effect/platform-node'
   * import type { appRouter } from './server/trpc'
   *
   * const client = Client.make<typeof appRouter>({
   *   url: 'http://localhost:3000/api/trpc',
   * })
   *
   * // Run with HttpClient provided (Node.js)
   * const program = client.procedures.user.list().pipe(
   *   Effect.provide(NodeHttpClient.layer),
   * )
   *
   * // Or in browser
   * const browserProgram = client.procedures.user.list().pipe(
   *   Effect.provide(FetchHttpClient.layer),
   * )
   *
   * const users = await Effect.runPromise(program)
   * ```
   *
   * @since 0.1.0
   * @category Client
   */
  make: <TRouter extends Router>(options: CreateClientOptions): TRPCClient<TRouter> =>
    makeClientImpl<TRouter>(options),
}
