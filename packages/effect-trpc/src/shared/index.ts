/**
 * @module effect-trpc/shared
 *
 * Internal shared utilities for adapters.
 * These are not part of the public API.
 */

export { type CorsOptions, buildCorsHeaders } from "./cors.js"
export {
  type CreateRpcWebHandlerOptions,
  type RpcWebHandler,
  createRpcWebHandler,
} from "./rpc-handler.js"
