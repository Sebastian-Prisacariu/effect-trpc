/**
 * Client Core - shared Effect orchestration outside React
 *
 * @since 1.0.0
 * @internal
 */

import { AtomRef, Result } from "@effect-atom/atom"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HashMap from "effect/HashMap"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"

import * as Procedure from "../Procedure/index.js"
import { normalizePath, shouldInvalidate } from "../Reactivity/index.js"
import { queryKey as toSsrQueryKey } from "../SSR/index.js"
import * as Transport from "../Transport/index.js"
import { ClientService } from "./service.js"

type QueryFetchReason = "observe" | "manual" | "invalidation" | "poll"

const QueryFetchReasonSchema = Schema.Literal("observe", "manual", "invalidation", "poll")

export class QueryObservedEvent extends Schema.TaggedClass<QueryObservedEvent>()(
  "QueryObserved",
  {
    key: Schema.String,
    path: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class QueryFetchStartedEvent extends Schema.TaggedClass<QueryFetchStartedEvent>()(
  "QueryFetchStarted",
  {
    key: Schema.String,
    path: Schema.String,
    reason: QueryFetchReasonSchema,
    timestamp: Schema.Number,
  }
) { }

export class QueryFetchSucceededEvent extends Schema.TaggedClass<QueryFetchSucceededEvent>()(
  "QueryFetchSucceeded",
  {
    key: Schema.String,
    path: Schema.String,
    reason: QueryFetchReasonSchema,
    timestamp: Schema.Number,
  }
) { }

export class QueryFetchFailedEvent extends Schema.TaggedClass<QueryFetchFailedEvent>()(
  "QueryFetchFailed",
  {
    key: Schema.String,
    path: Schema.String,
    reason: QueryFetchReasonSchema,
    timestamp: Schema.Number,
  }
) { }

export class QueryHydratedEvent extends Schema.TaggedClass<QueryHydratedEvent>()(
  "QueryHydrated",
  {
    key: Schema.String,
    path: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class QueryInvalidatedEvent extends Schema.TaggedClass<QueryInvalidatedEvent>()(
  "QueryInvalidated",
  {
    key: Schema.String,
    path: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class OptimisticLayerAddedEvent extends Schema.TaggedClass<OptimisticLayerAddedEvent>()(
  "OptimisticLayerAdded",
  {
    key: Schema.String,
    path: Schema.String,
    layerId: Schema.Number,
    timestamp: Schema.Number,
  }
) { }

export class OptimisticLayerRemovedEvent extends Schema.TaggedClass<OptimisticLayerRemovedEvent>()(
  "OptimisticLayerRemoved",
  {
    key: Schema.String,
    path: Schema.String,
    layerId: Schema.Number,
    timestamp: Schema.Number,
  }
) { }

export class MutationStartedEvent extends Schema.TaggedClass<MutationStartedEvent>()(
  "MutationStarted",
  {
    id: Schema.Number,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class MutationSucceededEvent extends Schema.TaggedClass<MutationSucceededEvent>()(
  "MutationSucceeded",
  {
    id: Schema.Number,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class MutationFailedEvent extends Schema.TaggedClass<MutationFailedEvent>()(
  "MutationFailed",
  {
    id: Schema.Number,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class StreamStartedEvent extends Schema.TaggedClass<StreamStartedEvent>()(
  "StreamStarted",
  {
    key: Schema.String,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class StreamChunkEvent extends Schema.TaggedClass<StreamChunkEvent>()(
  "StreamChunk",
  {
    key: Schema.String,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class StreamStoppedEvent extends Schema.TaggedClass<StreamStoppedEvent>()(
  "StreamStopped",
  {
    key: Schema.String,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export class StreamFailedEvent extends Schema.TaggedClass<StreamFailedEvent>()(
  "StreamFailed",
  {
    key: Schema.String,
    tag: Schema.String,
    timestamp: Schema.Number,
  }
) { }

export const ClientEventSchema = Schema.Union(
  QueryObservedEvent,
  QueryFetchStartedEvent,
  QueryFetchSucceededEvent,
  QueryFetchFailedEvent,
  QueryHydratedEvent,
  QueryInvalidatedEvent,
  OptimisticLayerAddedEvent,
  OptimisticLayerRemovedEvent,
  MutationStartedEvent,
  MutationSucceededEvent,
  MutationFailedEvent,
  StreamStartedEvent,
  StreamChunkEvent,
  StreamStoppedEvent,
  StreamFailedEvent,
)

export type ClientEvent = Schema.Schema.Type<typeof ClientEventSchema>

export interface QueryObserverOptions {
  readonly enabled: boolean
  readonly refetchInterval?: number
}

export interface QueryObserver<Success, Error> {
  readonly resultRef: AtomRef.ReadonlyRef<Result.Result<Success, Error>>
  readonly retain: Effect.Effect<void>
  readonly release: Effect.Effect<void>
  readonly setOptions: (options: QueryObserverOptions) => Effect.Effect<void>
  readonly refetch: Effect.Effect<void>
  readonly seedHydratedValue: (value: Success) => Effect.Effect<void>
}

export interface MutationObserver<Payload, Success, Error> {
  readonly resultRef: AtomRef.ReadonlyRef<Result.Result<Success, Error>>
  readonly execute: (payload: Payload) => Effect.Effect<Success, Error>
  readonly reset: Effect.Effect<void>
}

export interface StreamState<Success, Error> {
  readonly data: readonly Success[]
  readonly latestValue: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
}

export interface StreamObserver<Success, Error> {
  readonly stateRef: AtomRef.ReadonlyRef<StreamState<Success, Error>>
  readonly retain: Effect.Effect<void>
  readonly release: Effect.Effect<void>
  readonly setEnabled: (enabled: boolean) => Effect.Effect<void>
  readonly stop: Effect.Effect<void>
  readonly restart: Effect.Effect<void>
}

type StreamObserverLifecycle = {
  readonly retained: boolean
  readonly enabled: boolean
  readonly streamFiber: Fiber.RuntimeFiber<void, never> | null
}

type QueryDescriptor<Payload, Success, Error> = {
  readonly tag: string
  readonly key: string
  readonly path: string
  readonly normalizedPath: string
  readonly payload: Payload | undefined
  readonly successSchema: Schema.Schema<Success, unknown, never>
  readonly errorSchema: Schema.Schema<Error, unknown, never>
}

type MutationDescriptor<Payload, Success, Error> = {
  readonly tag: string
  readonly successSchema: Schema.Schema<Success, unknown, never>
  readonly errorSchema: Schema.Schema<Error, unknown, never>
  readonly invalidates: ReadonlyArray<string>
  readonly optimistic?: Procedure.OptimisticConfig<unknown, Payload, Success>
}

type StreamDescriptor<Payload, Success, Error> = {
  readonly tag: string
  readonly key: string
  readonly payload: Payload | undefined
  readonly successSchema: Schema.Schema<Success, unknown, never>
  readonly errorSchema: Schema.Schema<Error, unknown, never>
}

type MutationExecution = {
  readonly id: number
  readonly tag: string
  readonly status: "pending" | "success" | "error"
  readonly timestamp: number
}

type ResolvedOptimisticTarget<Payload> = {
  readonly path: string
  readonly key: string
  readonly payload: Payload
}

type OptimisticLayer<Value> = {
  readonly id: number
  readonly apply: (current: Value | undefined) => Value
}

type QueryEntryService<Payload, Success, Error> = {
  readonly resultRef: AtomRef.ReadonlyRef<Result.Result<Success, Error>>
  readonly attachDescriptor: (descriptor: QueryDescriptor<Payload, Success, Error>) => void
  readonly retain: (observerId: number) => Effect.Effect<void>
  readonly release: (observerId: number) => Effect.Effect<void>
  readonly setOptions: (observerId: number, options: QueryObserverOptions) => Effect.Effect<void>
  readonly seedHydratedValue: (value: Success) => Effect.Effect<void>
  readonly setCacheValue: (value: Success) => Effect.Effect<void>
  readonly getCacheValue: () => Success | undefined
  readonly addOptimisticLayer: (apply: (current: Success | undefined) => Success) => Effect.Effect<number>
  readonly removeOptimisticLayer: (id: number) => Effect.Effect<void>
  readonly clearOptimisticState: Effect.Effect<void>
  readonly invalidate: Effect.Effect<void>
  readonly fetch: (reason: QueryFetchReason) => Effect.Effect<void>
  readonly matchesInvalidation: (invalidationPath: string) => boolean
}

type QueryEntryState<Payload, Success, Error> = {
  readonly descriptor: QueryDescriptor<Payload, Success, Error> | undefined
  readonly serverResult: Result.Result<Success, Error>
  readonly cacheValue: Success | undefined
  readonly hasCacheValue: boolean
  readonly optimisticLayers: ReadonlyArray<OptimisticLayer<Success>>
  readonly nextOptimisticLayerId: number
  readonly stale: boolean
  readonly inflightFiber: Fiber.RuntimeFiber<void, never> | null
  readonly pollingFiber: Fiber.RuntimeFiber<void, never> | null
  readonly pollingInterval: number | undefined
  readonly observers: HashMap.HashMap<number, QueryObserverOptions>
}

export interface ClientCoreService {
  readonly runtime: ManagedRuntime.ManagedRuntime<ClientService, never>
  readonly eventsRef: AtomRef.ReadonlyRef<ReadonlyArray<ClientEvent>>
  readonly mutationsRef: AtomRef.ReadonlyRef<ReadonlyArray<MutationExecution>>
  readonly shutdown: Effect.Effect<void>
  readonly runClosedPromise: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>
  readonly runClosedFork: <A, E>(effect: Effect.Effect<A, E, never>) => Fiber.RuntimeFiber<A, E>
  readonly runClientPromise: <A, E>(effect: Effect.Effect<A, E, ClientService>) => Promise<A>
  readonly runClientFork: <A, E>(effect: Effect.Effect<A, E, ClientService>) => Fiber.RuntimeFiber<A, E>
  readonly observeQuery: <Payload, Success, Error>(
    descriptor: QueryDescriptor<Payload, Success, Error>
  ) => QueryObserver<Success, Error>
  readonly createMutationObserver: <Payload, Success, Error>(
    descriptor: MutationDescriptor<Payload, Success, Error>
  ) => MutationObserver<Payload, Success, Error>
  readonly createStreamObserver: <Payload, Success, Error>(
    descriptor: StreamDescriptor<Payload, Success, Error>
  ) => StreamObserver<Success, Error>
  readonly invalidate: (paths: ReadonlyArray<string>) => Effect.Effect<void>
}

export class ClientCore extends Context.Tag("@effect-trpc/ClientCore")<
  ClientCore,
  ClientCoreService
>() {
  static Live: Layer.Layer<ClientCore, never, Transport.Transport>
}

const getResultValueOrUndefined = <A, E>(result: Result.Result<A, E>): A | undefined => {
  const value = Result.value(result)
  return Option.isSome(value) ? value.value : undefined
}

const toDomainCause = <E>(
  cause: Cause.Cause<E | Transport.TransportError>
): Cause.Cause<E> => cause as Cause.Cause<E>

const resolveOptimisticTarget = <Payload>(
  target: string | Procedure.OptimisticTarget<Payload>,
  mutationPayload: Payload
): ResolvedOptimisticTarget<unknown> => {
  if (typeof target === "string") {
    return {
      path: target,
      key: toSsrQueryKey(target),
      payload: undefined,
    }
  }

  const queryPayload =
    typeof target.payload === "function"
      ? target.payload(mutationPayload)
      : target.payload

  return {
    path: target.path,
    key: toSsrQueryKey(target.path, queryPayload),
    payload: queryPayload,
  }
}

const makeClientRuntime = (
  runtime: ManagedRuntime.ManagedRuntime<ClientService, never>
) => ({
  // Close over the managed runtime and return a no-env Effect that React and
  // other callers can compose without re-specifying ClientService.
  runClientEffect: <A, E>(
    effect: Effect.Effect<A, E, ClientService>
  ): Effect.Effect<A, E> =>
    Effect.async((resume) => {
      const cancel = runtime.runCallback(effect, {
        onExit: (exit) => {
          resume(
            Exit.isSuccess(exit)
              ? Effect.succeed(exit.value)
              : Effect.failCause(exit.cause)
          )
        },
      })

      return Effect.sync(() => {
        cancel()
      })
    }),
  // Closed effects do not need the client runtime. Keeping a separate runner
  // makes that boundary explicit and avoids pretending arbitrary R can run here.
  runClosedPromise: <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    Effect.runPromise(effect),
  runClosedFork: <A, E>(effect: Effect.Effect<A, E, never>): Fiber.RuntimeFiber<A, E> =>
    Effect.runFork(effect),
  runClientPromise: <A, E>(effect: Effect.Effect<A, E, ClientService>): Promise<A> =>
    runtime.runPromise(effect),
  runClientFork: <A, E>(effect: Effect.Effect<A, E, ClientService>): Fiber.RuntimeFiber<A, E> =>
    runtime.runFork(effect),
})

const makeQueryEntryLive = <Payload, Success, Error>(
  core: {
    readonly runtime: ManagedRuntime.ManagedRuntime<ClientService, never>
    readonly emit: (event: ClientEvent) => void
    readonly runClientEffect: <A, E>(effect: Effect.Effect<A, E, ClientService>) => Effect.Effect<A, E>
    readonly runClosedFork: <A, E>(effect: Effect.Effect<A, E, never>) => Fiber.RuntimeFiber<A, E>
  },
  key: string,
  path: string
): Effect.Effect<QueryEntryService<Payload, Success, Error>> =>
  Effect.gen(function* () {
  const resultRef = AtomRef.make<Result.Result<Success, Error>>(Result.initial())
  const stateRef = yield* Ref.make<QueryEntryState<Payload, Success, Error>>({
    descriptor: undefined,
    serverResult: Result.initial(),
    cacheValue: undefined,
    hasCacheValue: false,
    optimisticLayers: [],
    nextOptimisticLayerId: 0,
    stale: false,
    inflightFiber: null,
    pollingFiber: null,
    pollingInterval: undefined,
    observers: HashMap.empty(),
  })

  const computeVisibleResult = (state: QueryEntryState<Payload, Success, Error>): Result.Result<Success, Error> => {
    if (state.optimisticLayers.length === 0) {
      return state.serverResult
    }

    const baseValue = state.hasCacheValue ? state.cacheValue : getResultValueOrUndefined(state.serverResult)
    const optimisticValue = state.optimisticLayers.reduce<Success | undefined>(
      (current, layer) => layer.apply(current),
      baseValue
    )

    if (optimisticValue === undefined) {
      return state.serverResult
    }

    return Result.success(optimisticValue, {
      waiting: state.serverResult.waiting,
    })
  }

  const publishState = (state: QueryEntryState<Payload, Success, Error>): Effect.Effect<void> =>
    Effect.sync(() => {
      resultRef.set(computeVisibleResult(state))
    })

  const hasEnabledObserver = (state: QueryEntryState<Payload, Success, Error>): boolean =>
    [...HashMap.values(state.observers)].some((observer) => observer.enabled)

  const clearOptimisticState = Effect.gen(function* () {
    const previousLayers = yield* Ref.modify(stateRef, (state) => [
      state.optimisticLayers,
      {
        ...state,
        optimisticLayers: [],
      },
    ] as const)

    if (previousLayers.length === 0) {
      return
    }

    const nextState = yield* Ref.get(stateRef)
    yield* publishState(nextState)
    for (const layer of previousLayers) {
      core.emit(new OptimisticLayerRemovedEvent({
        key,
        path,
        layerId: layer.id,
        timestamp: Date.now(),
      }))
    }
  })

  const recomputePolling = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)
      const nextInterval = [...HashMap.values(state.observers)]
        .filter((observer) => observer.enabled && observer.refetchInterval !== undefined && observer.refetchInterval > 0)
        .map((observer) => observer.refetchInterval!)
        .reduce<number | undefined>(
          (current, interval) => current === undefined ? interval : Math.min(current, interval),
          undefined
        )

      if (nextInterval === state.pollingInterval) {
        return
      }

      if (state.pollingFiber !== null) {
        yield* Fiber.interrupt(state.pollingFiber).pipe(Effect.ignore)
      }

      const nextPollingFiber = nextInterval === undefined
        ? null
        : core.runClosedFork(
            Effect.forever(
              Effect.sleep(nextInterval).pipe(
                Effect.flatMap(() => fetch("poll")),
                Effect.catchAll(() => Effect.void)
              )
            )
          )

      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        pollingInterval: nextInterval,
        pollingFiber: nextPollingFiber,
      }))
    })

  const maybeFetchOnActivate = (): Effect.Effect<void> =>
    Ref.get(stateRef).pipe(
      Effect.flatMap((state) => {
        if (!hasEnabledObserver(state)) {
          return Effect.void
        }

        if (state.stale || Result.isInitial(state.serverResult)) {
          return fetch("observe")
        }

        return Effect.void
      })
    )

  const fetch = (reason: QueryFetchReason): Effect.Effect<void> =>
    Effect.gen(function* () {
      const state = yield* Ref.get(stateRef)

      if (state.inflightFiber !== null) {
        return yield* Fiber.await(state.inflightFiber).pipe(Effect.asVoid)
      }

      if (state.descriptor === undefined) {
        return
      }

      const previous = state.serverResult
      const currentDescriptor = state.descriptor

      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        serverResult: Result.waitingFrom(Option.some(previous)),
      }))
      yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))

      core.emit(new QueryFetchStartedEvent({
        key,
        path,
        reason,
        timestamp: Date.now(),
      }))

      const runFetch = core.runClientEffect(
        Effect.gen(function* () {
          const service = yield* ClientService
          return yield* service.send<Success, Error>(
            currentDescriptor.tag,
            currentDescriptor.payload,
            currentDescriptor.successSchema,
            currentDescriptor.errorSchema
          )
        })
      ).pipe(
        Effect.tap((value) =>
          Effect.gen(function* () {
            const removedLayers = yield* Ref.modify(stateRef, (currentState) => [
              currentState.optimisticLayers,
              {
                ...currentState,
                cacheValue: value,
                hasCacheValue: true,
                serverResult: Result.success(value),
                optimisticLayers: [],
                stale: false,
                inflightFiber: null,
              },
            ] as const)

            yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))
            for (const layer of removedLayers) {
              core.emit(new OptimisticLayerRemovedEvent({
                key,
                path,
                layerId: layer.id,
                timestamp: Date.now(),
              }))
            }
            core.emit(new QueryFetchSucceededEvent({
              key,
              path,
              reason,
              timestamp: Date.now(),
            }))
          })
        ),
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (currentState) => ({
              ...currentState,
              serverResult: Result.failureWithPrevious(toDomainCause<Error>(cause), {
                previous: Option.some(previous),
              }),
              stale: false,
              inflightFiber: null,
            }))
            yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))
            core.emit(new QueryFetchFailedEvent({
              key,
              path,
              reason,
              timestamp: Date.now(),
            }))
          })
        )
      )

      const currentFiber = core.runClosedFork(runFetch.pipe(Effect.asVoid))
      yield* Ref.update(stateRef, (currentState) => ({
        ...currentState,
        inflightFiber: currentFiber,
      }))
      yield* Fiber.await(currentFiber).pipe(Effect.asVoid)
    })

  return {
    resultRef,
    attachDescriptor: (nextDescriptor) => {
      Effect.runSync(
        Ref.update(stateRef, (state) => ({
          ...state,
          descriptor: nextDescriptor,
        }))
      )
    },
    retain: (observerId) =>
      Effect.gen(function* () {
        core.emit(new QueryObservedEvent({
          key,
          path,
          timestamp: Date.now(),
        }))
        yield* Ref.update(stateRef, (state) => ({
          ...state,
          observers: HashMap.has(state.observers, observerId)
            ? state.observers
            : HashMap.set(state.observers, observerId, { enabled: true }),
        }))
        yield* maybeFetchOnActivate()
        yield* recomputePolling()
      }),
    release: (observerId) =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (state) => ({
          ...state,
          observers: HashMap.remove(state.observers, observerId),
        }))
        yield* recomputePolling()
      }),
    setOptions: (observerId, options) =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (state) => ({
          ...state,
          observers: HashMap.set(state.observers, observerId, options),
        }))
        if (options.enabled) {
          yield* maybeFetchOnActivate()
        }
        yield* recomputePolling()
      }),
    seedHydratedValue: (value) =>
      Effect.gen(function* () {
        const didSet = yield* Ref.modify(stateRef, (state) => {
          if (state.hasCacheValue) {
            return [false, state] as const
          }

          return [true, {
            ...state,
            cacheValue: value,
            hasCacheValue: true,
            serverResult: Result.success(value),
          }] as const
        })

        if (!didSet) {
          return
        }

        yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))
        core.emit(new QueryHydratedEvent({
          key,
          path,
          timestamp: Date.now(),
        }))
      }),
    setCacheValue: (value) =>
      Effect.gen(function* () {
        yield* Ref.update(stateRef, (state) => ({
          ...state,
          cacheValue: value,
          hasCacheValue: true,
          serverResult: Result.success(value),
        }))
        yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))
      }),
    getCacheValue: () =>
      Effect.runSync(
        Ref.get(stateRef).pipe(
          Effect.map((state) =>
            state.hasCacheValue ? state.cacheValue : getResultValueOrUndefined(state.serverResult)
          )
        )
      ),
    addOptimisticLayer: (apply) =>
      Effect.gen(function* () {
        const id = yield* Ref.modify(stateRef, (state) => {
          const nextId = state.nextOptimisticLayerId
          return [nextId, {
            ...state,
            nextOptimisticLayerId: nextId + 1,
            optimisticLayers: [...state.optimisticLayers, { id: nextId, apply }],
          }] as const
        })

        yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))
        core.emit(new OptimisticLayerAddedEvent({
          key,
          path,
          layerId: id,
          timestamp: Date.now(),
        }))
        return id
      }),
    removeOptimisticLayer: (id) =>
      Effect.gen(function* () {
        const removed = yield* Ref.modify(stateRef, (state) => {
          const nextLayers = state.optimisticLayers.filter((layer) => layer.id !== id)
          return [nextLayers.length !== state.optimisticLayers.length, {
            ...state,
            optimisticLayers: nextLayers,
          }] as const
        })

        if (!removed) {
          return
        }

        yield* Ref.get(stateRef).pipe(Effect.flatMap(publishState))
        core.emit(new OptimisticLayerRemovedEvent({
          key,
          path,
          layerId: id,
          timestamp: Date.now(),
        }))
      }),
    clearOptimisticState,
    invalidate: Effect.gen(function* () {
      yield* Ref.update(stateRef, (state) => ({
        ...state,
        stale: true,
      }))
      core.emit(new QueryInvalidatedEvent({
        key,
        path,
        timestamp: Date.now(),
      }))
      const state = yield* Ref.get(stateRef)
      if (!hasEnabledObserver(state)) {
        return
      }
      yield* fetch("invalidation")
    }),
    fetch,
    matchesInvalidation: (invalidationPath) => {
      const descriptorPath = Effect.runSync(
        Ref.get(stateRef).pipe(
          Effect.map((state) => state.descriptor?.normalizedPath ?? normalizePath(path))
        )
      )
      return shouldInvalidate(descriptorPath, invalidationPath)
    },
  }
})

const makeMutationObserverLive = <Payload, Success, Error>(
  core: ClientCoreService & {
    readonly emit: (event: ClientEvent) => void
    readonly nextMutationId: () => number
    readonly recordMutation: (execution: MutationExecution) => void
    readonly runClientEffect: <A, E>(effect: Effect.Effect<A, E, ClientService>) => Effect.Effect<A, E>
    readonly getOrCreateQueryEntry: <P, S, E>(
      key: string,
      path: string
    ) => Effect.Effect<QueryEntryService<P, S, E>>
  },
  descriptor: MutationDescriptor<Payload, Success, Error>
): MutationObserver<Payload, Success, Error> => {
  const resultRef = AtomRef.make<Result.Result<Success, Error>>(Result.initial())

  return {
    resultRef,
    reset: Effect.sync(() => {
      resultRef.set(Result.initial())
    }),
    execute: (payload) => {
      const mutationId = core.nextMutationId()
      const mutationEffect: Effect.Effect<Success, Error> = Effect.gen(function* () {
        let optimisticLayer:
          | {
            readonly entry: QueryEntryService<unknown, unknown, unknown>
            readonly layerId: number
            readonly path: string
          }
          | undefined

        yield* Effect.sync(() => {
          resultRef.set(Result.initial(true))
          core.recordMutation({
            id: mutationId,
            tag: descriptor.tag,
            status: "pending",
            timestamp: Date.now(),
          })
          core.emit(new MutationStartedEvent({
            id: mutationId,
            tag: descriptor.tag,
            timestamp: Date.now(),
          }))
        })

        if (descriptor.optimistic) {
          const target = resolveOptimisticTarget(descriptor.optimistic.target, payload)
          const entry = yield* core.getOrCreateQueryEntry<unknown, unknown, unknown>(target.key, target.path)
          const layerId = yield* entry.addOptimisticLayer((current) =>
            descriptor.optimistic!.reducer(current, payload)
          )
          optimisticLayer = {
            entry,
            layerId,
            path: target.path,
          }
        }

        const data = yield* core.runClientEffect(
          Effect.gen(function* () {
            const service = yield* ClientService
            return yield* service.send<Success, Error>(
              descriptor.tag,
              payload,
              descriptor.successSchema,
              descriptor.errorSchema,
              "mutation"
            )
          })
        ).pipe(Effect.mapErrorCause(toDomainCause<Error>))

        if (descriptor.optimistic && optimisticLayer !== undefined && descriptor.optimistic.reconcile) {
          const currentValue = optimisticLayer.entry.getCacheValue()
          const reconciledValue = descriptor.optimistic.reconcile(currentValue, payload, data)
          yield* optimisticLayer.entry.removeOptimisticLayer(optimisticLayer.layerId)
          yield* optimisticLayer.entry.setCacheValue(reconciledValue)
        }

        const remainingInvalidations =
          descriptor.optimistic?.reconcile && optimisticLayer !== undefined
            ? descriptor.invalidates.filter((path) => path !== optimisticLayer.path)
            : descriptor.invalidates

        if (remainingInvalidations.length > 0) {
          yield* core.invalidate(remainingInvalidations)
        }

        yield* Effect.sync(() => {
          resultRef.set(Result.success(data))
          core.recordMutation({
            id: mutationId,
            tag: descriptor.tag,
            status: "success",
            timestamp: Date.now(),
          })
          core.emit(new MutationSucceededEvent({
            id: mutationId,
            tag: descriptor.tag,
            timestamp: Date.now(),
          }))
        })

        return data
      }).pipe(
        Effect.tapErrorCause((cause) =>
          Effect.gen(function* () {
            const previous = resultRef.value

            if (descriptor.optimistic) {
              const target = resolveOptimisticTarget(descriptor.optimistic.target, payload)
              const entry = yield* core.getOrCreateQueryEntry<unknown, unknown, unknown>(target.key, target.path)
              yield* entry.clearOptimisticState
            }

            yield* Effect.sync(() => {
              resultRef.set(Result.failureWithPrevious(toDomainCause<Error>(cause), {
                previous: Option.some(previous),
              }))
              core.recordMutation({
                id: mutationId,
                tag: descriptor.tag,
                status: "error",
                timestamp: Date.now(),
              })
              core.emit(new MutationFailedEvent({
                id: mutationId,
                tag: descriptor.tag,
                timestamp: Date.now(),
              }))
            })
          })
        )
      )

      return mutationEffect
    },
  }
}

const makeStreamObserverLive = <Payload, Success, Error>(
  core: ClientCoreService & {
    readonly emit: (event: ClientEvent) => void
    readonly runClientEffect: <A, E>(effect: Effect.Effect<A, E, ClientService>) => Effect.Effect<A, E>
    readonly runClosedFork: <A, E>(effect: Effect.Effect<A, E, never>) => Fiber.RuntimeFiber<A, E>
  },
  descriptor: StreamDescriptor<Payload, Success, Error>
): Effect.Effect<StreamObserver<Success, Error>> => Effect.gen(function* () {
  const stateRef = AtomRef.make<StreamState<Success, Error>>({
    data: [],
    latestValue: undefined,
    isConnected: false,
    error: undefined,
  })
  const stateStoreRef = yield* Ref.make<StreamState<Success, Error>>({
    data: [],
    latestValue: undefined,
    isConnected: false,
    error: undefined,
  })
  const lifecycleRef = yield* Ref.make<StreamObserverLifecycle>({
    retained: false,
    enabled: true,
    streamFiber: null,
  })

  const publishStreamState = (state: StreamState<Success, Error>): Effect.Effect<void> =>
    Effect.sync(() => {
      stateRef.set(state)
    })

  const start = (): void => {
    const nextState: StreamState<Success, Error> = {
      data: [],
      latestValue: undefined,
      isConnected: true,
      error: undefined,
    }
    void Effect.runSync(Ref.set(stateStoreRef, nextState))
    void Effect.runSync(publishStreamState(nextState))

    core.emit(new StreamStartedEvent({
      key: descriptor.key,
      tag: descriptor.tag,
      timestamp: Date.now(),
    }))

    const nextFiber = core.runClosedFork(
      core.runClientEffect(
        Effect.gen(function* () {
          const service = yield* ClientService
          const stream = service.sendStream<Success, Error>(
            descriptor.tag,
            descriptor.payload,
            descriptor.successSchema,
            descriptor.errorSchema
          )

          yield* stream.pipe(
            Stream.tap((value) =>
              Effect.gen(function* () {
                const nextState = yield* Ref.modify(stateStoreRef, (state) => {
                  const updated: StreamState<Success, Error> = {
                    data: [...state.data, value],
                    latestValue: value,
                    isConnected: true,
                    error: undefined,
                  }
                  return [updated, updated] as const
                })
                yield* publishStreamState(nextState)
                core.emit(new StreamChunkEvent({
                  key: descriptor.key,
                  tag: descriptor.tag,
                  timestamp: Date.now(),
                }))
              })
            ),
            Stream.runDrain
          )
        })
      ).pipe(
        Effect.catchAllCause((cause) =>
          Effect.gen(function* () {
            const nextState = yield* Ref.modify(stateStoreRef, (state) => {
              const updated: StreamState<Success, Error> = {
                ...state,
                isConnected: false,
                error: Cause.squash(toDomainCause<Error>(cause)) as Error,
              }
              return [updated, updated] as const
            })
            yield* publishStreamState(nextState)
            core.emit(new StreamFailedEvent({
              key: descriptor.key,
              tag: descriptor.tag,
              timestamp: Date.now(),
            }))
          })
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Ref.update(lifecycleRef, (state) => ({
              ...state,
              streamFiber: null,
            }))
            const nextState = yield* Ref.modify(stateStoreRef, (state) => {
              const updated: StreamState<Success, Error> = {
                ...state,
                isConnected: false,
              }
              return [updated, updated] as const
            })
            yield* publishStreamState(nextState)
            core.emit(new StreamStoppedEvent({
              key: descriptor.key,
              tag: descriptor.tag,
              timestamp: Date.now(),
            }))
          })
        )
      )
    )

    void Effect.runSync(
      Ref.update(lifecycleRef, (state) => ({
        ...state,
        streamFiber: nextFiber,
      }))
    )
  }

  const stop = Effect.gen(function* () {
    const currentFiber = yield* Ref.modify(lifecycleRef, (state) => [
      state.streamFiber,
      {
        ...state,
        streamFiber: null,
      },
    ] as const)

    if (currentFiber !== null) {
      yield* Fiber.interrupt(currentFiber).pipe(Effect.ignore)
    }
  })

  return {
    stateRef,
    retain: Effect.sync(() => {
      const next = Effect.runSync(
        Ref.modify(lifecycleRef, (state) => {
          const nextState = {
            ...state,
            retained: true,
          }
          return [nextState.enabled && nextState.streamFiber === null, nextState] as const
        })
      )

      if (next) {
        start()
      }
    }),
    release: Ref.update(lifecycleRef, (state) => ({
      ...state,
      retained: false,
    })).pipe(Effect.zipRight(stop)),
    setEnabled: (nextEnabled) =>
      Effect.sync(() => {
        const shouldStart = Effect.runSync(
          Ref.modify(lifecycleRef, (state) => {
            const nextState = {
              ...state,
              enabled: nextEnabled,
            }
            return [nextState.enabled && nextState.retained && nextState.streamFiber === null, nextState] as const
          })
        )

        if (shouldStart) {
          start()
        }
      }).pipe(
        Effect.zipRight(nextEnabled ? Effect.void : stop)
      ),
    stop,
    restart: stop.pipe(
      Effect.zipRight(
        Effect.sync(() => {
          const shouldStart = Effect.runSync(
            Ref.get(lifecycleRef).pipe(
              Effect.map((state) => state.retained && state.enabled && state.streamFiber === null)
            )
          )

          if (shouldStart) {
            start()
          }
        })
      )
    ),
  }
})

export const makeClientCore = (
  layer: Layer.Layer<Transport.Transport>
): ClientCoreService => {
  const runtime = ManagedRuntime.make(
    ClientService.Live.pipe(Layer.provide(layer))
  )
  const clientRuntime = makeClientRuntime(runtime)
  const eventsRef = AtomRef.make<ReadonlyArray<ClientEvent>>([])
  const mutationsRef = AtomRef.make<ReadonlyArray<MutationExecution>>([])
  const queriesRef = Effect.runSync(
    Ref.make(HashMap.empty<string, QueryEntryService<unknown, unknown, unknown>>())
  )
  const nextObserverRef = Effect.runSync(Ref.make(0))
  const nextMutationRef = Effect.runSync(Ref.make(0))

  const emit = (event: ClientEvent): void => {
    eventsRef.update((events) => [...events, event].slice(-200))
  }

  const recordMutation = (execution: MutationExecution): void => {
    mutationsRef.update((executions) => {
      const existingIndex = executions.findIndex((item) => item.id === execution.id)
      if (existingIndex === -1) {
        return [...executions, execution].slice(-100)
      }

      const next = executions.slice()
      next[existingIndex] = execution
      return next
    })
  }

  const getOrCreateQueryEntry = <Payload, Success, Error>(
    key: string,
    path: string
  ): Effect.Effect<QueryEntryService<Payload, Success, Error>> =>
    Effect.gen(function* () {
      const queries = yield* Ref.get(queriesRef)
      const existing = HashMap.get(queries, key)
      if (Option.isSome(existing)) {
        return existing.value as QueryEntryService<Payload, Success, Error>
      }

      const entry = yield* makeQueryEntryLive<Payload, Success, Error>(
        {
          runtime,
          emit,
          runClientEffect: clientRuntime.runClientEffect,
          runClosedFork: clientRuntime.runClosedFork,
        },
        key,
        path
      )

      yield* Ref.update(queriesRef, (q) =>
        HashMap.set(q, key, entry as QueryEntryService<unknown, unknown, unknown>)
      )

      return entry
    })

  const core: ClientCoreService & {
    readonly emit: typeof emit
    readonly nextMutationId: () => number
    readonly recordMutation: typeof recordMutation
    readonly getOrCreateQueryEntry: typeof getOrCreateQueryEntry
    readonly runClientEffect: typeof clientRuntime.runClientEffect
  } = {
    runtime,
    eventsRef,
    mutationsRef,
    shutdown: Effect.promise(() => runtime.dispose()),
    runClosedPromise: clientRuntime.runClosedPromise,
    runClosedFork: clientRuntime.runClosedFork,
    runClientPromise: clientRuntime.runClientPromise,
    runClientFork: clientRuntime.runClientFork,
    emit,
    nextMutationId: () =>
      Effect.runSync(
        Ref.modify(nextMutationRef, (current) => [current, current + 1] as const)
      ),
    recordMutation,
    getOrCreateQueryEntry,
    runClientEffect: clientRuntime.runClientEffect,
    observeQuery: <Payload, Success, Error>(
      descriptor: QueryDescriptor<Payload, Success, Error>
    ): QueryObserver<Success, Error> => {
      // Run the effectful getOrCreateQueryEntry at the React boundary
      const entry = Effect.runSync(
        getOrCreateQueryEntry<Payload, Success, Error>(descriptor.key, descriptor.path)
      )
      entry.attachDescriptor(descriptor)
      const observerId = Effect.runSync(
        Ref.modify(nextObserverRef, (current) => [current, current + 1] as const)
      )

      return {
        resultRef: entry.resultRef,
        retain: entry.retain(observerId),
        release: entry.release(observerId),
        setOptions: (options) => entry.setOptions(observerId, options),
        refetch: entry.fetch("manual"),
        seedHydratedValue: (value) => entry.seedHydratedValue(value),
      }
    },
    createMutationObserver: <Payload, Success, Error>(
      descriptor: MutationDescriptor<Payload, Success, Error>
    ): MutationObserver<Payload, Success, Error> =>
      makeMutationObserverLive(core, descriptor),
    createStreamObserver: <Payload, Success, Error>(
      descriptor: StreamDescriptor<Payload, Success, Error>
    ): StreamObserver<Success, Error> =>
      Effect.runSync(makeStreamObserverLive(core, descriptor)),
    invalidate: (paths) => {
      const normalizedPaths = paths.map(normalizePath)
      const queries = Effect.runSync(Ref.get(queriesRef))
      const matches = [...HashMap.values(queries)].filter((entry) =>
        normalizedPaths.some((path) => entry.matchesInvalidation(path))
      )

      return Effect.all(matches.map((entry) => entry.invalidate), {
        concurrency: "unbounded",
        discard: true,
      })
    },
  }

  return core
}

ClientCore.Live = Layer.scoped(
  ClientCore,
  Effect.gen(function* () {
    const transport = yield* Transport.Transport
    const core = makeClientCore(Layer.succeed(Transport.Transport, transport))
    yield* Effect.addFinalizer(() => core.shutdown)
    return core
  })
)

