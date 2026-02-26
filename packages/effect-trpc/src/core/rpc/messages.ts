/**
 * @module effect-trpc/core/rpc/messages
 *
 * Core RPC message schemas for effect-trpc.
 * These schemas define the wire protocol between client and server.
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Request ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Branded type for RPC request IDs.
 * Ensures request IDs are not confused with other string types.
 */
export const RequestIdSchema = Schema.String.pipe(Schema.brand("RequestId"))
export type RequestId = typeof RequestIdSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Request Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for standard RPC requests.
 */
export const RpcRequestSchema = Schema.TaggedStruct("Request", {
  id: RequestIdSchema,
  tag: Schema.String,
  payload: Schema.Unknown,
  headers: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
})

export type RpcRequest = typeof RpcRequestSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Response Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for the Cause structure in failure responses.
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
 * Schema for successful exit in RPC responses.
 */
export const RpcExitSuccessSchema = Schema.TaggedStruct("Success", {
  value: Schema.Unknown,
})

/**
 * Schema for failed exit in RPC responses.
 */
export const RpcExitFailureSchema = Schema.TaggedStruct("Failure", {
  cause: Schema.optional(RpcCauseSchema),
})

/**
 * Schema for Exit message wrapper.
 */
export const RpcExitMessageSchema = Schema.TaggedStruct("Exit", {
  exit: Schema.Union(RpcExitSuccessSchema, RpcExitFailureSchema),
})

/**
 * Schema for Defect messages.
 */
export const RpcDefectMessageSchema = Schema.TaggedStruct("Defect", {
  defect: Schema.optional(Schema.String),
})

/**
 * Union of all RPC response message types.
 */
export const RpcResponseMessageSchema = Schema.Union(RpcExitMessageSchema, RpcDefectMessageSchema)

export type RpcResponseMessage = typeof RpcResponseMessageSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Stream Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for stream part messages.
 */
export const RpcStreamPartSchema = Schema.Union(
  Schema.TaggedStruct("StreamPart", { value: Schema.Unknown }),
  Schema.TaggedStruct("Part", { value: Schema.Unknown })
)

/**
 * Schema for stream end messages.
 */
export const RpcStreamEndSchema = Schema.Union(
  Schema.TaggedStruct("StreamEnd", {}),
  Schema.TaggedStruct("Complete", {})
)

/**
 * Schema for stream error messages.
 */
export const RpcStreamErrorSchema = Schema.Union(
  Schema.TaggedStruct("Error", { error: Schema.optional(Schema.Unknown) }),
  Schema.TaggedStruct("Failure", { error: Schema.optional(Schema.Unknown) })
)

/**
 * Schema for keep-alive messages.
 *
 * Keep-alive messages are sent by the server every 15 seconds during stream/chat/subscription
 * procedures to prevent proxies and load balancers from closing idle connections.
 *
 * These messages use a fixed format (not user data) and are filtered out on the client side -
 * they never reach user code.
 */
export const RpcKeepAliveSchema = Schema.TaggedStruct("KeepAlive", {})

/**
 * Union of all stream message types.
 *
 * Includes keep-alive messages which are filtered out before reaching user code.
 */
export const RpcStreamMessageSchema = Schema.Union(
  RpcStreamPartSchema,
  RpcStreamEndSchema,
  RpcStreamErrorSchema,
  RpcKeepAliveSchema,
)

export type RpcStreamMessage = typeof RpcStreamMessageSchema.Type
