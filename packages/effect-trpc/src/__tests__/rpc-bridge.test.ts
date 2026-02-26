/**
 * @module effect-trpc/__tests__/rpc-bridge
 *
 * Tests for the RPC bridge that converts effect-trpc procedures to @effect/rpc.
 * Tests procedure conversion, handler conversion, and middleware application.
 */

import { describe, it, expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Cause from "effect/Cause"

import { Procedure, Procedures } from "../index.js"
import { Middleware, type BaseContext, type AuthenticatedContext } from "../core/server/middleware.js"
import {
  procedureToRpc,
  proceduresGroupToRpcGroup,
  convertHandlers,
  createRpcComponents,
  RpcBridgeValidationError,
} from "../core/rpc/index.js"

/**
 * Helper to cast MiddlewareResult (Effect | Stream) to runnable Effect for tests.
 */

const asRunnable = <A, E>(effect: unknown): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>

/**
 * Helper to cast procedure to AnyProcedure for tests.
 */

const asProcedure = <T>(proc: T): Parameters<typeof procedureToRpc>[1] =>
  proc as unknown as Parameters<typeof procedureToRpc>[1]

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const CreateUserSchema = Schema.Struct({
  name: Schema.String,
})

const UserErrorSchema = Schema.TaggedStruct("UserError", {
  message: Schema.String,
})

// ─────────────────────────────────────────────────────────────────────────────
// Procedure to RPC Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("procedureToRpc", () => {
  it("converts a query procedure", () => {
    const queryProc = Procedure
      .input(Schema.Struct({ id: Schema.String }))
      .output(UserSchema)
      .query()

    const rpc = procedureToRpc("user.get", asProcedure(queryProc))

    expect(rpc).toBeDefined()
    // RPC should have the correct name - the _tag is the procedure name
    expect((rpc as any)._tag).toBe("user.get")
  })

  it("converts a mutation procedure", () => {
    const mutationProc = Procedure.input(CreateUserSchema).output(UserSchema).mutation()

    const rpc = procedureToRpc("user.create", asProcedure(mutationProc))

    expect(rpc).toBeDefined()
  })

  it("converts a stream procedure", () => {
    const streamProc = Procedure
      .input(Schema.Struct({ count: Schema.Number }))
      .output(Schema.Number)
      .stream()

    const rpc = procedureToRpc("counter.stream", asProcedure(streamProc))

    expect(rpc).toBeDefined()
  })

  it("converts a procedure with error schema", () => {
    const procWithError = Procedure
      .input(CreateUserSchema)
      .output(UserSchema)
      .error(UserErrorSchema)
      .mutation()

    const rpc = procedureToRpc("user.create", asProcedure(procWithError))

    expect(rpc).toBeDefined()
  })

  it("converts a procedure without input schema", () => {
    const procNoInput = Procedure.output(Schema.Array(UserSchema)).query()

    const rpc = procedureToRpc("user.list", asProcedure(procNoInput))

    expect(rpc).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ProceduresGroup to RpcGroup Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("proceduresGroupToRpcGroup", () => {
  it("converts a procedures group to RpcGroup", () => {
    const UserProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      create: Procedure.input(CreateUserSchema).output(UserSchema).mutation(),
      list: Procedure.output(Schema.Array(UserSchema)).query(),
    })

    const rpcGroup = proceduresGroupToRpcGroup(UserProcedures, "user.")

    expect(rpcGroup).toBeDefined()
  })

  it("uses path prefix for nested routers", () => {
    const PostProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const rpcGroup = proceduresGroupToRpcGroup(PostProcedures, "user.posts.")

    expect(rpcGroup).toBeDefined()
    // The full path should be "user.posts.get"
  })

  it("throws RpcBridgeValidationError for empty procedures group", () => {
    const EmptyProcedures = Procedures.make({})

    expect(() => proceduresGroupToRpcGroup(EmptyProcedures)).toThrow(RpcBridgeValidationError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Handler Conversion Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("convertHandlers", () => {
  it("converts handlers to RPC format", () => {
    const UserProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      create: Procedure.input(CreateUserSchema).output(UserSchema).mutation(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
      create: (_ctx: BaseContext, { name }: { name: string }) => Effect.succeed({ id: "1", name }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers, "user.")

    expect(rpcHandlers).toBeDefined()
    expect(typeof rpcHandlers["user.get"]).toBe("function")
    expect(typeof rpcHandlers["user.create"]).toBe("function")
  })

  it("applies path prefix for nested routers", () => {
    const PostProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed(`Post ${id}`),
    }

    const rpcHandlers = convertHandlers(PostProcedures, handlers, "user.posts.")

    expect(typeof rpcHandlers["user.posts.get"]).toBe("function")
  })

  it("throws on missing handlers", () => {
    const UserProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      list: Procedure.output(Schema.Array(UserSchema)).query(),
    })

    // Only provide 'get' handler, not 'list'
    const handlers = {
      get: ({ id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
    }

    // Should throw RpcBridgeValidationError for missing 'list' handler
    expect(() => convertHandlers(UserProcedures, handlers as any)).toThrow(
      /Missing handler implementation.*list/,
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Middleware Application Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Middleware Application", () => {
  it("handlers with middleware are wrapped correctly", async () => {
    let middlewareCalled = false

    const testMiddleware = Middleware("test")
    const testMiddlewareLive = testMiddleware.toLayer((ctx) =>
      Effect.sync(() => {
        middlewareCalled = true
        return ctx
      }),
    )

    const UserProcedures = Procedures.make({
      get: Procedure
        .use(testMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers, "user.")

    // Call the handler with mock options
    const mockOptions = {
      clientId: 1,
      headers: {},
    }

    const result = await Effect.runPromise(
      Effect.provide(
        asRunnable(
          rpcHandlers["user.get"]!(
            { id: "1" },
            mockOptions as unknown as { readonly clientId: number; readonly headers: unknown },
          ),
        ),
        testMiddlewareLive,
      ),
    )

    expect(middlewareCalled).toBe(true)
    expect(result).toEqual({ id: "1", name: "Test User" })
  })

  it("middleware can transform context", async () => {
    interface User {
      id: string
      name: string
    }

    const authMiddleware = Middleware<BaseContext>("auth").provides<{ user: User }>()
    const authMiddlewareLive = authMiddleware.toLayer((ctx) =>
      Effect.succeed({ ...ctx, user: { id: "user-1", name: "Test User" } }),
    )

    const UserProcedures = Procedures.make({
      me: Procedure.use(authMiddleware).output(UserSchema).query(),
    })

    const handlers = {
      me: (_ctx: AuthenticatedContext<User>) => Effect.succeed({ id: "user-1", name: "Test User" }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers, "user.")

    const mockOptions = {
      clientId: 1,
      headers: {},
    }

    const result = await Effect.runPromise(
      Effect.provide(
        asRunnable(
          rpcHandlers["user.me"]!(
            undefined,
            mockOptions as unknown as { readonly clientId: number; readonly headers: unknown },
          ),
        ),
        authMiddlewareLive,
      ),
    )

    expect(result).toEqual({ id: "user-1", name: "Test User" })
  })

  it("middleware errors are propagated", async () => {
    const TestError = Schema.TaggedStruct("TestError", {
      message: Schema.String,
    })
    type TestError = typeof TestError.Type

    const failingMiddleware = Middleware("failing")
    const failingMiddlewareLive = failingMiddleware.toLayer((_ctx) =>
      Effect.fail({ _tag: "TestError" as const, message: "Middleware failed" }),
    )

    const UserProcedures = Procedures.make({
      get: Procedure
        .use(failingMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers, "user.")

    const mockOptions = {
      clientId: 1,
      headers: {},
    }

    // Use Effect.runPromiseExit to inspect the failure
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        asRunnable(
          rpcHandlers["user.get"]!(
            { id: "1" },
            mockOptions as unknown as { readonly clientId: number; readonly headers: unknown },
          ),
        ),
        failingMiddlewareLive,
      ),
    )

    // Should be a failure with our TestError
    expect(exit._tag).toBe("Failure")
    if (exit._tag === "Failure") {
      // Squash the cause to get the error
      const error = Cause.squash(exit.cause)
      expect((error as any)._tag).toBe("TestError")
      expect((error as any).message).toBe("Middleware failed")
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createRpcComponents Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("createRpcComponents", () => {
  it("creates rpcGroup and createHandlersLayer", () => {
    const UserProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const { rpcGroup, createHandlersLayer } = createRpcComponents(UserProcedures)

    expect(rpcGroup).toBeDefined()
    expect(typeof createHandlersLayer).toBe("function")
  })

  it("createHandlersLayer returns a Layer", () => {
    const UserProcedures = Procedures.make({
      get: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const { createHandlersLayer } = createRpcComponents(UserProcedures)

    const handlersEffect = Effect.succeed({
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
    })

    const layer = createHandlersLayer(handlersEffect)

    expect(Layer.isLayer(layer)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RpcBridgeValidationError Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("RpcBridgeValidationError", () => {
  it("has correct tag", () => {
    const error = new RpcBridgeValidationError({
      module: "RpcBridge",
      method: "testMethod",
      reason: "Test reason",
    })

    expect(error._tag).toBe("RpcBridgeValidationError")
  })

  it("generates correct message without groupName", () => {
    const error = new RpcBridgeValidationError({
      module: "RpcBridge",
      method: "testMethod",
      reason: "Test reason",
    })

    expect(error.message).toBe("[RpcBridge.testMethod] Test reason")
  })

  it("generates correct message with groupName", () => {
    const error = new RpcBridgeValidationError({
      module: "RpcBridge",
      method: "testMethod",
      reason: "Test reason",
      groupName: "user",
    })

    expect(error.message).toBe("[RpcBridge.testMethod] (group: user) Test reason")
  })
})
