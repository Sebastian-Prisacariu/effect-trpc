/**
 * @module effect-trpc/core/internal/router
 * @internal
 *
 * Internal implementation for the Router module.
 * This module contains implementation details that are not part of the public API.
 */

import * as Layer from "effect/Layer"
import * as Data from "effect/Data"
import * as Record from "effect/Record"
import type * as Schema from "effect/Schema"
import type { RpcGroup} from "@effect/rpc";
import { RpcServer, RpcSerialization } from "@effect/rpc"
import type { ProceduresGroup, ProcedureRecord } from "../procedures.js"
import type { ProcedureDefinition } from "../procedure.js"
import { proceduresGroupToRpcGroup, type AnyRpc, type ProceduresToRpcs } from "../rpc-bridge.js"
import type { Middleware } from "../middleware.js"

// ─────────────────────────────────────────────────────────────────────────────
// Type ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Type ID for Router instances.
 * @internal
 */
export const TypeId: unique symbol = Symbol.for("@effect-trpc/Router")

/**
 * @internal
 */
export type TypeId = typeof TypeId

// ─────────────────────────────────────────────────────────────────────────────
// Router Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when router validation fails.
 *
 * This is a defect (programmer error) not a runtime failure.
 *
 * @remarks
 * **Why Data.TaggedError instead of Schema.TaggedError?**
 *
 * This uses `Data.TaggedError` (not `Schema.TaggedError`) because:
 * 1. This is a programmer error (defect) that occurs during router setup
 * 2. It happens at module initialization time, not at runtime over the wire
 * 3. It doesn't need to be serialized/deserialized across network boundaries
 *
 * Use `Schema.TaggedError` for errors that need wire serialization (like
 * procedure errors that are sent to clients).
 *
 * @since 0.1.0
 * @category errors
 */
export class RouterValidationError extends Data.TaggedError("RouterValidationError")<{
  readonly module: string
  readonly method: string
  readonly reason: string
}> {
  override get message(): string {
    return `[${this.module}.${this.method}] ${this.reason}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Entry Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Any ProceduresGroup - used for runtime checks.
 * @internal
 */
export type AnyProceduresGroup = ProceduresGroup<any, any>

/**
 * Any Router - used for runtime checks.
 * @internal
 */
export type AnyRouter = Router<any>

/**
 * A router entry can be either:
 * - A ProceduresGroup (leaf node with procedures)
 * - Another Router (branch node for nesting)
 * @internal
 */
export type RouterEntry = AnyProceduresGroup | AnyRouter

/**
 * Check if an entry is a Router (for nesting).
 * Accepts any object with a _tag property for flexibility.
 * @internal
 */
export const isRouter = (entry: { readonly _tag: string }): entry is AnyRouter =>
  entry._tag === "Router"

/**
 * Check if an entry is a ProceduresGroup (leaf).
 * Accepts any object with a _tag property for flexibility.
 * @internal
 */
export const isProceduresGroup = (entry: { readonly _tag: string }): entry is AnyProceduresGroup =>
  entry._tag === "ProceduresGroup"

// ─────────────────────────────────────────────────────────────────────────────
// Router Record Type (Recursive)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A record of router entries, allowing infinite nesting.
 *
 * Uses a structural type check to accept any object with _tag "ProceduresGroup" or "Router".
 * This is more permissive than a union type and allows proper type inference.
 *
 * @since 0.1.0
 * @category models
 */
export type RouterRecord = {
  readonly [key: string]: { readonly _tag: "ProceduresGroup" | "Router" }
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-Level Router Extraction (for type inference)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively extract all procedure definitions from a router record.
 * Returns a flattened record with full path keys.
 * 
 * @since 0.1.0
 * @category type-level
 */
export type ExtractProcedures<Routes extends RouterRecord, Prefix extends string = ""> = {
  [K in keyof Routes]: Routes[K] extends Router<infer R>
    ? ExtractProcedures<R, `${Prefix}${K & string}.`>
    : Routes[K] extends ProceduresGroup<infer Name, infer Procs>
      ? { [PK in keyof Procs as `${Prefix}${Name}.${PK & string}`]: Procs[PK] }
      : never
}[keyof Routes]

/**
 * Recursively extract all RpcGroup types from a router record.
 * Returns a union of RpcGroup types.
 * @internal
 */
export type ExtractRpcGroups<Routes extends RouterRecord, Prefix extends string = ""> = {
  [K in keyof Routes]: Routes[K] extends Router<infer R>
    ? ExtractRpcGroups<R, `${Prefix}${K & string}.`>
    : Routes[K] extends ProceduresGroup<infer Name, infer Procs>
      ? RpcGroup.RpcGroup<ProceduresToRpcs<Name, Procs, Prefix>>
      : never
}[keyof Routes]

// ─────────────────────────────────────────────────────────────────────────────
// Router Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating an HTTP layer from a router.
 *
 * @since 0.1.0
 * @category models
 */
export interface ToHttpLayerOptions<R> {
  /**
   * Path prefix for the RPC endpoint.
   * Must start with '/'.
   * @default '/rpc'
   */
  readonly path?: `/${string}`

  /**
   * Layer providing all procedure implementations.
   */
  readonly handlers: Layer.Layer<any, never, R>

  /**
   * Protocol to use for RPC communication.
   * - 'http': Use HTTP streaming (default, works with serverless)
   * - 'websocket': Use WebSocket (requires persistent connection)
   * @default 'http'
   */
  readonly protocol?: "http" | "websocket"
}

/**
 * A Router composes procedure groups with support for infinite nesting.
 * Routers can contain procedure groups (leaf nodes) or other routers (branches).
 *
 * @since 0.1.0
 * @category models
 */
export interface Router<Routes extends RouterRecord = RouterRecord> {
  readonly [TypeId]: TypeId
  readonly _tag: "Router"

  /**
   * The nested route structure (for types and client proxy).
   */
  readonly routes: Routes

  /**
   * Flattened procedures map with dot-separated paths.
   * @example { "user.posts.list": RpcDefinition, "health.check": RpcDefinition }
   */
  readonly procedures: Record<string, unknown>

  /**
   * The combined @effect/rpc RpcGroup for all procedures in this router.
   */
  readonly rpcGroup: RpcGroup.RpcGroup<AnyRpc>

  /**
   * Router-level middlewares applied to all procedures in this router.
   */
  readonly middlewares?: ReadonlyArray<Middleware<any, any, any, any>>

  /**
   * Apply middleware to all procedures in this router.
   * Returns a new Router with the middleware attached.
   */
  use(middleware: Middleware<any, any, any, any>): Router<Routes>

  /**
   * Create a Layer that serves this router over HTTP.
   * Uses NDJSON serialization for streaming support.
   */
  toHttpLayer<R>(options: ToHttpLayerOptions<R>): Layer.Layer<never, never, R>
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Helpers for Flattening
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten a RouterRecord to extract all procedure paths with their types.
 * Used for type inference on the client side.
 * @internal
 */
export type FlattenRouterRecord<
  Routes extends RouterRecord,
  Prefix extends string = "",
> = {
  [K in keyof Routes & string]: Routes[K] extends ProceduresGroup<infer Name, infer Procs>
    ? FlattenProceduresGroup<Name, Procs, Prefix, K>
    : Routes[K] extends Router<infer R>
      ? FlattenRouterRecord<R, `${Prefix}${K}.`>
      : never
}[keyof Routes & string]

/**
 * Helper to flatten a procedures group with its path prefix.
 * @internal
 */
type FlattenProceduresGroup<
  _Name extends string,
  Procs extends ProcedureRecord,
  Prefix extends string,
  Key extends string,
> = {
  [PK in keyof Procs & string]: {
    path: `${Prefix}${Key}.${PK}`
    procedure: Procs[PK]
  }
}[keyof Procs & string]

// ─────────────────────────────────────────────────────────────────────────────
// Recursive Type for Client Proxy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively build the client type from a RouterRecord.
 * This supports infinite nesting for the client proxy.
 * @internal
 */
export type RouterClient<Routes extends RouterRecord> = {
  [K in keyof Routes]: Routes[K] extends ProceduresGroup<infer _Name, infer Procs>
    ? ProceduresClient<Procs>
    : Routes[K] extends Router<infer R>
      ? RouterClient<R>
      : never
}

/**
 * Client type for a procedures group.
 * @internal
 */
type ProceduresClient<Procs extends ProcedureRecord> = {
  [K in keyof Procs]: ProcedureClient<Procs[K]>
}

/**
 * Client type for a single procedure (hooks).
 * @internal
 */
type ProcedureClient<P> = P extends { type: "query" }
  ? { useQuery: (...args: any[]) => any }
  : P extends { type: "mutation" }
    ? { useMutation: (...args: any[]) => any }
    : P extends { type: "stream" }
      ? { useStream: (...args: any[]) => any }
      : P extends { type: "chat" }
        ? { useChat: (...args: any[]) => any }
        : P extends { type: "subscription" }
          ? { useSubscription: (...args: any[]) => any }
          : never

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a router record contains no duplicate procedure paths.
 * Throws RouterValidationError if a collision is detected.
 * @internal
 */
function validateNoDuplicatePaths(routes: RouterRecord): void {
  const seenPaths = new Set<string>()

  const check = (entries: RouterRecord, pathPrefix: string = "") => {
    for (const [key, entry] of Object.entries(entries)) {
      if (isRouter(entry)) {
        check(entry.routes, `${pathPrefix}${key}.`)
      } else if (isProceduresGroup(entry)) {
        for (const procName of Object.keys(entry.procedures)) {
          const fullPath = `${pathPrefix}${key}.${procName}`
          if (seenPaths.has(fullPath)) {
            throw new RouterValidationError({
              module: "Router",
              method: "router",
              reason: `Duplicate procedure path detected: '${fullPath}'`,
            })
          }
          seenPaths.add(fullPath)
        }
      }
    }
  }

  check(routes)
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-Safe Flattening Infrastructure
// ─────────────────────────────────────────────────────────────────────────────
//
// This section implements type-safe router flattening using patterns from Effect:
//
// **Pattern: Type-Level Computation + Runtime Assertions**
// - Types are computed at compile-time using mapped types (ExtractProcedures<TRoutes>)
// - Runtime uses dynamic iteration (Record.reduce) with isolated boundary assertions
// - This matches Effect's approach in Context, RpcGroup, and similar areas
//
// **Pattern: Named Assertion Functions**
// - Each type boundary has a named function documenting why the assertion is safe
// - This is similar to Effect's Context.unsafeMake which takes Map<string, any>
//   and returns Context<Services> - the "unsafe" indicates caller responsibility
//
// See docs/LEARNINGS.md for detailed documentation of these patterns.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of flattening a router structure.
 * 
 * Generic over the router record type to preserve procedure types through flattening.
 * The type parameters are computed using ExtractProcedures and ExtractRpcGroups,
 * ensuring compile-time verification of the flattened structure.
 * @internal
 */
interface FlattenResult<Routes extends RouterRecord> {
  /**
   * Flattened procedures map with dot-separated paths.
   * Type is computed from ExtractProcedures<Routes>.
   */
  readonly procedures: ExtractProcedures<Routes>
  /**
   * Array of RpcGroups from all procedure groups.
   * Each group retains its precise type; the array collects them for merging.
   */
  readonly rpcGroups: ReadonlyArray<RpcGroup.RpcGroup<AnyRpc>>
}

/**
 * Internal mutable accumulator for building flatten result.
 * 
 * Uses mutable state internally for performance, but returns immutable FlattenResult.
 * This pattern is safe because the mutation is isolated within flattenRoutes.
 * @internal
 */
interface FlattenAccumulator {
  procedures: globalThis.Record<string, ProcedureDefinition>
  rpcGroups: Array<RpcGroup.RpcGroup<AnyRpc>>
}

// ─────────────────────────────────────────────────────────────────────────────
// Boundary Assertion Functions
// ─────────────────────────────────────────────────────────────────────────────
//
// These functions isolate type assertions to well-documented boundaries.
// Each assertion is "unsafe" in that it bypasses TypeScript's type checking,
// but is safe because we document the invariants that make it valid.
//
// This pattern matches Effect's Context.unsafeMake, which takes Map<string, any>
// and returns Context<Services> - the caller is responsible for ensuring the
// map contents match the Services type.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a value from ProceduresGroup.procedures is a ProcedureDefinition.
 * 
 * **Why this assertion is safe:**
 * 
 * ProcedureRecord is typed as `Record<string, any>` for flexibility in accepting
 * heterogeneous procedure types. However, at runtime, all values are guaranteed
 * to be ProcedureDefinition objects because:
 * 
 * 1. They can only be created via procedure.query/mutation/stream/chat/subscription
 * 2. The procedure builder always returns ProcedureDefinition
 * 3. TypeScript enforces this at the call site via InferHandlers<P>
 * 
 * This is similar to Effect's pattern of using `any` in intermediate types
 * while maintaining type safety at API boundaries.
 * 
 * @internal
 */
function unsafeAssertProcedureDefinition(procValue: unknown): ProcedureDefinition {
  return procValue as ProcedureDefinition
}

/**
 * Assert that an RpcGroup can be widened to RpcGroup<AnyRpc> for collection.
 * 
 * **Why this assertion is safe:**
 * 
 * proceduresGroupToRpcGroup returns `RpcGroup<ProceduresToRpcs<Name, Procs, Prefix>>`
 * which is a specific union of Rpc types. We widen to `RpcGroup<AnyRpc>` to collect
 * groups with different Rpc types into a single array for merging.
 * 
 * The type information is preserved at the Router level via:
 * - ExtractRpcGroups<TRoutes> at the type level
 * - RpcGroup.merge() at runtime, which combines the groups
 * 
 * This matches Effect's pattern in RpcGroup.toHandlersContext where handlers
 * are stored in Map<string, unknown> but retrieved with proper types.
 * 
 * @internal
 */
function unsafeWidenRpcGroup(
  group: AnyProceduresGroup,
  pathPrefix: string,
): RpcGroup.RpcGroup<AnyRpc> {
  return proceduresGroupToRpcGroup(group, pathPrefix) as unknown as RpcGroup.RpcGroup<AnyRpc>
}

/**
 * Assert that the accumulated flatten result matches the computed type.
 * 
 * **Why this assertion is safe:**
 * 
 * The FlattenAccumulator is built by flattenRoutes which:
 * 1. Visits every entry in the router record (exhaustive iteration)
 * 2. Constructs paths using `${prefix}${key}.${procName}` (matches ExtractProcedures)
 * 3. Collects all RpcGroups from procedure groups (matches ExtractRpcGroups)
 * 
 * The type-level computation in ExtractProcedures<TRoutes> exactly mirrors
 * the runtime iteration logic, ensuring structural compatibility.
 * 
 * This is the same pattern Effect uses in Context.unsafeMake:
 * - Runtime: Map<string, any> with dynamic content
 * - Type: Context<Services> with precise service types
 * - Safety: Caller ensures map contents match Services
 * 
 * @internal
 */
function unsafeAssertFlattenResult<Routes extends RouterRecord>(
  accumulator: FlattenAccumulator,
): FlattenResult<Routes> {
  return accumulator as unknown as FlattenResult<Routes>
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Flattening
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively flatten a router structure into procedures and RpcGroups.
 * 
 * **Type Safety Strategy:**
 * 
 * This function is generic over TRoutes. The return type uses ExtractProcedures<TRoutes>
 * which is computed at compile-time using TypeScript's type-level recursion.
 * 
 * We use Effect's Record.reduce for iteration, which preserves key types better
 * than Object.entries. However, we still need boundary assertions because:
 * - RouterRecord values are heterogeneous (Router | ProceduresGroup)
 * - Type guards narrow to AnyRouter | AnyProceduresGroup (using `any`)
 * - The accumulated result type can't be computed incrementally
 * 
 * The assertions are isolated to named functions (unsafeAssert*) that document
 * why each boundary crossing is safe.
 * 
 * @internal
 */
function flattenRoutes<Routes extends RouterRecord>(
  entries: Routes,
  pathPrefix: string = "",
): FlattenResult<Routes> {
  // Use Record.reduce for better type preservation on keys.
  // The callback receives `key: K` where K is the literal key type.
  const accumulator = Record.reduce(
    entries,
    { procedures: {}, rpcGroups: [] } as FlattenAccumulator,
    (acc, entry, key) => {
      if (isRouter(entry)) {
        // Nested router - recurse and merge results
        const nested = flattenRoutes(entry.routes, `${pathPrefix}${key}.`)
        Object.assign(acc.procedures, nested.procedures)
        acc.rpcGroups.push(...nested.rpcGroups)
      } else if (isProceduresGroup(entry)) {
        // Procedure group - flatten procedures with full path
        // Use Record.reduce for inner iteration too
        Record.reduce(
          entry.procedures as globalThis.Record<string, unknown>,
          undefined as void,
          (_, procValue, procName) => {
            const fullPath = `${pathPrefix}${key}.${procName}`
            acc.procedures[fullPath] = unsafeAssertProcedureDefinition(procValue)
          },
        )
        acc.rpcGroups.push(unsafeWidenRpcGroup(entry, pathPrefix))
      }
      return acc
    },
  )

  return unsafeAssertFlattenResult<Routes>(accumulator)
}

// ─────────────────────────────────────────────────────────────────────────────
// Router Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for creating a Router.
 * @internal
 */
export interface MakeOptions {
  readonly middlewares?: ReadonlyArray<Middleware<any, any, any, any>>
}

/**
 * Create a router from procedure groups and/or nested routers.
 *
 * Supports infinite nesting - routers can contain other routers.
 * Internally flattens all procedures to dot-separated paths for @effect/rpc.
 *
 * @internal
 */
export const make = <Routes extends RouterRecord>(
  routes: Routes,
  options?: MakeOptions
): Router<Routes> => {
  validateNoDuplicatePaths(routes)

  // Use the generic flattenRoutes which computes types from Routes
  const { procedures: flattenedProcedures, rpcGroups } = flattenRoutes(routes)

  // Validation: Router must have at least one procedure group.
  // This is a programmer error (defect) that should fail fast during development.
  // Using a plain throw is appropriate here since this is synchronous validation
  // at module initialization time, similar to Zod schema validation.
  if (rpcGroups.length === 0) {
    throw new RouterValidationError({
      module: "Router",
      method: "router",
      reason: "Router must have at least one procedure group",
    })
  }

  // Merge all RpcGroups into one using reduce (functional pattern)
  // The non-null assertion is safe: we validated rpcGroups.length > 0 above
  const combinedGroup = rpcGroups.slice(1).reduce(
    (acc, group) => acc.merge(group),
    rpcGroups[0]!,
  )

  return {
    [TypeId]: TypeId,
    _tag: "Router",
    routes,
    procedures: flattenedProcedures,
    rpcGroup: combinedGroup,
    ...(options?.middlewares ? { middlewares: options.middlewares } : {}),

    use: (middleware: Middleware<any, any, any, any>) => {
      const existingMiddlewares = options?.middlewares ?? []
      return make(routes, { middlewares: [...existingMiddlewares, middleware] })
    },

    toHttpLayer: <R>(httpOptions: ToHttpLayerOptions<R>) => {
      const path = httpOptions.path ?? "/rpc"
      const protocol = httpOptions.protocol ?? "http"

      return RpcServer.layerHttpRouter({
        group: combinedGroup,
        path,
        protocol,
      }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
        Layer.provide(httpOptions.handlers),
      )
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procedure metadata for client-side features and OpenAPI generation.
 *
 * @since 0.1.0
 * @category models
 */
export interface ProcedureMetadata {
  readonly description?: string
  /**
   * Short summary for OpenAPI generation.
   * @since 0.1.0
   */
  readonly summary?: string
  /**
   * URL to external documentation.
   * @since 0.1.0
   */
  readonly externalDocs?: string
  /**
   * Description of the successful response for OpenAPI.
   * @since 0.1.0
   */
  readonly responseDescription?: string
  readonly deprecated?: boolean
  readonly invalidates?: ReadonlyArray<string>
  readonly invalidatesTags?: ReadonlyArray<string>
  readonly tags?: ReadonlyArray<string>
}

/**
 * Metadata registry mapping procedure paths to their metadata.
 *
 * @since 0.1.0
 * @category models
 */
export type MetadataRegistry = Record<string, ProcedureMetadata>

/**
 * Extract procedure metadata from a router (supports nested routers).
 *
 * This is useful for passing declarative invalidation rules to the React client.
 *
 * @internal
 */
export const extractMetadata = <Routes extends RouterRecord>(
  routerInstance: Router<Routes>,
): MetadataRegistry => {
  /**
   * Recursively extract metadata using functional reduce pattern.
   * No mutation - builds up immutable result through recursion.
   */
  const extractFromRoutes = (
    entries: RouterRecord,
    pathPrefix: string = "",
  ): MetadataRegistry =>
    Object.entries(entries).reduce<MetadataRegistry>((acc, [key, entry]) => {
      if (isRouter(entry)) {
        // Nested router - recurse and merge results
        const nested = extractFromRoutes(entry.routes, `${pathPrefix}${key}.`)
        return { ...acc, ...nested }
      } else if (isProceduresGroup(entry)) {
        // Procedure group - extract metadata for each procedure
        const groupMetadata = Object.entries(entry.procedures).reduce<MetadataRegistry>(
          (procAcc, [procName, procDef]) => {
            const fullPath = `${pathPrefix}${key}.${procName}`
            const def = procDef as {
              description?: string
              summary?: string
              externalDocs?: string
              responseDescription?: string
              deprecated?: boolean
              invalidates?: ReadonlyArray<string>
              invalidatesTags?: ReadonlyArray<string>
              tags?: ReadonlyArray<string>
            }

            // Only include if there's actual metadata
            if (def.description || def.summary || def.externalDocs || def.responseDescription || def.deprecated || def.invalidates?.length || def.invalidatesTags?.length || def.tags?.length) {
              return {
                ...procAcc,
                [fullPath]: {
                  ...(def.description ? { description: def.description } : {}),
                  ...(def.summary ? { summary: def.summary } : {}),
                  ...(def.externalDocs ? { externalDocs: def.externalDocs } : {}),
                  ...(def.responseDescription ? { responseDescription: def.responseDescription } : {}),
                  ...(def.deprecated ? { deprecated: def.deprecated } : {}),
                  ...(def.invalidates?.length ? { invalidates: def.invalidates } : {}),
                  ...(def.invalidatesTags?.length ? { invalidatesTags: def.invalidatesTags } : {}),
                  ...(def.tags?.length ? { tags: def.tags } : {}),
                },
              }
            }
            return procAcc
          },
          {},
        )
        return { ...acc, ...groupMetadata }
      }
      return acc
    }, {})

  return extractFromRoutes(routerInstance.routes)
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Inference Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer the input type of a procedure.
 *
 * @since 0.1.0
 * @category type-level
 */
export type InferInput<T> = T extends ProceduresGroup<
  any,
  infer P extends ProcedureRecord
>
  ? {
      [K in keyof P]: P[K] extends { inputSchema: infer S }
        ? S extends Schema.Schema<infer I, any>
          ? I
          : unknown
        : unknown
    }
  : never

/**
 * Infer the output type of a procedure.
 *
 * @since 0.1.0
 * @category type-level
 */
export type InferOutput<T> = T extends ProceduresGroup<
  any,
  infer P extends ProcedureRecord
>
  ? {
      [K in keyof P]: P[K] extends { outputSchema: infer S }
        ? S extends Schema.Schema<infer O, any>
          ? O
          : unknown
        : unknown
    }
  : never
