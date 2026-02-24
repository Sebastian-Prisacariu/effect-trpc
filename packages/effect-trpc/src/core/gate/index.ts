/**
 * @module effect-trpc/core/gate
 *
 * Gate primitive for flow control.
 *
 * @example
 * ```ts
 * import { Gate } from 'effect-trpc'
 *
 * const program = Effect.gen(function* () {
 *   const authGate = yield* Gate.make('auth', { initiallyOpen: false })
 *
 *   // Control
 *   yield* Gate.open(authGate)
 *
 *   // Use
 *   yield* Gate.whenOpen(authGate, myEffect)
 *
 *   // Observe
 *   const isOpen = yield* Gate.isOpen(authGate)
 * })
 * ```
 *
 * @since 0.3.0
 */

// Types (type-only exports)
export type { ClosedBehavior, GateState, Gate as GateInstance, GateOptions } from "./Gate.js"

// Values (runtime exports)
export {
  // Type guards
  isGate,
  // Constructors
  make,
  makeUnscoped,
  // Control
  open,
  close,
  toggle,
  // Usage
  whenOpen,
  whenAllOpen,
  // Observation
  isOpen,
  isClosed,
  getState,
  awaitOpen,
  awaitClose,
  changes,
  subscribe,
  // Namespace (contains all functions)
  Gate,
} from "./Gate.js"

export { GateClosedError, GateErrorTypeId } from "./errors.js"
