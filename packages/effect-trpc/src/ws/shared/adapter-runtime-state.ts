import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"

export type AdapterLifecycle =
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Failed"; readonly error: Error }
  | { readonly _tag: "Disposing" }
  | { readonly _tag: "Disposed" }

export type ConnectionAdmission =
  | { readonly _tag: "Accept" }
  | { readonly _tag: "Starting" }
  | { readonly _tag: "Failed"; readonly error: Error }
  | { readonly _tag: "ShuttingDown" }

export interface AdapterRuntimeState {
  readonly lifecycle: Effect.Effect<AdapterLifecycle>
  readonly connectionAdmission: Effect.Effect<ConnectionAdmission>
  readonly canRunNewWork: Effect.Effect<boolean>
  readonly canRunCleanupWork: Effect.Effect<boolean>
  readonly markReady: Effect.Effect<void>
  readonly markFailed: (error: Error) => Effect.Effect<void>
  readonly markDisposing: Effect.Effect<void>
  readonly markDisposed: Effect.Effect<void>
  readonly trackFiber: (fiber: Fiber.RuntimeFiber<unknown, unknown>) => Effect.Effect<void>
  readonly untrackFiber: (fiber: Fiber.RuntimeFiber<unknown, unknown>) => Effect.Effect<void>
  readonly interruptTrackedFibers: Effect.Effect<void>
  readonly clearTrackedFibers: Effect.Effect<void>
}

const startingLifecycle: AdapterLifecycle = { _tag: "Starting" }
const readyLifecycle: AdapterLifecycle = { _tag: "Ready" }
const disposingLifecycle: AdapterLifecycle = { _tag: "Disposing" }
const disposedLifecycle: AdapterLifecycle = { _tag: "Disposed" }

const toConnectionAdmission = (lifecycle: AdapterLifecycle): ConnectionAdmission => {
  switch (lifecycle._tag) {
    case "Ready":
      return { _tag: "Accept" }
    case "Starting":
      return { _tag: "Starting" }
    case "Failed":
      return { _tag: "Failed", error: lifecycle.error }
    case "Disposing":
    case "Disposed":
      return { _tag: "ShuttingDown" }
  }
}

export const makeAdapterRuntimeState: Effect.Effect<AdapterRuntimeState> = Effect.gen(function* () {
  const lifecycleRef = yield* Ref.make<AdapterLifecycle>(startingLifecycle)
  const activeFibersRef = yield* Ref.make<ReadonlyArray<Fiber.RuntimeFiber<unknown, unknown>>>([])

  return {
    lifecycle: Ref.get(lifecycleRef),
    connectionAdmission: Ref.get(lifecycleRef).pipe(Effect.map(toConnectionAdmission)),
    canRunNewWork: Ref.get(lifecycleRef).pipe(Effect.map((lifecycle) => lifecycle._tag === "Ready")),
    canRunCleanupWork: Ref.get(lifecycleRef).pipe(
      Effect.map((lifecycle) => lifecycle._tag !== "Disposed"),
    ),
    markReady: Ref.set(lifecycleRef, readyLifecycle),
    markFailed: (error) => Ref.set(lifecycleRef, { _tag: "Failed", error }),
    markDisposing: Ref.set(lifecycleRef, disposingLifecycle),
    markDisposed: Ref.set(lifecycleRef, disposedLifecycle),
    trackFiber: (fiber) =>
      Ref.update(activeFibersRef, (fibers) => {
        if (fibers.includes(fiber)) {
          return fibers
        }
        return [...fibers, fiber]
      }),
    untrackFiber: (fiber) => Ref.update(activeFibersRef, (fibers) => fibers.filter((f) => f !== fiber)),
    interruptTrackedFibers: Effect.gen(function* () {
      const fibers = yield* Ref.get(activeFibersRef)
      yield* Effect.forEach(
        fibers,
        (fiber) => Fiber.interrupt(fiber).pipe(Effect.ignore),
        { discard: true, concurrency: "unbounded" },
      )
    }),
    clearTrackedFibers: Ref.set(activeFibersRef, []),
  }
})
