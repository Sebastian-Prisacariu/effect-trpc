/**
 * Transport module stub
 * @module
 */

import { Context, Schema } from "effect"

// TODO: Implement

export const http = null as any
export const webSocket = null as any
export const make = null as any
export const isTransientError = null as any

export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}

export interface TransportService {
  readonly send: (request: TransportRequest) => any
}

export interface TransportRequest {
  readonly id: string
  readonly path: string
  readonly payload: unknown
}

export type TransportResponse = any
