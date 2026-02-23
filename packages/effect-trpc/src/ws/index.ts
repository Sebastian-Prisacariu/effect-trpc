/**
 * @module effect-trpc/ws
 *
 * WebSocket transport layer for subscription procedures.
 *
 * @example Server-side usage
 * ```ts
 * import { createWebSocketHandler } from 'effect-trpc/node'
 * import { WebSocketServer } from 'ws'
 *
 * const wsHandler = createWebSocketHandler({
 *   router: appRouter,
 *   auth: myAuthLayer,
 * })
 *
 * const wss = new WebSocketServer({ port: 3001 })
 * wss.on('connection', (ws) => {
 *   Effect.runFork(
 *     wsHandler.handleConnection(ws).pipe(
 *       Effect.provide(wsHandler.defaultLayers)
 *     )
 *   )
 * })
 * ```
 *
 * @example Client-side usage
 * ```ts
 * const { data, send } = trpc.procedures.chat.join.useSubscription(
 *   { roomId: "123" },
 *   { onData: (msg) => console.log(msg) }
 * )
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ClientId,
  SubscriptionId,
  ConnectionState,
  SubscriptionState,
} from "./types.js"

export {
  ClientId as ClientIdSchema,
  SubscriptionId as SubscriptionIdSchema,
  ConnectionStateCtor,
  SubscriptionStateCtor,
  generateClientId,
  generateSubscriptionId,
} from "./types.js"

// ─────────────────────────────────────────────────────────────────────────────
// Protocol
// ─────────────────────────────────────────────────────────────────────────────

export type {
  FromClientMessage as FromClientMessageType,
  FromServerMessage as FromServerMessageType,
} from "./protocol.js"

export {
  // Client -> Server
  AuthMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientDataMessage,
  PingMessage,
  FromClientMessage,
  // Server -> Client
  AuthResultMessage,
  SubscribedMessage,
  DataMessage,
  ErrorMessage,
  CompleteMessage,
  ServerDataMessage,
  PongMessage,
  FromServerMessage,
  // Type guards
  isAuthMessage,
  isSubscribeMessage,
  isUnsubscribeMessage,
  isClientDataMessage,
  isPingMessage,
  isDataMessage,
  isErrorMessage,
  isCompleteMessage,
} from "./protocol.js"

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type { WebSocketError } from "./errors.js"

export {
  // Type identification
  WebSocketErrorTypeId,
  isWebSocketError,
  // Error types
  WebSocketConnectionError,
  WebSocketSendError,
  WebSocketCloseError,
  WebSocketAuthError,
  SubscriptionError,
  WebSocketProtocolError,
  ConnectionNotFoundError,
  SubscriptionNotFoundError,
  HandlerNotFoundError,
  ReconnectGaveUpError,
  HeartbeatTimeoutError,
} from "./errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Server (re-export for convenience)
// ─────────────────────────────────────────────────────────────────────────────

export type { WebSocketCodecShape } from "./server/index.js"
export type { AuthResult, WebSocketAuthHandler } from "./server/index.js"
export type { WebSocketHeartbeatShape, HeartbeatConfig } from "./server/index.js"
export type { Connection, ConnectionEvent, BroadcastResult } from "./server/index.js"
export type { ActiveSubscription, RegisteredHandler } from "./server/index.js"

export {
  WebSocketCodec,
  WebSocketCodecLive,
  makeWebSocketCodec,
  WebSocketAuth,
  makeWebSocketAuth,
  WebSocketAuthTest,
  WebSocketHeartbeat,
  defaultHeartbeatConfig,
  WebSocketHeartbeatLive,
  makeWebSocketHeartbeatLayer,
  WebSocketHeartbeatDisabled,
  ConnectionRegistry,
  ConnectionRegistryLive,
  SubscriptionManager,
  SubscriptionManagerLive,
} from "./server/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client (re-export for convenience)
// ─────────────────────────────────────────────────────────────────────────────

export type { WebSocketConnectionShape, WebSocketConnectionConfig } from "./client/index.js"
export type { WebSocketReconnectShape, WebSocketReconnectConfig } from "./client/index.js"
export type { SubscriptionRegistryShape, ClientSubscription } from "./client/index.js"
export type { WebSocketClientShape, WebSocketClientConfig } from "./client/index.js"

export {
  WebSocketConnection,
  ConnectionState as ClientConnectionState,
  makeWebSocketConnectionLayer,
  WebSocketReconnect,
  makeWebSocketReconnectLayer,
  WebSocketReconnectLive,
  SubscriptionRegistry,
  SubscriptionState as ClientSubscriptionState,
  SubscriptionEvent,
  SubscriptionRegistryLive,
  WebSocketClient,
  ClientState,
  makeWebSocketClientLayer,
} from "./client/index.js"
