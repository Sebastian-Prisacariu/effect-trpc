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

import { procedure, procedures } from "../index.js"
import { Middleware, type BaseContext, type AuthenticatedContext } from "../core/middleware.js"
import {
  procedureToRpc,
  proceduresGroupToRpcGroup,
  convertHandlers,
  createRpcComponents,
  RpcBridgeValidationError,
} from "../core/rpc-bridge.js"

/**
 * Helper to cast MiddlewareResult (Effect | Stream) to runnable Effect for tests.
 */

const asRunnable = <A, E>(effect: any): Effect.Effect<A, E, never> =>
  effect as Effect.Effect<A, E, never>

/**
 * Helper to cast procedure to AnyProcedure for tests.
 */

const asProcedure = <T>(proc: T): any => proc

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

const UserErrorSchema = Schema.Struct({
  _tag: Schema.Literal("UserError"),
  message: Schema.String,
})

// ─────────────────────────────────────────────────────────────────────────────
// Procedure to RPC Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("procedureToRpc", () => {
  it("converts a query procedure", () => {
    const queryProc = procedure
      .input(Schema.Struct({ id: Schema.String }))
      .output(UserSchema)
      .query()

    const rpc = procedureToRpc("user.get", asProcedure(queryProc))

    expect(rpc).toBeDefined()
    // RPC should have the correct name - the _tag is the procedure name
    expect((rpc as any)._tag).toBe("user.get")
  })

  it("converts a mutation procedure", () => {
    const mutationProc = procedure.input(CreateUserSchema).output(UserSchema).mutation()

    const rpc = procedureToRpc("user.create", asProcedure(mutationProc))

    expect(rpc).toBeDefined()
  })

  it("converts a stream procedure", () => {
    const streamProc = procedure
      .input(Schema.Struct({ count: Schema.Number }))
      .output(Schema.Number)
      .stream()

    const rpc = procedureToRpc("counter.stream", asProcedure(streamProc))

    expect(rpc).toBeDefined()
  })

  it("converts a procedure with error schema", () => {
    const procWithError = procedure
      .input(CreateUserSchema)
      .output(UserSchema)
      .error(UserErrorSchema)
      .mutation()

    const rpc = procedureToRpc("user.create", asProcedure(procWithError))

    expect(rpc).toBeDefined()
  })

  it("converts a procedure without input schema", () => {
    const procNoInput = procedure.output(Schema.Array(UserSchema)).query()

    const rpc = procedureToRpc("user.list", asProcedure(procNoInput))

    expect(rpc).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ProceduresGroup to RpcGroup Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("proceduresGroupToRpcGroup", () => {
  it("converts a procedures group to RpcGroup", () => {
    const UserProcedures = procedures("user", {
      get: procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      create: procedure.input(CreateUserSchema).output(UserSchema).mutation(),
      list: procedure.output(Schema.Array(UserSchema)).query(),
    })

    const rpcGroup = proceduresGroupToRpcGroup(UserProcedures)

    expect(rpcGroup).toBeDefined()
  })

  it("uses path prefix for nested routers", () => {
    const PostProcedures = procedures("posts", {
      get: procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const rpcGroup = proceduresGroupToRpcGroup(PostProcedures, "user.")

    expect(rpcGroup).toBeDefined()
    // The full path should be "user.posts.get"
  })

  it("throws RpcBridgeValidationError for empty procedures group", () => {
    const EmptyProcedures = procedures("empty", {})

    expect(() => proceduresGroupToRpcGroup(EmptyProcedures)).toThrow(RpcBridgeValidationError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Handler Conversion Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("convertHandlers", () => {
  it("converts handlers to RPC format", () => {
    const UserProcedures = procedures("user", {
      get: procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      create: procedure.input(CreateUserSchema).output(UserSchema).mutation(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
      create: (_ctx: BaseContext, { name }: { name: string }) => Effect.succeed({ id: "1", name }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers)

    expect(rpcHandlers).toBeDefined()
    expect(typeof rpcHandlers["user.get"]).toBe("function")
    expect(typeof rpcHandlers["user.create"]).toBe("function")
  })

  it("applies path prefix for nested routers", () => {
    const PostProcedures = procedures("posts", {
      get: procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.String)
        .query(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed(`Post ${id}`),
    }

    const rpcHandlers = convertHandlers(PostProcedures, handlers, "user.")

    expect(typeof rpcHandlers["user.posts.get"]).toBe("function")
  })

  it("throws on missing handlers", () => {
    const UserProcedures = procedures("user", {
      get: procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
      list: procedure.output(Schema.Array(UserSchema)).query(),
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

    const testMiddleware = Middleware.make<BaseContext, BaseContext, never, never>(
      "test",
      (ctx, _input, next) => {
        middlewareCalled = true
        return next(ctx) as Effect.Effect<unknown, never, never>
      },
    )

    const UserProcedures = procedures("user", {
      get: procedure
        .use(testMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers)

    // Call the handler with mock options
    const mockOptions = {
      clientId: 1,
      headers: {},
    }

    const result = await Effect.runPromise(
      asRunnable(rpcHandlers["user.get"]!({ id: "1" }, mockOptions as any)),
    )

    expect(middlewareCalled).toBe(true)
    expect(result).toEqual({ id: "1", name: "Test User" })
  })

  it("middleware can transform context", async () => {
    interface User {
      id: string
      name: string
    }

    const authMiddleware = Middleware.make<BaseContext, AuthenticatedContext<User>, never, never>(
      "auth",
      (ctx, _input, next) =>
        next({ ...ctx, user: { id: "user-1", name: "Test User" } }) as Effect.Effect<
          unknown,
          never,
          never
        >,
    )

    const UserProcedures = procedures("user", {
      me: procedure.use(authMiddleware).output(UserSchema).query(),
    })

    const handlers = {
      me: (_ctx: AuthenticatedContext<User>) => Effect.succeed({ id: "user-1", name: "Test User" }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers)

    const mockOptions = {
      clientId: 1,
      headers: {},
    }

    const result = await Effect.runPromise(
      asRunnable(rpcHandlers["user.me"]!(undefined, mockOptions as any)),
    )

    expect(result).toEqual({ id: "user-1", name: "Test User" })
  })

  it("middleware errors are propagated", async () => {
    const TestError = Schema.Struct({
      _tag: Schema.Literal("TestError"),
      message: Schema.String,
    })
    type TestError = typeof TestError.Type

    const failingMiddleware = Middleware.make<BaseContext, BaseContext, TestError>(
      "failing",
      (_ctx, _next) => Effect.fail({ _tag: "TestError" as const, message: "Middleware failed" }),
    )

    const UserProcedures = procedures("user", {
      get: procedure
        .use(failingMiddleware)
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const handlers = {
      get: (_ctx: BaseContext, { id }: { id: string }) => Effect.succeed({ id, name: "Test User" }),
    }

    const rpcHandlers = convertHandlers(UserProcedures, handlers)

    const mockOptions = {
      clientId: 1,
      headers: {},
    }

    // Use Effect.runPromiseExit to inspect the failure
    const exit = await Effect.runPromiseExit(
      asRunnable(rpcHandlers["user.get"]!({ id: "1" }, mockOptions as any)),
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
    const UserProcedures = procedures("user", {
      get: procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(UserSchema)
        .query(),
    })

    const { rpcGroup, createHandlersLayer } = createRpcComponents(UserProcedures)

    expect(rpcGroup).toBeDefined()
    expect(typeof createHandlersLayer).toBe("function")
  })

  it("createHandlersLayer returns a Layer", () => {
    const UserProcedures = procedures("user", {
      get: procedure
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
