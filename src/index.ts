/**
 * @module effect-trpc
 * 
 * tRPC-style ergonomics for Effect RPC + Effect Atom.
 */

// Shared (re-export Effect RPC for convenience)
export { Rpc, RpcGroup, Schema } from "./shared/index.js"

// Server
export { createRouteHandler, type RouteHandlerConfig } from "./server/handler.js"

// Client
export {
  createClient,
  Result,
  type ClientConfig,
  type UseQueryResult,
  type UseMutationResult,
} from "./client/index.js"
