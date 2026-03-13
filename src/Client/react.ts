/**
 * React Hooks for effect-trpc
 * 
 * Provides useQuery, useMutation, useStream hooks with automatic
 * cache invalidation via Reactivity.
 * 
 * @since 1.0.0
 * @module
 */

import * as React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Result from "@effect-atom/atom/Result"
import * as Transport from "../Transport/index.js"
import * as Procedure from "../Procedure/index.js"
import * as Router from "../Router/index.js"
import * as Reactivity from "../Reactivity/index.js"
import { 
  ClientServiceTag, 
  ClientServiceLive,
  QueryOptions,
  QueryResult,
  MutationOptions,
  MutationResult,
  StreamOptions,
  StreamResult,
} from "./index.js"

// =============================================================================
// React Context
// =============================================================================

interface ClientContextValue {
  readonly runtime: ManagedRuntime.ManagedRuntime<ClientServiceTag, never>
  readonly reactivity: Reactivity.ReactivityService
  readonly rootTag: string
}

const ClientContext = React.createContext<ClientContextValue | null>(null)

/**
 * Hook to access the client context
 * 
 * @internal
 */
export const useClientContext = (): ClientContextValue => {
  const ctx = React.useContext(ClientContext)
  if (!ctx) {
    throw new Error(
      "useClientContext must be used within an <api.Provider>. " +
      "Wrap your app with <api.Provider layer={Transport.http('/api')}>."
    )
  }
  return ctx
}

// =============================================================================
// Provider Factory
// =============================================================================

export interface ProviderProps {
  readonly layer: Layer.Layer<Transport.Transport>
  readonly children: React.ReactNode
}

/**
 * Create a Provider component for a router
 * 
 * @internal
 */
export const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  return function Provider({ layer, children }: ProviderProps) {
    // Create runtime and reactivity on mount
    const [contextValue] = useState<ClientContextValue>(() => {
      const fullLayer = ClientServiceLive.pipe(
        Layer.provideMerge(Reactivity.ReactivityLive),
        Layer.provide(layer)
      )
      const runtime = ManagedRuntime.make(fullLayer)
      const reactivity = Reactivity.make()
      
      return {
        runtime,
        reactivity,
        rootTag: router.tag,
      }
    })
    
    // Cleanup on unmount
    useEffect(() => {
      return () => {
        contextValue.runtime.dispose()
      }
    }, [contextValue])
    
    return React.createElement(
      ClientContext.Provider,
      { value: contextValue },
      children
    )
  }
}

// =============================================================================
// useQuery Hook
// =============================================================================

/**
 * Create a useQuery hook for a query procedure
 * 
 * @internal
 */
export const createUseQuery = <
  Payload,
  Success,
  Error
>(
  tag: string,
  procedure: Procedure.Query<any, any, any>
) => {
  const successSchema = procedure.successSchema
  const errorSchema = procedure.errorSchema
  const payloadSchema = procedure.payloadSchema
  const isVoidPayload = Schema.is(Schema.Void)(payloadSchema)
  
  // Return the hook function
  return function useQuery(
    payloadOrOptions?: Payload | QueryOptions,
    maybeOptions?: QueryOptions
  ): QueryResult<Success, Error> {
    const ctx = useClientContext()
    
    // Parse arguments
    const payload = isVoidPayload ? undefined : payloadOrOptions
    const options: QueryOptions = isVoidPayload 
      ? (payloadOrOptions as QueryOptions) ?? {}
      : maybeOptions ?? {}
    
    const { enabled = true, refetchInterval, staleTime } = options
    
    // State
    const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
    const [isLoading, setIsLoading] = useState(false)
    const mountedRef = useRef(true)
    const fetchIdRef = useRef(0)
    
    // Fetch function
    const fetchData = useCallback(async () => {
      if (!enabled) return
      
      const fetchId = ++fetchIdRef.current
      setIsLoading(true)
      setResult(Result.initial(true)) // waiting = true
      
      try {
        const effect = Effect.gen(function* () {
          const service = yield* ClientServiceTag
          return yield* service.send(tag, payload, successSchema, errorSchema)
        })
        
        const exit = await ctx.runtime.runPromiseExit(effect)
        
        // Check if this fetch is still relevant
        if (fetchId !== fetchIdRef.current || !mountedRef.current) return
        
        if (Exit.isSuccess(exit)) {
          setResult(Result.success<Success, Error>(exit.value as Success))
        } else {
          setResult(Result.failure<Success, Error>(exit.cause as any))
        }
      } catch (err) {
        if (fetchId !== fetchIdRef.current || !mountedRef.current) return
        setResult(Result.fail<Error, Success>(err as Error))
      } finally {
        if (fetchId === fetchIdRef.current && mountedRef.current) {
          setIsLoading(false)
        }
      }
    }, [enabled, payload, ctx.runtime])
    
    // Initial fetch
    useEffect(() => {
      fetchData()
    }, [fetchData])
    
    // Subscribe to reactivity for refetch
    useEffect(() => {
      const unsubscribe = ctx.reactivity.subscribe(tag, () => {
        fetchData()
      })
      return unsubscribe
    }, [tag, ctx.reactivity, fetchData])
    
    // Refetch interval
    useEffect(() => {
      if (!refetchInterval || !enabled) return
      
      const interval = setInterval(fetchData, refetchInterval)
      return () => clearInterval(interval)
    }, [refetchInterval, enabled, fetchData])
    
    // Cleanup
    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
      }
    }, [])
    
    // Derive state from result
    const isSuccess = Result.isSuccess(result)
    const isError = Result.isFailure(result)
    const data = isSuccess ? (result as any).value : undefined
    const error = isError ? (result as any).error : undefined
    
    return {
      result,
      isLoading,
      isError,
      isSuccess,
      data,
      error,
      refetch: fetchData,
    }
  }
}

// =============================================================================
// useMutation Hook
// =============================================================================

/**
 * Create a useMutation hook for a mutation procedure
 * 
 * @internal
 */
export const createUseMutation = <
  Payload,
  Success,
  Error
>(
  tag: string,
  procedure: Procedure.Mutation<any, any, any, any>
) => {
  const successSchema = procedure.successSchema
  const errorSchema = procedure.errorSchema
  const invalidatePaths = procedure.invalidates
  
  return function useMutation(
    options?: MutationOptions<Success, Error>
  ): MutationResult<Payload, Success, Error> {
    const ctx = useClientContext()
    const { onSuccess, onError, onSettled } = options ?? {}
    
    // State
    const [isLoading, setIsLoading] = useState(false)
    const [result, setResult] = useState<Result.Result<Success, Error>>(Result.initial())
    const mountedRef = useRef(true)
    
    // Mutate async
    const mutateAsync = useCallback(async (payload: Payload): Promise<Success> => {
      setIsLoading(true)
      setResult(Result.initial(true)) // waiting = true
      
      try {
        const effect = Effect.gen(function* () {
          const service = yield* ClientServiceTag
          const result = yield* service.send(tag, payload, successSchema, errorSchema)
          
          // Invalidate on success
          if (invalidatePaths.length > 0) {
            const tags = Reactivity.pathsToTags(ctx.rootTag, invalidatePaths)
            ctx.reactivity.invalidate(tags)
          }
          
          return result
        })
        
        const data = await ctx.runtime.runPromise(effect) as Success
        
        if (mountedRef.current) {
          setResult(Result.success<Success, Error>(data))
          setIsLoading(false)
          onSuccess?.(data)
          onSettled?.()
        }
        
        return data
      } catch (err) {
        if (mountedRef.current) {
          setResult(Result.fail<Error, Success>(err as Error))
          setIsLoading(false)
          onError?.(err as Error)
          onSettled?.()
        }
        throw err
      }
    }, [ctx.runtime, ctx.reactivity, ctx.rootTag, onSuccess, onError, onSettled])
    
    // Mutate (fire and forget)
    const mutate = useCallback((payload: Payload) => {
      mutateAsync(payload).catch(() => {
        // Error already handled via onError
      })
    }, [mutateAsync])
    
    // Reset function
    const reset = useCallback(() => {
      setResult(Result.initial())
      setIsLoading(false)
    }, [])
    
    // Cleanup
    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
      }
    }, [])
    
    // Derive state
    const isSuccess = Result.isSuccess(result)
    const isError = Result.isFailure(result)
    const data = isSuccess ? (result as any).value : undefined
    const error = isError ? (result as any).error : undefined
    
    return {
      result,
      mutate,
      mutateAsync,
      isLoading,
      isError,
      isSuccess,
      data,
      error,
      reset,
    }
  }
}

// =============================================================================
// useStream Hook
// =============================================================================

/**
 * Create a useStream hook for a stream procedure
 * 
 * @internal
 */
export const createUseStream = <
  Payload,
  Success,
  Error
>(
  tag: string,
  procedure: Procedure.Stream<any, any, any>
) => {
  const successSchema = procedure.successSchema
  const errorSchema = procedure.errorSchema
  const payloadSchema = procedure.payloadSchema
  const isVoidPayload = Schema.is(Schema.Void)(payloadSchema)
  
  return function useStream(
    payloadOrOptions?: Payload | StreamOptions,
    maybeOptions?: StreamOptions
  ): StreamResult<Success, Error> {
    const ctx = useClientContext()
    
    // Parse arguments
    const payload = isVoidPayload ? undefined : payloadOrOptions
    const options: StreamOptions = isVoidPayload
      ? (payloadOrOptions as StreamOptions) ?? {}
      : maybeOptions ?? {}
    
    const { enabled = true } = options
    
    // State
    const [items, setItems] = useState<Success[]>([])
    const [isStreaming, setIsStreaming] = useState(false)
    const [error, setError] = useState<Error | undefined>()
    const [isComplete, setIsComplete] = useState(false)
    const abortRef = useRef<(() => void) | null>(null)
    const mountedRef = useRef(true)
    
    // Start streaming
    useEffect(() => {
      if (!enabled) return
      
      setIsStreaming(true)
      setItems([])
      setError(undefined)
      setIsComplete(false)
      
      const effect = Effect.gen(function* () {
        const service = yield* ClientServiceTag
        const stream = service.sendStream(tag, payload, successSchema, errorSchema)
        
        yield* stream.pipe(
          Stream.tap((item) => Effect.sync(() => {
            if (mountedRef.current) {
              setItems((prev) => [...prev, item as Success])
            }
          })),
          Stream.runDrain
        )
      })
      
      // Run the stream
      ctx.runtime.runPromise(effect)
        .then(() => {
          if (mountedRef.current) {
            setIsStreaming(false)
            setIsComplete(true)
          }
        })
        .catch((err) => {
          if (mountedRef.current) {
            setIsStreaming(false)
            setError(err as Error)
          }
        })
      
      // Cleanup - note: we can't easily abort a running stream
      // This would need Fiber interrupt support
      return () => {
        abortRef.current?.()
      }
    }, [enabled, payload, ctx.runtime])
    
    // Cleanup
    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
      }
    }, [])
    
    return {
      data: items,
      latestValue: items[items.length - 1],
      isConnected: isStreaming,
      error,
      stop: () => abortRef.current?.(),
      restart: () => {
        // Would need to re-trigger the effect
        // For now, just clear state
        setItems([])
        setError(undefined)
        setIsComplete(false)
      },
    }
  }
}
