/**
 * HTTP E2E Tests
 * 
 * Tests the full HTTP transport stack:
 * - Client sends request via Transport.http()
 * - Server handles via Server.toFetchHandler()
 * - State persists across requests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { it as effectIt } from "@effect/vitest"
import { Effect, Layer, Ref, Schema, ManagedRuntime } from "effect"
import * as http from "node:http"

import { Client, Router, Procedure, Server, Transport } from "../../src/index.js"

// =============================================================================
// Test Schemas
// =============================================================================

class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
}) {}

class CreateUserInput extends Schema.Class<CreateUserInput>("CreateUserInput")({
  name: Schema.String,
  email: Schema.String,
}) {}

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "NotFoundError",
  { id: Schema.String }
) {}

// =============================================================================
// Test Router
// =============================================================================

const testRouter = Router.make("@api", {
  users: {
    list: Procedure.query({ success: Schema.Array(User) }),
    get: Procedure.query({
      payload: Schema.Struct({ id: Schema.String }),
      success: User,
      error: NotFoundError,
    }),
    create: Procedure.mutation({
      payload: CreateUserInput,
      success: User,
      invalidates: ["users"],
    }),
  },
  health: Procedure.query({ success: Schema.String }),
})

// =============================================================================
// In-Memory Database (persists across requests)
// =============================================================================

interface Database {
  readonly users: Ref.Ref<User[]>
  readonly nextId: Ref.Ref<number>
}

class DatabaseService extends Effect.Tag("Database")<DatabaseService, Database>() {}

const DatabaseLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const users = yield* Ref.make<User[]>([
      new User({ id: "1", name: "Alice", email: "alice@example.com" }),
    ])
    const nextId = yield* Ref.make(2)
    return { users, nextId }
  })
)

// =============================================================================
// Handlers
// =============================================================================

const handlers = {
  users: {
    list: () =>
      Effect.gen(function* () {
        const db = yield* DatabaseService
        return yield* Ref.get(db.users)
      }),
    get: ({ id }: { id: string }) =>
      Effect.gen(function* () {
        const db = yield* DatabaseService
        const users = yield* Ref.get(db.users)
        const user = users.find(u => u.id === id)
        if (!user) return yield* Effect.fail(new NotFoundError({ id }))
        return user
      }),
    create: (input: CreateUserInput) =>
      Effect.gen(function* () {
        const db = yield* DatabaseService
        const id = yield* Ref.getAndUpdate(db.nextId, n => n + 1)
        const user = new User({ id: String(id), name: input.name, email: input.email })
        yield* Ref.update(db.users, users => [...users, user])
        return user
      }),
  },
  health: () => Effect.succeed("OK"),
}

const server = Server.make(testRouter, handlers)

// =============================================================================
// HTTP Server Setup
// =============================================================================

let httpServer: http.Server
let serverPort: number
let runtime: ManagedRuntime.ManagedRuntime<DatabaseService, never>

beforeAll(async () => {
  // Create a SINGLE managed runtime with database - shared across all requests
  runtime = ManagedRuntime.make(DatabaseLive)
  
  // Get the HTTP handler
  const httpHandler = Server.toHttpHandler(server)
  
  // Create HTTP server
  httpServer = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Method not allowed" }))
      return
    }
    
    // Read body
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks).toString("utf-8")
    
    // Create request object
    const httpRequest = {
      json: () => Promise.resolve(JSON.parse(body)),
      headers: req.headers as Record<string, string>,
    }
    
    try {
      // Use the shared runtime to run the handler
      const response = await runtime.runPromise(httpHandler(httpRequest))
      
      res.writeHead(response.status, response.headers)
      res.end(response.body)
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: String(err) }))
    }
  })
  
  // Start server on random port
  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address()
      serverPort = (addr as any).port
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve())
  })
  await runtime.dispose()
})

// =============================================================================
// Tests
// =============================================================================

describe("HTTP Transport E2E", () => {
  const getClientLayer = () => Transport.http(`http://127.0.0.1:${serverPort}`)
  
  effectIt.effect("query returns data", () =>
    Effect.gen(function* () {
      const service = yield* Client.ClientServiceTag
      const proc = testRouter.pathMap.procedures.get("health")!.procedure
      
      const result = yield* service.send(
        "@api/health",
        undefined,
        proc.successSchema,
        proc.errorSchema
      )
      
      expect(result).toBe("OK")
    }).pipe(
      Effect.provide(Client.ClientServiceLive),
      Effect.provide(getClientLayer())
    )
  )

  effectIt.effect("query returns list", () =>
    Effect.gen(function* () {
      const service = yield* Client.ClientServiceTag
      const proc = testRouter.pathMap.procedures.get("users.list")!.procedure
      
      const users = yield* service.send(
        "@api/users/list",
        undefined,
        proc.successSchema,
        proc.errorSchema
      ) as User[]
      
      expect(users.length).toBeGreaterThanOrEqual(1)
      expect(users[0].name).toBe("Alice")
    }).pipe(
      Effect.provide(Client.ClientServiceLive),
      Effect.provide(getClientLayer())
    )
  )

  effectIt.effect("mutation creates and persists data", () =>
    Effect.gen(function* () {
      const service = yield* Client.ClientServiceTag
      const createProc = testRouter.pathMap.procedures.get("users.create")!.procedure
      const listProc = testRouter.pathMap.procedures.get("users.list")!.procedure
      
      // Create a new user
      const created = yield* service.send(
        "@api/users/create",
        new CreateUserInput({ name: "Bob", email: "bob@example.com" }),
        createProc.successSchema,
        createProc.errorSchema
      ) as User
      
      expect(created.name).toBe("Bob")
      expect(created.email).toBe("bob@example.com")
      
      // Fetch all users - Bob should be there
      const users = yield* service.send(
        "@api/users/list",
        undefined,
        listProc.successSchema,
        listProc.errorSchema
      ) as User[]
      
      const bob = users.find(u => u.name === "Bob")
      expect(bob).toBeDefined()
      expect(bob!.id).toBe(created.id)
    }).pipe(
      Effect.provide(Client.ClientServiceLive),
      Effect.provide(getClientLayer())
    )
  )

  effectIt.effect("mutation persists across separate requests", () =>
    Effect.gen(function* () {
      const service = yield* Client.ClientServiceTag
      const createProc = testRouter.pathMap.procedures.get("users.create")!.procedure
      const getProc = testRouter.pathMap.procedures.get("users.get")!.procedure
      
      // Create a new user
      const created = yield* service.send(
        "@api/users/create",
        new CreateUserInput({ name: "Charlie", email: "charlie@example.com" }),
        createProc.successSchema,
        createProc.errorSchema
      ) as User
      
      // Fetch the specific user in a NEW request
      const fetched = yield* service.send(
        "@api/users/get",
        { id: created.id },
        getProc.successSchema,
        getProc.errorSchema
      ) as User
      
      expect(fetched.name).toBe("Charlie")
      expect(fetched.email).toBe("charlie@example.com")
    }).pipe(
      Effect.provide(Client.ClientServiceLive),
      Effect.provide(getClientLayer())
    )
  )

  effectIt.effect("error responses are properly typed", () =>
    Effect.gen(function* () {
      const service = yield* Client.ClientServiceTag
      const proc = testRouter.pathMap.procedures.get("users.get")!.procedure
      
      const result = yield* service.send(
        "@api/users/get",
        { id: "nonexistent" },
        proc.successSchema,
        proc.errorSchema
      ).pipe(Effect.flip) // Flip to get the error
      
      expect(result).toBeInstanceOf(NotFoundError)
      expect((result as NotFoundError).id).toBe("nonexistent")
    }).pipe(
      Effect.provide(Client.ClientServiceLive),
      Effect.provide(getClientLayer())
    )
  )
})
