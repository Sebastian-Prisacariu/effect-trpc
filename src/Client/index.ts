/**
 * Client - Create typed API clients for React
 * 
 * @since 1.0.0
 * @module
 */

import { Effect, Layer, Scope, Runtime, FiberRef, Cause } from "effect"
import type * as Router from "../Router/index.js"
import type * as Procedure from "../Procedure/index.js"
import type * as ResultModule from "../Result/index.js"
import { Transport, type TransportRequest, type TransportResponse, TransportError } from "../Transport/index.js"
import { makeHooks } from "./internal/hooks.js"
import { makeProvider } from "./internal/provider.js"

// Re-export Result
export * as Result from "../Result/index.js"

// =============================================================================
// Client Types
// =============================================================================

/**
 * Typed client mapped from router definition
 * 
 * @since 1.0.0
 * @category models
 */
export type Client<D extends Router.Definition> = ClientMethods<Router.FlattenDefinition<D>>

type ClientMethods<D> = {
  readonly [K in keyof D]: D[K] extends Procedure.QueryDef<infer P, infer S, infer E, any>
    ? QueryClient<P, S, E>
    : D[K] extends Procedure.MutationDef<infer P, infer S, infer E, any>
      ? MutationClient<P, S, E>
      : D[K] extends Procedure.StreamDef<infer P, infer S, infer E, any>
        ? StreamClient<P, S, E>
        : D[K] extends object
          ? ClientMethods<D[K]>
          : never
}

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryClient<Payload, Success, Error> {
  readonly useQuery: UseQueryHook<Payload, Success, Error>
  readonly useSuspenseQuery: UseSuspenseQueryHook<Payload, Success>
  readonly useRefresh: () => () => void
  readonly run: Effect.Effect<Success, Error | TransportError, Transport>
  readonly runPromise: (payload: Payload) => Promise<Success>
  readonly prefetch: (payload: Payload) => Effect.Effect<void, never, Transport>
  readonly prefetchPromise: (payload: Payload) => Promise<ResultModule.Result<Success, Error>>
  readonly key: (payload: Payload) => string
}

export interface UseQueryHook<Payload, Success, Error> {
  (payload?: Payload, options?: QueryHookOptions): QueryHookResult<Success, Error>
}

export interface UseSuspenseQueryHook<Payload, Success> {
  (payload?: Payload): Success
}

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryHookOptions {
  readonly enabled?: boolean
  readonly staleTime?: number
  readonly refetchOnMount?: boolean
  readonly refetchOnWindowFocus?: boolean
  readonly refetchInterval?: number
}

/**
 * @since 1.0.0
 * @category models
 */
export interface QueryHookResult<Success, Error> {
  readonly result: ResultModule.Result<Success, Error>
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly refetch: () => void
  readonly refresh: () => void
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationClient<Payload, Success, Error> {
  readonly useMutation: UseMutationHook<Payload, Success, Error>
  readonly run: (payload: Payload) => Effect.Effect<Success, Error | TransportError, Transport>
  readonly runPromise: (payload: Payload) => Promise<Success>
}

export interface UseMutationHook<Payload, Success, Error> {
  (options?: MutationHookOptions<Payload, Success, Error>): MutationHookResult<Payload, Success, Error>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationHookOptions<Payload, Success, Error> {
  readonly onSuccess?: (data: Success, payload: Payload) => void
  readonly onError?: (error: Error, payload: Payload) => void
  readonly onSettled?: () => void
}

/**
 * @since 1.0.0
 * @category models
 */
export interface MutationHookResult<Payload, Success, Error> {
  readonly mutate: (payload: Payload) => void
  readonly mutateAsync: (payload: Payload) => Promise<Success>
  readonly result: ResultModule.Result<Success, Error>
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly isLoading: boolean
  readonly isSuccess: boolean
  readonly isError: boolean
  readonly reset: () => void
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamClient<Payload, Success, Error> {
  readonly useStream: UseStreamHook<Payload, Success, Error>
  readonly run: (payload: Payload) => Effect.Effect<AsyncIterable<Success>, Error | TransportError, Transport | Scope.Scope>
}

export interface UseStreamHook<Payload, Success, Error> {
  (payload?: Payload, options?: StreamHookOptions): StreamHookResult<Success, Error>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamHookOptions {
  readonly enabled?: boolean
}

/**
 * @since 1.0.0
 * @category models
 */
export interface StreamHookResult<Success, Error> {
  readonly chunks: ReadonlyArray<Success>
  readonly latest: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
}

// =============================================================================
// Client Instance
// =============================================================================

/**
 * Full client instance with Provider
 * 
 * @since 1.0.0
 * @category models
 */
export interface ClientInstance<D extends Router.Definition> extends Client<D> {
  readonly Provider: ProviderComponent
  readonly invalidate: (keys: ReadonlyArray<string>) => void
}

export interface ProviderComponent {
  (props: ProviderProps): any
}

/**
 * @since 1.0.0
 * @category models
 */
export interface ProviderProps {
  readonly children: any
  readonly layer: Layer.Layer<Transport, never, never>
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a typed client for React
 * 
 * @since 1.0.0
 * @category constructors
 */
export const make = <D extends Router.Definition>(
  options?: ClientOptions
): ClientInstance<D> => {
  // Create shared state
  const state = createClientState()
  
  // Create provider component
  const Provider = makeProvider(state)
  
  // Create client proxy that generates hooks/methods for any path
  const client = createClientProxy<D>(state, [])
  
  return Object.assign(client, {
    Provider,
    invalidate: (keys: ReadonlyArray<string>) => {
      state.invalidate(keys)
    },
  }) as ClientInstance<D>
}

// Alias
export { make as unsafeMake }

/**
 * @since 1.0.0
 * @category models
 */
export interface ClientOptions {
  readonly defaults?: {
    readonly staleTime?: number
    readonly refetchOnWindowFocus?: boolean
    readonly refetchOnReconnect?: boolean
  }
}

// =============================================================================
// Internal
// =============================================================================

interface ClientState {
  runtime: Runtime.Runtime<Transport> | null
  cache: Map<string, CacheEntry<any, any>>
  listeners: Map<string, Set<() => void>>
  invalidate: (keys: ReadonlyArray<string>) => void
  subscribe: (key: string, listener: () => void) => () => void
  getSnapshot: <A, E>(key: string) => ResultModule.Result<A, E>
  fetch: <A, E>(key: string, path: string, payload: unknown) => Effect.Effect<A, E | TransportError, Transport>
}

interface CacheEntry<A, E> {
  result: ResultModule.Result<A, E>
  timestamp: number
}

const createClientState = (): ClientState => {
  const cache = new Map<string, CacheEntry<any, any>>()
  const listeners = new Map<string, Set<() => void>>()
  let runtime: Runtime.Runtime<Transport> | null = null

  const notify = (key: string) => {
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.forEach((l) => l())
    }
  }

  const state: ClientState = {
    get runtime() { return runtime },
    set runtime(r) { runtime = r },
    cache,
    listeners,
    
    invalidate: (keys) => {
      for (const pattern of keys) {
        for (const key of cache.keys()) {
          if (key.startsWith(pattern) || key === pattern) {
            cache.delete(key)
            notify(key)
          }
        }
      }
    },
    
    subscribe: (key, listener) => {
      let keyListeners = listeners.get(key)
      if (!keyListeners) {
        keyListeners = new Set()
        listeners.set(key, keyListeners)
      }
      keyListeners.add(listener)
      
      return () => {
        keyListeners!.delete(listener)
        if (keyListeners!.size === 0) {
          listeners.delete(key)
        }
      }
    },
    
    getSnapshot: <A, E>(key: string): ResultModule.Result<A, E> => {
      const entry = cache.get(key)
      if (entry) {
        return entry.result
      }
      return { _tag: "Initial" }
    },
    
    fetch: <A, E>(key: string, path: string, payload: unknown) =>
      Effect.gen(function* () {
        const transport = yield* Transport
        
        // Set loading state
        const current = cache.get(key)
        cache.set(key, {
          result: { _tag: "Waiting", previous: current?.result },
          timestamp: Date.now(),
        })
        notify(key)
        
        // Send request
        const requestId = `${key}-${Date.now()}`
        const request: TransportRequest = {
          id: requestId,
          path,
          payload,
        }
        
        const response = yield* Effect.either(
          Effect.runPromise(
            transport.send(request).pipe(
              Effect.map((stream) => {
                // For now, just get first response
                // TODO: proper stream handling
              })
            )
          )
        )
        
        // For simplicity, let's use a direct approach
        const result = yield* sendAndReceive(transport, request)
        
        if (result._tag === "Success") {
          cache.set(key, {
            result: { _tag: "Success", value: result.value as A },
            timestamp: Date.now(),
          })
          notify(key)
          return result.value as A
        } else {
          const error = result.error as E
          cache.set(key, {
            result: { _tag: "Failure", error },
            timestamp: Date.now(),
          })
          notify(key)
          return yield* Effect.fail(error)
        }
      }),
  }

  return state
}

const sendAndReceive = (
  transport: Transport["Type"],
  request: TransportRequest
): Effect.Effect<TransportResponse, TransportError> =>
  Effect.async((resume) => {
    // Get first response from stream
    let resolved = false
    
    Effect.runPromise(
      transport.send(request).pipe(
        Effect.tap((response) => {
          if (!resolved) {
            resolved = true
            resume(Effect.succeed(response))
          }
          return Effect.void
        }),
        Effect.catchAll((error) => {
          if (!resolved) {
            resolved = true
            resume(Effect.fail(error))
          }
          return Effect.void
        })
      )
    )
  })

const createClientProxy = <D extends Router.Definition>(
  state: ClientState,
  pathParts: string[]
): Client<D> => {
  return new Proxy({} as Client<D>, {
    get(_, prop: string) {
      const newPath = [...pathParts, prop]
      const path = newPath.join(".")
      
      // Check if this is a method
      if (prop === "useQuery" || prop === "useMutation" || prop === "useStream" ||
          prop === "useSuspenseQuery" || prop === "useRefresh" ||
          prop === "run" || prop === "runPromise" || prop === "prefetch" || 
          prop === "prefetchPromise" || prop === "key" ||
          prop === "mutate" || prop === "mutateAsync" || prop === "reset") {
        // Return the appropriate hook/method
        return createProcedureClient(state, pathParts.join("."), prop)
      }
      
      // Otherwise, continue proxy chain
      return createClientProxy(state, newPath)
    },
  })
}

const createProcedureClient = (
  state: ClientState,
  path: string,
  method: string
): any => {
  const getKey = (payload: unknown) => `${path}:${JSON.stringify(payload ?? {})}`
  
  switch (method) {
    case "useQuery":
      return makeHooks(state, path).useQuery
      
    case "useMutation":
      return makeHooks(state, path).useMutation
      
    case "useStream":
      return makeHooks(state, path).useStream
      
    case "useSuspenseQuery":
      return makeHooks(state, path).useSuspenseQuery
      
    case "useRefresh":
      return () => () => {
        // Manual refresh implementation
      }
      
    case "run":
      return (payload: unknown) => state.fetch(getKey(payload), path, payload)
      
    case "runPromise":
      return async (payload: unknown) => {
        if (!state.runtime) {
          throw new Error("Client not initialized. Did you wrap your app in <api.Provider>?")
        }
        return Runtime.runPromise(state.runtime)(
          state.fetch(getKey(payload), path, payload)
        )
      }
      
    case "prefetch":
      return (payload: unknown) =>
        state.fetch(getKey(payload), path, payload).pipe(Effect.ignore)
      
    case "prefetchPromise":
      return async (payload: unknown) => {
        if (!state.runtime) {
          throw new Error("Client not initialized")
        }
        try {
          const value = await Runtime.runPromise(state.runtime)(
            state.fetch(getKey(payload), path, payload)
          )
          return { _tag: "Success" as const, value }
        } catch (error) {
          return { _tag: "Failure" as const, error }
        }
      }
      
    case "key":
      return (payload: unknown) => getKey(payload)
      
    default:
      return () => {
        throw new Error(`Unknown method: ${method}`)
      }
  }
}
