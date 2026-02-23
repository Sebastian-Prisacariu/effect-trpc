/**
 * @module effect-trpc/ws/server
 *
 * WebSocket server services for subscription procedures.
 *
 * @example
 * ```ts
 * import {
 *   WebSocketCodec, WebSocketCodecLive,
 *   WebSocketAuth, makeWebSocketAuth,
 *   WebSocketHeartbeat, WebSocketHeartbeatLive,
 *   ConnectionRegistry, ConnectionRegistryLive,
 *   SubscriptionManager, SubscriptionManagerLive,
 *   WebSocketMetrics, WebSocketMetricsLive,
 *   BackpressureController, BackpressureControllerLive,
 * } from 'effect-trpc/ws/server'
 *
 * // Create auth layer
 * const AuthLive = makeWebSocketAuth({
 *   authenticate: (token) => verifyJwt(token),
 * })
 *
 * // Compose all layers
 * const WebSocketServerLive = Layer.mergeAll(
 *   WebSocketCodecLive,
 *   AuthLive,
 *   WebSocketHeartbeatLive,
 *   ConnectionRegistryLive,
 *   WebSocketMetricsLive, // Enable metrics collection
 *   BackpressureControllerLive, // Enable backpressure signaling
 * ).pipe(
 *   Layer.provideMerge(SubscriptionManagerLive),
 * )
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketCodec
// ─────────────────────────────────────────────────────────────────────────────

export type { WebSocketCodecShape } from "./WebSocketCodec.js"

export {
  WebSocketCodec,
  WebSocketCodecLive,
  makeWebSocketCodec,
} from "./WebSocketCodec.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketAuth
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AuthResult,
  WebSocketAuthHandler,
} from "./WebSocketAuth.js"

export {
  WebSocketAuth,
  makeWebSocketAuth,
  WebSocketAuthTest,
} from "./WebSocketAuth.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketHeartbeat
// ─────────────────────────────────────────────────────────────────────────────

export type {
  WebSocketHeartbeatShape,
  HeartbeatConfig,
} from "./WebSocketHeartbeat.js"

export {
  WebSocketHeartbeat,
  defaultHeartbeatConfig,
  WebSocketHeartbeatLive,
  makeWebSocketHeartbeatLayer,
  WebSocketHeartbeatDisabled,
} from "./WebSocketHeartbeat.js"

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionRegistry
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Connection,
  ConnectionEvent,
  BroadcastResult,
} from "./ConnectionRegistry.js"

export {
  ConnectionRegistry,
  ConnectionRegistryLive,
} from "./ConnectionRegistry.js"

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionManager
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ActiveSubscription,
  RegisteredHandler,
} from "./SubscriptionManager.js"

export {
  SubscriptionManager,
  SubscriptionManagerLive,
} from "./SubscriptionManager.js"

// ─────────────────────────────────────────────────────────────────────────────
// WebSocketMetrics
// ─────────────────────────────────────────────────────────────────────────────

export type { WebSocketMetricsService } from "./WebSocketMetrics.js"

export {
  WebSocketMetrics,
  WebSocketMetricsLive,
  WebSocketMetricsDisabled,
  // Metric instances for direct access
  activeConnections,
  activeSubscriptions,
  messagesReceived,
  messagesSent,
  subscriptionsCreated,
  subscriptionsCompleted,
  subscriptionsErrored,
  connectionsOpened,
  connectionsClosed,
  authFailures,
  broadcastsSent,
  broadcastFailures,
} from "./WebSocketMetrics.js"

// ─────────────────────────────────────────────────────────────────────────────
// BackpressureController
// ─────────────────────────────────────────────────────────────────────────────

export type {
  BackpressureConfig,
  BackpressureState,
  BackpressureControllerService,
} from "./BackpressureController.js"

export {
  BackpressureController,
  BackpressureControllerLive,
  BackpressureControllerDisabled,
  makeBackpressureControllerLayer,
  defaultBackpressureConfig,
} from "./BackpressureController.js"
