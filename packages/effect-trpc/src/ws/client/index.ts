/**
 * @module effect-trpc/ws/client
 *
 * WebSocket client services for subscriptions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketConnection
// ─────────────────────────────────────────────────────────────────────────────

export type {
  WebSocketConnectionShape,
  WebSocketConnectionConfig,
} from "./WebSocketConnection.js"

export {
  WebSocketConnection,
  ConnectionState,
  makeWebSocketConnectionLayer,
} from "./WebSocketConnection.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketReconnect
// ─────────────────────────────────────────────────────────────────────────────

export type {
  WebSocketReconnectShape,
  WebSocketReconnectConfig,
} from "./WebSocketReconnect.js"

export {
  WebSocketReconnect,
  makeWebSocketReconnectLayer,
  WebSocketReconnectLive,
} from "./WebSocketReconnect.js"

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionRegistry
// ─────────────────────────────────────────────────────────────────────────────

export type {
  SubscriptionRegistryShape,
  ClientSubscription,
} from "./SubscriptionRegistry.js"

export {
  SubscriptionRegistry,
  SubscriptionState,
  SubscriptionEvent,
  SubscriptionRegistryLive,
} from "./SubscriptionRegistry.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketClient
// ─────────────────────────────────────────────────────────────────────────────

export type {
  WebSocketClientShape,
  WebSocketClientConfig,
} from "./WebSocketClient.js"

export {
  WebSocketClient,
  ClientState,
  makeWebSocketClientLayer,
} from "./WebSocketClient.js"
