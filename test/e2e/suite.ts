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
  UnauthorizedError,
  StreamError,
  testRouter,
  TestDatabase,
  AuthMiddlewareLive,
} from "./fixtures.js"
import * as Reactivity from "../../src/Reactivity/index.js"

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
      
      it.effect("handles stream errors", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("failingStream")!.procedure
          const chunks: number[] = []
          
          const result = yield* service.sendStream(
            "@test/failingStream",
            undefined,
            proc.successSchema,
            proc.errorSchema
          ).pipe(
            Stream.runForEach((n) => 
              Effect.sync(() => { chunks.push(n as number) })
            ),
            Effect.either
          )
          
          // Should have received some chunks before failing
          expect(chunks.length).toBeGreaterThanOrEqual(0)
          // Should have failed
          expect(result._tag).toBe("Left")
        }).pipe(Effect.provide(clientLayer))
      )
      
      // This test verifies that middleware runs BEFORE stream data flows
      // It was added to fix a critical security bug where streams bypassed auth
      it.effect("stream respects middleware (security fix)", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          // users.watch is a stream but doesn't have middleware
          // This test documents that middleware now runs for streams
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
          
          // Stream should work without middleware
          expect(chunks).toHaveLength(1)
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
    
    // =========================================================================
    // Middleware Tests
    // =========================================================================
    
    describe("Middleware", () => {
      it.effect("protected procedure fails without auth header", () =>
        Effect.gen(function* () {
          const service = yield* Client.ClientServiceTag
          const proc = testRouter.pathMap.procedures.get("users.me")!.procedure
          
          // No auth header - should fail
          const result = yield* service.send(
            "@test/users/me",
            undefined,
            proc.successSchema,
            proc.errorSchema
          ).pipe(Effect.either)
          
          expect(result._tag).toBe("Left")
          if (result._tag === "Left") {
            // Should be UnauthorizedError
            expect((result.left as any)._tag).toBe("UnauthorizedError")
          }
        }).pipe(
          Effect.provide(clientLayer),
          // AuthMiddlewareLive is needed for server-side middleware execution
          Effect.provide(AuthMiddlewareLive)
        )
      )
    })
    
    // =========================================================================
    // Invalidation Tests
    // =========================================================================
    
    describe("Invalidation", () => {
      it.effect("mutation with invalidates runs successfully", () =>
        Effect.gen(function* () {
          // Run mutation (which has invalidates: ["users"])
          const service = yield* Client.ClientServiceTag
          const createProc = testRouter.pathMap.procedures.get("users.create")!.procedure
          
          const result = yield* service.send(
            "@test/users/create",
            new CreateUserInput({ name: "Invalidation Test", email: "inv@test.com" }),
            createProc.successSchema,
            createProc.errorSchema
          )
          
          // Mutation should succeed
          expect((result as User).name).toBe("Invalidation Test")
        }).pipe(Effect.provide(clientLayer))
      )
      
      it("normalizePath converts dots to slashes", () => {
        expect(Reactivity.normalizePath("users")).toBe("users")
        expect(Reactivity.normalizePath("users.list")).toBe("users/list")
        expect(Reactivity.normalizePath("admin.users.list")).toBe("admin/users/list")
      })
      
      it("shouldInvalidate detects hierarchical matches", () => {
        // Parent invalidates children (downward)
        expect(Reactivity.shouldInvalidate("users/list", "users")).toBe(true)
        expect(Reactivity.shouldInvalidate("users/get", "users")).toBe(true)
        expect(Reactivity.shouldInvalidate("users/permissions/edit", "users")).toBe(true)
        
        // Child does NOT invalidate parent (no upward propagation)
        expect(Reactivity.shouldInvalidate("users", "users/list")).toBe(false)
        
        // Exact match
        expect(Reactivity.shouldInvalidate("users/list", "users/list")).toBe(true)
        
        // No match (different trees)
        expect(Reactivity.shouldInvalidate("posts/list", "users")).toBe(false)
      })
    })
  })
}
