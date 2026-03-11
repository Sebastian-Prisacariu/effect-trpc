/**
 * Internal service contracts for effect-trpc
 * 
 * Interface-first: Define what exists, implement later.
 */

import { Context, Effect, Layer, Stream, Scope, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"

// =============================================================================
// Domain Types (shared across services)
// =============================================================================

/** Unique identifier for a request */
export type RequestId = string & { readonly _tag: "RequestId" }

/** Encoded RPC message from client */
export interface ClientMessage {
  readonly _tag: "Request"
  readonly id: RequestId
  readonly tag: string  // procedure path e.g. "user.list"
  readonly payload: unknown
}

/** Encoded RPC message from server */
export type ServerMessage =
  | { readonly _tag: "Success"; readonly requestId: RequestId; readonly value: unknown }
  | { readonly _tag: "Failure"; readonly requestId: RequestId; readonly cause: unknown }
  | { readonly _tag: "Chunk"; readonly requestId: RequestId; readonly values: ReadonlyArray<unknown> }
  | { readonly _tag: "End"; readonly requestId: RequestId }

// =============================================================================
// Transport Service
// =============================================================================

/**
 * Transport handles sending requests and receiving responses.
 * Different implementations: HTTP, WebSocket, Worker, Mock
 */
export interface TransportService {
  /**
   * Send a request and receive response(s).
   * For queries/mutations: single response
   * For streams: multiple chunks + end
   */
  readonly send: (
    message: ClientMessage
  ) => Stream.Stream<ServerMessage, TransportError>

  /**
   * Whether this transport supports batching
   */
  readonly supportsBatching: boolean
}

export class Transport extends Context.Tag("@effect-trpc/Transport")<
  Transport,
  TransportService
>() {}

export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    reason: Schema.Literal("Network", "Timeout", "Protocol", "Closed"),
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

// =============================================================================
// Batching Service
// =============================================================================

/**
 * Batching collects multiple requests and sends them together.
 * Sits in front of Transport.
 */
export interface BatchingService {
  /**
   * Submit a request. May be batched with others.
   */
  readonly submit: (
    message: ClientMessage
  ) => Stream.Stream<ServerMessage, TransportError>

  /**
   * Flush any pending requests immediately
   */
  readonly flush: () => Effect.Effect<void>
}

export class Batching extends Context.Tag("@effect-trpc/Batching")<
  Batching,
  BatchingService
>() {}

export interface BatchingConfig {
  readonly enabled: boolean
  readonly window: number  // milliseconds
  readonly maxSize: number
  readonly queries: boolean
  readonly mutations: boolean
}

// =============================================================================
// Serialization Service
// =============================================================================

/**
 * Serialization encodes/decodes messages.
 * Re-exports from Effect RPC where possible.
 */
export interface SerializationService {
  readonly encode: (message: ClientMessage) => Effect.Effect<Uint8Array | string, SerializationError>
  readonly decode: (data: Uint8Array | string) => Effect.Effect<ReadonlyArray<ServerMessage>, SerializationError>
  readonly contentType: string
}

export class Serialization extends Context.Tag("@effect-trpc/Serialization")<
  Serialization,
  SerializationService
>() {}

export class SerializationError extends Schema.TaggedError<SerializationError>()(
  "SerializationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

// =============================================================================
// Registry Service (wraps Effect Atom)
// =============================================================================

/**
 * Registry manages query atoms and their lifecycle.
 * Backed by Effect Atom's Registry.
 */
export interface RegistryService {
  /**
   * Get or create an atom for a query
   */
  readonly getQueryAtom: <A, E>(
    key: string,
    fetcher: () => Effect.Effect<A, E>
  ) => Effect.Effect<QueryAtom<A, E>>

  /**
   * Invalidate queries by key pattern
   */
  readonly invalidate: (
    keys: ReadonlyArray<string>
  ) => Effect.Effect<void>

  /**
   * Subscribe to atom changes (for React integration)
   */
  readonly subscribe: <A, E>(
    atom: QueryAtom<A, E>,
    listener: (result: QueryResult<A, E>) => void
  ) => Effect.Effect<void, never, Scope.Scope>

  /**
   * Get current value synchronously (for useSyncExternalStore)
   */
  readonly getSnapshot: <A, E>(
    atom: QueryAtom<A, E>
  ) => QueryResult<A, E>

  /**
   * Dehydrate registry state for SSR
   */
  readonly dehydrate: () => Effect.Effect<DehydratedState>

  /**
   * Hydrate registry from SSR state
   */
  readonly hydrate: (state: DehydratedState) => Effect.Effect<void>
}

export class Registry extends Context.Tag("@effect-trpc/Registry")<
  Registry,
  RegistryService
>() {}

/** Opaque atom handle */
export interface QueryAtom<A, E> {
  readonly _tag: "QueryAtom"
  readonly key: string
  readonly _A: A
  readonly _E: E
}

/** Query result states */
export type QueryResult<A, E> =
  | { readonly _tag: "Initial" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Refreshing"; readonly value: A }
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly error: E }

/** Serialized registry state for SSR */
export interface DehydratedState {
  readonly queries: ReadonlyArray<{
    readonly key: string
    readonly value: unknown
    readonly timestamp: number
  }>
}

// =============================================================================
// Procedure Executor Service
// =============================================================================

/**
 * Executor runs procedures on the client side.
 * Handles encoding, transport, decoding, caching.
 */
export interface ExecutorService {
  /**
   * Execute a query
   */
  readonly query: <I, A, E>(
    path: string,
    input: I,
    options?: QueryOptions
  ) => Effect.Effect<A, E | TransportError>

  /**
   * Execute a mutation
   */
  readonly mutation: <I, A, E>(
    path: string,
    input: I,
    options?: MutationOptions
  ) => Effect.Effect<A, E | TransportError>

  /**
   * Execute a stream
   */
  readonly stream: <I, A, E>(
    path: string,
    input: I,
    options?: StreamOptions
  ) => Stream.Stream<A, E | TransportError>
}

export class Executor extends Context.Tag("@effect-trpc/Executor")<
  Executor,
  ExecutorService
>() {}

export interface QueryOptions {
  readonly signal?: AbortSignal
  readonly skipBatch?: boolean
}

export interface MutationOptions {
  readonly signal?: AbortSignal
  readonly invalidates?: ReadonlyArray<string>
}

export interface StreamOptions {
  readonly signal?: AbortSignal
}

// =============================================================================
// Server Handler Service
// =============================================================================

/**
 * Handler processes incoming RPC requests on the server.
 */
export interface HandlerService {
  /**
   * Handle a single request
   */
  readonly handle: (
    message: ClientMessage,
    context: ServerContext
  ) => Stream.Stream<ServerMessage, never>

  /**
   * Handle a batch of requests
   */
  readonly handleBatch: (
    messages: ReadonlyArray<ClientMessage>,
    context: ServerContext
  ) => Stream.Stream<ServerMessage, never>
}

export class Handler extends Context.Tag("@effect-trpc/Handler")<
  Handler,
  HandlerService
>() {}

export interface ServerContext {
  readonly headers: Headers
  readonly signal?: AbortSignal
}

// =============================================================================
// Layer Composition Helpers
// =============================================================================

/**
 * Create a complete client layer from config
 */
export const makeClientLayer = (config: {
  url: string
  batching?: Partial<BatchingConfig>
}): Layer.Layer<Transport | Batching | Registry | Executor, never, never> => {
  // Will be implemented - just the contract for now
  throw new Error("Not implemented")
}

/**
 * Create a complete server layer from router
 */
export const makeServerLayer = <R>(
  router: unknown, // Router type TBD
  layer: Layer.Layer<R, never, never>
): Layer.Layer<Handler, never, never> => {
  // Will be implemented - just the contract for now
  throw new Error("Not implemented")
}
