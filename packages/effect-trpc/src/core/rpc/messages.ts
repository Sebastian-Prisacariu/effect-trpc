/**
 * @module effect-trpc/core/rpc/messages
 *
 * Shared wire protocol schemas used by core and react clients.
 */

import * as Schema from "effect/Schema"

/**
 * Branded type for RPC request IDs.
 */
export const RequestIdSchema = Schema.String.pipe(Schema.brand("RequestId"))
export type RequestId = typeof RequestIdSchema.Type

/**
 * Schema for Effect Cause-like payloads encoded by RPC failures.
 */
export const RpcCauseSchema = Schema.Union(
  Schema.TaggedStruct("Fail", {
    error: Schema.Unknown,
  }),
  Schema.TaggedStruct("Die", {
    defect: Schema.Unknown,
  }),
  Schema.TaggedStruct("Interrupt", {
    fiberId: Schema.optional(Schema.Unknown),
  }),
)

export type RpcCause = typeof RpcCauseSchema.Type

/**
 * Schema for successful exit payloads.
 */
export const RpcExitSuccessSchema = Schema.TaggedStruct("Success", {
  value: Schema.Unknown,
})

/**
 * Schema for failed exit payloads.
 */
export const RpcExitFailureSchema = Schema.TaggedStruct("Failure", {
  cause: Schema.optional(RpcCauseSchema),
})

/**
 * Schema for tagged Exit wrapper messages.
 */
export const RpcExitMessageSchema = Schema.TaggedStruct("Exit", {
  exit: Schema.Union(RpcExitSuccessSchema, RpcExitFailureSchema),
})

/**
 * Schema for defect wrapper messages.
 */
export const RpcDefectMessageSchema = Schema.TaggedStruct("Defect", {
  defect: Schema.optional(Schema.String),
})

/**
 * Union of all non-stream response messages.
 */
export const RpcResponseMessageSchema = Schema.Union(RpcExitMessageSchema, RpcDefectMessageSchema)
export type RpcResponseMessage = typeof RpcResponseMessageSchema.Type

/**
 * Schema for stream part messages.
 */
export const RpcStreamPartSchema = Schema.TaggedStruct("StreamPart", {
  value: Schema.Unknown,
})

/**
 * Legacy alias for stream part messages.
 */
export const RpcPartSchema = Schema.TaggedStruct("Part", {
  value: Schema.Unknown,
})

/**
 * Schema for stream completion messages.
 */
export const RpcStreamEndSchema = Schema.TaggedStruct("StreamEnd", {})

/**
 * Legacy alias for stream completion messages.
 */
export const RpcCompleteSchema = Schema.TaggedStruct("Complete", {})

/**
 * Schema for stream error messages.
 */
export const RpcStreamErrorSchema = Schema.TaggedStruct("Error", {
  error: Schema.optional(Schema.Unknown),
})

/**
 * Legacy alias for stream error messages.
 */
export const RpcFailureSchema = Schema.TaggedStruct("Failure", {
  error: Schema.optional(Schema.Unknown),
})

/**
 * Schema for stream keep-alive messages.
 */
export const RpcKeepAliveSchema = Schema.TaggedStruct("KeepAlive", {})

/**
 * Union of all stream message variants.
 */
export const RpcStreamMessageSchema = Schema.Union(
  RpcStreamPartSchema,
  RpcPartSchema,
  RpcStreamEndSchema,
  RpcCompleteSchema,
  RpcStreamErrorSchema,
  RpcFailureSchema,
  RpcKeepAliveSchema,
)
export type RpcStreamMessage = typeof RpcStreamMessageSchema.Type
