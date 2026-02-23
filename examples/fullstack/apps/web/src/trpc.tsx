/**
 * tRPC client setup using effect-trpc/react
 */
import { createTRPCReact } from "effect-trpc/react"
import type { AppRouter } from "@example/api"

export const trpc = createTRPCReact<AppRouter>({
  url: "http://localhost:3001/rpc",
})
