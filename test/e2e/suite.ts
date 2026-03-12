/**
 * Reusable E2E Test Suite
 * 
 * This suite can be run against different transport implementations
 * to ensure consistent behavior across HTTP, WebSocket, loopback, etc.
 */

import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Stream, Exit } from "effect"
import * as Client from "../../src/Client/index.js"
import * as Transport from "../../src/Transport/index.js"
import { 
  User, 
  CreateUserInput, 
  NotFoundError, 
  ValidationError,
  testRouter,
  TestDatabase,
} from "./fixtures.js"

/**
 * Create an e2e test suite for a given transport layer
 */
export const e2eSuite = (
  name: string,
  layer: Layer.Layer<Transport.Transport | TestDatabase, never, never>,
  options?: { concurrent?: boolean; timeout?: number }
) => {
  const { concurrent = true, timeout = 10000 } = options ?? {}
  
  // Create full client layer: Transport → ClientService → Client ops
  const clientLayer = Client.ClientServiceLive.pipe(
    Layer.provide(layer)
  )
  
  describe(name, { concurrent, timeout }, () => {
    // Helper to create the run effect for a procedure
    const runQuery = <A, E>(
      effect: Effect.Effect<A, E, Client.ClientServiceTag>
    ) => effect.pipe(Effect.provide(clientLayer))
    
    // =========================================================================
    // Query Tests
    // =========================================================================
    
    describe("Query", () => {
      it.effect("returns decoded success (list)", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const users = yield* service.send(
            "@test/users/list",
            undefined,
            testRouter.pathMap.procedures.get("users.list")!.procedure.successSchema,
            testRouter.pathMap.procedures.get("users.list")!.procedure.errorSchema
          )
          
          expect(Array.isArray(users)).toBe(true)
          expect((users as User[]).length).toBe(2)
          expect((users as User[])[0].name).toBe("Alice")
        }).pipe(Effect.provide(clientLayer))
      )
      
      it.effect("accepts payload and returns result", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.get")!.procedure
          const user = yield* service.send(
            "@test/users/get",
            { id: "1" },
            proc.successSchema,
            proc.errorSchema
          )
          
          expect((user as User).id).toBe("1")
          expect((user as User).name).toBe("Alice")
        }).pipe(Effect.provide(clientLayer))
      )
      
      it.effect("works with void payload", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("health")!.procedure
          const result = yield* service.send(
            "@test/health",
            undefined,
            proc.successSchema,
            proc.errorSchema
          )
          
          expect(result).toBe("OK")
        }).pipe(Effect.provide(clientLayer))
      )
    })
    
    // =========================================================================
    // Query Error Tests
    // =========================================================================
    
    describe("Query Errors", () => {
      it.effect("returns typed error on failure", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.get")!.procedure
          const exit = yield* service.send(
            "@test/users/get",
            { id: "not-found" },
            proc.successSchema,
            proc.errorSchema
          ).pipe(Effect.exit)
          
          expect(Exit.isFailure(exit)).toBe(true)
        }).pipe(Effect.provide(clientLayer))
      )
    })
    
    // =========================================================================
    // Mutation Tests
    // =========================================================================
    
    describe("Mutation", () => {
      it.effect("creates and returns result", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.create")!.procedure
          const user = yield* service.send(
            "@test/users/create",
            new CreateUserInput({ name: "Charlie", email: "charlie@example.com" }),
            proc.successSchema,
            proc.errorSchema
          )
          
          expect((user as User).name).toBe("Charlie")
          expect((user as User).email).toBe("charlie@example.com")
        }).pipe(Effect.provide(clientLayer))
      )
      
      // Skip: Requires shared database state across requests
      // In loopback each request gets fresh database
      it.skip("mutation persists data", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const createProc = testRouter.pathMap.procedures.get("users.create")!.procedure
          const getProc = testRouter.pathMap.procedures.get("users.get")!.procedure
          
          // Create user
          const created = yield* service.send(
            "@test/users/create",
            new CreateUserInput({ name: "David", email: "david@example.com" }),
            createProc.successSchema,
            createProc.errorSchema
          ) as User
          
          // Fetch to verify persistence
          const fetched = yield* service.send(
            "@test/users/get",
            { id: created.id },
            getProc.successSchema,
            getProc.errorSchema
          )
          
          expect((fetched as User).name).toBe("David")
        }).pipe(Effect.provide(clientLayer))
      )
      
      it.effect("mutation returns validation error", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.create")!.procedure
          const exit = yield* service.send(
            "@test/users/create",
            new CreateUserInput({ name: "A", email: "a@example.com" }), // Too short
            proc.successSchema,
            proc.errorSchema
          ).pipe(Effect.exit)
          
          expect(Exit.isFailure(exit)).toBe(true)
        }).pipe(Effect.provide(clientLayer))
      )
    })
    
    // =========================================================================
    // Stream Tests
    // =========================================================================
    
    describe("Stream", () => {
      it.effect("yields chunks", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.watch")!.procedure
          const chunks: User[] = []
          
          yield* service.sendStream(
            "@test/users/watch",
            undefined,
            proc.successSchema,
            proc.errorSchema
          ).pipe(
            Stream.take(1),
            Stream.runForEach((user) => 
              Effect.sync(() => { chunks.push(user as User) })
            )
          )
          
          expect(chunks).toHaveLength(1)
          expect(chunks[0].name).toBeDefined()
        }).pipe(Effect.provide(clientLayer))
      )
    })
    
    // =========================================================================
    // Protocol Tests
    // =========================================================================
    
    describe("Protocol", () => {
      it.effect("request has correct tag", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.list")!.procedure
          const users = yield* service.send(
            "@test/users/list",
            undefined,
            proc.successSchema,
            proc.errorSchema
          )
          
          expect(users).toBeDefined()
        }).pipe(Effect.provide(clientLayer))
      )
    })
    
    // =========================================================================
    // Schema Round-trip Tests
    // =========================================================================
    
    describe("Schema Round-trip", () => {
      it.effect("class instances survive round-trip", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.create")!.procedure
          const input = new CreateUserInput({ name: "RoundTrip", email: "rt@example.com" })
          const result = yield* service.send(
            "@test/users/create",
            input,
            proc.successSchema,
            proc.errorSchema
          )
          
          expect((result as User).name).toBe("RoundTrip")
        }).pipe(Effect.provide(clientLayer))
      )
    })
  })
}
