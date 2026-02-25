/**
 * @module effect-trpc/core/router
 *
 * Router for composing procedure groups with support for infinite nesting.
 * Routers can contain procedure groups (leaf nodes) or other routers (branches).
 *
 * @example
 * ```ts
 * // Nested router structure
 * const appRouter = Router.make({
 *   user: Router.make({
 *     posts: procedures("posts", { list: p.query(...) }),
 *     profile: procedures("profile", { get: p.query(...) }),
 *   }),
 *   health: procedures("health", { check: p.query(...) }),
 * })
 *
 * // Client usage with infinite nesting
 * api.user.posts.list.useQuery()
 * api.user.profile.get.useQuery()
 * api.health.check.useQuery()
 * ```
 *
 * @since 0.1.0
 */

import * as internal from "./internal/router.js"

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from internal module
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
export const RouterValidationError = internal.RouterValidationError

/**
 * @since 0.1.0
 * @category errors
 */
export type RouterValidationError = internal.RouterValidationError

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A record of router entries, allowing infinite nesting.
 *
 * Uses a structural type check to accept any object with _tag "ProceduresGroup" or "Router".
 * This is more permissive than a union type and allows proper type inference.
 *
 * @example
 * ```ts
 * const routes: RouterRecord = {
 *   user: Router.make({ ... }),     // Nested router
 *   health: procedures("health", {}), // Procedure group
 * }
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export type RouterRecord = internal.RouterRecord

/**
 * A Router composes procedure groups with support for infinite nesting.
 * Routers can contain procedure groups (leaf nodes) or other routers (branches).
 *
 * @since 0.1.0
 * @category models
 */
export type Router<Routes extends RouterRecord = RouterRecord> = internal.Router<Routes>

/**
 * Options for creating an HTTP layer from a router.
 *
 * @since 0.1.0
 * @category models
 */
export type ToHttpLayerOptions<R> = internal.ToHttpLayerOptions<R>

/**
 * Procedure metadata for client-side features.
 *
 * @since 0.1.0
 * @category models
 */
export type ProcedureMetadata = internal.ProcedureMetadata

/**
 * Metadata registry mapping procedure paths to their metadata.
 *
 * @since 0.1.0
 * @category models
 */
export type MetadataRegistry = internal.MetadataRegistry

// ─────────────────────────────────────────────────────────────────────────────
// Type-Level Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively extract all procedure definitions from a router record.
 * Returns a flattened record with full path keys.
 *
 * @example
 * ```ts
 * const routes = {
 *   user: procedures("user", { get: proc, list: proc }),
 *   admin: Router.make({ users: procedures("users", { ban: proc }) })
 * }
 * type Procs = ExtractProcedures<typeof routes>
 * // { "user.get": Proc, "user.list": Proc, "admin.users.ban": Proc }
 * ```
 *
 * @since 0.1.0
 * @category type-level
 */
export type ExtractProcedures<
  Routes extends RouterRecord,
  Prefix extends string = "",
> = internal.ExtractProcedures<Routes, Prefix>

/**
 * Recursively extract all RpcGroup types from a router record.
 * Returns a union of RpcGroup types.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ExtractRpcGroups<
  Routes extends RouterRecord,
  Prefix extends string = "",
> = internal.ExtractRpcGroups<Routes, Prefix>

/**
 * Infer the input type of a procedure.
 *
 * @since 0.1.0
 * @category type-level
 */
export type InferInput<T> = internal.InferInput<T>

/**
 * Infer the output type of a procedure.
 *
 * @since 0.1.0
 * @category type-level
 */
export type InferOutput<T> = internal.InferOutput<T>

/**
 * Infer the error type of a procedure (includes middleware errors).
 *
 * @since 0.4.0
 * @category type-level
 */
export type InferError<T> = internal.InferError<T>

/**
 * Infer the requirements (R channel) of a procedure (includes middleware requirements).
 *
 * @since 0.4.0
 * @category type-level
 */
export type InferRequirements<T> = internal.InferRequirements<T>

/**
 * Infer the services provided by middleware for a procedure.
 *
 * @since 0.4.0
 * @category type-level
 */
export type InferProvides<T> = internal.InferProvides<T>

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Any ProceduresGroup - used for runtime checks.
 *
 * @since 0.1.0
 * @category guards
 */
export type AnyProceduresGroup = internal.AnyProceduresGroup

/**
 * Any Router - used for runtime checks.
 *
 * @since 0.1.0
 * @category guards
 */
export type AnyRouter = internal.AnyRouter

/**
 * A router entry can be either:
 * - A ProceduresGroup (leaf node with procedures)
 * - Another Router (branch node for nesting)
 *
 * @since 0.1.0
 * @category guards
 */
export type RouterEntry = internal.RouterEntry

/**
 * Check if an entry is a Router (for nesting).
 * Accepts any object with a _tag property for flexibility.
 *
 * @since 0.1.0
 * @category guards
 */
export const isRouter: (entry: { readonly _tag: string }) => entry is AnyRouter = internal.isRouter

/**
 * Check if an entry is a ProceduresGroup (leaf).
 * Accepts any object with a _tag property for flexibility.
 *
 * @since 0.1.0
 * @category guards
 */
export const isProceduresGroup: (entry: { readonly _tag: string }) => entry is AnyProceduresGroup =
  internal.isProceduresGroup

// ─────────────────────────────────────────────────────────────────────────────
// Router Namespace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Router namespace containing constructors and utilities.
 *
 * @example
 * ```ts
 * // Flat structure
 * const appRouter = Router.make({
 *   user: userProcedures,
 *   post: postProcedures,
 * })
 *
 * // Nested structure
 * const appRouter = Router.make({
 *   user: Router.make({
 *     posts: procedures("posts", { list: p.query(...) }),
 *     comments: Router.make({
 *       recent: procedures("recent", { list: p.query(...) }),
 *     }),
 *   }),
 *   health: procedures("health", { check: p.query(...) }),
 * })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const Router = {
  /**
   * Create a router from procedure groups and/or nested routers.
   *
   * Supports infinite nesting - routers can contain other routers.
   * Internally flattens all procedures to dot-separated paths for @effect/rpc.
   *
   * @example
   * ```ts
   * // Simple router
   * const appRouter = Router.make({
   *   user: userProcedures,
   *   post: postProcedures,
   * })
   *
   * // Nested routers from different modules
   * // src/server/routers/user.ts
   * export const userRouter = Router.make({
   *   posts: userPostsProcedures,
   *   profile: userProfileProcedures,
   * })
   *
   * // src/server/routers/index.ts
   * import { userRouter } from './user'
   * export const appRouter = Router.make({
   *   user: userRouter,
   *   health: healthProcedures,
   * })
   * ```
   *
   * @since 0.1.0
   * @category constructors
   */
  make: internal.make,
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract procedure metadata from a router (supports nested routers).
 *
 * This is useful for passing declarative invalidation rules to the React client.
 *
 * @example
 * ```ts
 * const appRouter = Router.make({
 *   user: Router.make({
 *     posts: procedures("posts", {
 *       create: p.mutation(...).invalidates(["user.posts.list"]),
 *     }),
 *   }),
 * })
 *
 * export const routerMetadata = extractMetadata(appRouter)
 * // { "user.posts.create": { invalidates: ["user.posts.list"] } }
 * ```
 *
 * @since 0.1.0
 * @category utilities
 */
export const extractMetadata: <Routes extends RouterRecord>(
  routerInstance: Router<Routes>,
) => MetadataRegistry = internal.extractMetadata
