/**
 * Server implementation.
 * 
 * This file implements the RPC handlers using Effect RPC's toLayer().
 */

import { Effect, Layer, Ref } from "effect"
import { User, UserRpcs, NotFoundError, ValidationError } from "./procedures.js"

// ─────────────────────────────────────────────────────────────────────────────
// Database Service (Interface-First!)
// ─────────────────────────────────────────────────────────────────────────────

class UserRepository extends Effect.Service<UserRepository>()("UserRepository", {
  effect: Effect.gen(function* () {
    // In-memory store for example
    const users = yield* Ref.make<User[]>([
      new User({
        id: "1",
        name: "Alice",
        email: "alice@example.com",
        createdAt: new Date(),
      }),
      new User({
        id: "2",
        name: "Bob",
        email: "bob@example.com",
        createdAt: new Date(),
      }),
    ])
    
    return {
      findAll: () => Ref.get(users),
      
      findById: (id: string) =>
        Ref.get(users).pipe(
          Effect.flatMap((all) => {
            const user = all.find((u) => u.id === id)
            return user
              ? Effect.succeed(user)
              : Effect.fail(new NotFoundError({ message: "User not found", entityId: id }))
          })
        ),
      
      findByEmail: (email: string) =>
        Ref.get(users).pipe(
          Effect.flatMap((all) => {
            const user = all.find((u) => u.email === email)
            return user
              ? Effect.succeed(user)
              : Effect.fail(new NotFoundError({ message: "User not found", entityId: email }))
          })
        ),
      
      create: (data: { name: string; email: string }) =>
        Ref.updateAndGet(users, (all) => {
          // Validate email uniqueness
          if (all.some((u) => u.email === data.email)) {
            throw new ValidationError({ message: "Email already exists", field: "email" })
          }
          
          const user = new User({
            id: String(all.length + 1),
            name: data.name,
            email: data.email,
            createdAt: new Date(),
          })
          
          return [...all, user]
        }).pipe(Effect.map((all) => all[all.length - 1]!)),
      
      update: (id: string, data: { name?: string; email?: string }) =>
        Ref.updateAndGet(users, (all) => {
          const index = all.findIndex((u) => u.id === id)
          if (index === -1) {
            throw new NotFoundError({ message: "User not found", entityId: id })
          }
          
          const updated = new User({
            ...all[index]!,
            ...(data.name && { name: data.name }),
            ...(data.email && { email: data.email }),
          })
          
          return [...all.slice(0, index), updated, ...all.slice(index + 1)]
        }).pipe(
          Effect.flatMap((all) => {
            const user = all.find((u) => u.id === id)
            return user
              ? Effect.succeed(user)
              : Effect.fail(new NotFoundError({ message: "User not found", entityId: id }))
          })
        ),
      
      delete: (id: string) =>
        Ref.update(users, (all) => {
          const index = all.findIndex((u) => u.id === id)
          if (index === -1) {
            throw new NotFoundError({ message: "User not found", entityId: id })
          }
          return [...all.slice(0, index), ...all.slice(index + 1)]
        }),
    }
  }),
}) {}

// ─────────────────────────────────────────────────────────────────────────────
// RPC Handlers (Live Layer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live implementation of UserRpcs.
 * 
 * This uses Effect RPC's toLayer() which returns a Layer.
 */
export const UserRpcsLive = UserRpcs.toLayer(
  Effect.gen(function* () {
    const repo = yield* UserRepository
    
    return {
      list: () => repo.findAll(),
      byId: ({ id }) => repo.findById(id),
      byEmail: ({ email }) => repo.findByEmail(email),
      create: (input) => repo.create(input),
      update: ({ id, ...data }) => repo.update(id, data),
      delete: ({ id }) => repo.delete(id),
    }
  })
).pipe(Layer.provide(UserRepository.Default))

// ─────────────────────────────────────────────────────────────────────────────
// Next.js Route Handler
// ─────────────────────────────────────────────────────────────────────────────

// app/api/rpc/route.ts
// import { createRouteHandler } from "effect-trpc/server"
// import { UserRpcs, UserRpcsLive } from "./server"
// 
// export const POST = createRouteHandler({
//   rpcs: UserRpcs,
//   handlers: UserRpcsLive,
// })
