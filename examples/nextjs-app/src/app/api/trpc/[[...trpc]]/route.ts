/**
 * Next.js App Router API route for effect-trpc.
 */

import { Router } from "effect-trpc"
import { appRouter } from "~/server/trpc/router"
import { AllHandlersLive } from "~/server/trpc/handlers"

/**
 * Create the route handlers.
 */
const rpc = appRouter.pipe(
  Router.provide(AllHandlersLive),
  Router.toHttpHandler(),
)

const GET = rpc.handler
const POST = rpc.handler

export { GET, POST }
