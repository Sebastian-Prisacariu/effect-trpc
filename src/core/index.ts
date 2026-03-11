/**
 * @module effect-trpc/core
 * 
 * Core types and builders for effect-trpc.
 */

export {
  procedure,
  type ProcedureBuilder,
  type ProcedureDefinition,
  type ProcedureMeta,
  type ProcedureType,
  type InferInput,
  type InferOutput,
  type InferType,
} from "./procedure.js"

export {
  procedures,
  type ProceduresGroup,
  type ProcedureRecord,
  type ProceduresService,
  type HandlersFor,
  type ProcedureHandler,
  isProceduresGroup,
} from "./procedures.js"

export {
  Router,
  type RouterDefinition,
  type RouterRecord,
  type RouterEntry,
  type RouterClient,
  type FlattenRouter,
  getProcedurePaths,
  getProcedure,
} from "./router.js"
