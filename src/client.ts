/**
 * effect-trpc/client - Client-side exports
 * 
 * Import this in client code (React components)
 * 
 * @since 1.0.0
 * 
 * @example
 * ```ts
 * // lib/api.ts
 * import { Client, Transport } from "effect-trpc/client"
 * import type { AppRouter } from "./router"
 * 
 * export const api = Client.unsafeMake<AppRouter>()
 * ```
 */

export * as Client from "./Client.js"
export * as Transport from "./Transport.js"

// Re-export types needed for client-side use
export type { QueryResult, DehydratedState } from "./internal/services.js"
