/**
 * effect-trpc/client entry point
 * @module
 */

export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Client from "./Client/index.js"
export * as Transport from "./Transport/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"
export * as Reactivity from "./Reactivity/index.js"
export * as SSR from "./SSR/index.js"
export * as Optimistic from "./Optimistic/index.js"

export type {
  InferProcedurePayload,
  InferProcedureSuccess,
  InferProcedureError,
  InferMutationInvalidates,
  InferRouterPaths,
  InferRouterDefinition,
  InferRouterProcedure,
  TransportRequest,
  TransportResponse,
  TransportError,
  MiddlewareRequest,
  ProcedureType,
  PathReactivityService,
} from "./types.js"
