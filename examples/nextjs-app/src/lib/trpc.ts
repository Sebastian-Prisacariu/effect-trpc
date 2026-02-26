/**
 * Client-side TRPC configuration.
 *
 * effect-trpc provides two patterns for React integration:
 *
 * ## Pattern 1: Simple (shown below)
 * Uses `createTRPCReact` which manages its own runtime internally.
 * Best for simple apps where you don't need to share the runtime.
 *
 * ## Pattern 2: Runtime-Injected (V1 API)
 * App provides its own ManagedRuntime via EffectTRPCProvider.
 * Best for complex apps with shared services.
 *
 * @example Runtime-Injected Pattern
 * ```ts
 * // lib/trpc.ts
 * import { ManagedRuntime, Layer } from "effect"
 * import { createTRPCHooks, Client } from "effect-trpc/react"
 * import { appRouter } from "~/server/trpc/router"
 *
 * const AppLive = Client.HttpLive("/api/trpc")
 * export const appRuntime = ManagedRuntime.make(AppLive)
 * export const trpc = createTRPCHooks({ router: appRouter })
 *
 * // app/providers.tsx
 * import { EffectTRPCProvider } from "effect-trpc/react"
 * import { appRuntime, trpc } from "~/lib/trpc"
 *
 * export function Providers({ children }) {
 *   return (
 *     <EffectTRPCProvider runtime={appRuntime}>
 *       <trpc.Provider>
 *         {children}
 *       </trpc.Provider>
 *     </EffectTRPCProvider>
 *   )
 * }
 * ```
 */

import { createTRPCReact } from "effect-trpc/react"
import type { AppRouter } from "~/server/trpc/router"

/**
 * Typed TRPC client for React (Simple Pattern).
 *
 * This uses the simple `createTRPCReact` API which manages
 * its own ManagedRuntime internally.
 */
export const trpc = createTRPCReact<AppRouter>({
  url: "/api/trpc",
})
