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
export {
  type SecurityHeadersOptions,
  DEFAULT_SECURITY_HEADERS,
  buildSecurityHeaders,
  addSecurityHeaders,
} from "./security-headers.js"
export {
  // Types
  type LogCategory,
  type TrpcLoggerConfig,
  type TrpcLogEvent,
  type TrpcLoggerService,
  // Service Tag
  TrpcLogger,
  // Configuration
  defaultConfig as defaultLoggerConfig,
  // Layers
  makeTrpcLoggerLayer,
  TrpcLoggerLive,
  TrpcLoggerDev,
  TrpcLoggerProd,
  TrpcLoggerSilent,
  // Utilities
  redactSensitiveData,
  generateRequestId,
  // Convenience functions
  logQuery,
  logMutation,
  logTrpcEvent,
  // Re-export Logger for convenience
  Logger,
} from "./logging.js"
