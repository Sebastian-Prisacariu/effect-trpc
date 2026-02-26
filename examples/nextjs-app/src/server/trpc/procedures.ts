/**
 * Server-side procedure definitions.
 *
 * This file demonstrates both flat and nested procedure groups.
 */

import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { Procedures, Procedure } from "effect-trpc"

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.String,
})
export type User = typeof UserSchema.Type

export const CreateUserSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
})
export type CreateUser = typeof CreateUserSchema.Type

export const UserIdSchema = Schema.Struct({
  id: Schema.String,
})
export type UserId = typeof UserIdSchema.Type

export const UpdateUserSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
})
export type UpdateUser = typeof UpdateUserSchema.Type

export const PostSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  content: Schema.String,
  authorId: Schema.String,
  createdAt: Schema.String,
})
export type Post = typeof PostSchema.Type

export const CreatePostSchema = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  authorId: Schema.String,
})
export type CreatePost = typeof CreatePostSchema.Type

export const HealthSchema = Schema.Struct({
  status: Schema.Literal("healthy", "degraded", "unhealthy"),
  timestamp: Schema.String,
})
export type Health = typeof HealthSchema.Type

// ─────────────────────────────────────────────────────────────────────────────
// Nested User Profile Procedures
// Used in: user.profile.get, user.profile.update
// ─────────────────────────────────────────────────────────────────────────────

export const UserProfileProcedures = Procedures.make({
  /**
   * Get the current user's profile.
   */
  get: Procedure.output(UserSchema).query(),

  /**
   * Update the current user's profile.
   */
  update: Procedure
    .input(UpdateUserSchema)
    .output(UserSchema)
    .invalidates(["user.profile.get"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Nested User Posts Procedures
// Used in: user.posts.list, user.posts.create
// ─────────────────────────────────────────────────────────────────────────────

export const UserPostsProcedures = Procedures.make({
  /**
   * List the current user's posts.
   */
  list: Procedure.output(Schema.Array(PostSchema)).query(),

  /**
   * Create a new post for the current user.
   */
  create: Procedure
    .input(Schema.Struct({ title: Schema.String, content: Schema.String }))
    .output(PostSchema)
    .invalidates(["user.posts.list", "post.list"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin Users Procedures (nested under admin router)
// Used in: admin.users.list, admin.users.delete
// ─────────────────────────────────────────────────────────────────────────────

export const AdminUsersProcedures = Procedures.make({
  /**
   * List all users (admin only).
   */
  list: Procedure.output(Schema.Array(UserSchema)).query(),

  /**
   * Delete a user by ID (admin only).
   */
  delete: Procedure
    .input(UserIdSchema)
    .output(Schema.Boolean)
    .invalidates(["admin.users.list", "user.list"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Top-level Post Procedures
// ─────────────────────────────────────────────────────────────────────────────

export const PostProcedures = Procedures.make({
  /**
   * List all posts.
   */
  list: Procedure.output(Schema.Array(PostSchema)).query(),

  /**
   * Get posts by author ID.
   */
  byAuthor: Procedure
    .input(Schema.Struct({ authorId: Schema.String }))
    .output(Schema.Array(PostSchema))
    .query(),

  /**
   * Create a new post.
   */
  create: Procedure
    .input(CreatePostSchema)
    .output(PostSchema)
    .invalidates(["post.list", "post.byAuthor"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Procedures
// ─────────────────────────────────────────────────────────────────────────────

export const HealthProcedures = Procedures.make({
  /**
   * Check the health of the service.
   */
  check: Procedure.output(HealthSchema).query(),
})
