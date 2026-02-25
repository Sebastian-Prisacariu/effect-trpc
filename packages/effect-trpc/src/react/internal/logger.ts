/**
 * @module effect-trpc/react/internal/logger
 * @internal
 *
 * Development logging for RPC calls.
 * Provides tRPC-style colored console output for queries, mutations, and streams.
 */

import * as Effect from "effect/Effect"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProcedureType = "query" | "mutation" | "stream" | "chat" | "subscription"

export interface LoggerConfig {
  /**
   * Enable/disable logging.
   * @default true in development, false in production
   */
  readonly enabled?: boolean

  /**
   * Include input in logs.
   * @default true
   */
  readonly logInput?: boolean

  /**
   * Include result in logs.
   * @default true
   */
  readonly logResult?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger State
// ─────────────────────────────────────────────────────────────────────────────

let requestCounter = 0

const isProduction = (): boolean => {
  try {
    return typeof process !== "undefined" && process.env["NODE_ENV"] === "production"
  } catch {
    return false
  }
}

let globalConfig: LoggerConfig = {
  enabled: !isProduction(),
  logInput: true,
  logResult: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Colors
// ─────────────────────────────────────────────────────────────────────────────

const colors: Record<ProcedureType | "error", string> = {
  query: "#61dafb", // cyan (React blue)
  mutation: "#ff6b6b", // coral red
  stream: "#9b59b6", // purple
  chat: "#3498db", // blue
  subscription: "#2ecc71", // green
  error: "#e74c3c", // red
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configure the global logger settings.
 */
export const configureLogger = (config: Partial<LoggerConfig>): void => {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get the current logger configuration.
 */
export const getLoggerConfig = (): LoggerConfig => ({ ...globalConfig })

/**
 * Check if logging is enabled.
 */
export const isLoggingEnabled = (): boolean => globalConfig.enabled ?? true

/**
 * Get the next request ID.
 */
export const nextRequestId = (): number => ++requestCounter

/**
 * Log the start of an RPC call.
 */
const logStart = (type: ProcedureType, id: number, path: string, input: unknown): void => {
  if (!globalConfig.enabled) return

  const color = colors[type]
  const message = `>> ${type} #${id}  ${path}`

  if (globalConfig.logInput && input !== undefined) {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold`, { input })
  } else {
    console.log(`%c${message}`, `color: ${color}; font-weight: bold`)
  }
}

/**
 * Log the successful completion of an RPC call.
 */
const logEnd = (
  type: ProcedureType,
  id: number,
  path: string,
  elapsedMs: number,
  input: unknown,
  result: unknown,
): void => {
  if (!globalConfig.enabled) return

  const color = colors[type]
  const message = `<< ${type} #${id}  ${path}`

  const details: { elapsedMs: number; input?: unknown; result?: unknown } = { elapsedMs }
  if (globalConfig.logInput && input !== undefined) details.input = input
  if (globalConfig.logResult && result !== undefined) details.result = result

  console.log(`%c${message}`, `color: ${color}; font-weight: bold`, details)
}

/**
 * Log an RPC call error.
 */
const logError = (
  type: ProcedureType,
  id: number,
  path: string,
  elapsedMs: number,
  input: unknown,
  error: unknown,
): void => {
  if (!globalConfig.enabled) return

  const color = colors.error
  const message = `!! ${type} #${id}  ${path}`

  const details: { elapsedMs: number; input?: unknown; error: unknown } = { elapsedMs, error }
  if (globalConfig.logInput && input !== undefined) details.input = input

  console.log(`%c${message}`, `color: ${color}; font-weight: bold`, details)
}

/**
 * Create a logging wrapper for an RPC effect.
 * Logs start, end/error with timing.
 */
export const withRpcLogging = <A, E, R>(
  type: ProcedureType,
  path: string,
  input: unknown,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  if (!globalConfig.enabled) {
    return effect
  }

  const id = nextRequestId()

  return Effect.suspend(() => {
    const startTime = Date.now()
    logStart(type, id, path, input)

    return effect.pipe(
      Effect.tap((result) =>
        Effect.sync(() => logEnd(type, id, path, Date.now() - startTime, input, result)),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => logError(type, id, path, Date.now() - startTime, input, error)),
      ),
    )
  })
}

/**
 * Create a stream logger that returns callbacks for manual logging.
 * Used for streams where we need to log at different points in the lifecycle.
 */
export const createStreamLogger = (
  type: ProcedureType,
  path: string,
  input: unknown,
): {
  readonly id: number
  readonly startTime: number
  readonly logStreamStart: () => void
  readonly logStreamEnd: (partCount: number) => void
  readonly logStreamError: (error: unknown) => void
} => {
  const id = nextRequestId()
  const startTime = Date.now()

  return {
    id,
    startTime,
    logStreamStart: () => logStart(type, id, path, input),
    logStreamEnd: (partCount: number) => {
      if (!globalConfig.enabled) return
      const color = colors[type]
      const message = `<< ${type} #${id}  ${path}`
      console.log(`%c${message}`, `color: ${color}; font-weight: bold`, {
        elapsedMs: Date.now() - startTime,
        partCount,
      })
    },
    logStreamError: (error: unknown) =>
      logError(type, id, path, Date.now() - startTime, input, error),
  }
}
