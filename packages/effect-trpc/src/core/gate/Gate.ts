/**
 * @module effect-trpc/core/gate/Gate
 *
 * Gate primitive for flow control using Effect's Semaphore.
 *
 * A Gate is a binary flow control mechanism:
 * - When **open**: effects pass through immediately
 * - When **closed**: effects either wait, fail, or get queued (configurable)
 *
 * Built on Effect's Semaphore for atomic state transitions and built-in waiting.
 *
 * @example
 * ```ts
 * import { Gate } from 'effect-trpc/core'
 * import { Effect } from 'effect'
 *
 * const program = Effect.gen(function* () {
 *   // Create a gate (open by default)
 *   const authGate = yield* Gate.make('auth', {
 *     initiallyOpen: false,
 *     closedBehavior: 'fail',
 *   })
 *
 *   // Control the gate
 *   yield* Gate.open(authGate)
 *   yield* Gate.close(authGate)
 *
 *   // Run effect only when gate is open
 *   yield* Gate.whenOpen(authGate, myEffect)
 *
 *   // Observe state
 *   const isOpen = yield* Gate.isOpen(authGate)
 * })
 * ```
 *
 * @since 0.2.0
 */

import * as Effect from "effect/Effect"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Stream from "effect/Stream"
import * as Scope from "effect/Scope"
import * as Fiber from "effect/Fiber"
import { GateClosedError } from "./errors.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Behavior when attempting to pass through a closed gate.
 *
 * - `'wait'`: Block until the gate opens (default)
 * - `'fail'`: Immediately fail with GateClosedError
 * - `'queue'`: Add to queue, return Deferred (for offline queue integration)
 *
 * @since 0.2.0
 * @category types
 */
export type ClosedBehavior = "wait" | "fail" | "queue"

/**
 * Current state of a gate.
 *
 * @since 0.2.0
 * @category types
 */
export interface GateState {
  readonly isOpen: boolean
  readonly closedAt: number | null
  readonly openedAt: number | null
}

/**
 * A Gate instance for flow control.
 *
 * @since 0.2.0
 * @category types
 */
export interface Gate {
  readonly _tag: "Gate"
  readonly name: string
  readonly state: SubscriptionRef.SubscriptionRef<GateState>
  readonly semaphore: Effect.Semaphore
  readonly closedBehavior: ClosedBehavior
}

/**
 * Options for creating a gate.
 *
 * @since 0.2.0
 * @category types
 */
export interface GateOptions {
  /**
   * Whether the gate starts open.
   * @default true
   */
  readonly initiallyOpen?: boolean

  /**
   * What to do when attempting to pass through a closed gate.
   * @default 'wait'
   */
  readonly closedBehavior?: ClosedBehavior
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type guard to check if a value is a Gate.
 *
 * @since 0.2.0
 * @category guards
 */
export const isGate = (u: unknown): u is Gate =>
  typeof u === "object" &&
  u !== null &&
  "_tag" in u &&
  u._tag === "Gate" &&
  "name" in u &&
  typeof (u as Gate).name === "string" &&
  "state" in u &&
  "semaphore" in u &&
  "closedBehavior" in u

// ─────────────────────────────────────────────────────────────────────────────
// Constructor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new gate.
 *
 * @param name - Identifier for the gate (used in error messages)
 * @param options - Configuration options
 * @returns Effect that yields a Gate, requires Scope for cleanup
 *
 * @example
 * ```ts
 * const gate = yield* Gate.make('auth', {
 *   initiallyOpen: false,
 *   closedBehavior: 'fail',
 * })
 * ```
 *
 * @since 0.2.0
 * @category constructors
 */
export const make = (
  name: string,
  options: GateOptions = {},
): Effect.Effect<Gate, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { initiallyOpen = true, closedBehavior = "wait" } = options

    // Binary semaphore: 1 permit when open, 0 when closed
    const semaphore = yield* Effect.makeSemaphore(initiallyOpen ? 1 : 0)

    // Observable state
    const state = yield* SubscriptionRef.make<GateState>({
      isOpen: initiallyOpen,
      closedAt: initiallyOpen ? null : Date.now(),
      openedAt: initiallyOpen ? Date.now() : null,
    })

    return {
      _tag: "Gate" as const,
      name,
      state,
      semaphore,
      closedBehavior,
    }
  })

/**
 * Create a gate without requiring Scope (for simpler use cases).
 * The gate will not be automatically cleaned up.
 *
 * @since 0.2.0
 * @category constructors
 */
export const makeUnscoped = (
  name: string,
  options: GateOptions = {},
): Effect.Effect<Gate> =>
  Effect.scoped(make(name, options))

// ─────────────────────────────────────────────────────────────────────────────
// Control
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a gate, allowing effects to pass through.
 * If already open, this is a no-op.
 *
 * @since 0.2.0
 * @category control
 */
export const open = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (current.isOpen) return

    // Release the permit (unblocks waiters)
    yield* gate.semaphore.release(1)

    yield* SubscriptionRef.set(gate.state, {
      isOpen: true,
      closedAt: current.closedAt,
      openedAt: Date.now(),
    })
  })

/**
 * Close a gate, blocking or failing effects that try to pass through.
 * If already closed, this is a no-op.
 *
 * @since 0.2.0
 * @category control
 */
export const close = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (!current.isOpen) return

    // Take the permit (blocks future whenOpen calls)
    yield* gate.semaphore.take(1)

    yield* SubscriptionRef.set(gate.state, {
      isOpen: false,
      closedAt: Date.now(),
      openedAt: current.openedAt,
    })
  })

/**
 * Toggle a gate's state (open -> closed, closed -> open).
 *
 * @since 0.2.0
 * @category control
 */
export const toggle = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (current.isOpen) {
      yield* close(gate)
    } else {
      yield* open(gate)
    }
  })

// ─────────────────────────────────────────────────────────────────────────────
// Usage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run an effect only when the gate is open.
 *
 * Behavior when closed depends on the gate's `closedBehavior`:
 * - `'wait'`: Block until the gate opens, then run the effect
 * - `'fail'`: Immediately fail with GateClosedError
 * - `'queue'`: Same as wait (queue integration handled separately)
 *
 * @since 0.2.0
 * @category usage
 */
export const whenOpen = <A, E, R>(
  gate: Gate,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | GateClosedError, R> => {
  switch (gate.closedBehavior) {
    case "wait":
    case "queue":
      // Semaphore handles waiting automatically via withPermits(1)
      return gate.semaphore.withPermits(1)(effect)

    case "fail":
      return Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(gate.state)
        if (!state.isOpen) {
          return yield* Effect.fail(
            new GateClosedError({
              gate: gate.name,
              closedAt: state.closedAt ?? undefined,
            }),
          )
        }
        return yield* gate.semaphore.withPermits(1)(effect)
      })
  }
}

/**
 * Compose multiple gates - effect runs only when ALL gates are open.
 *
 * @since 0.2.0
 * @category usage
 */
export const whenAllOpen = <A, E, R>(
  gates: ReadonlyArray<Gate>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | GateClosedError, R> =>
  gates.reduceRight(
    (acc, gate) => whenOpen(gate, acc),
    effect as Effect.Effect<A, E | GateClosedError, R>,
  )

// ─────────────────────────────────────────────────────────────────────────────
// Observation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a gate is currently open.
 *
 * @since 0.2.0
 * @category observation
 */
export const isOpen = (gate: Gate): Effect.Effect<boolean> =>
  SubscriptionRef.get(gate.state).pipe(Effect.map((s) => s.isOpen))

/**
 * Check if a gate is currently closed.
 *
 * @since 0.2.0
 * @category observation
 */
export const isClosed = (gate: Gate): Effect.Effect<boolean> =>
  SubscriptionRef.get(gate.state).pipe(Effect.map((s) => !s.isOpen))

/**
 * Get the full state of a gate.
 *
 * @since 0.2.0
 * @category observation
 */
export const getState = (gate: Gate): Effect.Effect<GateState> =>
  SubscriptionRef.get(gate.state)

/**
 * Wait until the gate is open.
 * Completes immediately if already open.
 *
 * @since 0.2.0
 * @category observation
 */
export const awaitOpen = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (current.isOpen) return

    yield* gate.state.changes.pipe(
      Stream.filter((s) => s.isOpen),
      Stream.take(1),
      Stream.runDrain,
    )
  })

/**
 * Wait until the gate is closed.
 * Completes immediately if already closed.
 *
 * @since 0.2.0
 * @category observation
 */
export const awaitClose = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (!current.isOpen) return

    yield* gate.state.changes.pipe(
      Stream.filter((s) => !s.isOpen),
      Stream.take(1),
      Stream.runDrain,
    )
  })

/**
 * Stream of gate open/closed state changes.
 * Only emits when the state actually changes.
 *
 * @since 0.2.0
 * @category observation
 */
export const changes = (gate: Gate): Stream.Stream<boolean> =>
  gate.state.changes.pipe(
    Stream.map((s) => s.isOpen),
    Stream.changes,
  )

/**
 * Subscribe to gate state changes (callback-based for React integration).
 * Returns a cleanup function to unsubscribe.
 *
 * @since 0.2.0
 * @category observation
 */
export const subscribe = (gate: Gate, callback: (isOpen: boolean) => void): (() => void) => {
  const fiber = Effect.runFork(
    changes(gate).pipe(
      Stream.tap((isOpen) => Effect.sync(() => callback(isOpen))),
      Stream.runDrain,
    ),
  )

  return () => {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gate module - all functions as a namespace.
 *
 * @since 0.2.0
 * @category modules
 */
export const Gate = {
  make,
  makeUnscoped,
  open,
  close,
  toggle,
  whenOpen,
  whenAllOpen,
  isOpen,
  isClosed,
  getState,
  awaitOpen,
  awaitClose,
  changes,
  subscribe,
  isGate,
} as const
