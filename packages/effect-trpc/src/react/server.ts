/**
 * @module effect-trpc/react/server
 *
 * Server-side utilities for using effect-trpc in React Server Components (RSC) and SSR.
 * 
 * This module is separate from the main react exports to avoid bundling server-side
 * code (like RPC handlers) with client-only React hooks.
 *
 * @example
 * ```ts
 * // src/trpc/server.js
 * import { createServerClient } from "effect-trpc/react/server"
 * import { appRouter } from "./router"
 * import { AppHandlersLive } from "./handlers"
 * 
 * export const serverClient = createServerClient({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 * ```
 *
 * @since 0.1.0
 */

export { createServerClient } from "./server-client.js"
export type { CreateServerClientOptions } from "./server-client.js"

