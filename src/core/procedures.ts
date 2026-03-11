/**
 * @module effect-trpc/core/procedures
 * 
 * Group related procedures together and define implementation contracts.
 * 
 * This is where interface-first shines: we define WHAT the procedures do,
 * and the `implement` method returns a Layer that provides the HOW.
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { ProcedureDefinition, ProcedureType, InferInput, InferOutput } from "./procedure.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A record of procedure definitions.
 */
export type ProcedureRecord = Record<string, ProcedureDefinition<any, any, any>>

/**
 * Handler type for a single procedure.
 */
export type ProcedureHandler<TDef extends ProcedureDefinition<any, any, any>> =
  TDef extends ProcedureDefinition<infer I, infer O, any>
    ? (input: I) => Effect.Effect<O, any, any>
    : never

/**
 * Handler record for a procedures group.
 */
export type HandlersFor<P extends ProcedureRecord> = {
  readonly [K in keyof P]: ProcedureHandler<P[K]>
}

/**
 * Extract all requirements from handlers.
 */
export type HandlersRequirements<H> = H extends Record<string, (input: any) => Effect.Effect<any, any, infer R>>
  ? R
  : never

/**
 * Service interface for a procedures group.
 */
export interface ProceduresService<
  Name extends string,
  P extends ProcedureRecord,
> {
  readonly _name: Name
  readonly handlers: HandlersFor<P>
}

/**
 * A group of related procedure definitions.
 */
export interface ProceduresGroup<
  Name extends string,
  P extends ProcedureRecord,
> {
  readonly _tag: "ProceduresGroup"
  readonly name: Name
  readonly procedures: P
  
  /**
   * Service tag for dependency injection.
   */
  readonly tag: Context.Tag<
    ProceduresService<Name, P>,
    ProceduresService<Name, P>
  >
  
  /**
   * Create a Layer implementing this procedures group.
   * 
   * @example
   * ```ts
   * const UserProceduresLive = UserProcedures.implement({
   *   list: () => Effect.succeed([]),
   *   byId: ({ id }) => db.findUser(id),
   *   create: (input) => db.createUser(input),
   * })
   * ```
   */
  implement<R>(
    handlers: {
      readonly [K in keyof P]: (
        input: InferInput<P[K]>
      ) => Effect.Effect<InferOutput<P[K]>, any, R>
    }
  ): Layer.Layer<ProceduresService<Name, P>, never, R>
  
  /**
   * Create a test Layer with in-memory implementations.
   */
  implementTest(
    handlers: {
      readonly [K in keyof P]: (
        input: InferInput<P[K]>
      ) => Effect.Effect<InferOutput<P[K]>, any, never>
    }
  ): Layer.Layer<ProceduresService<Name, P>, never, never>
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a procedures group.
 * 
 * @param name - Unique name for this group (used as namespace in router)
 * @param procs - Record of procedure definitions
 * 
 * @example
 * ```ts
 * const UserProcedures = procedures('user', {
 *   list: procedure.output(Schema.Array(UserSchema)).query(),
 *   byId: procedure.input(IdSchema).output(UserSchema).query(),
 *   create: procedure.input(CreateSchema).output(UserSchema).mutation(),
 * })
 * ```
 */
export const procedures = <
  Name extends string,
  P extends ProcedureRecord,
>(
  name: Name,
  procs: P,
): ProceduresGroup<Name, P> => {
  // Create the service tag
  const tag = Context.GenericTag<ProceduresService<Name, P>>(
    `ProceduresService:${name}`
  )
  
  return {
    _tag: "ProceduresGroup",
    name,
    procedures: procs,
    tag,
    
    implement: (handlers) =>
      Layer.effect(
        tag,
        Effect.map(
          Effect.context<any>(),
          (ctx) => ({
            _name: name,
            handlers: Object.fromEntries(
              Object.entries(handlers).map(([key, handler]) => [
                key,
                (input: any) => (handler as any)(input).pipe(Effect.provide(ctx)),
              ])
            ) as HandlersFor<P>,
          })
        )
      ) as Layer.Layer<ProceduresService<Name, P>, never, any>,
    
    implementTest: (handlers) =>
      Layer.succeed(tag, {
        _name: name,
        handlers: handlers as HandlersFor<P>,
      }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

export const isProceduresGroup = (value: unknown): value is ProceduresGroup<string, ProcedureRecord> =>
  typeof value === "object" &&
  value !== null &&
  (value as any)._tag === "ProceduresGroup"
