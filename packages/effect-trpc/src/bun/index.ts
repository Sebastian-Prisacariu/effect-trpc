/**
 * @module effect-trpc/bun
 *
 * Bun adapter for effect-trpc.
 * Provides both HTTP and WebSocket server support.
 *
 * For smaller bundle sizes, you can import from subpaths:
 * - `effect-trpc/bun/http` - HTTP only
 * - `effect-trpc/bun/ws` - WebSocket only
 *
 * @example HTTP Server
 * ```ts
 * import { createServer, createFetchHandler } from "effect-trpc/bun"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 *
 * // Option 1: Use createServer for simple setup
 * const server = createServer({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 *   port: 3000,
 * })
 *
 * // Option 2: Use with Bun.serve directly
 * const handler = createFetchHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * Bun.serve({
 *   port: 3000,
 *   fetch: handler.fetch,
 * })
 * ```
 *
 * @example WebSocket Server
 * ```ts
 * import { createWebSocketHandler, createFetchHandler } from "effect-trpc/bun"
 *
 * const wsHandler = createWebSocketHandler({
 *   router: appRouter,
 *   auth: myAuthHandler,
 * })
 *
 * const httpHandler = createFetchHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * Bun.serve({
 *   port: 3000,
 *   fetch(req, server) {
 *     const url = new URL(req.url)
 *     if (url.pathname === "/ws") {
 *       if (server.upgrade(req, { data: { authenticated: false } })) {
 *         return
 *       }
 *       return new Response("Upgrade failed", { status: 500 })
 *     }
 *     return httpHandler.fetch(req)
 *   },
 *   websocket: wsHandler.websocket,
 * })
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  createFetchHandler,
  createServer,
} from "./http.js"

export type {
  CreateServerOptions,
  FetchHandler,
  BunServerInstance,
  CorsOptions,
} from "./http.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  createWebSocketHandler,
} from "./ws.js"

export type {
  CreateWebSocketHandlerOptions,
  BunWebSocketHandlerResult,
  BunWebSocket,
  BunWebSocketHandler,
  WebSocketAuthHandler,
  FromServerMessage,
} from "./ws.js"
