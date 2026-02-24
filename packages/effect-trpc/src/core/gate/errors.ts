/**
 * @module effect-trpc/core/gate/errors
 *
 * Errors for the Gate primitive.
 *
 * @since 0.2.0
 */

import * as Schema from "effect/Schema"

// ─────────────────────────────────────────────────────────────────────────────
// Type Identification
// ─────────────────────────────────────────────────────────────────────────────

export const GateErrorTypeId: unique symbol = Symbol.for("@effect-trpc/GateError")
export type GateErrorTypeId = typeof GateErrorTypeId

// ─────────────────────────────────────────────────────────────────────────────
// Gate Closed Error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when attempting to pass through a closed gate with 'fail' behavior.
 *
 * @since 0.2.0
 * @category errors
 */
export class GateClosedError extends Schema.TaggedError<GateClosedError>()("GateClosedError", {
  gate: Schema.String,
  closedAt: Schema.optional(Schema.Number),
}) {
  readonly [GateErrorTypeId]: GateErrorTypeId = GateErrorTypeId
  readonly isRetryable = true

  override get message(): string {
    return `Gate "${this.gate}" is closed`
  }
}
