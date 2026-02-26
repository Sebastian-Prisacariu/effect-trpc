/**
 * @module effect-trpc/core/rpc/errors
 *
 * Core RPC errors used across the client and server.
 */

import * as Data from "effect/Data"
import * as Predicate from "effect/Predicate"

// ─────────────────────────────────────────────────────────────────────────────
// Type IDs
// ─────────────────────────────────────────────────────────────────────────────

export const RpcClientErrorTypeId: unique symbol = Symbol.for("@effect-trpc/RpcClientError")
export type RpcClientErrorTypeId = typeof RpcClientErrorTypeId

export const RpcResponseErrorTypeId: unique symbol = Symbol.for("@effect-trpc/RpcResponseError")
export type RpcResponseErrorTypeId = typeof RpcResponseErrorTypeId

export const RpcTimeoutErrorTypeId: unique symbol = Symbol.for("@effect-trpc/RpcTimeoutError")
export type RpcTimeoutErrorTypeId = typeof RpcTimeoutErrorTypeId

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

export const isRpcClientError = (u: unknown): u is RpcClientError =>
  Predicate.hasProperty(u, RpcClientErrorTypeId)

export const isRpcResponseError = (u: unknown): u is RpcResponseError =>
  Predicate.hasProperty(u, RpcResponseErrorTypeId)

export const isRpcTimeoutError = (u: unknown): u is RpcTimeoutError =>
  Predicate.hasProperty(u, RpcTimeoutErrorTypeId)

export const isRpcError = (u: unknown): u is RpcClientError | RpcResponseError | RpcTimeoutError =>
  isRpcClientError(u) || isRpcResponseError(u) || isRpcTimeoutError(u)

// ─────────────────────────────────────────────────────────────────────────────
// Error Classes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error for RPC client-side failures (serialization, parsing, etc).
 */
export class RpcClientError extends Data.TaggedError("RpcClientError")<{
  readonly message: string
  readonly cause?: unknown
}> {
  readonly [RpcClientErrorTypeId]: RpcClientErrorTypeId = RpcClientErrorTypeId
}

/**
 * Error for HTTP response failures from the RPC server.
 */
export class RpcResponseError extends Data.TaggedError("RpcResponseError")<{
  readonly message: string
  readonly status: number
}> {
  readonly [RpcResponseErrorTypeId]: RpcResponseErrorTypeId = RpcResponseErrorTypeId
}

/**
 * Error when an RPC call times out.
 */
export class RpcTimeoutError extends Data.TaggedError("RpcTimeoutError")<{
  readonly rpcName: string
  readonly timeout: number
}> {
  readonly [RpcTimeoutErrorTypeId]: RpcTimeoutErrorTypeId = RpcTimeoutErrorTypeId

  override get message(): string {
    return `RPC call '${this.rpcName}' timed out after ${this.timeout}ms`
  }
}

export type RpcError =
  | RpcClientError
  | RpcResponseError
  | RpcTimeoutError
