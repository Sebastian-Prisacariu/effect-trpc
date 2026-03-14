/**
 * Server type definitions
 * 
 * @internal
 * @module
 */

import type * as Effect from "effect/Effect"
import type { Pipeable } from "effect/Pipeable"
import type * as Stream from "effect/Stream"
import type * as Router from "../Router/index.js"
import type * as Transport from "../Transport/index.js"
import type * as Middleware from "../Middleware/index.js"

// =============================================================================
// Server Types
// =============================================================================

/** @internal */
export const ServerTypeId: unique symbol = Symbol.for("effect-trpc/Server")

/** @internal */
export type ServerTypeId = typeof ServerTypeId

/**
 * Server instance that can handle RPC requests
 * 
 * @since 1.0.0
 * @category models
 */
export interface Server<out D extends Router.Definition, out R> extends Pipeable {
  readonly [ServerTypeId]: ServerTypeId
  readonly router: Router.Router<D>
  readonly middlewares: ReadonlyArray<Middleware.Applicable>
  
  /**
   * Handle a single request (query/mutation)
   * @param request - The transport request
   * @param signal - Optional AbortSignal for request cancellation
   */
  readonly handle: (
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ) => Effect.Effect<Transport.TransportResponse, never, R>
  
  /**
   * Handle a streaming request
   * @param request - The transport request
   * @param signal - Optional AbortSignal for stream cancellation
   */
  readonly handleStream: (
    request: Transport.TransportRequest,
    signal?: AbortSignal
  ) => Stream.Stream<Transport.StreamResponse, never, R>
}

// =============================================================================
// HTTP Types
// =============================================================================

/**
 * Minimal HTTP request interface (no @effect/platform dependency)
 * 
 * @internal
 */
export interface HttpRequest {
  readonly json: () => Promise<unknown>
  readonly headers?: 
    | Record<string, string | string[] | undefined>
    | { get: (name: string) => string | null }
  /** Optional AbortSignal for request cancellation */
  readonly signal?: AbortSignal
}

/**
 * HTTP response interface
 * 
 * @internal
 */
export interface HttpResponse {
  readonly status: number
  readonly headers: Record<string, string>
  readonly body: string
}

/**
 * Options for HTTP handler
 * 
 * @since 1.0.0
 * @category http
 */
export interface HttpHandlerOptions {
  /**
   * Base path for the RPC endpoint (default: "/rpc")
   */
  readonly path?: string
  
  /**
   * Maximum payload size in bytes (optional, no limit by default)
   * Requests exceeding this limit will receive a 413 response.
   */
  readonly maxPayloadSize?: number
}

/**
 * Next.js Pages Router API request
 * 
 * @internal
 */
export interface NextApiRequest {
  readonly body: unknown
  readonly headers: Record<string, string | string[] | undefined>
}

/**
 * Next.js Pages Router API response
 * 
 * @internal
 */
export interface NextApiResponse {
  status: (code: number) => NextApiResponse
  json: (data: unknown) => void
  setHeader: (name: string, value: string) => void
  write: (chunk: string) => void
  end: () => void
}
