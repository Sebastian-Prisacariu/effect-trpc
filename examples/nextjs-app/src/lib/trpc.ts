/**
 * Client-side TRPC configuration.
 */

import { createTRPCReact } from "effect-trpc/react"
import type { AppRouter } from "~/server/trpc/router"

/**
 * Typed TRPC client for React.
 */
export const trpc = createTRPCReact<AppRouter>({
  url: "/api/trpc",
})
