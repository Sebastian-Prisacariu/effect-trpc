/**
 * @module effect-trpc/core
 *
 * Core exports for effect-trpc: procedure definition, router, and errors.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Procedure
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ProcedureBuilder,
  ProcedureDefinition,
  ProcedureType,
  // Type inference helpers
  InferProcedureContext,
  InferProcedureInput,
  InferProcedureOutput,
  InferProcedureError,
  InferProcedureMiddlewareR,
  InferProcedureProvides,
} from "./procedure.js"

export { procedure } from "./procedure.js"

// ─────────────────────────────────────────────────────────────────────────────
// Procedures (Groups)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ProceduresGroup,
  ProcedureRecord,
  ProceduresService,
  InferHandler,
  InferHandlers,
  // Requirements and error extraction
  HandlersRequirements,
  ProceduresMiddlewareR,
  ProceduresError,
  ProceduresProvides,
  EffectiveHandlerRequirements,
  // Subscription types
  SubscriptionHandler,
  SubscriptionContext,
  UnsubscribeReason,
} from "./procedures.js"

export {
  procedures,
  UnsubscribeReason as UnsubscribeReasonCtor,
} from "./procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export {
  Router,
  RouterValidationError,
  extractMetadata,
  isRouter,
  isProceduresGroup,
} from "./router.js"

export type {
  RouterValidationError as RouterValidationErrorType,
  RouterRecord,
  Router as RouterType,
  ToHttpLayerOptions,
  ProcedureMetadata,
  MetadataRegistry,
  ExtractProcedures,
  ExtractRpcGroups,
  InferInput,
  InferOutput,
  AnyProceduresGroup,
  AnyRouter,
  RouterEntry,
} from "./router.js"

// ─────────────────────────────────────────────────────────────────────────────
// RPC Bridge (advanced usage)
// ─────────────────────────────────────────────────────────────────────────────

export {
  RpcBridgeValidationError,
  VerifiedRpc,
  procedureToRpc,
  proceduresGroupToRpcGroup,
  convertHandlers,
  createRpcComponents,
} from "./rpc-bridge.js"

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
} from "./rpc-bridge.js"

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

export {
  Middleware,
  middlewareWithProvides,
  composeMiddleware,
  loggingMiddleware,
  timingMiddleware,
  timeoutMiddleware,
  rateLimitMiddleware,
  authMiddleware,
  requirePermission,
  MiddlewareTimeoutError,
  MiddlewareRateLimitError,
  MiddlewareAuthError,
  MiddlewarePermissionError,
  MiddlewareContextRef,
  getMiddlewareContext,
  requireMiddlewareContext,
  // Service-providing middleware (v0.2.0)
  ServiceMiddlewareTypeId,
  isServiceMiddleware,
  serviceMiddleware,
} from "./middleware.js"

export type {
  BaseContext,
  AuthenticatedContext,
  MiddlewareFn,
  Middleware as MiddlewareType,
  MiddlewareProvides,
  RateLimitOptions,
  // Service-providing middleware types (v0.2.0)
  ServiceMiddleware,
  ServiceMiddlewareService,
} from "./middleware.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

export {
  Client,
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
} from "./client.js"

export type {
  RetryConfig,
  BatchConfig,
  CreateClientOptions,
  RpcClientErrorTypeId as RpcClientErrorTypeIdType,
  RpcResponseErrorTypeId as RpcResponseErrorTypeIdType,
  RpcTimeoutErrorTypeId as RpcTimeoutErrorTypeIdType,
  TRPCClient,
  RpcError,
} from "./client.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types (Branded IDs)
// ─────────────────────────────────────────────────────────────────────────────

export { ClientId, SubscriptionId } from "./types.js"
export type { ClientId as ClientIdType, SubscriptionId as SubscriptionIdType } from "./types.js"
