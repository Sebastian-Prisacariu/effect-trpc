/**
 * @module effect-trpc
 * 
 * tRPC-style ergonomics for Effect-based applications.
 */

// Core
export {
  procedure,
  procedures,
  Router,
  type ProcedureBuilder,
  type ProcedureDefinition,
  type ProcedureMeta,
  type ProcedureType,
  type ProceduresGroup,
  type ProcedureRecord,
  type ProceduresService,
  type RouterDefinition,
  type RouterRecord,
  type RouterClient,
  type InferInput,
  type InferOutput,
} from "./core/index.js"

// Server
export { createRouteHandler, type HandlerConfig } from "./server/index.js"
