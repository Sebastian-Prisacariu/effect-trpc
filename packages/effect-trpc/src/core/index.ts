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
  TaggedErrorClass as ProcedureTaggedErrorClass,
  ProcedureImplementation,
  ProcedureImplementationTag,
  // Type inference helpers
  InferProcedureContext,
  InferProcedureInput,
  InferProcedureOutput,
  InferProcedureError,
  InferProcedureMiddlewareR,
  InferProcedureProvides,
} from "./server/procedure.js"

export { Procedure } from "./server/procedure.js"

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
} from "./server/procedures.js"

export { Procedures, UnsubscribeReason as UnsubscribeReasonCtor } from "./server/procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export {
  Router,
  RouterValidationError,
  extractMetadata,
  isRouter,
  isProceduresGroup,
} from "./server/router.js"

export type {
  RouterValidationError as RouterValidationErrorType,
  RouterRecord,
  Router as RouterType,
  ToHttpLayerOptions,
  ToHttpHandlerOptions,
  HttpHandler,
  ProcedureMetadata,
  MetadataRegistry,
  ExtractProcedures,
  ExtractRpcGroups,
  InferInput,
  InferOutput,
  InferError,
  InferRequirements,
  InferProvides,
  AnyProceduresGroup,
  AnyRouter,
  RouterEntry,
} from "./server/router.js"

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
} from "./rpc/index.js"

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
} from "./rpc/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

export {
  Middleware,
  MiddlewareTimeoutError,
  MiddlewareRateLimitError,
  MiddlewareAuthError,
  MiddlewarePermissionError,
} from "./server/middleware.js"

export type {
  BaseContext,
  AuthenticatedContext,
  MiddlewareBuilder,
  TaggedErrorClass as MiddlewareTaggedErrorClass,
  MiddlewareImplementation,
  Middleware as MiddlewareType,
  MiddlewareProvides,
} from "./server/middleware.js"

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
} from "./client/index.js"

export type {
  RetryConfig,
  BatchConfig,
  LoggerConfig,
  CreateClientOptions,
  RpcClientErrorTypeId as RpcClientErrorTypeIdType,
  RpcResponseErrorTypeId as RpcResponseErrorTypeIdType,
  RpcTimeoutErrorTypeId as RpcTimeoutErrorTypeIdType,
  TRPCClient,
  RpcError,
} from "./client/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types (Branded IDs)
// ─────────────────────────────────────────────────────────────────────────────

export { ClientId, SubscriptionId } from "./types.js"
export type { ClientId as ClientIdType, SubscriptionId as SubscriptionIdType } from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Gate (Flow Control)
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Namespace with all functions
  Gate,
  // Error
  GateClosedError,
  GateErrorTypeId,
  // Type guard
  isGate,
} from "./gate/index.js"

export type { ClosedBehavior, GateState, GateInstance, GateOptions } from "./gate/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Network (Online/Offline Detection)
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Service Tag
  Network,
  // Layers
  NetworkBrowserLive,
  NetworkAlwaysOnline,
  // Convenience accessors
  isOnline as networkIsOnline,
  getState as networkGetState,
  awaitOnline as networkAwaitOnline,
  awaitOffline as networkAwaitOffline,
  whenOnline as networkWhenOnline,
  whenOffline as networkWhenOffline,
  // Errors
  NetworkOfflineError,
  NetworkErrorTypeId,
} from "./network/index.js"

export type { NetworkState, NetworkDetector, NetworkService } from "./network/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Architecture Namespaces
// ─────────────────────────────────────────────────────────────────────────────

export * as ServerCore from "./server/index.js"
export * as ClientCore from "./client/index.js"
export * as RpcCore from "./rpc/index.js"
