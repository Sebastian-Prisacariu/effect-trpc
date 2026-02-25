/**
 * @module shared/logging
 *
 * Unified Logging System for effect-trpc
 *
 * This module provides a comprehensive logging solution that gives users
 * visibility into every operation in the tRPC-Effect system:
 *
 * - **Queries**: Request/response logging with timing
 * - **Mutations**: Operation logging with input/output
 * - **Streams**: Stream lifecycle logging (start, data, complete, error)
 * - **Subscriptions**: WebSocket subscription events
 * - **WebSocket**: Connection lifecycle, auth, heartbeat
 * - **Middleware**: Middleware execution tracing
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Effect, Logger } from "effect"
 * import { TrpcLogger, TrpcLoggerLive } from "effect-trpc/shared/logging"
 *
 * // Use with pretty logger for development
 * const program = myEffect.pipe(
 *   Effect.provide(TrpcLoggerLive),
 *   Effect.provide(Logger.pretty)
 * )
 * ```
 *
 * ## Configuration
 *
 * ```typescript
 * import { makeTrpcLoggerLayer, LogLevel } from "effect-trpc/shared/logging"
 *
 * const CustomLoggerLive = makeTrpcLoggerLayer({
 *   level: LogLevel.Debug,
 *   includeInput: true,
 *   includeOutput: false,  // Don't log response data
 *   includeTiming: true,
 *   redactFields: ["password", "token", "secret"],
 * })
 * ```
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Context from "effect/Context"
import * as LogLevel from "effect/LogLevel"
import * as Clock from "effect/Clock"
import { pipe } from "effect/Function"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log categories that can be individually enabled/disabled.
 *
 * @since 0.1.0
 */
export type LogCategory =
  | "query"
  | "mutation"
  | "stream"
  | "subscription"
  | "websocket"
  | "middleware"
  | "auth"
  | "cache"
  | "error"

/**
 * Configuration options for the tRPC logger.
 *
 * @since 0.1.0
 */
export interface TrpcLoggerConfig {
  /**
   * Minimum log level. Logs below this level are filtered.
   * @default LogLevel.Info
   */
  readonly level: LogLevel.LogLevel

  /**
   * Whether to include request input in logs.
   * @default true in development, false in production
   */
  readonly includeInput: boolean

  /**
   * Whether to include response output in logs.
   * @default false (can be verbose)
   */
  readonly includeOutput: boolean

  /**
   * Whether to include timing information.
   * @default true
   */
  readonly includeTiming: boolean

  /**
   * Fields to redact from logged data.
   * Values will be replaced with "[REDACTED]"
   * @default ["password", "token", "secret", "apiKey", "authorization"]
   */
  readonly redactFields: ReadonlyArray<string>

  /**
   * Maximum depth for nested object logging.
   * @default 3
   */
  readonly maxDepth: number

  /**
   * Maximum string length before truncation.
   * @default 200
   */
  readonly maxStringLength: number

  /**
   * Categories to enable. Empty means all enabled.
   * @default [] (all enabled)
   */
  readonly enabledCategories: ReadonlyArray<LogCategory>

  /**
   * Categories to disable. Takes precedence over enabledCategories.
   * @default []
   */
  readonly disabledCategories: ReadonlyArray<LogCategory>
}

/**
 * Default configuration for the tRPC logger.
 *
 * @since 0.1.0
 */
export const defaultConfig: TrpcLoggerConfig = {
  level: LogLevel.Info,
  includeInput: process.env["NODE_ENV"] !== "production",
  includeOutput: false,
  includeTiming: true,
  redactFields: ["password", "token", "secret", "apiKey", "authorization", "cookie", "sessionId"],
  maxDepth: 3,
  maxStringLength: 200,
  enabledCategories: [],
  disabledCategories: [],
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Event types for structured logging.
 *
 * @since 0.1.0
 */
export type TrpcLogEvent =
  | QueryStartEvent
  | QuerySuccessEvent
  | QueryErrorEvent
  | MutationStartEvent
  | MutationSuccessEvent
  | MutationErrorEvent
  | StreamStartEvent
  | StreamDataEvent
  | StreamCompleteEvent
  | StreamErrorEvent
  | SubscriptionStartEvent
  | SubscriptionDataEvent
  | SubscriptionCompleteEvent
  | SubscriptionErrorEvent
  | WebSocketConnectEvent
  | WebSocketDisconnectEvent
  | WebSocketAuthEvent
  | WebSocketHeartbeatEvent
  | MiddlewareStartEvent
  | MiddlewareEndEvent
  | CacheHitEvent
  | CacheMissEvent
  | CacheInvalidateEvent

interface QueryStartEvent {
  readonly _tag: "QueryStart"
  readonly procedure: string
  readonly input: unknown
  readonly requestId: string
}

interface QuerySuccessEvent {
  readonly _tag: "QuerySuccess"
  readonly procedure: string
  readonly durationMs: number
  readonly output: unknown
  readonly requestId: string
}

interface QueryErrorEvent {
  readonly _tag: "QueryError"
  readonly procedure: string
  readonly durationMs: number
  readonly error: unknown
  readonly requestId: string
}

interface MutationStartEvent {
  readonly _tag: "MutationStart"
  readonly procedure: string
  readonly input: unknown
  readonly requestId: string
}

interface MutationSuccessEvent {
  readonly _tag: "MutationSuccess"
  readonly procedure: string
  readonly durationMs: number
  readonly output: unknown
  readonly requestId: string
}

interface MutationErrorEvent {
  readonly _tag: "MutationError"
  readonly procedure: string
  readonly durationMs: number
  readonly error: unknown
  readonly requestId: string
}

interface StreamStartEvent {
  readonly _tag: "StreamStart"
  readonly procedure: string
  readonly input: unknown
  readonly requestId: string
}

interface StreamDataEvent {
  readonly _tag: "StreamData"
  readonly procedure: string
  readonly chunkIndex: number
  readonly requestId: string
}

interface StreamCompleteEvent {
  readonly _tag: "StreamComplete"
  readonly procedure: string
  readonly totalChunks: number
  readonly durationMs: number
  readonly requestId: string
}

interface StreamErrorEvent {
  readonly _tag: "StreamError"
  readonly procedure: string
  readonly chunksBeforeError: number
  readonly durationMs: number
  readonly error: unknown
  readonly requestId: string
}

interface SubscriptionStartEvent {
  readonly _tag: "SubscriptionStart"
  readonly procedure: string
  readonly subscriptionId: string
  readonly clientId: string
  readonly input: unknown
}

interface SubscriptionDataEvent {
  readonly _tag: "SubscriptionData"
  readonly procedure: string
  readonly subscriptionId: string
  readonly messageIndex: number
}

interface SubscriptionCompleteEvent {
  readonly _tag: "SubscriptionComplete"
  readonly procedure: string
  readonly subscriptionId: string
  readonly totalMessages: number
  readonly durationMs: number
  readonly reason: "client_unsubscribe" | "server_complete" | "error"
}

interface SubscriptionErrorEvent {
  readonly _tag: "SubscriptionError"
  readonly procedure: string
  readonly subscriptionId: string
  readonly error: unknown
}

interface WebSocketConnectEvent {
  readonly _tag: "WebSocketConnect"
  readonly clientId: string
  readonly remoteAddress?: string
}

interface WebSocketDisconnectEvent {
  readonly _tag: "WebSocketDisconnect"
  readonly clientId: string
  readonly code: number
  readonly reason: string
  readonly durationMs: number
}

interface WebSocketAuthEvent {
  readonly _tag: "WebSocketAuth"
  readonly clientId: string
  readonly success: boolean
  readonly userId?: string
  readonly durationMs: number
}

interface WebSocketHeartbeatEvent {
  readonly _tag: "WebSocketHeartbeat"
  readonly clientId: string
  readonly latencyMs: number
}

interface MiddlewareStartEvent {
  readonly _tag: "MiddlewareStart"
  readonly name: string
  readonly procedure: string
  readonly requestId: string
}

interface MiddlewareEndEvent {
  readonly _tag: "MiddlewareEnd"
  readonly name: string
  readonly procedure: string
  readonly durationMs: number
  readonly success: boolean
  readonly requestId: string
}

interface CacheHitEvent {
  readonly _tag: "CacheHit"
  readonly key: string
  readonly procedure: string
}

interface CacheMissEvent {
  readonly _tag: "CacheMiss"
  readonly key: string
  readonly procedure: string
}

interface CacheInvalidateEvent {
  readonly _tag: "CacheInvalidate"
  readonly keys: ReadonlyArray<string>
  readonly reason: string
}

/**
 * Service interface for the tRPC logger.
 *
 * @since 0.1.0
 */
export interface TrpcLoggerService {
  /**
   * Log a structured event.
   */
  readonly log: (event: TrpcLogEvent) => Effect.Effect<void>

  /**
   * Log a query lifecycle (start → success/error).
   * Returns the result of the effect.
   */
  readonly logQuery: <A, E, R>(
    procedure: string,
    input: unknown,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>

  /**
   * Log a mutation lifecycle (start → success/error).
   * Returns the result of the effect.
   */
  readonly logMutation: <A, E, R>(
    procedure: string,
    input: unknown,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>

  /**
   * Log a stream lifecycle.
   */
  readonly logStreamStart: (procedure: string, input: unknown, requestId: string) => Effect.Effect<void>
  readonly logStreamData: (procedure: string, chunkIndex: number, requestId: string) => Effect.Effect<void>
  readonly logStreamComplete: (
    procedure: string,
    totalChunks: number,
    durationMs: number,
    requestId: string,
  ) => Effect.Effect<void>
  readonly logStreamError: (
    procedure: string,
    chunksBeforeError: number,
    durationMs: number,
    error: unknown,
    requestId: string,
  ) => Effect.Effect<void>

  /**
   * Log WebSocket events.
   */
  readonly logWebSocketConnect: (clientId: string, remoteAddress?: string) => Effect.Effect<void>
  readonly logWebSocketDisconnect: (
    clientId: string,
    code: number,
    reason: string,
    durationMs: number,
  ) => Effect.Effect<void>
  readonly logWebSocketAuth: (
    clientId: string,
    success: boolean,
    userId: string | undefined,
    durationMs: number,
  ) => Effect.Effect<void>

  /**
   * Get current configuration.
   */
  readonly getConfig: () => Effect.Effect<TrpcLoggerConfig>
}

/**
 * Context.Tag for the TrpcLogger service.
 *
 * @since 0.1.0
 */
export class TrpcLogger extends Context.Tag("@effect-trpc/TrpcLogger")<TrpcLogger, TrpcLoggerService>() {}

// ─────────────────────────────────────────────────────────────────────────────
// Data Sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Redact sensitive fields from an object.
 *
 * @since 0.1.0
 */
export const redactSensitiveData = (
  data: unknown,
  redactFields: ReadonlyArray<string>,
  maxDepth: number,
  maxStringLength: number,
  currentDepth = 0,
): unknown => {
  if (currentDepth >= maxDepth) {
    return "[MAX_DEPTH]"
  }

  if (data === null || data === undefined) {
    return data
  }

  if (typeof data === "string") {
    if (data.length > maxStringLength) {
      return data.slice(0, maxStringLength) + `... [truncated ${data.length - maxStringLength} chars]`
    }
    return data
  }

  if (typeof data === "number" || typeof data === "boolean") {
    return data
  }

  if (typeof data === "bigint") {
    return data.toString() + "n"
  }

  if (Array.isArray(data)) {
    if (data.length > 100) {
      return [
        ...data.slice(0, 10).map((item) => redactSensitiveData(item, redactFields, maxDepth, maxStringLength, currentDepth + 1)),
        `... [${data.length - 10} more items]`,
      ]
    }
    return data.map((item) => redactSensitiveData(item, redactFields, maxDepth, maxStringLength, currentDepth + 1))
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {}
    const entries = Object.entries(data as Record<string, unknown>)

    for (const [key, value] of entries) {
      const lowerKey = key.toLowerCase()
      if (redactFields.some((field) => lowerKey.includes(field.toLowerCase()))) {
        result[key] = "[REDACTED]"
      } else {
        result[key] = redactSensitiveData(value, redactFields, maxDepth, maxStringLength, currentDepth + 1)
      }
    }
    return result
  }

  // Handle symbols and functions
  if (typeof data === "symbol") {
    return data.toString()
  }

  if (typeof data === "function") {
    return `[Function: ${data.name || "anonymous"}]`
  }

  // Fallback for any edge cases - use typeof for safety
  return `[${typeof data}]`
}

// ─────────────────────────────────────────────────────────────────────────────
// Request ID Generation
// ─────────────────────────────────────────────────────────────────────────────

let requestCounter = 0

/**
 * Generate a unique request ID for tracing.
 *
 * @since 0.1.0
 */
export const generateRequestId = (): string => {
  const timestamp = Date.now().toString(36)
  const counter = (requestCounter++).toString(36).padStart(4, "0")
  if (requestCounter >= 0x7fffffff) requestCounter = 0
  return `${timestamp}-${counter}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Formatting
// ─────────────────────────────────────────────────────────────────────────────

const categoryFromEvent = (event: TrpcLogEvent): LogCategory => {
  switch (event._tag) {
    case "QueryStart":
    case "QuerySuccess":
    case "QueryError":
      return "query"
    case "MutationStart":
    case "MutationSuccess":
    case "MutationError":
      return "mutation"
    case "StreamStart":
    case "StreamData":
    case "StreamComplete":
    case "StreamError":
      return "stream"
    case "SubscriptionStart":
    case "SubscriptionData":
    case "SubscriptionComplete":
    case "SubscriptionError":
      return "subscription"
    case "WebSocketConnect":
    case "WebSocketDisconnect":
    case "WebSocketAuth":
    case "WebSocketHeartbeat":
      return "websocket"
    case "MiddlewareStart":
    case "MiddlewareEnd":
      return "middleware"
    case "CacheHit":
    case "CacheMiss":
    case "CacheInvalidate":
      return "cache"
  }
}

const levelFromEvent = (event: TrpcLogEvent): LogLevel.LogLevel => {
  switch (event._tag) {
    case "QueryError":
    case "MutationError":
    case "StreamError":
    case "SubscriptionError":
      return LogLevel.Error

    case "QuerySuccess":
    case "MutationSuccess":
    case "StreamComplete":
    case "SubscriptionComplete":
    case "WebSocketAuth":
      return LogLevel.Info

    case "StreamData":
    case "SubscriptionData":
    case "MiddlewareStart":
    case "MiddlewareEnd":
    case "CacheHit":
    case "CacheMiss":
      return LogLevel.Debug

    default:
      return LogLevel.Info
  }
}

const formatEventMessage = (event: TrpcLogEvent): string => {
  switch (event._tag) {
    case "QueryStart":
      return `📤 Query ${event.procedure}`
    case "QuerySuccess":
      return `✅ Query ${event.procedure} (${event.durationMs}ms)`
    case "QueryError":
      return `❌ Query ${event.procedure} failed (${event.durationMs}ms)`
    case "MutationStart":
      return `📤 Mutation ${event.procedure}`
    case "MutationSuccess":
      return `✅ Mutation ${event.procedure} (${event.durationMs}ms)`
    case "MutationError":
      return `❌ Mutation ${event.procedure} failed (${event.durationMs}ms)`
    case "StreamStart":
      return `🌊 Stream ${event.procedure} started`
    case "StreamData":
      return `📦 Stream ${event.procedure} chunk #${event.chunkIndex}`
    case "StreamComplete":
      return `✅ Stream ${event.procedure} complete (${event.totalChunks} chunks, ${event.durationMs}ms)`
    case "StreamError":
      return `❌ Stream ${event.procedure} error after ${event.chunksBeforeError} chunks (${event.durationMs}ms)`
    case "SubscriptionStart":
      return `🔔 Subscription ${event.procedure} started [${event.subscriptionId}]`
    case "SubscriptionData":
      return `📨 Subscription ${event.procedure} message #${event.messageIndex}`
    case "SubscriptionComplete":
      return `🔕 Subscription ${event.procedure} ended (${event.reason}, ${event.totalMessages} msgs, ${event.durationMs}ms)`
    case "SubscriptionError":
      return `❌ Subscription ${event.procedure} error [${event.subscriptionId}]`
    case "WebSocketConnect":
      return `🔌 WebSocket connected [${event.clientId}]`
    case "WebSocketDisconnect":
      return `🔌 WebSocket disconnected [${event.clientId}] (code: ${event.code}, ${event.durationMs}ms)`
    case "WebSocketAuth":
      return event.success
        ? `🔐 WebSocket auth success [${event.clientId}] user=${event.userId} (${event.durationMs}ms)`
        : `🔐 WebSocket auth failed [${event.clientId}] (${event.durationMs}ms)`
    case "WebSocketHeartbeat":
      return `💓 WebSocket heartbeat [${event.clientId}] latency=${event.latencyMs}ms`
    case "MiddlewareStart":
      return `⚙️ Middleware ${event.name} → ${event.procedure}`
    case "MiddlewareEnd":
      return event.success
        ? `⚙️ Middleware ${event.name} ← ${event.procedure} (${event.durationMs}ms)`
        : `⚙️ Middleware ${event.name} ✗ ${event.procedure} (${event.durationMs}ms)`
    case "CacheHit":
      return `💾 Cache HIT ${event.key}`
    case "CacheMiss":
      return `💾 Cache MISS ${event.key}`
    case "CacheInvalidate":
      return `💾 Cache INVALIDATE ${event.keys.length} keys (${event.reason})`
  }
}

const eventToAnnotations = (event: TrpcLogEvent, config: TrpcLoggerConfig): Record<string, unknown> => {
  // Build annotations object - using object spread to avoid index signature issues
  const base = {
    category: categoryFromEvent(event),
    eventType: event._tag,
  }

  // Add event-specific annotations using spread
  switch (event._tag) {
    case "QueryStart":
    case "MutationStart":
      return {
        ...base,
        ...(config.includeInput ? { input: redactSensitiveData(event.input, config.redactFields, config.maxDepth, config.maxStringLength) } : {}),
        requestId: event.requestId,
        procedure: event.procedure,
      }

    case "QuerySuccess":
    case "MutationSuccess":
      return {
        ...base,
        ...(config.includeOutput ? { output: redactSensitiveData(event.output, config.redactFields, config.maxDepth, config.maxStringLength) } : {}),
        requestId: event.requestId,
        procedure: event.procedure,
        durationMs: event.durationMs,
      }

    case "QueryError":
    case "MutationError":
      return {
        ...base,
        error: redactSensitiveData(event.error, config.redactFields, config.maxDepth, config.maxStringLength),
        requestId: event.requestId,
        procedure: event.procedure,
        durationMs: event.durationMs,
      }

    case "StreamStart":
      return {
        ...base,
        ...(config.includeInput ? { input: redactSensitiveData(event.input, config.redactFields, config.maxDepth, config.maxStringLength) } : {}),
        requestId: event.requestId,
        procedure: event.procedure,
      }

    case "StreamData":
      return {
        ...base,
        requestId: event.requestId,
        procedure: event.procedure,
        chunkIndex: event.chunkIndex,
      }

    case "StreamComplete":
      return {
        ...base,
        requestId: event.requestId,
        procedure: event.procedure,
        totalChunks: event.totalChunks,
        durationMs: event.durationMs,
      }

    case "StreamError":
      return {
        ...base,
        error: redactSensitiveData(event.error, config.redactFields, config.maxDepth, config.maxStringLength),
        requestId: event.requestId,
        procedure: event.procedure,
        chunksBeforeError: event.chunksBeforeError,
        durationMs: event.durationMs,
      }

    case "SubscriptionStart":
      return {
        ...base,
        ...(config.includeInput ? { input: redactSensitiveData(event.input, config.redactFields, config.maxDepth, config.maxStringLength) } : {}),
        subscriptionId: event.subscriptionId,
        clientId: event.clientId,
        procedure: event.procedure,
      }

    case "SubscriptionData":
      return {
        ...base,
        subscriptionId: event.subscriptionId,
        procedure: event.procedure,
        messageIndex: event.messageIndex,
      }

    case "SubscriptionComplete":
      return {
        ...base,
        subscriptionId: event.subscriptionId,
        procedure: event.procedure,
        totalMessages: event.totalMessages,
        durationMs: event.durationMs,
        reason: event.reason,
      }

    case "SubscriptionError":
      return {
        ...base,
        error: redactSensitiveData(event.error, config.redactFields, config.maxDepth, config.maxStringLength),
        subscriptionId: event.subscriptionId,
        procedure: event.procedure,
      }

    case "WebSocketConnect":
      return {
        ...base,
        clientId: event.clientId,
        ...(event.remoteAddress ? { remoteAddress: event.remoteAddress } : {}),
      }

    case "WebSocketDisconnect":
      return {
        ...base,
        clientId: event.clientId,
        code: event.code,
        reason: event.reason,
        durationMs: event.durationMs,
      }

    case "WebSocketAuth":
      return {
        ...base,
        clientId: event.clientId,
        success: event.success,
        ...(event.userId ? { userId: event.userId } : {}),
        durationMs: event.durationMs,
      }

    case "WebSocketHeartbeat":
      return {
        ...base,
        clientId: event.clientId,
        latencyMs: event.latencyMs,
      }

    case "MiddlewareStart":
      return {
        ...base,
        name: event.name,
        procedure: event.procedure,
        requestId: event.requestId,
      }

    case "MiddlewareEnd":
      return {
        ...base,
        name: event.name,
        procedure: event.procedure,
        requestId: event.requestId,
        durationMs: event.durationMs,
        success: event.success,
      }

    case "CacheHit":
    case "CacheMiss":
      return {
        ...base,
        key: event.key,
        procedure: event.procedure,
      }

    case "CacheInvalidate":
      return {
        ...base,
        keys: event.keys,
        reason: event.reason,
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Implementation
// ─────────────────────────────────────────────────────────────────────────────

const makeTrpcLoggerService = (config: TrpcLoggerConfig): TrpcLoggerService => {
  const isCategoryEnabled = (category: LogCategory): boolean => {
    // Check disabled first (takes precedence)
    if (config.disabledCategories.includes(category)) {
      return false
    }
    // If enabledCategories is empty, all are enabled
    if (config.enabledCategories.length === 0) {
      return true
    }
    // Otherwise check if explicitly enabled
    return config.enabledCategories.includes(category)
  }

  const logEvent = (event: TrpcLogEvent): Effect.Effect<void> => {
    const category = categoryFromEvent(event)
    if (!isCategoryEnabled(category)) {
      return Effect.void
    }

    const eventLevel = levelFromEvent(event)
    if (LogLevel.lessThan(eventLevel, config.level)) {
      return Effect.void
    }

    const message = formatEventMessage(event)
    const annotations = eventToAnnotations(event, config)

    // Use appropriate log level
    const logEffect =
      eventLevel === LogLevel.Error
        ? Effect.logError(message)
        : eventLevel === LogLevel.Warning
          ? Effect.logWarning(message)
          : eventLevel === LogLevel.Debug
            ? Effect.logDebug(message)
            : Effect.logInfo(message)

    return logEffect.pipe(Effect.annotateLogs(annotations))
  }

  const logProcedureLifecycle = <A, E, R>(
    startEvent: (requestId: string) => TrpcLogEvent,
    successEvent: (requestId: string, durationMs: number, result: A) => TrpcLogEvent,
    errorEvent: (requestId: string, durationMs: number, error: unknown) => TrpcLogEvent,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.flatMap(Clock.currentTimeMillis, (startTime) => {
      const requestId = generateRequestId()

      return pipe(
        logEvent(startEvent(requestId)),
        Effect.flatMap(() =>
          Effect.flatMap(Effect.exit(effect), (exit) =>
            Effect.flatMap(Clock.currentTimeMillis, (endTime) => {
              const durationMs = Number(endTime - startTime)

              if (exit._tag === "Success") {
                return Effect.as(
                  logEvent(successEvent(requestId, durationMs, exit.value)),
                  exit.value,
                )
              } else {
                return Effect.zipRight(
                  logEvent(errorEvent(requestId, durationMs, exit.cause)),
                  Effect.failCause(exit.cause),
                )
              }
            }),
          ),
        ),
      )
    })

  return {
    log: logEvent,

    logQuery: (procedure, input, effect) =>
      logProcedureLifecycle(
        (requestId) => ({ _tag: "QueryStart", procedure, input, requestId }),
        (requestId, durationMs, output) => ({ _tag: "QuerySuccess", procedure, durationMs, output, requestId }),
        (requestId, durationMs, error) => ({ _tag: "QueryError", procedure, durationMs, error, requestId }),
        effect,
      ),

    logMutation: (procedure, input, effect) =>
      logProcedureLifecycle(
        (requestId) => ({ _tag: "MutationStart", procedure, input, requestId }),
        (requestId, durationMs, output) => ({ _tag: "MutationSuccess", procedure, durationMs, output, requestId }),
        (requestId, durationMs, error) => ({ _tag: "MutationError", procedure, durationMs, error, requestId }),
        effect,
      ),

    logStreamStart: (procedure, input, requestId) =>
      logEvent({ _tag: "StreamStart", procedure, input, requestId }),

    logStreamData: (procedure, chunkIndex, requestId) =>
      logEvent({ _tag: "StreamData", procedure, chunkIndex, requestId }),

    logStreamComplete: (procedure, totalChunks, durationMs, requestId) =>
      logEvent({ _tag: "StreamComplete", procedure, totalChunks, durationMs, requestId }),

    logStreamError: (procedure, chunksBeforeError, durationMs, error, requestId) =>
      logEvent({ _tag: "StreamError", procedure, chunksBeforeError, durationMs, error, requestId }),

    logWebSocketConnect: (clientId, remoteAddress) =>
      logEvent(
        remoteAddress !== undefined
          ? { _tag: "WebSocketConnect", clientId, remoteAddress }
          : { _tag: "WebSocketConnect", clientId },
      ),

    logWebSocketDisconnect: (clientId, code, reason, durationMs) =>
      logEvent({ _tag: "WebSocketDisconnect", clientId, code, reason, durationMs }),

    logWebSocketAuth: (clientId, success, userId, durationMs) =>
      logEvent(
        userId !== undefined
          ? { _tag: "WebSocketAuth", clientId, success, userId, durationMs }
          : { _tag: "WebSocketAuth", clientId, success, durationMs },
      ),

    getConfig: () => Effect.succeed(config),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a TrpcLogger layer with custom configuration.
 *
 * @since 0.1.0
 */
export const makeTrpcLoggerLayer = (
  config: Partial<TrpcLoggerConfig> = {},
): Layer.Layer<TrpcLogger> => {
  const finalConfig: TrpcLoggerConfig = {
    ...defaultConfig,
    ...config,
  }
  return Layer.succeed(TrpcLogger, makeTrpcLoggerService(finalConfig))
}

/**
 * Default TrpcLogger layer with standard configuration.
 *
 * @since 0.1.0
 */
export const TrpcLoggerLive: Layer.Layer<TrpcLogger> = makeTrpcLoggerLayer()

/**
 * Development TrpcLogger with verbose output.
 *
 * @since 0.1.0
 */
export const TrpcLoggerDev: Layer.Layer<TrpcLogger> = makeTrpcLoggerLayer({
  level: LogLevel.Debug,
  includeInput: true,
  includeOutput: true,
  includeTiming: true,
})

/**
 * Production TrpcLogger with minimal output.
 *
 * @since 0.1.0
 */
export const TrpcLoggerProd: Layer.Layer<TrpcLogger> = makeTrpcLoggerLayer({
  level: LogLevel.Info,
  includeInput: false,
  includeOutput: false,
  includeTiming: true,
  disabledCategories: ["middleware", "cache"],
})

/**
 * Silent TrpcLogger that logs nothing.
 * Useful for testing.
 *
 * @since 0.1.0
 */
export const TrpcLoggerSilent: Layer.Layer<TrpcLogger> = makeTrpcLoggerLayer({
  level: LogLevel.None,
})

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a query using the TrpcLogger service.
 *
 * @since 0.1.0
 */
export const logQuery = <A, E, R>(
  procedure: string,
  input: unknown,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | TrpcLogger> =>
  Effect.flatMap(TrpcLogger, (logger) => logger.logQuery(procedure, input, effect))

/**
 * Log a mutation using the TrpcLogger service.
 *
 * @since 0.1.0
 */
export const logMutation = <A, E, R>(
  procedure: string,
  input: unknown,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | TrpcLogger> =>
  Effect.flatMap(TrpcLogger, (logger) => logger.logMutation(procedure, input, effect))

/**
 * Log a raw event using the TrpcLogger service.
 *
 * @since 0.1.0
 */
export const logTrpcEvent = (event: TrpcLogEvent): Effect.Effect<void, never, TrpcLogger> =>
  Effect.flatMap(TrpcLogger, (logger) => logger.log(event))

// ─────────────────────────────────────────────────────────────────────────────
// Pretty Logger Preset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combined layer that provides both TrpcLogger and Logger.pretty.
 *
 * This is the recommended setup for development:
 *
 * ```typescript
 * import { TrpcLoggerPretty } from "effect-trpc/shared/logging"
 *
 * const program = myEffect.pipe(Effect.provide(TrpcLoggerPretty))
 * ```
 *
 * @since 0.1.0
 */
export { Logger } from "effect"
