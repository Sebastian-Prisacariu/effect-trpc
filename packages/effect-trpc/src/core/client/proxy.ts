import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Match from "effect/Match"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type { BaseContext } from "../server/middleware.js"
import type { ProcedureRecord, ProceduresGroup } from "../server/procedures.js"
import type { ProcedureDefinition, ProcedureType } from "../server/procedure.js"
import type { RouterShape, RouterRecord } from "../server/router.js"
import type { RpcError } from "../rpc/errors.js"
import type { Stream } from "effect/Stream"
import { Transport } from "./transports.js"

// ─────────────────────────────────────────────────────────────────────────────
// Client Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryProcedureClient<I, A, E> {
  (input: I): Effect.Effect<A, E | RpcError>
}

export interface MutationProcedureClient<I, A, E> {
  (input: I): Effect.Effect<A, E | RpcError>
}

export interface StreamProcedureClient<I, A, E> {
  (input: I): Stream<A, E | RpcError>
}

export interface SubscriptionProcedureClient<I, A, E> {
  (input: I): Stream<A, E | RpcError>
}

/**
 * Client type for a procedure definition.
 * Uses direct structural matching to work better across module boundaries.
 */
export type ProcedureClient<P> =
  // Try to unwrap Effect first
  P extends Effect.Effect<infer D, infer _E, infer _R>
    ? D extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx, infer Type>
      ? CreateProcedureClient<I, A, E, Type>
      : never
    : // Direct ProcedureDefinition
      P extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx, infer Type>
      ? CreateProcedureClient<I, A, E, Type>
      : never

/**
 * Helper to create the actual procedure client function type.
 */
type CreateProcedureClient<I, A, E, Type> = Type extends "query"
  ? QueryProcedureClient<unknown extends I ? void : I, A, E>
  : Type extends "mutation"
    ? MutationProcedureClient<unknown extends I ? void : I, A, E>
    : Type extends "stream" | "chat"
      ? StreamProcedureClient<unknown extends I ? void : I, A, E>
      : Type extends "subscription"
        ? SubscriptionProcedureClient<unknown extends I ? void : I, A, E>
        : never

/**
 * Helper type to resolve a single router entry.
 *
 * Pattern: Match Effect<T> first, then T directly, to handle both wrapped and unwrapped.
 * Each branch uses a single-level conditional to help TypeScript evaluate correctly
 * across module boundaries.
 */
type ResolveRouterEntry<Entry> =
  // Check if it's an Effect wrapping something
  Entry extends Effect.Effect<infer Inner, infer _E, infer _R>
    ? ResolveInnerEntry<Inner>
    : // Not an Effect, check the raw types
      ResolveInnerEntry<Entry>

/**
 * Resolve the inner type (after Effect unwrapping).
 * Uses direct structural matching rather than extracted helper types.
 */
type ResolveInnerEntry<Inner> =
  // Case 1: Nested Router
  Inner extends RouterShape<infer NestedRoutes>
    ? RouterClient<NestedRoutes>
    : // Case 2: ProceduresGroup - directly extract procedures and map
      Inner extends { readonly _tag: "ProceduresGroup"; readonly procedures: infer P }
      ? P extends Record<string, unknown>
        ? { -readonly [K in keyof P]: ProcedureClient<P[K]> }
        : never
      : // Case 3: ProcedureDefinition - create client directly
        Inner extends ProcedureDefinition<infer I, infer A, infer E, infer _Ctx, infer Type>
        ? CreateProcedureClient<I, A, E, Type>
        : // Case 4: Plain record of procedures
          Inner extends Record<string, unknown>
          ? { -readonly [K in keyof Inner]: ProcedureClient<Inner[K]> }
          : never

/**
 * Client type for a router's routes.
 */
export type RouterClient<R extends RouterRecord> = {
  -readonly [K in keyof R]: ResolveRouterEntry<R[K]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Proxy Engine Service
// ─────────────────────────────────────────────────────────────────────────────

type AnyProcedureDefinition = ProcedureDefinition<
  unknown,
  unknown,
  unknown,
  BaseContext,
  ProcedureType
>

export class ProxyInvocationError extends Schema.TaggedError<ProxyInvocationError>()(
  "ProxyInvocationError",
  { rpcName: Schema.String, message: Schema.String },
) {}

export interface ProxyShape {
  readonly createProxy: <TRouter extends RouterShape<RouterRecord>>(
    router: TRouter,
  ) => RouterClient<TRouter["routes"]>
}

export class Proxy extends Context.Tag("@effect-trpc/Proxy")<Proxy, ProxyShape>() {
  static readonly Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const transport = yield* Transport

      /**
       * Extract a value from an Effect synchronously.
       * Safe because our definitions always use Effect.succeed internally.
       */
      const extractFromEffect = <T>(effect: Effect.Effect<T, never, any>): T => {
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
       * Try to extract a value from something that might be an Effect.
       */
      const tryExtract = (value: unknown): unknown => {
        // Check if it looks like an Effect (has required symbols/methods)
        if (
          typeof value === "object" &&
          value !== null &&
          "pipe" in value &&
          typeof (value as { pipe: unknown }).pipe === "function"
        ) {
          try {
            return extractFromEffect(value as Effect.Effect<unknown, never, unknown>)
          } catch {
            return value
          }
        }
        return value
      }

      const flattenRoutes = <Routes extends Record<string, unknown>>(
        routes: Routes,
        prefix = "",
      ): Record<string, AnyProcedureDefinition> => {
        let flat: Record<string, AnyProcedureDefinition> = {}

        for (const [key, rawValue] of Object.entries(routes)) {
          const newPrefix = prefix ? `${prefix}.${key}` : key

          // Try to extract from Effect if needed
          const value = tryExtract(rawValue)

          Match.value(value).pipe(
            Match.when(
              (candidate: unknown): candidate is AnyProcedureDefinition =>
                Predicate.isTagged(candidate, "ProcedureDefinition"),
              (definition) => {
                flat[newPrefix] = definition
              },
            ),
            Match.when(
              (candidate: unknown): candidate is RouterShape<RouterRecord> =>
                Predicate.isTagged(candidate, "Router"),
              (nestedRouter) => {
                flat = { ...flat, ...flattenRoutes(nestedRouter.routes, newPrefix) }
              },
            ),
            Match.when(
              (candidate: unknown): candidate is ProceduresGroup<string, ProcedureRecord> =>
                Predicate.isTagged(candidate, "ProceduresGroup"),
              (group) => {
                flat = { ...flat, ...flattenRoutes(group.procedures, newPrefix) }
              },
            ),
            Match.when(Predicate.isRecord, (record) => {
              flat = { ...flat, ...flattenRoutes(record, newPrefix) }
            }),
            Match.orElse(() => undefined),
          )
        }

        return flat
      }

      const createRecursiveProxy = (
        flatProcedures: Record<string, AnyProcedureDefinition>,
        pathSegments: string[] = [],
      ): unknown => {
        return new globalThis.Proxy(() => {}, {
          get(_target, prop: string) {
            return createRecursiveProxy(flatProcedures, [...pathSegments, prop])
          },
          apply(_target, _thisArg, args) {
            const rpcName = pathSegments.join(".")
            const input = args[0] as unknown
            const definition = flatProcedures[rpcName]

            if (definition === undefined) {
              return Effect.fail(
                new ProxyInvocationError({
                  rpcName,
                  message: `Procedure not found at path '${rpcName}'`,
                }),
              )
            }

            const stream =
              definition.type === "stream" ||
              definition.type === "subscription" ||
              definition.type === "chat"

            return transport.call(rpcName, input, {
              payloadSchema: definition.inputSchema,
              successSchema: definition.outputSchema,
              errorSchema: definition.errorSchema,
              stream,
            })
          },
        })
      }

      return {
        createProxy: (router) => {
          const flatProcedures = flattenRoutes(router.routes)
          return createRecursiveProxy(flatProcedures) as RouterClient<typeof router.routes>
        },
      }
    }),
  )
}
