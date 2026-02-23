/**
 * @module effect-trpc/node
 *
 * Node.js adapter for effect-trpc.
 * Provides both HTTP and WebSocket server support.
 *
 * For smaller bundle sizes, you can import from subpaths:
 * - `effect-trpc/node/http` - HTTP only (~15KB savings)
 * - `effect-trpc/node/ws` - WebSocket only
 *
 * @example HTTP Server
 * ```ts
 * import { createHandler, nodeToWebRequest, webToNodeResponse } from "effect-trpc/node"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 * import * as http from "node:http"
 *
 * const handler = createHandler({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * const server = http.createServer(async (req, res) => {
 *   const request = await nodeToWebRequest(req)
 *   const response = await handler.fetch(request)
 *   await webToNodeResponse(response, res)
 * })
 *
 * server.listen(3000)
 * ```
 *
 * @example WebSocket Server
 * ```ts
 * import { createWebSocketHandler } from "effect-trpc/node"
 * import { WebSocketServer } from "ws"
 *
 * const wsHandler = createWebSocketHandler({
 *   router: appRouter,
 *   auth: myAuthHandler,
 * })
 *
 * const wss = new WebSocketServer({ port: 3001 })
 * wss.on("connection", (ws) => {
 *   Effect.runFork(wsHandler.handleConnection(ws))
 * })
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Exports
// ─────────────────────────────────────────────────────────────────────────────

export {
  // Handler
  createHandler,
  // Request/Response conversion
  nodeToWebRequest,
  nodeToWebRequestEffect,
  webToNodeResponse,
  webToNodeResponseEffect,
  // Error
  PayloadTooLargeError,
  // Constants
  DEFAULT_MAX_BODY_SIZE,
} from "./http.js"

export type {
  CreateHandlerOptions,
  FetchHandler,
  NodeToWebRequestOptions,
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
  WebSocketHandler,
  WebSocketLike,
  WebSocketAuthHandler,
  FromServerMessage,
} from "./ws.js"
