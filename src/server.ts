/**
 * effect-trpc/server - Server-side exports
 * 
 * Import this in server code (API routes, Server Components)
 * 
 * @since 1.0.0
 * 
 * @example
 * ```ts
 * // app/api/trpc/[...trpc]/route.ts
 * import { Server } from "effect-trpc/server"
 * import { AppRouter } from "@/lib/router"
 * import { LiveLayer } from "@/lib/layers"
 * 
 * export const { GET, POST } = Server.createRouteHandler(AppRouter, {
 *   layer: LiveLayer,
 * })
 * ```
 */

export * as Server from "./Server.js"

// Re-export core modules needed for server-side use
export * as Procedure from "./Procedure.js"
export * as Router from "./Router.js"
