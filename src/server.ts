/**
 * effect-trpc/server entry point
 * @module
 */

// Re-export core modules
export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"

// Server-specific exports
export * as Server from "./Server/index.js"
export { createRouteHandler, createHandler, createCaller } from "./Server/index.js"
