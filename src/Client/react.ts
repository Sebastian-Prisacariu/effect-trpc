/**
 * React Integration for effect-trpc
 *
 * Built on @effect-atom/atom-react, with a shared Effect-driven client core.
 *
 * @since 1.0.0
 * @module
 */

import * as React from "react"
import { useCallback, useContext, useEffect, useMemo } from "react"
import { AtomRef, Result, RegistryProvider, useAtomRef } from "@effect-atom/atom-react"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

import * as Procedure from "../Procedure/index.js"
import * as Router from "../Router/index.js"
import { normalizePath } from "../Reactivity/index.js"
import { queryKey as toSsrQueryKey, queryKeyFromSchema as toSchemaQueryKey, useHydrationState } from "../SSR/index.js"
import * as Transport from "../Transport/index.js"
import { type ClientCoreService, makeClientCore } from "./core.js"

// =============================================================================
// Provider
// =============================================================================

export interface ProviderProps {
  readonly layer: Layer.Layer<Transport.Transport>
  readonly children: React.ReactNode
}

const suspensePromiseRegistry = new WeakMap<object, Promise<void>>()

const waitForResultRef = <A, E>(
  ref: AtomRef.ReadonlyRef<Result.Result<A, E>>
): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    const unsubscribe = ref.subscribe((next) => {
      if (next._tag === "Initial") {
        return
      }
      unsubscribe()
      resume(Effect.void)
    })

    return Effect.sync(() => {
      unsubscribe()
    })
  })

const refToSuspensePromise = <A, E>(
  core: ClientCoreService,
  ref: AtomRef.ReadonlyRef<Result.Result<A, E>>
): Promise<void> => {
  const existing = suspensePromiseRegistry.get(ref as object)
  if (existing !== undefined) {
    return existing
  }

  const promise = core.runClosedPromise(waitForResultRef(ref)).finally(() => {
    suspensePromiseRegistry.delete(ref as object)
  })

  suspensePromiseRegistry.set(ref as object, promise)
  return promise
}

const useResultRefWithOptionalSuspense = <A, E>(
  core: ClientCoreService,
  ref: AtomRef.ReadonlyRef<Result.Result<A, E>>,
  suspense: boolean
): Result.Result<A, E> => {
  const result = useAtomRef(ref)
  if (!suspense) {
    return result
  }

  if (result._tag === "Initial") {
    throw refToSuspensePromise(core, ref)
  }

  if (result._tag === "Failure") {
    throw Cause.squash(result.cause)
  }

  return result
}

const getHydratedValue = <A>(
  state: { readonly queries: Record<string, unknown> } | null,
  primaryKey: string,
  fallbackKey: string
): A | undefined => (state?.queries[primaryKey] ?? state?.queries[fallbackKey]) as A | undefined

const getResultValueOrUndefined = <A, E>(result: Result.Result<A, E>): A | undefined => {
  const value = Result.value(result)
  return Option.isSome(value) ? value.value : undefined
}

const getResultErrorOrUndefined = <A, E>(result: Result.Result<A, E>): E | undefined => {
  const error = Result.error(result)
  return Option.isSome(error) ? error.value : undefined
}

interface TrpcContextValue {
  readonly core: ClientCoreService
}

const TrpcContext = React.createContext<TrpcContextValue | null>(null)

const useTrpcContext = (): TrpcContextValue => {
  const ctx = useContext(TrpcContext)
  if (ctx === null) {
    throw new Error(
      "useTrpcContext must be used within <api.Provider>. " +
      "Wrap your app with <api.Provider layer={Transport.http('/api')}>."
    )
  }
  return ctx
}

export const createProvider = <D extends Router.Definition>(
  _router: Router.Router<D>
): React.FC<ProviderProps> => {
  return function TrpcProvider({ layer, children }: ProviderProps) {
    const core = useMemo(() => makeClientCore(layer), [layer])

    useEffect(() => {
      return () => {
        void core.runClosedPromise(core.shutdown)
      }
    }, [core])

    const contextValue = useMemo<TrpcContextValue>(() => ({ core }), [core])

    return React.createElement(
      RegistryProvider,
      {},
      React.createElement(
        TrpcContext.Provider,
        { value: contextValue },
        children
      )
    )
  }
}

// =============================================================================
// useQuery Hook
// =============================================================================

export interface UseQueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly suspense?: boolean
}

export interface UseQueryResult<Success, Error> {
  readonly result: Result.Result<Success, Error>
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly refetch: () => void
}

export const createUseQuery = <
  PayloadSchema extends Schema.Schema.AnyNoContext,
  SuccessSchema extends Schema.Schema.AnyNoContext,
  ErrorSchema extends Schema.Schema.AnyNoContext
>(
  tag: string,
  procedure: Procedure.Query<PayloadSchema, SuccessSchema, ErrorSchema>
): (
  payload?: Schema.Schema.Type<PayloadSchema>,
  options?: UseQueryOptions
) => UseQueryResult<Schema.Schema.Type<SuccessSchema>, Schema.Schema.Type<ErrorSchema>> => {
  type Payload = Schema.Schema.Type<PayloadSchema>
  type Success = Schema.Schema.Type<SuccessSchema>
  type Error = Schema.Schema.Type<ErrorSchema>

  const path = tag.split("/").slice(1).join(".")
  const normalizedPath = normalizePath(path)

  return function useQuery(
    payload?: Payload,
    options: UseQueryOptions = {}
  ): UseQueryResult<Success, Error> {
    const { enabled = true, suspense = false, refetchInterval } = options
    const ctx = useTrpcContext()
    const hydrationState = useHydrationState()
    const cacheKey = useMemo(
      () => toSchemaQueryKey(path, procedure.payloadSchema, payload),
      [path, payload, procedure.payloadSchema]
    )
    const stablePayload = useMemo(() => payload, [cacheKey])
    const hydratedValue = getHydratedValue<Success>(hydrationState, cacheKey, path)

    const observer = useMemo(
      () =>
        ctx.core.observeQuery<Payload, Success, Error>({
          tag,
          key: cacheKey,
          path,
          normalizedPath,
          payload: stablePayload,
          successSchema: procedure.successSchema,
          errorSchema: procedure.errorSchema,
        }),
      [cacheKey, ctx.core, stablePayload]
    )

    useEffect(() => {
      const setupEffect = (hydratedValue !== undefined
        ? observer.seedHydratedValue(hydratedValue)
        : Effect.void
      ).pipe(
        Effect.zipRight(observer.setOptions({ enabled, refetchInterval })),
        Effect.zipRight(observer.retain)
      )
      void ctx.core.runClosedPromise(setupEffect)
      return () => {
        void ctx.core.runClosedPromise(observer.release)
      }
    }, [ctx.core, enabled, hydratedValue, observer, refetchInterval])

    const atomResult = useResultRefWithOptionalSuspense(ctx.core, observer.resultRef, suspense)
    const result =
      Result.isInitial(atomResult) && hydratedValue !== undefined
        ? Result.success<Success, Error>(hydratedValue)
        : atomResult
    const isLoading = Result.isInitial(result) || Result.isWaiting(result)
    const isSuccess = Result.isSuccess(result)
    const isError = Result.isFailure(result)
    const data = getResultValueOrUndefined(result)
    const error = getResultErrorOrUndefined(result)

    const refetch = useCallback(() => {
      if (!enabled) {
        return
      }
      void ctx.core.runClosedPromise(observer.refetch)
    }, [ctx.core, enabled, observer])

    return {
      result,
      data,
      error,
      isLoading,
      isSuccess,
      isError,
      refetch,
    } satisfies UseQueryResult<Success, Error>
  }
}

// =============================================================================
// useMutation Hook
// =============================================================================

export interface UseMutationOptions<Success, Error> {
  readonly onSuccess?: (data: Success) => void
  readonly onError?: (error: Error) => void
  readonly onSettled?: () => void
}

export interface UseMutationResult<Payload, Success, Error> {
  readonly result: Result.Result<Success, Error>
  readonly mutate: (payload: Payload) => void
  readonly mutateAsync: (payload: Payload) => Promise<Success>
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly reset: () => void
}

export const createUseMutation = <
  PayloadSchema extends Schema.Schema.AnyNoContext,
  SuccessSchema extends Schema.Schema.AnyNoContext,
  ErrorSchema extends Schema.Schema.AnyNoContext,
  Invalidates extends ReadonlyArray<string>
>(
  tag: string,
  procedure: Procedure.Mutation<PayloadSchema, SuccessSchema, ErrorSchema, Invalidates>
): (
  options?: UseMutationOptions<Schema.Schema.Type<SuccessSchema>, Schema.Schema.Type<ErrorSchema>>
) => UseMutationResult<
  Schema.Schema.Type<PayloadSchema>,
  Schema.Schema.Type<SuccessSchema>,
  Schema.Schema.Type<ErrorSchema>
> => {
  type Payload = Schema.Schema.Type<PayloadSchema>
  type Success = Schema.Schema.Type<SuccessSchema>
  type Error = Schema.Schema.Type<ErrorSchema>

  return function useMutation(
    options: UseMutationOptions<Success, Error> = {}
  ): UseMutationResult<Payload, Success, Error> {
    const { onSuccess, onError, onSettled } = options
    const ctx = useTrpcContext()

    const observer = useMemo(
      () =>
        ctx.core.createMutationObserver<Payload, Success, Error>({
          tag,
          successSchema: procedure.successSchema,
          errorSchema: procedure.errorSchema,
          invalidates: procedure.invalidates,
          optimistic: procedure.optimistic,
        }),
      [ctx.core]
    )

    const result = useAtomRef(observer.resultRef)
    const isLoading = Result.isWaiting(result)
    const isSuccess = Result.isSuccess(result)
    const isError = Result.isFailure(result)
    const data = getResultValueOrUndefined(result)
    const error = getResultErrorOrUndefined(result)

    const mutateAsync = useCallback(async (payload: Payload): Promise<Success> => {
      const effect = observer.execute(payload).pipe(
        Effect.tap((next) => Effect.sync(() => {
          onSuccess?.(next)
        })),
        Effect.tapError((nextError) => Effect.sync(() => {
          onError?.(nextError)
        })),
        Effect.ensuring(Effect.sync(() => {
          onSettled?.()
        }))
      )

      return ctx.core.runClosedPromise(effect)
    }, [ctx.core, observer, onError, onSettled, onSuccess])

    const mutate = useCallback((payload: Payload) => {
      void mutateAsync(payload).catch(() => undefined)
    }, [mutateAsync])

    const reset = useCallback(() => {
      void ctx.core.runClosedPromise(observer.reset)
    }, [ctx.core, observer])

    return {
      result,
      mutate,
      mutateAsync,
      isLoading,
      isSuccess,
      isError,
      data,
      error,
      reset,
    } satisfies UseMutationResult<Payload, Success, Error>
  }
}

// =============================================================================
// useStream Hook
// =============================================================================

export interface UseStreamOptions {
  readonly enabled?: boolean
}

export interface UseStreamResult<Success, Error> {
  readonly data: readonly Success[]
  readonly latestValue: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
  readonly stop: () => void
  readonly restart: () => void
}

export const createUseStream = <
  PayloadSchema extends Schema.Schema.AnyNoContext,
  SuccessSchema extends Schema.Schema.AnyNoContext,
  ErrorSchema extends Schema.Schema.AnyNoContext
>(
  tag: string,
  procedure: Procedure.Stream<PayloadSchema, SuccessSchema, ErrorSchema>
): (
  payload?: Schema.Schema.Type<PayloadSchema>,
  options?: UseStreamOptions
) => UseStreamResult<
  Schema.Schema.Type<SuccessSchema>,
  Schema.Schema.Type<ErrorSchema>
> => {
  type Payload = Schema.Schema.Type<PayloadSchema>
  type Success = Schema.Schema.Type<SuccessSchema>
  type Error = Schema.Schema.Type<ErrorSchema>

  const path = tag.split("/").slice(1).join(".")

  return function useStream(
    payload?: Payload,
    options: UseStreamOptions = {}
  ): UseStreamResult<Success, Error> {
    const { enabled = true } = options
    const ctx = useTrpcContext()
    const streamKey = useMemo(
      () => toSchemaQueryKey(path, procedure.payloadSchema, payload),
      [path, payload, procedure.payloadSchema]
    )
    const stablePayload = useMemo(() => payload, [streamKey])

    const observer = useMemo(
      () =>
        ctx.core.createStreamObserver<Payload, Success, Error>({
          tag,
          key: streamKey,
          payload: stablePayload,
          successSchema: procedure.successSchema,
          errorSchema: procedure.errorSchema,
        }),
      [ctx.core, stablePayload, streamKey]
    )

    useEffect(() => {
      void ctx.core.runClosedPromise(
        observer.setEnabled(enabled).pipe(
          Effect.zipRight(observer.retain)
        )
      )
      return () => {
        void ctx.core.runClosedPromise(observer.release)
      }
    }, [ctx.core, enabled, observer])

    const state = useAtomRef(observer.stateRef)

    const stop = useCallback(() => {
      void ctx.core.runClosedPromise(observer.stop)
    }, [ctx.core, observer])

    const restart = useCallback(() => {
      void ctx.core.runClosedPromise(observer.restart)
    }, [ctx.core, observer])

    return {
      data: state.data,
      latestValue: state.latestValue,
      isConnected: state.isConnected,
      error: state.error,
      stop,
      restart,
    } satisfies UseStreamResult<Success, Error>
  }
}

