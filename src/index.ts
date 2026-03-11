/**
 * effect-trpc - End-to-end typesafe APIs with Effect
 * 
 * @since 1.0.0
 * 
 * @example
 * ```ts
 * // Define procedures
 * import { Procedure, Router } from "effect-trpc"
 * 
 * const UserRouter = Router.make({
 *   list: Procedure.query({
 *     success: Schema.Array(User),
 *     handler: () => UserService.findAll()
 *   }),
 *   create: Procedure.mutation({
 *     payload: CreateUserInput,
 *     success: User,
 *     invalidates: ["user.list"],
 *     handler: (input) => UserService.create(input)
 *   }),
 * })
 * 
 * // Create client
 * import { Client, Transport } from "effect-trpc"
 * 
 * const api = Client.unsafeMake<typeof UserRouter>()
 * 
 * // Use in React
 * <api.Provider layer={Transport.http("/api/trpc")}>
 *   <App />
 * </api.Provider>
 * 
 * // In components
 * const query = api.user.list.useQuery({})
 * ```
 */

// =============================================================================
// Core Modules
// =============================================================================

/**
 * Procedure - Define RPC endpoints
 * 
 * @since 1.0.0
 */
export * as Procedure from "./Procedure.js"

/**
 * Router - Compose procedures into typed APIs
 * 
 * @since 1.0.0
 */
export * as Router from "./Router.js"

/**
 * Client - Create typed API clients
 * 
 * @since 1.0.0
 */
export * as Client from "./Client.js"

/**
 * Transport - How requests travel
 * 
 * @since 1.0.0
 */
export * as Transport from "./Transport.js"

// =============================================================================
// Re-exports from Effect RPC (where applicable)
// =============================================================================

// TODO: Re-export RpcMiddleware as Middleware
// export * as Middleware from "@effect/rpc/RpcMiddleware"
