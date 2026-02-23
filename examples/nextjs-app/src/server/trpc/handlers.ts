/**
 * Server-side procedure implementations.
 *
 * This file demonstrates handlers for both flat and nested procedure groups.
 */

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  PostProcedures,
  UserProfileProcedures,
  UserPostsProcedures,
  AdminUsersProcedures,
  HealthProcedures,
  type User,
  type Post,
  type Health,
} from "./procedures"

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Database (for demo purposes)
// ─────────────────────────────────────────────────────────────────────────────

const users: User[] = [
  {
    id: "1",
    name: "Alice Johnson",
    email: "alice@example.com",
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    name: "Bob Smith",
    email: "bob@example.com",
    createdAt: new Date().toISOString(),
  },
]

const posts: Post[] = [
  {
    id: "1",
    title: "Hello Effect!",
    content: "This is a post about Effect.ts",
    authorId: "1",
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    title: "TRPC is awesome",
    content: "Building type-safe APIs with effect-trpc",
    authorId: "1",
    createdAt: new Date().toISOString(),
  },
  {
    id: "3",
    title: "My first post",
    content: "Just getting started!",
    authorId: "2",
    createdAt: new Date().toISOString(),
  },
]

// Simulated current user (in real app, this would come from auth)
const currentUserId = "1"

let nextUserId = 3
let nextPostId = 4

// ─────────────────────────────────────────────────────────────────────────────
// Nested User Profile Handlers (user.profile.*)
// ─────────────────────────────────────────────────────────────────────────────

export const UserProfileHandlersLive = UserProfileProcedures.toLayer({
  get: () =>
    Effect.gen(function* () {
      const user = users.find((u) => u.id === currentUserId)
      if (!user) {
        return yield* Effect.dieMessage("Current user not found")
      }
      return user
    }),

  update: (_, { name, email }) =>
    Effect.gen(function* () {
      const index = users.findIndex((u) => u.id === currentUserId)
      if (index === -1) {
        return yield* Effect.dieMessage("Current user not found")
      }
      // Create updated user object (readonly-safe)
      const currentUser = users[index]!
      const updatedUser: User = {
        ...currentUser,
        name: name ?? currentUser.name,
        email: email ?? currentUser.email,
      }
      users[index] = updatedUser
      return updatedUser
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Nested User Posts Handlers (user.posts.*)
// ─────────────────────────────────────────────────────────────────────────────

export const UserPostsHandlersLive = UserPostsProcedures.toLayer({
  list: () => Effect.succeed(posts.filter((p) => p.authorId === currentUserId)),

  create: (_, { title, content }) =>
    Effect.sync(() => {
      const post: Post = {
        id: String(nextPostId++),
        title,
        content,
        authorId: currentUserId,
        createdAt: new Date().toISOString(),
      }
      posts.push(post)
      return post
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin Users Handlers (admin.users.*)
// ─────────────────────────────────────────────────────────────────────────────

export const AdminUsersHandlersLive = AdminUsersProcedures.toLayer({
  list: () => Effect.succeed(users),

  delete: (_, { id }) =>
    Effect.sync(() => {
      const index = users.findIndex((u) => u.id === id)
      if (index === -1) {
        return false
      }
      users.splice(index, 1)
      return true
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Post Handlers
// ─────────────────────────────────────────────────────────────────────────────

export const PostHandlersLive = PostProcedures.toLayer({
  list: () => Effect.succeed(posts),

  byAuthor: (_, { authorId }) =>
    Effect.succeed(posts.filter((p) => p.authorId === authorId)),

  create: (_, { title, content, authorId }) =>
    Effect.sync(() => {
      const post: Post = {
        id: String(nextPostId++),
        title,
        content,
        authorId,
        createdAt: new Date().toISOString(),
      }
      posts.push(post)
      return post
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Health Handlers
// ─────────────────────────────────────────────────────────────────────────────

export const HealthHandlersLive = HealthProcedures.toLayer({
  check: () =>
    Effect.succeed({
      status: "healthy" as const,
      timestamp: new Date().toISOString(),
    }),
})

// ─────────────────────────────────────────────────────────────────────────────
// Combined Handlers Layer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All handlers combined into a single layer.
 *
 * Note: For nested routers, we need to provide handlers for each leaf
 * procedures group. The router's toHttpLayer will combine them.
 */
export const AllHandlersLive = Layer.mergeAll(
  // Nested user handlers
  UserProfileHandlersLive,
  UserPostsHandlersLive,
  // Nested admin handlers
  AdminUsersHandlersLive,
  // Top-level handlers
  PostHandlersLive,
  HealthHandlersLive,
)
