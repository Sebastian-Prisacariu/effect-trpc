/**
 * @module effect-trpc/core/server/procedures
 *
 * Procedures grouping for organizing related procedure definitions.
 *
 * Procedures groups accept Effects and return Effects, enabling automatic
 * requirement tracking via Effect's type system. When you compose procedure
 * definitions, their requirements are unioned in the R channel.
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Stream from "effect/Stream"
import type {
  AnyMiddlewareDefinition,
  BaseContext,
  MiddlewareDefinition,
  MiddlewareService,
} from "./middleware.js"
import type { ProcedureDefinition, ProcedureHandlerResult, ProcedureType } from "./procedure.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ProcedureRecord = Record<string, unknown>

export interface SubscriptionContext {
  readonly subscriptionId: string
  readonly clientId: string
  readonly userId: string
  readonly metadata: unknown
  readonly path: string
}

export type UnsubscribeReason =
  | { readonly _tag: "ClientUnsubscribed" }
  | { readonly _tag: "ClientDisconnected" }
  | { readonly _tag: "StreamCompleted" }
  | { readonly _tag: "StreamErrored"; readonly cause: unknown }
  | { readonly _tag: "ServerShutdown" }

export const UnsubscribeReason = {
  ClientUnsubscribed: { _tag: "ClientUnsubscribed" } as const,
  ClientDisconnected: { _tag: "ClientDisconnected" } as const,
  StreamCompleted: { _tag: "StreamCompleted" } as const,
  StreamErrored: (cause: unknown): UnsubscribeReason => ({ _tag: "StreamErrored", cause }),
  ServerShutdown: { _tag: "ServerShutdown" } as const,
}

export interface SubscriptionHandler<I, A, E, R> {
  readonly onSubscribe: (
    input: I,
    context: SubscriptionContext,
  ) => Effect.Effect<Stream.Stream<A, E>, E, R>
  readonly onUnsubscribe?: (
    context: SubscriptionContext,
    reason: UnsubscribeReason,
  ) => Effect.Effect<void, never, unknown>
  readonly onClientMessage?: (
    message: unknown,
    context: SubscriptionContext,
  ) => Effect.Effect<void, never, unknown>
}

/**
 * Handler implementation for a procedure.
 */
type ProcedureImplementation<T> =
  T extends ProcedureDefinition<
    infer I,
    infer A,
    infer E,
    infer Ctx extends BaseContext,
    infer Type extends ProcedureType
  >
    ? Type extends "subscription"
      ? SubscriptionHandler<I, A, E, unknown>
      : (ctx: Ctx, input: I) => ProcedureHandlerResult<A, E, Type, unknown>
    : never

/**
 * Extract procedure definition from an Effect (for handler type inference).
 * Uses Effect.Effect.Success to extract the A type from Effect<A, E, R>.
 */
type ExtractProcedureDefinition<T> =
  T extends Effect.Effect<infer A, infer _E, infer _R>
    ? A extends ProcedureDefinition<infer I, infer O, infer E, infer Ctx, infer Type>
      ? ProcedureDefinition<I, O, E, Ctx, Type>
      : never
    : T extends ProcedureDefinition<infer I, infer O, infer E, infer Ctx, infer Type>
      ? ProcedureDefinition<I, O, E, Ctx, Type>
      : never

/**
 * Service type that holds the procedures group handlers.
 */
export type ProceduresService<
  Name extends string = string,
  P extends ProcedureRecord = ProcedureRecord,
> = {
  readonly name: Name
  readonly handlers: {
    readonly [K in keyof P]: ProcedureImplementation<ExtractProcedureDefinition<P[K]>>
  }
}

/**
 * A group of related procedure definitions.
 *
 * The group itself is wrapped in an Effect to track requirements.
 */
export interface ProceduresGroup<
  Name extends string = string,
  P extends ProcedureRecord = ProcedureRecord,
> {
  readonly _tag: "ProceduresGroup"
  readonly name: Name
  readonly procedures: P

  /**
   * Create a Layer that implements all procedures in this group.
   */
  toLayer(handlers: {
    readonly [K in keyof P]: ProcedureImplementation<ExtractProcedureDefinition<P[K]>>
  }): Layer.Layer<unknown, never, unknown>
}

export type AnyProceduresGroup = ProceduresGroup<string, ProcedureRecord>

export const isProceduresGroup = (value: unknown): value is AnyProceduresGroup =>
  Predicate.isTagged(value, "ProceduresGroup")

// ─────────────────────────────────────────────────────────────────────────────
// Apply Middleware Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply middleware to a procedure Effect.
 */
type ApplyMiddlewareToProcedureEffect<PE, M> =
  PE extends Effect.Effect<
    ProcedureDefinition<infer I, infer A, infer E, infer Ctx extends BaseContext, infer Type>,
    never,
    infer PR
  >
    ? M extends MiddlewareDefinition<infer MCtxIn, infer MCtxOut, infer MInput, infer MError>
      ? Effect.Effect<
          ProcedureDefinition<I & MInput, A, E | MError, Ctx & MCtxOut, Type>,
          never,
          PR | MiddlewareService<MCtxIn, MCtxOut, MInput, MError>
        >
      : PE
    : PE

/**
 * Apply middleware to all procedures in a record.
 */
type ApplyMiddlewareToProcedureRecord<P extends ProcedureRecord, M> = {
  readonly [K in keyof P]: ApplyMiddlewareToProcedureEffect<P[K], M>
}

/**
 * Extract requirements from a procedures record.
 */
type InferProceduresRequirements<P extends ProcedureRecord> = {
  [K in keyof P]: P[K] extends Effect.Effect<any, any, infer R> ? R : never
}[keyof P]

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ProcedureDefinitionRuntime = {
  readonly _tag: "ProcedureDefinition"
  readonly serviceTag: Context.Tag<any, any>
  readonly middlewares: ReadonlyArray<AnyMiddlewareDefinition>
}

const isProcedureDefinitionRuntime = (value: unknown): value is ProcedureDefinitionRuntime =>
  Predicate.isTagged(value, "ProcedureDefinition") &&
  typeof (value as { readonly serviceTag?: unknown }).serviceTag === "object"

/**
 * Extract procedure definition from Effect synchronously.
 */
function extractProcedureDef(
  procedureEffect: Effect.Effect<ProcedureDefinitionRuntime, never, any>,
): ProcedureDefinitionRuntime {
  let extracted: ProcedureDefinitionRuntime | undefined
  Effect.runSync(
    Effect.map(
      procedureEffect as Effect.Effect<ProcedureDefinitionRuntime, never, never>,
      (def) => {
        extracted = def
      },
    ),
  )
  if (!extracted) {
    throw new Error("Failed to extract procedure definition")
  }
  return extracted
}

/**
 * Extract middleware definition from Effect synchronously.
 */
function extractMiddlewareDef(
  middlewareEffect: Effect.Effect<AnyMiddlewareDefinition, never, any>,
): AnyMiddlewareDefinition {
  let extracted: AnyMiddlewareDefinition | undefined
  Effect.runSync(
    Effect.map(middlewareEffect as Effect.Effect<AnyMiddlewareDefinition, never, never>, (def) => {
      extracted = def
    }),
  )
  if (!extracted) {
    throw new Error("Failed to extract middleware definition")
  }
  return extracted
}

/**
 * Apply middleware to a single procedure definition at runtime.
 */
const applyMiddlewareToProcedureRuntime = (
  definition: ProcedureDefinitionRuntime,
  middleware: AnyMiddlewareDefinition,
): ProcedureDefinitionRuntime => {
  return {
    ...definition,
    middlewares: [middleware, ...definition.middlewares],
  }
}

/**
 * Apply middleware to all procedures in a record at runtime.
 */
const applyMiddlewareToRecordRuntime = <P extends ProcedureRecord>(
  definitions: P,
  middleware: AnyMiddlewareDefinition,
): P => {
  const next: Record<string, unknown> = {}

  for (const [procedureName, procedureEffect] of Object.entries(definitions)) {
    // Check if it's an Effect containing a ProcedureDefinition
    const maybeEffect = procedureEffect as Effect.Effect<unknown, never, unknown>

    // Try to extract the definition
    try {
      const definition = extractProcedureDef(
        maybeEffect as Effect.Effect<ProcedureDefinitionRuntime, never, unknown>,
      )

      if (isProcedureDefinitionRuntime(definition)) {
        // Apply middleware and rewrap in Effect
        const newDef = applyMiddlewareToProcedureRuntime(definition, middleware)
        next[procedureName] = Effect.succeed(newDef)
      } else {
        next[procedureName] = procedureEffect
      }
    } catch {
      // Not a valid procedure Effect, keep as-is
      next[procedureName] = procedureEffect
    }
  }

  return next as P
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a procedures group.
 *
 * @param name - Unique name for this group (used for service tag)
 * @param definitions - Record of procedure Effects
 * @returns Effect containing the ProceduresGroup with unioned requirements
 */
const createProceduresGroup = <const Name extends string, P extends ProcedureRecord>(
  name: Name,
  definitions: P,
): Effect.Effect<ProceduresGroup<Name, P>, never, InferProceduresRequirements<P>> => {
  const group: ProceduresGroup<Name, P> = {
    _tag: "ProceduresGroup",
    name,
    procedures: definitions,
    toLayer(handlers) {
      const serviceTag = Context.GenericTag<ProceduresService<Name, P>>(`@effect-trpc/${name}`)
      const layers: Array<Layer.Layer<unknown, never, unknown>> = []

      for (const [procedureName, procedureEffect] of Object.entries(definitions)) {
        const handler = handlers[procedureName as keyof P]

        // Extract the procedure definition from the Effect
        try {
          const definition = extractProcedureDef(
            procedureEffect as Effect.Effect<ProcedureDefinitionRuntime, never, unknown>,
          )

          if (isProcedureDefinitionRuntime(definition) && typeof handler === "function") {
            const layer = Layer.succeed(definition.serviceTag, { handler })
            layers.push(layer as unknown as Layer.Layer<unknown, never, unknown>)
          }
        } catch {
          // Skip non-procedure entries
        }
      }

      return Layer.mergeAll(Layer.succeed(serviceTag, { name, handlers }), ...layers)
    },
  }

  // Return as Effect with R requirements (phantom type tracking)
  return Effect.succeed(group) as Effect.Effect<
    ProceduresGroup<Name, P>,
    never,
    InferProceduresRequirements<P>
  >
}

/**
 * Apply middleware to all procedures in a group.
 *
 * @param middleware - Effect containing the middleware definition
 * @returns Function that transforms a ProceduresGroup Effect
 */
const useProceduresMiddleware =
  <CtxIn extends BaseContext, CtxOut extends BaseContext, InputExt, E2, MR>(
    middlewareEffect: Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>, never, MR>,
  ) =>
  <Name extends string, P extends ProcedureRecord, PR>(
    groupEffect: Effect.Effect<ProceduresGroup<Name, P>, never, PR>,
  ): Effect.Effect<
    ProceduresGroup<
      Name,
      ApplyMiddlewareToProcedureRecord<P, MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>>
    >,
    never,
    PR | MR | MiddlewareService<CtxIn, CtxOut, InputExt, E2>
  > => {
    // Extract middleware definition
    const middleware = extractMiddlewareDef(
      middlewareEffect as Effect.Effect<AnyMiddlewareDefinition, never, MR>,
    )

    // Extract the group
    let group: ProceduresGroup<Name, P> | undefined
    Effect.runSync(
      Effect.map(groupEffect as Effect.Effect<ProceduresGroup<Name, P>, never, never>, (g) => {
        group = g
      }),
    )

    if (!group) {
      throw new Error("Failed to extract procedures group")
    }

    // Apply middleware to all procedures
    const nextDefs = applyMiddlewareToRecordRuntime(group.procedures, middleware)

    // Create new group with transformed procedures
    return createProceduresGroup(
      group.name,
      nextDefs as ApplyMiddlewareToProcedureRecord<
        P,
        MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>
      >,
    ) as Effect.Effect<
      ProceduresGroup<
        Name,
        ApplyMiddlewareToProcedureRecord<P, MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>>
      >,
      never,
      PR | MR | MiddlewareService<CtxIn, CtxOut, InputExt, E2>
    >
  }

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create and manage procedures groups.
 *
 * @example
 * ```ts
 * const userProcedures = Procedures.make("user", {
 *   create: procedure.use(AuthMiddleware).input(CreateUserSchema).mutation(),
 *   get: procedure.input(GetUserSchema).query(),
 * })
 * // Type: Effect<ProceduresGroup<...>, never, AuthMiddlewareService | SessionService | ...>
 *
 * // Apply middleware to entire group
 * const protectedProcedures = userProcedures.pipe(
 *   Procedures.use(OrgMiddleware)
 * )
 * ```
 */
/**
 * Create a Layer from a procedures group Effect.
 * This is the recommended way to provide implementations.
 *
 * @param groupEffect - Effect containing the procedures group
 * @param handlers - Handler implementations for each procedure
 */
const proceduresToLayer = <Name extends string, P extends ProcedureRecord, R>(
  groupEffect: Effect.Effect<ProceduresGroup<Name, P>, never, R>,
  handlers: {
    readonly [K in keyof P]: ProcedureImplementation<ExtractProcedureDefinition<P[K]>>
  },
): Layer.Layer<unknown, never, R> => {
  // Extract the group synchronously
  let group: ProceduresGroup<Name, P> | undefined
  Effect.runSync(
    Effect.map(groupEffect as Effect.Effect<ProceduresGroup<Name, P>, never, never>, (g) => {
      group = g
    }),
  )

  if (!group) {
    throw new Error("Failed to extract procedures group")
  }

  // Use the group's toLayer method
  return group.toLayer(handlers) as Layer.Layer<unknown, never, R>
}

export const Procedures = {
  /**
   * Create a procedures group from a record of procedure Effects.
   */
  make: createProceduresGroup,

  /**
   * Apply middleware to all procedures in a group.
   */
  use: useProceduresMiddleware,

  /**
   * Create a Layer from a procedures group Effect.
   */
  toLayer: proceduresToLayer,

  /**
   * Prefix helper (currently identity - actual prefixing done at router level).
   */
  prefix: <const Prefix extends string, P extends ProcedureRecord>(
    _prefix: Prefix,
    definitions: P,
  ): P => definitions,
}

// Backwards compatibility alias
export const procedures = createProceduresGroup
