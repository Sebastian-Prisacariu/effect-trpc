/**
 * @module effect-trpc/core/rpc
 *
 * RPC-focused module surface: bridge utilities, message schemas, and errors.
 */

export * from "./messages.js"
export * from "./errors.js"

export {
  VerifiedRpc,
  procedureToRpc,
  proceduresGroupToRpcGroup,
  convertHandlers,
  createRpcComponents,
} from "../server/internal/bridge.js"

export type {
  AnyRpc,
  VerifiedRpc as VerifiedRpcType,
  ProcedureToRpc,
  ProceduresToRpcs,
  InferRpcHandler,
  RpcHandlerOptions,
  CreateServerLayerOptions,
  GroupRpcs,
  GroupHandlers,
} from "../server/internal/bridge.js"
