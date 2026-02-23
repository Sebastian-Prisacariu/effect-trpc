/**
 * Next.js App Router API route for effect-trpc.
 */

import { createRouteHandler } from "effect-trpc/next"
import { appRouter } from "~/server/trpc/router"
import { AllHandlersLive } from "~/server/trpc/handlers"

/**
 * Create the route handlers.
 */
const { GET, POST } = createRouteHandler({
  router: appRouter,
  handlers: AllHandlersLive,
})

export { GET, POST }
