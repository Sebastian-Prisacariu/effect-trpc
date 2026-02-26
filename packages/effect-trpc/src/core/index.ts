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

export { procedures, UnsubscribeReason as UnsubscribeReasonCtor } from "./procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

export {
  Router,
  RouterValidationError,
  extractMetadata,
  isRouter,
  isProceduresGroup,
  isProvidedRouter,
} from "./router.js"

export type {
  RouterValidationError as RouterValidationErrorType,
  RouterRecord,
  Router as RouterType,
  ToHttpLayerOptions,
  ToHttpHandlerOptions,
  ProvidedRouter,
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
  // Builder function
  Middleware,
  // Type guards
  isMiddlewareDefinition,
  MiddlewareDefinitionTypeId,
  // Built-in middleware definitions
  LoggingMiddleware,
  TimingMiddleware,
  AuthMiddleware,
  RequirePermissionMiddleware,
  RateLimitMiddleware,
  // Built-in middleware layers
  LoggingMiddlewareLive,
  TimingMiddlewareLive,
  createAuthMiddlewareLive,
  createRequirePermissionMiddlewareLive,
  createRateLimitMiddlewareLive,
  // Errors
  MiddlewareTimeoutError,
  MiddlewareRateLimitError,
  MiddlewareAuthError,
  MiddlewarePermissionError,
  // Context utilities
  MiddlewareContextRef,
  getMiddlewareContext,
  requireMiddlewareContext,
} from "./middleware.js"

export type {
  // Context types
  BaseContext,
  AuthenticatedContext,
  // Middleware types
  MiddlewareDefinition,
  MiddlewareBuilder,
  MiddlewareService,
  // Type extraction
  MiddlewareInput,
  MiddlewareError,
  MiddlewareContextOut,
  MiddlewareContextIn,
  // Options
  RateLimitOptions,
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
  LoggerConfig,
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
