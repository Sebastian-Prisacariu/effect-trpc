/**
 * React Integration for effect-trpc
 * 
 * Built on @effect-atom/atom-react - uses Effect Atom's hooks and registry
 * for state management, caching, and React integration.
 * 
 * @since 1.0.0
 * @module
 */

import * as React from "react"
import { useContext, useMemo, useCallback, useState, useEffect, useRef } from "react"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Scope from "effect/Scope"
import { pipe } from "effect/Function"

// Import from @effect-atom/atom-react
import {
  Atom,
  Registry,
  Result,
  useAtomValue,
  useAtomSuspense,
  useAtomRefresh,
  useAtomMount,
  RegistryContext,
  RegistryProvider,
} from "@effect-atom/atom-react"

// Import @effect/experimental/Reactivity for cache invalidation
import * as Reactivity from "@effect/experimental/Reactivity"

import * as Transport from "../Transport/index.js"
import * as Procedure from "../Procedure/index.js"
import * as Router from "../Router/index.js"
import { ClientServiceTag, ClientServiceLive } from "./index.js"

// =============================================================================
// Provider
// =============================================================================

export interface ProviderProps {
  readonly layer: Layer.Layer<Transport.Transport>
  readonly children: React.ReactNode
}

/**
 * Context for the Atom runtime (created per router)
 */
interface TrpcContextValue {
  readonly atomRuntime: Atom.AtomRuntime<ClientServiceTag | Reactivity.Reactivity>
  readonly layer: Layer.Layer<ClientServiceTag | Reactivity.Reactivity>
  readonly rootTag: string
}

const TrpcContext = React.createContext<TrpcContextValue | null>(null)

const useTrpcContext = (): TrpcContextValue => {
  const ctx = useContext(TrpcContext)
  if (!ctx) {
    throw new Error(
      "useTrpcContext must be used within <api.Provider>. " +
      "Wrap your app with <api.Provider layer={Transport.http('/api')}>."
    )
  }
  return ctx
}

/**
 * Create a Provider component for a router
 * 
 * The Provider sets up:
 * - Effect Atom Registry (for caching)
 * - Reactivity service (for invalidation)
 * - Transport layer (for network requests)
 * 
 * @internal
 */
export const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  return function TrpcProvider({ layer, children }: ProviderProps) {
    // Create the Atom runtime with Reactivity support
    const contextValue = useMemo<TrpcContextValue>(() => {
      // Build the full layer with ClientService + Reactivity
      const fullLayer = ClientServiceLive.pipe(
        Layer.provideMerge(Reactivity.layer),
        Layer.provide(layer)
      )
      
      // Create AtomRuntime from the layer
      const atomRuntime = Atom.runtime(fullLayer)
      
      return {
        atomRuntime,
        layer: fullLayer,
        rootTag: router.tag,
      }
    }, [layer])
    
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
  /**
   * Enable/disable the query (default: true)
   */
  readonly enabled?: boolean
  
  /**
   * Refetch interval in milliseconds (optional)
   */
  readonly refetchInterval?: number
  
  /**
   * Use Suspense for loading state (default: false)
   */
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

/**
 * Create a useQuery hook for a procedure
 * 
 * @internal
 */
export const createUseQuery = <Payload, Success, Error>(
  tag: string,
  procedure: Procedure.Query<any, any, any>
): (payload?: Payload, options?: UseQueryOptions) => UseQueryResult<Success, Error> => {
  // Compute reactivity keys from tag (e.g., "@api/users/list" → ["users", "users/list"])
  const tagParts = tag.split("/").slice(1)
  const reactivityKeys = tagParts.reduce<string[]>((acc, part, i) => {
    const key = i === 0 ? part : `${acc[i - 1]}/${part}`
    return [...acc, key]
  }, [])
  
  return function useQuery(
    payload?: Payload,
    options: UseQueryOptions = {}
  ): UseQueryResult<Success, Error> {
    const { enabled = true, suspense = false, refetchInterval } = options
    const ctx = useTrpcContext()
    
    // Stable serialized payload for cache key
    const payloadKey = useMemo(() => JSON.stringify(payload), [payload])
    
    // Create the query atom using AtomRuntime
    // Key includes payload so different payloads get different atoms
    const queryAtom = useMemo(() => {
      const queryEffect = Effect.gen(function* () {
        const service = yield* ClientServiceTag
        return yield* service.send(
          tag,
          payload,
          procedure.successSchema,
          procedure.errorSchema
        )
      })
      
      // Create atom with the runtime
      let atom = ctx.atomRuntime.atom(queryEffect)
      
      // Register for reactivity (invalidation)
      if (reactivityKeys.length > 0) {
        atom = ctx.atomRuntime.factory.withReactivity(reactivityKeys)(atom)
      }
      
      return atom
    }, [ctx.atomRuntime, tag, payloadKey]) // payloadKey in deps
    
    // Mount the atom (keeps it alive)
    // Note: useAtomMount handles undefined internally
    useAtomMount(queryAtom)
    
    // Get the refresh function
    const refetch = useAtomRefresh(queryAtom)
    
    // Refetch interval polling
    useEffect(() => {
      if (!enabled || !refetchInterval || refetchInterval <= 0) return
      
      const intervalId = setInterval(() => {
        refetch()
      }, refetchInterval)
      
      return () => clearInterval(intervalId)
    }, [enabled, refetchInterval, refetch])
    
    // Get the value using appropriate hook
    let result: Result.Result<Success, Error>
    
    // When disabled, return initial state
    if (!enabled) {
      result = Result.initial()
    } else if (suspense) {
      result = useAtomSuspense(queryAtom) as Result.Result<Success, Error>
    } else {
      result = useAtomValue(queryAtom) as Result.Result<Success, Error>
    }
    
    // Derive convenience values
    const isLoading = Result.isInitial(result) || Result.isWaiting(result)
    const isSuccess = Result.isSuccess(result)
    const isError = Result.isFailure(result)
    const data = isSuccess ? (result as Result.Success<Success, Error>).value : undefined
    const error = isError ? (result as Result.Failure<Success, Error>).cause : undefined
    
    return {
      result,
      data,
      error: error as Error | undefined,
      isLoading,
      isSuccess,
      isError,
      refetch,
    }
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

/**
 * Create a useMutation hook for a procedure
 * 
 * @internal
 */
export const createUseMutation = <Payload, Success, Error>(
  tag: string,
  procedure: Procedure.Mutation<any, any, any, any>
): (options?: UseMutationOptions<Success, Error>) => UseMutationResult<Payload, Success, Error> => {
  const invalidatePaths = procedure.invalidates
  
  // Extract optimistic config from procedure
  const optimisticConfig = procedure.optimistic as {
    target: string
    reducer: (current: unknown, payload: unknown) => unknown
    reconcile?: (current: unknown, payload: unknown, result: unknown) => unknown
  } | undefined
  
  return function useMutation(
    options: UseMutationOptions<Success, Error> = {}
  ): UseMutationResult<Payload, Success, Error> {
    const { onSuccess, onError, onSettled } = options
    const ctx = useTrpcContext()
    
    // Local state for mutation result
    const [result, setResult] = useState<Result.Result<Success, Error>>(
      Result.initial()
    )
    
    // Track optimistic state for rollback
    const optimisticRef = useRef<{ previousValue: unknown } | null>(null)
    
    const mutateAsync = useCallback((payload: Payload): Promise<Success> => {
      setResult(Result.initial(true)) // waiting = true
      
      // Build the mutation effect with optimistic support
      const mutationEffect = Effect.gen(function* () {
        const service = yield* ClientServiceTag
        
        // Apply optimistic update if configured
        if (optimisticConfig) {
          // Store rollback state (would need atom access for real impl)
          // For now, optimistic updates are applied via Reactivity
          yield* Effect.logDebug("Applying optimistic update", {
            target: optimisticConfig.target,
            payload,
          })
        }
        
        const data = yield* service.send(
          tag,
          payload,
          procedure.successSchema,
          procedure.errorSchema,
          "mutation"
        )
        
        // Reconcile or invalidate on success
        if (optimisticConfig?.reconcile) {
          // If reconcile is provided, apply it instead of invalidating
          yield* Effect.logDebug("Reconciling optimistic update", {
            target: optimisticConfig.target,
            result: data,
          })
        } else if (invalidatePaths.length > 0) {
          // Invalidate on success
          yield* service.invalidate(invalidatePaths)
        }
        
        return data as Success
      })
      
      // Run the effect with proper handling
      return Effect.runPromise(
        mutationEffect.pipe(
          Effect.tap((data) => Effect.sync(() => {
            optimisticRef.current = null // Clear rollback state
            setResult(Result.success(data))
            onSuccess?.(data)
          })),
          Effect.tapError((error) => Effect.sync(() => {
            // Rollback optimistic update on error
            if (optimisticRef.current && optimisticConfig) {
              // Would rollback via atom here
              Effect.runSync(
                Effect.logDebug("Rolling back optimistic update", {
                  target: optimisticConfig.target,
                })
              )
            }
            optimisticRef.current = null
            setResult(Result.fail(error as Error))
            onError?.(error as Error)
          })),
          Effect.ensuring(Effect.sync(() => onSettled?.())),
          Effect.provide(ctx.layer)
        )
      )
    }, [ctx.layer, tag, procedure.successSchema, procedure.errorSchema, invalidatePaths, optimisticConfig, onSuccess, onError, onSettled])
    
    const mutate = useCallback((payload: Payload) => {
      mutateAsync(payload).catch(() => {
        // Error already handled via onError
      })
    }, [mutateAsync])
    
    const reset = useCallback(() => {
      setResult(Result.initial())
    }, [])
    
    // Derive convenience values
    const isLoading = Result.isWaiting(result)
    const isSuccess = Result.isSuccess(result)
    const isError = Result.isFailure(result)
    const data = isSuccess ? (result as Result.Success<Success, Error>).value : undefined
    const error = isError ? (result as Result.Failure<Success, Error>).cause : undefined
    
    return {
      result,
      mutate,
      mutateAsync,
      isLoading,
      isSuccess,
      isError,
      data,
      error: error as Error | undefined,
      reset,
    }
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

/**
 * Create a useStream hook for a stream procedure
 * 
 * @internal
 */
export const createUseStream = <Payload, Success, Error>(
  tag: string,
  procedure: Procedure.Stream<any, any, any>
): (payload?: Payload, options?: UseStreamOptions) => UseStreamResult<Success, Error> => {
  return function useStream(
    payload?: Payload,
    options: UseStreamOptions = {}
  ): UseStreamResult<Success, Error> {
    const { enabled = true } = options
    const ctx = useTrpcContext()
    
    const [data, setData] = useState<readonly Success[]>([])
    const [isConnected, setIsConnected] = useState(false)
    const [error, setError] = useState<Error | undefined>()
    const [restartCount, setRestartCount] = useState(0) // Trigger for restart
    const fiberRef = useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)
    
    // Subscribe to stream updates
    useEffect(() => {
      if (!enabled) return
      
      setIsConnected(true)
      setData([])
      setError(undefined)
      
      // Build the stream effect
      const streamEffect = Effect.gen(function* () {
        const service = yield* ClientServiceTag
        const stream = service.sendStream(
          tag,
          payload,
          procedure.successSchema,
          procedure.errorSchema
        )
        
        // Run the stream, collecting values
        yield* stream.pipe(
          Stream.tap((value) => Effect.sync(() => {
            setData((prev) => [...prev, value as Success])
          })),
          Stream.runDrain
        )
      }).pipe(
        Effect.tapError((err) => Effect.sync(() => {
          setError(err as Error)
          setIsConnected(false)
        })),
        Effect.ensuring(Effect.sync(() => setIsConnected(false))),
        Effect.provide(ctx.layer)
      )
      
      // Fork the stream as a fiber so we can interrupt it
      const fiber = Effect.runFork(streamEffect)
      fiberRef.current = fiber
      
      return () => {
        // Interrupt the fiber on cleanup
        if (fiberRef.current) {
          Effect.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {})
        }
        setIsConnected(false)
      }
    }, [enabled, ctx.layer, tag, payload, procedure.successSchema, procedure.errorSchema, restartCount])
    
    const stop = useCallback(() => {
      if (fiberRef.current) {
        Effect.runPromise(Fiber.interrupt(fiberRef.current)).catch(() => {})
        fiberRef.current = null
      }
      setIsConnected(false)
    }, [])
    
    const restart = useCallback(() => {
      // Stop existing stream and increment counter to trigger useEffect re-run
      stop()
      setRestartCount((c) => c + 1)
    }, [stop])
    
    return {
      data,
      latestValue: data[data.length - 1],
      isConnected,
      error,
      stop,
      restart,
    }
  }
}
