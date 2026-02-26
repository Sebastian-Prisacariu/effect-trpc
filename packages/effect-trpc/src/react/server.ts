/**
 * @module effect-trpc/react/server
 *
 * Server-side utilities for using effect-trpc in React Server Components (RSC) and SSR.
 *
 * This module is separate from the main react exports to avoid bundling server-side
 * code (like RPC handlers) with client-only React hooks.
 *
 * ## Two Patterns for SSR
 *
 * ### 1. Simple Pattern (`createServerClient`)
 *
 * Best for simple SSR use cases. Creates a ready-to-use client.
 *
 * ```ts
 * import { createServerClient } from "effect-trpc/react/server"
 *
 * const serverClient = createServerClient({
 *   router: appRouter,
 *   handlers: AppHandlersLive,
 * })
 *
 * // In Server Component:
 * const users = await Effect.runPromise(serverClient.procedures.user.list())
 * ```
 *
 * ### 2. Runtime-Injected Pattern (`createInMemoryClientLive`)
 *
 * Best for complex apps that want to share a runtime between SSR and client.
 *
 * ```ts
 * import { createInMemoryClientLive } from "effect-trpc/react/server"
 * import { ManagedRuntime } from "effect"
 *
 * // Create a runtime for SSR
 * const InMemoryClientLive = createInMemoryClientLive(appRouter, AppHandlersLive)
 * const ssrRuntime = ManagedRuntime.make(InMemoryClientLive)
 *
 * // In Server Component:
 * const users = await ssrRuntime.runPromise(
 *   Effect.gen(function* () {
 *     const client = yield* Client
 *     const api = client.create(appRouter)
 *     return yield* api.user.list()
 *   })
 * )
 * ```
 *
 * @since 0.1.0
 */

// Simple SSR pattern
export { createServerClient } from "./server-client.js"
export type { CreateServerClientOptions, ServerTRPCClient } from "./server-client.js"

// Runtime-injected SSR pattern
export { createInMemoryClientLive } from "./server-client.js"

// Re-export Client for convenience
export { Client } from "../core/client/index.js"
export type { ClientShape } from "../core/client/index.js"

