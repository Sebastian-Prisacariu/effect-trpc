/**
 * Transport - How requests travel between client and server
 * 
 * @since 1.0.0
 * @module
 */

import { Context, Effect, Layer, Stream, Duration } from "effect"
import { httpTransport } from "./internal/http.js"
import { webSocketTransport } from "./internal/websocket.js"
import { mockTransport } from "./internal/mock.js"
import type * as Router from "../Router/index.js"

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
import { TransportError } from "./internal/error.js"

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
 * Create a custom transport from a service implementation
 * 
 * @since 1.0.0
 * @category constructors
 */
export const fromService = (
  service: TransportService
): Layer.Layer<Transport, never, never> =>
  Layer.succeed(Transport, service)

/**
 * Handler map for mock transport
 * Maps procedure paths to their implementations
 */
export type MockHandlers<D extends Router.Definition> = {
  [K in PathsOf<Router.FlattenDefinition<D>>]: (
    payload: PayloadFor<Router.FlattenDefinition<D>, K>
  ) => Effect.Effect<SuccessFor<Router.FlattenDefinition<D>, K>, ErrorFor<Router.FlattenDefinition<D>, K>>
}

// Type helpers for extracting paths and types from router
type PathsOf<D, Prefix extends string = ""> = D extends object
  ? {
      [K in keyof D & string]: D[K] extends { readonly _tag: "Query" | "Mutation" | "Stream" }
        ? Prefix extends "" ? K : `${Prefix}.${K}`
        : PathsOf<D[K], Prefix extends "" ? K : `${Prefix}.${K}`>
    }[keyof D & string]
  : never

type GetAtPath<D, Path extends string> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof D
    ? GetAtPath<D[Head], Tail>
    : never
  : Path extends keyof D
    ? D[Path]
    : never

type PayloadFor<D, Path extends string> = GetAtPath<D, Path> extends { readonly payload: infer P }
  ? P extends { readonly Type: infer T } ? T : unknown
  : void

type SuccessFor<D, Path extends string> = GetAtPath<D, Path> extends { readonly success: infer S }
  ? S extends { readonly Type: infer T } ? T : unknown
  : unknown

type ErrorFor<D, Path extends string> = GetAtPath<D, Path> extends { readonly error: infer E }
  ? E extends { readonly Type: infer T } ? T : unknown
  : never

/**
 * Create a type-safe mock transport
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * const mockLayer = Transport.make<AppRouter>({
 *   "user.list": () => Effect.succeed([...]),
 *   "user.byId": ({ id }) => Effect.succeed({ id, name: "Mock" }),
 * })
 * ```
 */
export const make = <D extends Router.Definition>(
  handlers: MockHandlers<D>
): Layer.Layer<Transport, never, never> =>
  mockTransport(handlers as Record<string, (payload: unknown) => Effect.Effect<unknown, unknown>>)

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if an error is transient (retry-able)
 * 
 * @since 1.0.0
 * @category utilities
 */
export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransportError) {
    return error.reason === "Network" || error.reason === "Timeout"
  }
  return false
}
