/**
 * @module effect-trpc/core/rpc/errors
 *
 * Errors related to RPC transport and wire protocol handling.
 */

import * as Schema from "effect/Schema"

/**
 * Error for serialization / deserialization failures in RPC payloads.
 */
export class SerializationError extends Schema.TaggedError<SerializationError>()(
  "SerializationError",
  { message: Schema.String },
) {}

export {
  RpcBridgeValidationError,
} from "../server/internal/bridge.js"

export {
  RpcClientError,
  RpcResponseError,
  RpcTimeoutError,
  RpcClientErrorTypeId,
  RpcResponseErrorTypeId,
  RpcTimeoutErrorTypeId,
  isRpcClientError,
  isRpcResponseError,
  isRpcTimeoutError,
  isRpcError,
  isRetryableError,
} from "../client/index.js"
