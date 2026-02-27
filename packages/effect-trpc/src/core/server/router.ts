/**
 * @module effect-trpc/core/server/router
 *
 * Router for organizing procedure definitions into a hierarchical structure.
 *
 * Routers accept Effects and return Effects, enabling automatic requirement tracking
 * via Effect's type system. When you compose routes, their requirements are unioned
 * in the R channel.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Pipeable from "effect/Pipeable"
import * as Data from "effect/Data"
import * as Predicate from "effect/Predicate"
import type {
  AnyMiddlewareDefinition,
  BaseContext,
  MiddlewareDefinition,
  MiddlewareService,
} from "./middleware.js"
import type { ProcedureDefinition, ProcedureType } from "./procedure.js"
import type { AnyProceduresGroup, ProcedureRecord, ProceduresGroup } from "./procedures.js"
import { RpcBridge } from "./internal/bridge.js"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A router entry can be:
 * - Effect<ProcedureDefinition, never, R>
 * - Effect<ProceduresGroup, never, R>
 * - Effect<RouterShape, never, R>
 * - Plain records for backwards compatibility
 */
export type RouterEntry =
  | Effect.Effect<ProcedureDefinition<any, any, any, any, any>, never, any>
  | Effect.Effect<ProceduresGroup<any, any>, never, any>
  | Effect.Effect<RouterShape<any>, never, any>
  | Record<string, Effect.Effect<ProcedureDefinition<any, any, any, any, any>, never, any>>

export type RouterRecord = Record<string, RouterEntry>

/**
 * Extract requirements from a router entry.
 */
type InferEntryRequirements<T> =
  T extends Effect.Effect<any, any, infer R>
    ? R
    : T extends Record<string, Effect.Effect<any, any, infer R>>
      ? R
      : never

/**
 * Extract requirements from all entries in a router record.
 */
type InferRouterRequirements<Routes extends RouterRecord> = {
  [K in keyof Routes]: InferEntryRequirements<Routes[K]>
}[keyof Routes]

/**
 * Extract the procedure definitions from a router for client type inference.
 */
export type ExtractProcedures<Routes extends RouterRecord, Prefix extends string = ""> = {
  [K in keyof Routes]: Routes[K] extends Effect.Effect<infer D, never, any>
    ? D extends RouterShape<infer R>
      ? ExtractProcedures<R, `${Prefix}${K & string}.`>
      : D extends ProcedureDefinition<any, any, any, any, any>
        ? { [PK in `${Prefix}${K & string}`]: D }
        : D extends ProceduresGroup<string, infer P>
          ? ExtractProceduresFromRecord<P, `${Prefix}${K & string}.`>
          : never
    : Routes[K] extends Record<string, Effect.Effect<infer D, never, any>>
      ? D extends ProcedureDefinition<any, any, any, any, any>
        ? { [PK in keyof Routes[K] as `${Prefix}${K & string}.${PK & string}`]: D }
        : never
      : never
}[keyof Routes]

type ExtractProceduresFromRecord<P extends ProcedureRecord, Prefix extends string> = {
  [K in keyof P]: P[K] extends Effect.Effect<infer D, never, any>
    ? D extends ProcedureDefinition<any, any, any, any, any>
      ? { [PK in `${Prefix}${K & string}`]: D }
      : never
    : never
}[keyof P]

export type AnyRouter = RouterShape<RouterRecord>

// Type inference helpers
export type InferInput<T> = T extends ProcedureDefinition<infer I, any, any, any, any> ? I : never
export type InferOutput<T> = T extends ProcedureDefinition<any, infer A, any, any, any> ? A : never
export type InferError<T> = T extends ProcedureDefinition<any, any, infer E, any, any> ? E : never

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ProcedureDefinitionRuntime = {
  readonly _tag: "ProcedureDefinition"
  readonly middlewares: ReadonlyArray<AnyMiddlewareDefinition>
}

const isProcedureDefinitionRuntime = (value: unknown): value is ProcedureDefinitionRuntime =>
  Predicate.isTagged(value, "ProcedureDefinition")

/**
 * Extract a value from an Effect synchronously.
 * Safe because our definitions always use Effect.succeed internally.
 */
function extractFromEffect<T>(effect: Effect.Effect<T, never, any>): T {
  let extracted: T | undefined
  Effect.runSync(
    Effect.map(effect as Effect.Effect<T, never, never>, (val) => {
      extracted = val
    }),
  )
  if (extracted === undefined) {
    throw new Error("Failed to extract value from Effect")
  }
  return extracted
}

/**
 * Apply middleware to a procedure definition at runtime.
 */
const applyMiddlewareToProcedureRuntime = (
  definition: ProcedureDefinitionRuntime,
  middleware: AnyMiddlewareDefinition,
): ProcedureDefinitionRuntime => ({
  ...definition,
  middlewares: [middleware, ...definition.middlewares],
})

/**
 * Apply middleware to a router entry at runtime.
 */
const applyMiddlewareToEntryRuntime = (
  entry: RouterEntry,
  middleware: AnyMiddlewareDefinition,
): RouterEntry => {
  // Try to extract and check what type it is
  try {
    const extracted = extractFromEffect(entry as Effect.Effect<unknown, never, unknown>)

    if (isProcedureDefinitionRuntime(extracted)) {
      const newDef = applyMiddlewareToProcedureRuntime(extracted, middleware)
      return Effect.succeed(newDef) as unknown as RouterEntry
    }

    if (Predicate.isTagged(extracted, "ProceduresGroup")) {
      const group = extracted as AnyProceduresGroup
      // Apply middleware to each procedure in the group
      const newProcedures: Record<string, unknown> = {}
      for (const [name, procEffect] of Object.entries(group.procedures)) {
        const proc = extractFromEffect(procEffect as Effect.Effect<unknown, never, unknown>)
        if (isProcedureDefinitionRuntime(proc)) {
          const newProc = applyMiddlewareToProcedureRuntime(proc, middleware)
          newProcedures[name] = Effect.succeed(newProc)
        } else {
          newProcedures[name] = procEffect
        }
      }
      return Effect.succeed({
        ...group,
        procedures: newProcedures,
      }) as unknown as RouterEntry
    }

    if (Predicate.isTagged(extracted, "Router")) {
      const router = extracted as RouterShape<RouterRecord>
      const newRoutes = applyMiddlewareToRecordRuntime(router.routes, middleware)
      return Effect.succeed(new RouterShape({ routes: newRoutes })) as unknown as RouterEntry
    }
  } catch {
    // Not a valid Effect, check if it's a plain record
    if (Predicate.isRecord(entry)) {
      const record = entry as Record<string, Effect.Effect<unknown, never, unknown>>
      const newRecord: Record<string, unknown> = {}
      for (const [key, procEffect] of Object.entries(record)) {
        newRecord[key] = applyMiddlewareToEntryRuntime(procEffect as RouterEntry, middleware)
      }
      return newRecord as unknown as RouterEntry
    }
  }

  return entry
}

/**
 * Apply middleware to all entries in a router record.
 */
const applyMiddlewareToRecordRuntime = <Routes extends RouterRecord>(
  routes: Routes,
  middleware: AnyMiddlewareDefinition,
): Routes => {
  const next: Record<string, RouterEntry> = {}
  for (const [key, entry] of Object.entries(routes)) {
    next[key] = applyMiddlewareToEntryRuntime(entry, middleware)
  }
  return next as Routes
}

// ─────────────────────────────────────────────────────────────────────────────
// RouterShape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Router shape containing route definitions.
 *
 * Note: Requirements are tracked at the Effect level, not here.
 */
export class RouterShape<Routes extends RouterRecord = RouterRecord>
  extends Data.TaggedClass("Router")<{
    readonly routes: Routes
  }>
  implements Pipeable.Pipeable
{
  pipe() {
    return Pipeable.pipeArguments(this, arguments)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Middleware Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply middleware to procedure definition type.
 */
type ApplyMiddlewareToProcedure<P, M> =
  P extends ProcedureDefinition<infer I, infer A, infer E, infer Ctx, infer Type>
    ? M extends MiddlewareDefinition<any, infer MCtxOut, infer MInput, infer MError>
      ? ProcedureDefinition<I & MInput, A, E | MError, Ctx & MCtxOut, Type>
      : P
    : P

/**
 * Apply middleware to an Effect-wrapped definition.
 * Helper types for each case to simplify the main conditional.
 */
type ApplyMiddlewareToProcedureEffect<
  D,
  M,
  R,
  MCtxIn extends BaseContext,
  MCtxOut extends BaseContext,
  MInput,
  MError,
> =
  D extends ProcedureDefinition<any, any, any, any, any>
    ? Effect.Effect<
        ApplyMiddlewareToProcedure<D, M>,
        never,
        R | MiddlewareService<MCtxIn, MCtxOut, MInput, MError>
      >
    : D extends ProceduresGroup<infer Name, infer P>
      ? Effect.Effect<
          ProceduresGroup<Name, ApplyMiddlewareToProcedureRecord<P, M>>,
          never,
          R | MiddlewareService<MCtxIn, MCtxOut, MInput, MError>
        >
      : D extends RouterShape<infer Routes>
        ? Effect.Effect<
            RouterShape<ApplyMiddlewareToRouterRecord<Routes, M>>,
            never,
            R | MiddlewareService<MCtxIn, MCtxOut, MInput, MError>
          >
        : Effect.Effect<D, never, R>

type ApplyMiddlewareToEffect<Eff, M> =
  Eff extends Effect.Effect<infer D, never, infer R>
    ? M extends MiddlewareDefinition<
        infer MCtxIn extends BaseContext,
        infer MCtxOut extends BaseContext,
        infer MInput,
        infer MError
      >
      ? ApplyMiddlewareToProcedureEffect<D, M, R, MCtxIn, MCtxOut, MInput, MError>
      : Eff
    : Eff

type ApplyMiddlewareToProcedureRecord<P extends ProcedureRecord, M> = {
  readonly [K in keyof P]: ApplyMiddlewareToEffect<P[K], M>
}

type ApplyMiddlewareToRouterRecord<Routes extends RouterRecord, M> = {
  readonly [K in keyof Routes]: ApplyMiddlewareToEffect<Routes[K], M>
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Router factory and utilities.
 *
 * @example
 * ```ts
 * // Create a router from procedure Effects
 * const appRouter = Router.make({
 *   health: healthProcedures,
 *   users: userProcedures,
 *   posts: postProcedures,
 * })
 * // Type: Effect<RouterShape<...>, never, AllRequirements>
 *
 * // Apply middleware to entire router
 * const protectedRouter = appRouter.pipe(
 *   Router.use(OrgMiddleware)
 * )
 * ```
 */
export const Router = {
  /**
   * Create a router from a record of route entries.
   * Returns an Effect that tracks all requirements.
   */
  make: <T extends RouterRecord>(
    routes: T,
  ): Effect.Effect<RouterShape<T>, never, InferRouterRequirements<T>> => {
    const router = new RouterShape({ routes })
    return Effect.succeed(router) as Effect.Effect<
      RouterShape<T>,
      never,
      InferRouterRequirements<T>
    >
  },

  /**
   * Apply middleware to all routes in a router.
   */
  use:
    <CtxIn extends BaseContext, CtxOut extends BaseContext, InputExt, E2, MR>(
      middlewareEffect: Effect.Effect<MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>, never, MR>,
    ) =>
    <Routes extends RouterRecord, PR>(
      routerEffect: Effect.Effect<RouterShape<Routes>, never, PR>,
    ): Effect.Effect<
      RouterShape<
        ApplyMiddlewareToRouterRecord<Routes, MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>>
      >,
      never,
      PR | MR | MiddlewareService<CtxIn, CtxOut, InputExt, E2>
    > => {
      // Extract middleware
      const middleware = extractFromEffect(middlewareEffect)

      // Extract router
      const router = extractFromEffect(routerEffect)

      // Apply middleware to all routes
      const newRoutes = applyMiddlewareToRecordRuntime(
        router.routes,
        middleware as AnyMiddlewareDefinition,
      )

      return Effect.succeed(new RouterShape({ routes: newRoutes })) as unknown as Effect.Effect<
        RouterShape<
          ApplyMiddlewareToRouterRecord<Routes, MiddlewareDefinition<CtxIn, CtxOut, InputExt, E2>>
        >,
        never,
        PR | MR | MiddlewareService<CtxIn, CtxOut, InputExt, E2>
      >
    },

  /**
   * Provide a Layer to satisfy some or all requirements.
   * Returns an object with the router and layer for HTTP handling.
   */
  provide:
    <HandlersOut, LayerR>(layer: Layer.Layer<HandlersOut, never, LayerR>) =>
    <Routes extends RouterRecord, RouterR>(
      routerEffect: Effect.Effect<RouterShape<Routes>, never, RouterR>,
    ): ProvidedRouter<Routes, HandlersOut, LayerR> => {
      const router = extractFromEffect(routerEffect)
      return { router, layer }
    },

  /**
   * Convert a provided router to an HTTP Layer.
   */
  toHttpLayer:
    (options?: { path?: `/${string}` | "*"; disableTracing?: boolean; spanPrefix?: string }) =>
    <Routes extends RouterRecord, HandlersOut, LayerR>(
      provided: ProvidedRouter<Routes, HandlersOut, LayerR>,
    ): Layer.Layer<never, never, LayerR> =>
      Layer.unwrapEffect(
        Effect.provide(
          Effect.map(RpcBridge, (bridge) =>
            bridge
              .toHttpLayer(provided.router as RouterShape<RouterRecord>, options)
              .pipe(Layer.provide(provided.layer)),
          ),
          provided.layer,
        ),
      ) as unknown as Layer.Layer<never, never, LayerR>,

  /**
   * Merge two routers together.
   */
  mergeDeep: <RoutesA extends RouterRecord, RoutesB extends RouterRecord, RA, RB>(
    routerAEffect: Effect.Effect<RouterShape<RoutesA>, never, RA>,
    routerBEffect: Effect.Effect<RouterShape<RoutesB>, never, RB>,
    _options?: { onConflict?: "error" | "overwrite" | "skip" },
  ): Effect.Effect<RouterShape<RoutesA & RoutesB>, never, RA | RB> => {
    const routerA = extractFromEffect(routerAEffect)
    const routerB = extractFromEffect(routerBEffect)
    return Effect.succeed(
      new RouterShape({ routes: { ...routerA.routes, ...routerB.routes } }),
    ) as Effect.Effect<RouterShape<RoutesA & RoutesB>, never, RA | RB>
  },

  /**
   * Prefix routes (currently identity - prefixing done at path resolution).
   */
  prefix: <P extends string, Routes extends RouterRecord, R>(
    _prefix: P,
    routerEffect: Effect.Effect<RouterShape<Routes>, never, R>,
  ): Effect.Effect<RouterShape<Routes>, never, R> => routerEffect,
}

/**
 * A router with its implementation layer attached.
 */
export interface ProvidedRouter<
  Routes extends RouterRecord = RouterRecord,
  HandlersOut = unknown,
  Requirements = unknown,
> {
  readonly router: RouterShape<Routes>
  readonly layer: Layer.Layer<HandlersOut, never, Requirements>
}
