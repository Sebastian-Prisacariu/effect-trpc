/**
 * Server-side procedure definitions.
 *
 * This file demonstrates both flat and nested procedure groups.
 */

import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { procedures, procedure } from "effect-trpc"

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

export const UserProfileProcedures = procedures("profile", {
  /**
   * Get the current user's profile.
   */
  get: procedure.output(UserSchema).query(),

  /**
   * Update the current user's profile.
   */
  update: procedure
    .input(UpdateUserSchema)
    .output(UserSchema)
    .invalidates(["user.profile.get"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Nested User Posts Procedures
// Used in: user.posts.list, user.posts.create
// ─────────────────────────────────────────────────────────────────────────────

export const UserPostsProcedures = procedures("posts", {
  /**
   * List the current user's posts.
   */
  list: procedure.output(Schema.Array(PostSchema)).query(),

  /**
   * Create a new post for the current user.
   */
  create: procedure
    .input(Schema.Struct({ title: Schema.String, content: Schema.String }))
    .output(PostSchema)
    .invalidates(["user.posts.list", "post.list"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin Users Procedures (nested under admin router)
// Used in: admin.users.list, admin.users.delete
// ─────────────────────────────────────────────────────────────────────────────

export const AdminUsersProcedures = procedures("users", {
  /**
   * List all users (admin only).
   */
  list: procedure.output(Schema.Array(UserSchema)).query(),

  /**
   * Delete a user by ID (admin only).
   */
  delete: procedure
    .input(UserIdSchema)
    .output(Schema.Boolean)
    .invalidates(["admin.users.list", "user.list"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Top-level Post Procedures
// ─────────────────────────────────────────────────────────────────────────────

export const PostProcedures = procedures("post", {
  /**
   * List all posts.
   */
  list: procedure.output(Schema.Array(PostSchema)).query(),

  /**
   * Get posts by author ID.
   */
  byAuthor: procedure
    .input(Schema.Struct({ authorId: Schema.String }))
    .output(Schema.Array(PostSchema))
    .query(),

  /**
   * Create a new post.
   */
  create: procedure
    .input(CreatePostSchema)
    .output(PostSchema)
    .invalidates(["post.list", "post.byAuthor"])
    .mutation(),
})

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Procedures
// ─────────────────────────────────────────────────────────────────────────────

export const HealthProcedures = procedures("health", {
  /**
   * Check the health of the service.
   */
  check: procedure.output(HealthSchema).query(),
})
