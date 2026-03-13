/**
 * effect-trpc - End-to-end typesafe APIs with Effect
 * 
 * @since 1.0.0
 * 
 * @example
 * ```ts
 * import { Procedure, Router, Client, Transport } from "effect-trpc"
 * import { Schema } from "effect"
 * 
 * // Define procedures
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: Procedure.query({ success: Schema.Array(User) }),
 *     create: Procedure.mutation({
 *       payload: CreateUserInput,
 *       success: User,
 *       invalidates: ["users"],
 *     }),
 *   },
 *   health: Procedure.query({ success: Schema.String }),
 * })
 * 
 * // Create client
 * const api = Client.make<typeof appRouter>()
 * 
 * // Use in React
 * <api.Provider layer={Transport.http("/api/trpc")}>
 *   <App />
 * </api.Provider>
 * 
 * // In components
 * const query = api.users.list.useQuery()
 * ```
 */

export * as Procedure from "./Procedure/index.js"
export * as Router from "./Router/index.js"
export * as Client from "./Client/index.js"
export * as Server from "./Server/index.js"
export * as Transport from "./Transport/index.js"
export * as Result from "./Result/index.js"
export * as Middleware from "./Middleware/index.js"
export * as Reactivity from "./Reactivity/index.js"
