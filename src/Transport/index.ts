/**
 * Transport - How requests travel between client and server
 * 
 * @since 1.0.0
 * @module
 */

import { Context, Layer, Stream, Duration } from "effect"
import { httpTransport } from "./internal/http.js"
import { webSocketTransport } from "./internal/websocket.js"
import type { TransportError } from "./internal/error.js"

// =============================================================================
// Service (the only thing that crosses module boundaries)
// =============================================================================

/**
 * @since 1.0.0
 * @category service
 */
export interface TransportService {
  readonly send: (request: TransportRequest) => Stream.Stream<TransportResponse, TransportError>
}

/**
 * @since 1.0.0
 * @category service
 */
export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}

// =============================================================================
// Types
// =============================================================================

/**
 * @since 1.0.0
 * @category models
 */
export interface TransportRequest {
  readonly id: string
  readonly path: string
  readonly payload: unknown
}

/**
 * @since 1.0.0
 * @category models
 */
export type TransportResponse =
  | { readonly _tag: "Success"; readonly id: string; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly id: string; readonly error: unknown }
  | { readonly _tag: "Chunk"; readonly id: string; readonly values: ReadonlyArray<unknown> }
  | { readonly _tag: "End"; readonly id: string }

export { TransportError } from "./internal/error.js"

// =============================================================================
// Constructors
// =============================================================================

/**
 * @since 1.0.0
 * @category models
 */
export interface HttpOptions {
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  readonly timeout?: Duration.DurationInput
  readonly fetch?: typeof globalThis.fetch
  readonly batching?: {
    readonly enabled?: boolean
    readonly window?: Duration.DurationInput
    readonly maxSize?: number
    readonly queries?: boolean
    readonly mutations?: boolean
  }
}

/**
 * Create an HTTP transport
 * 
 * @since 1.0.0
 * @category constructors
 */
export const http = (
  url: string,
  options?: HttpOptions
): Layer.Layer<Transport, never, never> =>
  httpTransport(url, options)

/**
 * @since 1.0.0
 * @category models
 */
export interface WebSocketOptions {
  readonly connectionTimeout?: Duration.DurationInput
  readonly reconnect?: {
    readonly enabled?: boolean
    readonly maxAttempts?: number
    readonly delay?: Duration.DurationInput
  }
}

/**
 * Create a WebSocket transport
 * 
 * @since 1.0.0
 * @category constructors
 */
export const webSocket = (
  url: string,
  options?: WebSocketOptions
): Layer.Layer<Transport, never, never> =>
  webSocketTransport(url, options)

/**
 * Create a custom transport
 * 
 * @since 1.0.0
 * @category constructors
 */
export const make = (
  service: TransportService
): Layer.Layer<Transport, never, never> =>
  Layer.succeed(Transport, service)
