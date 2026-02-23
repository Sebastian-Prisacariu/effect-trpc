/**
 * Server-side router configuration.
 *
 * This example demonstrates nested router support.
 * Routers can contain other routers for modular organization.
 *
 * @example
 * ```ts
 * // Client usage with nested routers:
 * api.user.profile.get.useQuery()        // Flat access
 * api.user.posts.list.useQuery()         // Nested router
 * api.admin.users.list.useQuery()        // Deeply nested
 * ```
 */

import { Router } from "effect-trpc"
import {
  PostProcedures,
  UserProfileProcedures,
  UserPostsProcedures,
  AdminUsersProcedures,
  HealthProcedures,
} from "./procedures"

// ─────────────────────────────────────────────────────────────────────────────
// Nested Router Example
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User sub-router: groups user-related procedure groups.
 *
 * Paths:
 * - user.profile.get
 * - user.profile.update
 * - user.posts.list
 * - user.posts.create
 */
const userRouter = Router.make({
  profile: UserProfileProcedures,
  posts: UserPostsProcedures,
})

/**
 * Admin sub-router: admin-only operations.
 *
 * Paths:
 * - admin.users.list
 * - admin.users.delete
 */
const adminRouter = Router.make({
  users: AdminUsersProcedures,
})

// ─────────────────────────────────────────────────────────────────────────────
// Main App Router
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The app router combining all procedure groups and nested routers.
 *
 * Structure:
 * - user (Router)
 *   - profile (ProceduresGroup)
 *   - posts (ProceduresGroup)
 * - admin (Router)
 *   - users (ProceduresGroup)
 * - post (ProceduresGroup)
 * - health (ProceduresGroup)
 */
export const appRouter = Router.make({
  // Nested routers
  user: userRouter,
  admin: adminRouter,
  // Top-level procedure groups
  post: PostProcedures,
  health: HealthProcedures,
})

/**
 * Export type for client-side usage.
 */
export type AppRouter = typeof appRouter
