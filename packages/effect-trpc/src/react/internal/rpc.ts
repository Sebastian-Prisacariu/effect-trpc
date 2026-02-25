/**
 * @module effect-trpc/react/internal/rpc
 * @internal
 *
 * Internal RPC implementation for React client.
 * Contains RPC request/response handling, schemas, and streaming logic.
 */

import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Data from "effect/Data"
import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import * as Clock from "effect/Clock"
import * as Random from "effect/Random"
import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientRequest from "@effect/platform/HttpClientRequest"
import type * as HttpClientError from "@effect/platform/HttpClientError"
import { RpcClientError, RpcResponseError } from "../../core/client.js"

// ─────────────────────────────────────────────────────────────────────────────
// Request ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branded type for RPC request IDs.
 * @internal
 */
const RequestId = Schema.String.pipe(Schema.brand("RequestId"))
type RequestId = typeof RequestId.Type

/**
 * Generate a unique request ID.
 * @internal
 */
export const generateRequestId: Effect.Effect<RequestId> = Effect.gen(function* () {
  const timestamp = yield* Clock.currentTimeMillis
  const random = yield* Random.nextIntBetween(0, 1000000)
  return (String(timestamp) + String(random).padStart(6, "0")) as RequestId
})

// ─────────────────────────────────────────────────────────────────────────────
// RPC Message Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for the Cause structure in failure responses.
 * @internal
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
 * @internal
 */
const RpcExitSuccessSchema = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Unknown,
})

/**
 * Schema for failed exit in RPC responses.
 * @internal
 */
const RpcExitFailureSchema = Schema.Struct({
  _tag: Schema.Literal("Failure"),
  cause: Schema.optional(RpcCauseSchema),
})

/**
 * Schema for Exit message wrapper.
 * @internal
 */
const RpcExitMessageSchema = Schema.Struct({
  _tag: Schema.Literal("Exit"),
  exit: Schema.Union(RpcExitSuccessSchema, RpcExitFailureSchema),
})

/**
 * Schema for Defect messages.
 * @internal
 */
const RpcDefectMessageSchema = Schema.Struct({
  _tag: Schema.Literal("Defect"),
  defect: Schema.optional(Schema.String),
})

/**
 * Schema for stream part messages.
 * @internal
 */
const RpcStreamPartSchema = Schema.Struct({
  _tag: Schema.Union(Schema.Literal("StreamPart"), Schema.Literal("Part")),
  value: Schema.Unknown,
})

/**
 * Schema for stream end messages.
 * @internal
 */
const RpcStreamEndSchema = Schema.Struct({
  _tag: Schema.Union(Schema.Literal("StreamEnd"), Schema.Literal("Complete")),
})

/**
 * Schema for stream error messages.
 * @internal
 */
const RpcStreamErrorSchema = Schema.Struct({
  _tag: Schema.Union(Schema.Literal("Error"), Schema.Literal("Failure")),
  error: Schema.optional(Schema.Unknown),
})

/**
 * Union of all RPC response message types.
 * @internal
 */
const RpcResponseMessageSchema = Schema.Union(RpcExitMessageSchema, RpcDefectMessageSchema)

/**
 * Union of all stream message types.
 * @internal
 */
const RpcStreamMessageSchema = Schema.Union(
  RpcStreamPartSchema,
  RpcStreamEndSchema,
  RpcStreamErrorSchema,
)

// ─────────────────────────────────────────────────────────────────────────────
// Chat Part Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for chat parts that contain text.
 * @internal
 */
const TextPartSchema = Schema.Struct({ text: Schema.String })

/**
 * Extract text from a chat part if it has a text property.
 * @internal
 */
export const extractTextFromPart = (part: unknown): Option.Option<string> => {
  const result = Schema.decodeUnknownOption(TextPartSchema)(part)
  return Option.map(result, (p) => p.text)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracing Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for tracing spans in RPC calls.
 * @internal
 */
export interface TracingConfig {
  readonly enabled?: boolean
  readonly spanPrefix?: string
  readonly spanName?: (procedurePath: string) => string
  readonly includeInput?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Request/Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely stringify a value to JSON.
 * @internal
 */
export const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === "bigint") {
        return `[BigInt:${val.toString()}]`
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return val
    })
  } catch {
    return "[Unserializable]"
  }
}

/**
 * Create RPC request body with safe JSON serialization.
 * @internal
 */
export const createRpcRequestBody = (
  rpcName: string,
  input: unknown,
): Effect.Effect<string, RpcClientError> =>
  Effect.gen(function* () {
    const requestId = yield* generateRequestId
    return yield* Effect.try({
      try: () =>
        JSON.stringify({
          _tag: "Request",
          id: requestId,
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
 * @internal
 */
export const parseRpcLine = <A>(line: string): Effect.Effect<Option.Option<A>, RpcClientError> =>
  Effect.gen(function* () {
    // First, parse the JSON
    const rawJson: unknown = yield* Effect.try({
      try: () => JSON.parse(line) as unknown,
      catch: (e) => new RpcClientError({ message: `Failed to parse JSON: ${line}`, cause: e }),
    })

    // Try to decode as a response message using Schema
    const decodeResult = yield* Schema.decodeUnknown(RpcResponseMessageSchema)(rawJson).pipe(
      Effect.mapError(
        (e) => new RpcClientError({ message: `Invalid RPC message format`, cause: e }),
      ),
      Effect.option,
    )

    if (Option.isNone(decodeResult)) {
      return Option.none()
    }

    const msg = decodeResult.value

    if (msg._tag === "Exit") {
      if (msg.exit._tag === "Success") {
        return Option.some(msg.exit.value as A)
      }
      const cause = msg.exit.cause
      if (cause?._tag === "Fail") {
        // Preserve typed errors so Effect.catchTag works
        // If the error has a _tag property, return it directly
        const error = cause.error
        if (
          typeof error === "object" &&
          error !== null &&
          "_tag" in error &&
          typeof (error as { _tag: unknown })._tag === "string"
        ) {
          return yield* Effect.fail(error as RpcClientError)
        }
        return yield* Effect.fail(new RpcClientError({ message: "Request failed", cause: error }))
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
 * Parse RPC response text (NDJSON format).
 * @internal
 */
export const parseRpcResponse = <A>(text: string): Effect.Effect<A, RpcClientError> =>
  Effect.gen(function* () {
    const lines = text.trim().split("\n").filter(Boolean)

    for (const line of lines) {
      const result = yield* parseRpcLine<A>(line)
      if (Option.isSome(result)) {
        return result.value
      }
    }

    return yield* Effect.fail(new RpcClientError({ message: "No response received" }))
  })

// ─────────────────────────────────────────────────────────────────────────────
// RPC Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Effect that executes an RPC call.
 * @internal
 */
export const createRpcEffect = <A>(
  url: string,
  procedurePath: string,
  input: unknown,
  tracing?: TracingConfig,
): Effect.Effect<
  A,
  RpcClientError | RpcResponseError | HttpClientError.HttpClientError,
  HttpClient.HttpClient
> => {
  // Handle deeply nested paths like "user.posts.list" or "admin.settings.update"
  // The procedure name is always the last segment, the rest is the group path
  const parts = procedurePath.split(".")
  const procedureName = parts.pop()
  const groupPath = parts.join(".")

  if (!groupPath || !procedureName) {
    return Effect.fail(new RpcClientError({ message: `Invalid procedure path: ${procedurePath}` }))
  }

  const rpcName = `${groupPath}.${procedureName}`

  const effect = Effect.gen(function* () {
    const body = yield* createRpcRequestBody(rpcName, input)
    const request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/x-ndjson"),
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

  if (tracing?.enabled) {
    const spanName = tracing.spanName
      ? tracing.spanName(procedurePath)
      : `${tracing.spanPrefix ?? "trpc.client"}.${procedurePath}`

    return effect.pipe(
      Effect.withSpan(spanName, {
        attributes: tracing.includeInput ? { "rpc.input": safeStringify(input) } : undefined,
      }),
    )
  }

  return effect
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming RPC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error type for React stream operations.
 * @internal
 */
export type ReactStreamError = RpcClientError | RpcResponseError | HttpClientError.HttpClientError

/**
 * Internal stream message types for parsing NDJSON responses.
 * @internal
 */
class StreamPart<A> extends Data.TaggedClass("StreamPart")<{ readonly value: A }> {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
class StreamEnd extends Data.TaggedClass("StreamEnd")<{}> {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
class StreamSkip extends Data.TaggedClass("StreamSkip")<{}> {}

type _StreamMessage<A> = StreamPart<A> | StreamEnd | StreamSkip

/**
 * Create a Stream that reads from a streaming RPC endpoint.
 * @internal
 */
export const createStreamEffect = <A>(
  url: string,
  procedurePath: string,
  input: unknown,
): Stream.Stream<A, ReactStreamError, HttpClient.HttpClient> => {
  // Handle deeply nested paths like "user.posts.list" or "admin.settings.update"
  // The procedure name is always the last segment, the rest is the group path
  const parts = procedurePath.split(".")
  const procedureName = parts.pop()
  const groupPath = parts.join(".")

  if (!groupPath || !procedureName) {
    return Stream.fail<ReactStreamError>(
      new RpcClientError({ message: `Invalid procedure path: ${procedurePath}` }),
    )
  }

  const rpcName = `${groupPath}.${procedureName}`

  return Stream.unwrap(
    Effect.gen(function* () {
      const body = yield* createRpcRequestBody(rpcName, input)
      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeader("Content-Type", "application/x-ndjson"),
        HttpClientRequest.bodyText(body),
      )

      const client = yield* HttpClient.HttpClient
      const response = yield* client.execute(request)

      if (response.status >= 400) {
        return Stream.fail<ReactStreamError>(
          new RpcResponseError({
            message: `HTTP error: ${response.status}`,
            status: response.status,
          }),
        )
      }

      const stream: Stream.Stream<A, ReactStreamError, never> = response.stream.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim().length > 0),
        Stream.mapEffect((line) =>
          Effect.gen(function* () {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const rawJson = yield* Effect.try({
              // eslint-disable-next-line @typescript-eslint/no-unsafe-return
              try: () => JSON.parse(line),
              catch: (e) =>
                new RpcClientError({ message: `Failed to parse stream line: ${line}`, cause: e }),
            })

            const decodeResult = yield* Schema.decodeUnknown(RpcStreamMessageSchema)(rawJson).pipe(
              Effect.option,
            )

            if (Option.isNone(decodeResult)) {
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
              // Preserve typed errors so Effect.catchTag works
              const error = msg.error
              if (
                typeof error === "object" &&
                error !== null &&
                "_tag" in error &&
                typeof (error as { _tag: unknown })._tag === "string"
              ) {
                return yield* Effect.fail(error as RpcClientError)
              }
              return yield* Effect.fail(
                new RpcClientError({ message: "Stream error", cause: error }),
              )
            }

            return new StreamSkip()
          }),
        ),
        Stream.takeWhile((msg): msg is StreamPart<A> | StreamSkip => msg._tag !== "StreamEnd"),
        Stream.filter((msg): msg is StreamPart<A> => msg._tag === "StreamPart"),
        Stream.map((msg) => msg.value),
      )

      return stream
    }),
  )
}
