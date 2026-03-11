/**
 * Transport module - How requests travel between client and server
 * 
 * @since 1.0.0
 */

import { Context, Effect, Layer, Stream, Duration } from "effect"
import type { BatchingConfig } from "./internal/services.js"

// =============================================================================
// Re-export Tag
// =============================================================================

export {
  /**
   * Transport service tag
   * 
   * @since 1.0.0
   * @category tag
   */
  Transport,
  
  /**
   * Transport service interface
   * 
   * @since 1.0.0
   * @category models
   */
  type TransportService,
  
  /**
   * Transport error
   * 
   * @since 1.0.0
   * @category errors
   */
  TransportError,
} from "./internal/services.js"

// =============================================================================
// HTTP Transport
// =============================================================================

/**
 * Configuration for HTTP transport
 * 
 * @since 1.0.0
 * @category models
 */
export interface HttpConfig {
  /**
   * Request headers
   */
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  
  /**
   * Request timeout
   */
  readonly timeout?: Duration.DurationInput
  
  /**
   * Batching configuration
   */
  readonly batching?: {
    readonly enabled?: boolean
    readonly window?: Duration.DurationInput
    readonly maxSize?: number
    readonly queries?: boolean
    readonly mutations?: boolean
  }
  
  /**
   * Custom fetch implementation
   */
  readonly fetch?: typeof globalThis.fetch
}

/**
 * Create an HTTP transport layer
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * 
 * // Basic
 * const layer = Transport.http("/api/trpc")
 * 
 * // With config
 * const layer = Transport.http("/api/trpc", {
 *   timeout: Duration.seconds(30),
 *   batching: {
 *     enabled: true,
 *     window: Duration.millis(10),
 *   }
 * })
 * ```
 */
export const http = (
  url: string,
  config?: HttpConfig
): Layer.Layer<import("./internal/services.js").Transport, never, never> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

// =============================================================================
// WebSocket Transport
// =============================================================================

/**
 * Configuration for WebSocket transport
 * 
 * @since 1.0.0
 * @category models
 */
export interface WebSocketConfig {
  /**
   * Connection timeout
   */
  readonly connectionTimeout?: Duration.DurationInput
  
  /**
   * Reconnection settings
   */
  readonly reconnect?: {
    readonly enabled?: boolean
    readonly maxAttempts?: number
    readonly delay?: Duration.DurationInput
  }
  
  /**
   * Heartbeat/ping interval
   */
  readonly heartbeat?: Duration.DurationInput
}

/**
 * Create a WebSocket transport layer
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * 
 * const layer = Transport.webSocket("wss://api.example.com/trpc")
 * ```
 */
export const webSocket = (
  url: string,
  config?: WebSocketConfig
): Layer.Layer<import("./internal/services.js").Transport, never, never> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

// =============================================================================
// Worker Transport
// =============================================================================

/**
 * Create a Web Worker transport layer
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * 
 * const worker = new Worker("./api-worker.js")
 * const layer = Transport.worker(worker)
 * ```
 */
export const worker = (
  worker: Worker
): Layer.Layer<import("./internal/services.js").Transport, never, never> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}

// =============================================================================
// Custom Transport
// =============================================================================

/**
 * Create a custom transport from handlers
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Transport } from "effect-trpc"
 * import { Stream } from "effect"
 * 
 * // In-memory transport for testing
 * const layer = Transport.make({
 *   send: (message) => Stream.make({
 *     _tag: "Success",
 *     requestId: message.id,
 *     value: mockData[message.tag],
 *   }),
 *   supportsBatching: false,
 * })
 * ```
 */
export const make = (
  service: import("./internal/services.js").TransportService
): Layer.Layer<import("./internal/services.js").Transport, never, never> => {
  // Contract only - implementation TBD
  throw new Error("Not implemented")
}
