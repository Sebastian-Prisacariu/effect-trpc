/**
 * @module effect-trpc/ws/server/MessageRateLimiter
 *
 * Rate limiting for WebSocket messages to prevent clients from flooding the server.
 * Uses a sliding window approach with per-client tracking.
 *
 * @example
 * ```ts
 * import { MessageRateLimiter } from 'effect-trpc/ws/server'
 *
 * // Use with default config
 * const program = Effect.gen(function* () {
 *   const rateLimiter = yield* MessageRateLimiter
 *   
 *   // Check if client can send a message
 *   yield* rateLimiter.checkLimit(clientId)
 * }).pipe(Effect.provide(MessageRateLimiterLive))
 *
 * // Or with custom config
 * const customProgram = program.pipe(
 *   Effect.provide(makeMessageRateLimiterLayer({
 *     maxMessages: 200,
 *     windowMs: 30000, // 30 seconds
 *   }))
 * )
 * ```
 *
 * @since 0.1.0
 */

import * as Effect from "effect/Effect"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import type { ClientId } from "../types.js"
import { MessageRateLimitExceededError } from "../errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for message rate limiting.
 *
 * @since 0.1.0
 * @category Configuration
 */
export interface RateLimitConfig {
  /**
   * Maximum number of messages allowed per time window.
   * @default 100
   */
  readonly maxMessages: number

  /**
   * Time window in milliseconds.
   * @default 60000 (1 minute)
   */
  readonly windowMs: number
}

/**
 * Default rate limit configuration.
 * 100 messages per minute should be sufficient for most use cases
 * while preventing abuse.
 *
 * @since 0.1.0
 * @category Configuration
 */
export const defaultRateLimitConfig: RateLimitConfig = {
  maxMessages: 100,
  windowMs: 60000, // 1 minute
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal state for tracking rate limits per client.
 * @internal
 */
interface RateLimitState {
  /** Number of messages in current window */
  readonly count: number
  /** Timestamp when current window started */
  readonly windowStart: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service interface for message rate limiting.
 *
 * @since 0.1.0
 * @category Models
 */
export interface MessageRateLimiterService {
  /**
   * Check if a client is within rate limits.
   * Increments the message count and fails if limit exceeded.
   *
   * @param clientId - The client to check
   * @returns Effect that succeeds if within limit, fails with MessageRateLimitExceededError if exceeded
   */
  readonly checkLimit: (clientId: ClientId) => Effect.Effect<void, MessageRateLimitExceededError>

  /**
   * Get the current rate limit state for a client.
   * Useful for debugging and monitoring.
   *
   * @param clientId - The client to check
   * @returns The current count and remaining time in window, or none if no state exists
   */
  readonly getState: (clientId: ClientId) => Effect.Effect<Option.Option<{
    readonly count: number
    readonly remainingMs: number
    readonly maxMessages: number
  }>>

  /**
   * Clear rate limit state for a client.
   * Should be called when a client disconnects.
   *
   * @param clientId - The client to clear
   */
  readonly clearClient: (clientId: ClientId) => Effect.Effect<void>

  /**
   * Get the current configuration.
   */
  readonly config: RateLimitConfig
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Service for WebSocket message rate limiting.
 *
 * @example
 * ```ts
 * import { MessageRateLimiter, MessageRateLimiterLive } from 'effect-trpc/ws/server'
 *
 * const program = Effect.gen(function* () {
 *   const rateLimiter = yield* MessageRateLimiter
 *   
 *   // Called for each incoming message
 *   yield* rateLimiter.checkLimit(clientId)
 *   
 *   // Process message...
 * }).pipe(Effect.provide(MessageRateLimiterLive))
 * ```
 *
 * @since 0.1.0
 * @category Tags
 */
export class MessageRateLimiter extends Context.Tag("@effect-trpc/MessageRateLimiter")<
  MessageRateLimiter,
  MessageRateLimiterService
>() {
  /**
   * Live layer with default configuration.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Live: Layer.Layer<MessageRateLimiter>

  /**
   * No-op layer for testing or when rate limiting is disabled.
   *
   * @since 0.1.0
   * @category Layers
   */
  static Disabled: Layer.Layer<MessageRateLimiter>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

const makeMessageRateLimiter = (config: RateLimitConfig): Effect.Effect<MessageRateLimiterService> =>
  Effect.gen(function* () {
    // Per-client rate limit state
    const stateRef = yield* Ref.make(HashMap.empty<ClientId, RateLimitState>())

    const checkLimit = (clientId: ClientId): Effect.Effect<void, MessageRateLimitExceededError> =>
      Effect.gen(function* () {
        const now = Date.now()
        const states = yield* Ref.get(stateRef)
        const existingState = HashMap.get(states, clientId)

        // Get or create state
        let state: RateLimitState
        if (Option.isSome(existingState)) {
          state = existingState.value
        } else {
          state = { count: 0, windowStart: now }
        }

        // Reset window if expired
        if (now - state.windowStart > config.windowMs) {
          state = { count: 0, windowStart: now }
        }

        // Increment count
        const newCount = state.count + 1
        const newState: RateLimitState = { count: newCount, windowStart: state.windowStart }

        // Update state
        yield* Ref.update(stateRef, (s) => HashMap.set(s, clientId, newState))

        // Check limit
        if (newCount > config.maxMessages) {
          const retryAfterMs = state.windowStart + config.windowMs - now
          return yield* Effect.fail(
            new MessageRateLimitExceededError({
              clientId,
              currentCount: newCount,
              maxMessages: config.maxMessages,
              retryAfterMs: Math.max(0, retryAfterMs),
            }),
          )
        }
      })

    const getState = (clientId: ClientId) =>
      Effect.gen(function* () {
        const now = Date.now()
        const states = yield* Ref.get(stateRef)
        const existingState = HashMap.get(states, clientId)

        if (Option.isNone(existingState)) {
          return Option.none()
        }

        const state = existingState.value
        const windowEnd = state.windowStart + config.windowMs
        const remainingMs = Math.max(0, windowEnd - now)

        return Option.some({
          count: state.count,
          remainingMs,
          maxMessages: config.maxMessages,
        })
      })

    const clearClient = (clientId: ClientId) =>
      Ref.update(stateRef, (s) => HashMap.remove(s, clientId))

    return {
      checkLimit,
      getState,
      clearClient,
      config,
    } satisfies MessageRateLimiterService
  })

const makeNoOpRateLimiter = Effect.succeed<MessageRateLimiterService>({
  checkLimit: () => Effect.void,
  getState: () => Effect.succeed(Option.none()),
  clearClient: () => Effect.void,
  config: { maxMessages: Infinity, windowMs: 0 },
})

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a rate limiter layer with custom configuration.
 *
 * @param config - Rate limit configuration
 * @returns Layer providing MessageRateLimiter
 *
 * @since 0.1.0
 * @category Layers
 */
export const makeMessageRateLimiterLayer = (config: RateLimitConfig): Layer.Layer<MessageRateLimiter> =>
  Layer.effect(MessageRateLimiter, makeMessageRateLimiter(config))

/**
 * Live layer with default configuration (100 messages per minute).
 *
 * @since 0.1.0
 * @category Layers
 */
export const MessageRateLimiterLive: Layer.Layer<MessageRateLimiter> = makeMessageRateLimiterLayer(
  defaultRateLimitConfig,
)

/**
 * No-op layer for testing or when rate limiting is disabled.
 * Always allows messages through.
 *
 * @since 0.1.0
 * @category Layers
 */
export const MessageRateLimiterDisabled: Layer.Layer<MessageRateLimiter> = Layer.effect(
  MessageRateLimiter,
  makeNoOpRateLimiter,
)

// Assign static properties
MessageRateLimiter.Live = MessageRateLimiterLive
MessageRateLimiter.Disabled = MessageRateLimiterDisabled
