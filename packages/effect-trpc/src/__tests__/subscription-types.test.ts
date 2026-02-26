/**
 * @module effect-trpc/tests/subscription-types
 *
 * Tests for subscription procedure type and handler inference.
 */

import { describe, it, expect, expectTypeOf } from "vitest"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Schema from "effect/Schema"

import { Procedures, Procedure } from "../core/index.js"
import type {
  SubscriptionHandler,
  SubscriptionContext,
  UnsubscribeReason,
  InferHandler,
} from "../core/index.js"
import { UnsubscribeReasonCtor } from "../core/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Test: Procedure Definition
// ─────────────────────────────────────────────────────────────────────────────

describe("subscription procedure type", () => {
  it("compiles with .subscription() builder method", () => {
    const NotificationSchema = Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      body: Schema.String,
    })

    const NotificationProcedures = Procedures.make({
      watch: Procedure
        .input(Schema.Struct({ userId: Schema.String }))
        .output(NotificationSchema)
        .subscription(),
    })

    expect(NotificationProcedures.procedures.watch.type).toBe("subscription")
    expect(NotificationProcedures.procedures.watch._tag).toBe("ProcedureDefinition")
  })

  it("subscription procedure has correct structure", () => {
    const TestProcedures = Procedures.make({
      events: Procedure
        .input(Schema.Struct({ topic: Schema.String }))
        .output(Schema.Struct({ data: Schema.Unknown }))
        .subscription(),
    })

    const def = TestProcedures.procedures.events
    expect(def.type).toBe("subscription")
    expect(def.inputSchema).toBeDefined()
    expect(def.outputSchema).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: Handler Types
// ─────────────────────────────────────────────────────────────────────────────

describe("subscription handler types", () => {
  it("SubscriptionHandler has correct shape", () => {
    // Minimal handler (only onSubscribe required)
    const minimalHandler: SubscriptionHandler<string, number, never, never> = {
      onSubscribe: (_input, _ctx) =>
        Effect.succeed(Stream.make(1, 2, 3)),
    }

    expect(minimalHandler.onSubscribe).toBeDefined()
    expect(minimalHandler.onClientMessage).toBeUndefined()
    expect(minimalHandler.onUnsubscribe).toBeUndefined()
  })

  it("full handler with all lifecycle methods", () => {
    const fullHandler: SubscriptionHandler<
      { roomId: string },
      { text: string },
      Error,
      never
    > = {
      onSubscribe: (input, ctx) =>
        Effect.sync(() => {
          // Can access input
          const _roomId: string = input.roomId
          // Can access context
          const _userId: string = ctx.userId
          const _subId = ctx.subscriptionId
          const _path: string = ctx.path

          return Stream.make({ text: "hello" }, { text: "world" })
        }),

      onClientMessage: (data, ctx) =>
        Effect.gen(function* () {
          yield* Effect.log(`Client ${ctx.userId} sent: ${JSON.stringify(data)}`)
        }),

      onUnsubscribe: (ctx, reason) =>
        Effect.log(`${ctx.userId} left: ${reason._tag}`),
    }

    expect(fullHandler.onSubscribe).toBeDefined()
    expect(fullHandler.onClientMessage).toBeDefined()
    expect(fullHandler.onUnsubscribe).toBeDefined()
  })

  it("InferHandler produces SubscriptionHandler for subscription procedures", () => {
    const _TestProcedures = Procedures.make({
      sub: Procedure
        .input(Schema.Struct({ id: Schema.String }))
        .output(Schema.Struct({ value: Schema.Number }))
        .subscription(),
    })

    type SubProcedure = typeof _TestProcedures.procedures.sub
    type SubHandler = InferHandler<SubProcedure>

    // Type check: SubHandler should be assignable to SubscriptionHandler
    const handler: SubHandler = {
      onSubscribe: (_input, _ctx) =>
        Effect.succeed(Stream.make({ value: 42 })),
    }

    expect(handler.onSubscribe).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: UnsubscribeReason
// ─────────────────────────────────────────────────────────────────────────────

describe("UnsubscribeReason", () => {
  it("has all expected variants", () => {
    const reasons: UnsubscribeReason[] = [
      UnsubscribeReasonCtor.ClientUnsubscribed,
      UnsubscribeReasonCtor.ClientDisconnected,
      UnsubscribeReasonCtor.StreamCompleted,
      UnsubscribeReasonCtor.StreamErrored(new Error("test")),
      UnsubscribeReasonCtor.ServerShutdown,
    ]

    expect(reasons.map((r) => r._tag)).toEqual([
      "ClientUnsubscribed",
      "ClientDisconnected",
      "StreamCompleted",
      "StreamErrored",
      "ServerShutdown",
    ])
  })

  it("StreamErrored captures error", () => {
    const error = new Error("test error")
    const reason = UnsubscribeReasonCtor.StreamErrored(error)

    expect(reason._tag).toBe("StreamErrored")
    if (reason._tag === "StreamErrored") {
      expect(reason.error).toBe(error)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test: Type-Level Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("subscription type inference", () => {
  it("SubscriptionContext has correct shape", () => {
    expectTypeOf<SubscriptionContext["subscriptionId"]>().toBeString()
    expectTypeOf<SubscriptionContext["clientId"]>().toBeString()
    expectTypeOf<SubscriptionContext["userId"]>().toBeString()
    expectTypeOf<SubscriptionContext["metadata"]>().toEqualTypeOf<Record<string, unknown>>()
    expectTypeOf<SubscriptionContext["path"]>().toBeString()
  })

  it("onSubscribe returns Effect<Stream<O, E>>, not Stream directly", () => {
    type Handler = SubscriptionHandler<string, number, Error, never>
    type OnSubscribeReturn = ReturnType<Handler["onSubscribe"]>

    // Should be Effect<Stream<number, Error>, Error, never>
    expectTypeOf<OnSubscribeReturn>().toMatchTypeOf<
      Effect.Effect<Stream.Stream<number, Error>, Error, never>
    >()
  })

  it("onClientMessage and onUnsubscribe are optional", () => {
    // This should compile: only onSubscribe is required
    const minimalHandler: SubscriptionHandler<void, string, never, never> = {
      onSubscribe: () => Effect.succeed(Stream.make("hello")),
    }

    expectTypeOf(minimalHandler.onClientMessage).toEqualTypeOf<
      ((data: unknown, ctx: SubscriptionContext) => Effect.Effect<void, never, never>) | undefined
    >()
  })
})
