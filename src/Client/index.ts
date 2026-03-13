/**
 * Client - Type-safe RPC client with React hooks and imperative API
 * 
 * @since 1.0.0
 * @module
 * 
 * @example
 * ```ts
 * import { Client, Transport } from "effect-trpc"
 * 
 * const api = Client.make(appRouter)
 * 
 * // React: hooks get runtime from Provider
 * function App() {
 *   return (
 *     <api.Provider layer={Transport.http("/api")}>
 *       <UserList />
 *     </api.Provider>
 *   )
 * }
 * 
 * function UserList() {
 *   const query = api.users.list.useQuery()
 *   // ...
 * }
 * 
 * // Vanilla: provide layer to get bound client
 * const vanillaApi = api.provide(Transport.http("/api"))
 * await vanillaApi.users.list.runPromise()
 * ```
 */

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import type * as Scope from "effect/Scope"
import * as Router from "../Router/index.js"
import * as Procedure from "../Procedure/index.js"
import * as Transport from "../Transport/index.js"
import * as Reactivity from "../Reactivity/index.js"

// =============================================================================
// Type IDs
// =============================================================================

/** @internal */
export const ClientTypeId: unique symbol = Symbol.for("effect-trpc/Client")

/** @internal */
export type ClientTypeId = typeof ClientTypeId

// =============================================================================
// ClientService (internal Effect service)
// =============================================================================

/**
 * Internal service that handles RPC calls
 * 
 * @since 1.0.0
 * @category services
 */
export interface ClientService {
  readonly send: <S, E>(
    tag: string,
    payload: unknown,
    successSchema: Schema.Schema<S, unknown>,
    errorSchema: Schema.Schema<E, unknown>
  ) => Effect.Effect<S, E | Transport.TransportError>
  
  readonly sendStream: <S, E>(
    tag: string,
    payload: unknown,
    successSchema: Schema.Schema<S, unknown>,
    errorSchema: Schema.Schema<E, unknown>
  ) => Stream.Stream<S, E | Transport.TransportError>
  
  readonly invalidate: (tags: readonly string[]) => Effect.Effect<void>
}

/**
 * ClientService tag for dependency injection
 * 
 * @since 1.0.0
 * @category services
 */
export class ClientServiceTag extends Context.Tag("@effect-trpc/ClientService")<
  ClientServiceTag,
  ClientService
>() {}

/**
 * Create ClientService layer from Transport
 * 
 * @since 1.0.0
 * @category layers
 */
export const ClientServiceLive: Layer.Layer<ClientServiceTag, never, Transport.Transport> = 
  Layer.effect(
    ClientServiceTag,
    Effect.gen(function* () {
      const transport = yield* Transport.Transport
      
      return {
        send: (tag, payload, successSchema, errorSchema) =>
          Effect.gen(function* () {
            const request = new Transport.TransportRequest({
              id: Transport.generateRequestId(),
              tag,
              payload,
            })
            
            const response = yield* transport.send(request)
            
            if (Schema.is(Transport.Success)(response)) {
              return yield* Schema.decodeUnknown(successSchema)(response.value).pipe(
                Effect.mapError((e) => new Transport.TransportError({
                  reason: "Protocol",
                  message: "Failed to decode success response",
                  cause: e,
                }))
              )
            } else {
              const error = yield* Schema.decodeUnknown(errorSchema)(response.error).pipe(
                Effect.mapError((e) => new Transport.TransportError({
                  reason: "Protocol",
                  message: "Failed to decode error response",
                  cause: e,
                }))
              )
              return yield* Effect.fail(error)
            }
          }),
        
        sendStream: <S, E>(
          tag: string,
          payload: unknown,
          successSchema: Schema.Schema<S, unknown>,
          errorSchema: Schema.Schema<E, unknown>
        ): Stream.Stream<S, E | Transport.TransportError> => {
          const request = new Transport.TransportRequest({
            id: Transport.generateRequestId(),
            tag,
            payload,
          })
          
          return transport.sendStream(request).pipe(
            // Take until StreamEnd
            Stream.takeWhile((response) => !Schema.is(Transport.StreamEnd)(response)),
            // Map each response
            Stream.mapEffect((response): Effect.Effect<S, E | Transport.TransportError> => {
              if (Schema.is(Transport.StreamChunk)(response)) {
                return Schema.decodeUnknown(successSchema)(response.chunk).pipe(
                  Effect.mapError((e) => new Transport.TransportError({
                    reason: "Protocol",
                    message: "Failed to decode stream chunk",
                    cause: e,
                  }))
                )
              } else if (Schema.is(Transport.Failure)(response)) {
                return Schema.decodeUnknown(errorSchema)(response.error).pipe(
                  Effect.flatMap((err) => Effect.fail(err as E)),
                  Effect.mapError((e) => 
                    e instanceof Transport.TransportError 
                      ? e 
                      : new Transport.TransportError({
                          reason: "Protocol",
                          message: "Failed to decode stream error",
                          cause: e,
                        })
                  )
                ) as Effect.Effect<S, E | Transport.TransportError>
              }
              // Should not reach here
              return Effect.fail(new Transport.TransportError({
                reason: "Protocol",
                message: "Unexpected stream response type",
              }))
            })
          )
        },
        
        invalidate: (paths) =>
          Effect.gen(function* () {
            const pathReactivity = yield* Effect.serviceOption(Reactivity.PathReactivity)
            if (pathReactivity._tag === "Some") {
              yield* pathReactivity.value.invalidate(paths)
            }
          }),
      }
    })
  )



// =============================================================================
// Client Types
// =============================================================================

/**
 * A typed RPC client
 * 
 * @since 1.0.0
 * @category models
 */
export interface Client<R extends Router.Router<Router.Definition>> {
  readonly [ClientTypeId]: ClientTypeId
  
  /**
   * React Provider component that supplies the runtime
   */
  readonly Provider: React.FC<ProviderProps>
  
  /**
   * Invalidate queries by path (strict typing)
   */
  readonly invalidate: (paths: readonly Router.Paths<Router.DefinitionOf<R>>[]) => void
  
  /**
   * Create a bound client with runtime for vanilla usage
   */
  readonly provide: (layer: Layer.Layer<Transport.Transport>) => BoundClient<R>
}

/**
 * Client with runtime bound (for vanilla/imperative usage)
 * 
 * @since 1.0.0
 * @category models
 */
export type BoundClient<R extends Router.Router<Router.Definition>> = 
  & ClientProxy<Router.DefinitionOf<R>>
  & {
    readonly [ClientTypeId]: ClientTypeId
    
    /**
     * Invalidate queries by path
     */
    readonly invalidate: (paths: readonly Router.Paths<Router.DefinitionOf<R>>[]) => void
    
    /**
     * Shutdown the runtime
     */
    readonly shutdown: () => Promise<void>
  }

/**
 * Provider props
 * 
 * @since 1.0.0
 * @category models
 */
export interface ProviderProps {
  readonly layer: Layer.Layer<Transport.Transport>
  readonly children: React.ReactNode
}

/**
 * Recursive proxy type that mirrors the router structure
 * 
 * @since 1.0.0
 * @category models
 */
export type ClientProxy<D extends Router.Definition> = {
  readonly [K in keyof D]: D[K] extends Procedure.Any
    ? ProcedureClient<D[K]>
    : D[K] extends Router.Definition
      ? ClientProxy<D[K]>
      : never
}

/**
 * Client for a single procedure
 * 
 * @since 1.0.0
 * @category models
 */
export type ProcedureClient<P extends Procedure.Any> = 
  P extends Procedure.Query<infer Payload, infer Success, infer Error>
    ? QueryClient<
        Schema.Schema.Type<Payload>,
        Schema.Schema.Type<Success>,
        Schema.Schema.Type<Error>
      >
    : P extends Procedure.Mutation<infer Payload, infer Success, infer Error, any>
      ? MutationClient<
          Schema.Schema.Type<Payload>,
          Schema.Schema.Type<Success>,
          Schema.Schema.Type<Error>
        >
      : P extends Procedure.Stream<infer Payload, infer Success, infer Error>
        ? StreamClient<
            Schema.Schema.Type<Payload>,
            Schema.Schema.Type<Success>,
            Schema.Schema.Type<Error>
          >
        : never

/**
 * Query procedure client
 * 
 * @since 1.0.0
 * @category models
 */
export interface QueryClient<Payload, Success, Error> {
  /**
   * React hook for queries
   */
  readonly useQuery: UseQueryFn<Payload, Success, Error>
  
  /**
   * Effect that executes the query (requires ClientService)
   */
  readonly run: Payload extends void
    ? Effect.Effect<Success, Error | Transport.TransportError, ClientServiceTag>
    : (payload: Payload) => Effect.Effect<Success, Error | Transport.TransportError, ClientServiceTag>
  
  /**
   * Promise that executes the query (requires bound runtime)
   */
  readonly runPromise: Payload extends void
    ? () => Promise<Success>
    : (payload: Payload) => Promise<Success>
  
  /**
   * Prefetch the query
   */
  readonly prefetch: Payload extends void
    ? Effect.Effect<void, Error | Transport.TransportError, ClientServiceTag>
    : (payload: Payload) => Effect.Effect<void, Error | Transport.TransportError, ClientServiceTag>
}

/**
 * Mutation procedure client
 * 
 * @since 1.0.0
 * @category models
 */
export interface MutationClient<Payload, Success, Error> {
  /**
   * React hook for mutations
   */
  readonly useMutation: UseMutationFn<Payload, Success, Error>
  
  /**
   * Effect that executes the mutation
   */
  readonly run: (payload: Payload) => Effect.Effect<Success, Error | Transport.TransportError, ClientServiceTag>
  
  /**
   * Promise that executes the mutation (requires bound runtime)
   */
  readonly runPromise: (payload: Payload) => Promise<Success>
}

/**
 * Stream procedure client
 * 
 * @since 1.0.0
 * @category models
 */
export interface StreamClient<Payload, Success, Error> {
  /**
   * React hook for streams
   */
  readonly useStream: UseStreamFn<Payload, Success, Error>
  
  /**
   * Stream that yields values
   */
  readonly stream: Payload extends void
    ? Stream.Stream<Success, Error | Transport.TransportError, ClientServiceTag>
    : (payload: Payload) => Stream.Stream<Success, Error | Transport.TransportError, ClientServiceTag>
}

// =============================================================================
// Hook Types (React)
// =============================================================================

/**
 * useQuery function signature
 * 
 * @since 1.0.0
 * @category hooks
 */
export type UseQueryFn<Payload, Success, Error> = Payload extends void
  ? (options?: QueryOptions) => QueryResult<Success, Error>
  : (payload: Payload, options?: QueryOptions) => QueryResult<Success, Error>

/**
 * Query options
 * 
 * @since 1.0.0
 * @category hooks
 */
export interface QueryOptions {
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly staleTime?: number
}

/**
 * Query result (uses Result from effect-atom)
 * 
 * @since 1.0.0
 * @category hooks
 */
export interface QueryResult<Success, Error> {
  readonly result: import("@effect-atom/atom/Result").Result<Success, Error>
  readonly isLoading: boolean
  readonly isError: boolean
  readonly isSuccess: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly refetch: () => void
}

/**
 * useMutation function signature
 * 
 * @since 1.0.0
 * @category hooks
 */
export type UseMutationFn<Payload, Success, Error> = 
  (options?: MutationOptions<Success, Error>) => MutationResult<Payload, Success, Error>

/**
 * Mutation options
 * 
 * @since 1.0.0
 * @category hooks
 */
export interface MutationOptions<Success, Error> {
  readonly onSuccess?: (data: Success) => void
  readonly onError?: (error: Error) => void
  readonly onSettled?: () => void
}

/**
 * Mutation result
 * 
 * @since 1.0.0
 * @category hooks
 */
export interface MutationResult<Payload, Success, Error> {
  readonly result: import("@effect-atom/atom/Result").Result<Success, Error>
  readonly mutate: (payload: Payload) => void
  readonly mutateAsync: (payload: Payload) => Promise<Success>
  readonly isLoading: boolean
  readonly isError: boolean
  readonly isSuccess: boolean
  readonly data: Success | undefined
  readonly error: Error | undefined
  readonly reset: () => void
}

/**
 * useStream function signature
 * 
 * @since 1.0.0
 * @category hooks
 */
export type UseStreamFn<Payload, Success, Error> = Payload extends void
  ? (options?: StreamOptions) => StreamResult<Success, Error>
  : (payload: Payload, options?: StreamOptions) => StreamResult<Success, Error>

/**
 * Stream options
 * 
 * @since 1.0.0
 * @category hooks
 */
export interface StreamOptions {
  readonly enabled?: boolean
}

/**
 * Stream result
 * 
 * @since 1.0.0
 * @category hooks
 */
export interface StreamResult<Success, Error> {
  readonly data: readonly Success[]
  readonly latestValue: Success | undefined
  readonly isConnected: boolean
  readonly error: Error | undefined
  readonly stop: () => void
  readonly restart: () => void
}

// =============================================================================
// React Types (imported dynamically)
// =============================================================================

// React types for Node.js compatibility (React is optional peer dep)
declare namespace React {
  interface FC<P = {}> {
    (props: P): React.ReactElement | null
  }
  type ReactNode = any
  type ReactElement = any
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a typed RPC client from a router
 * 
 * @since 1.0.0
 * @category constructors
 * @example
 * ```ts
 * import { Client, Router, Procedure } from "effect-trpc"
 * 
 * const appRouter = Router.make("@api", {
 *   users: {
 *     list: Procedure.query({ success: Schema.Array(User) }),
 *   },
 * })
 * 
 * const api = Client.make(appRouter)
 * 
 * // React usage
 * <api.Provider layer={Transport.http("/api")}>
 *   <App />
 * </api.Provider>
 * 
 * // Vanilla usage
 * const vanillaApi = api.provide(Transport.http("/api"))
 * await vanillaApi.users.list.runPromise()
 * ```
 */
export const make = <D extends Router.Definition>(
  router: Router.Router<D>
): Client<Router.Router<D>> & ClientProxy<D> => {
  const rootTag = router.tag
  
  // Build the proxy structure using Record.map
  const buildProxy = <Def extends Router.Definition>(
    def: Def,
    pathParts: readonly string[]
  ): ClientProxy<Def> =>
    Record.map(def, (value, key) => {
      const newPath = [...pathParts, key]
      const tag = [rootTag, ...newPath].join("/")
      
      if (Procedure.isProcedure(value)) {
        return createProcedureClient(tag, value, null)
      }
      return buildProxy(value as Router.Definition, newPath)
    }) as ClientProxy<Def>
  
  const proxy = buildProxy(router.definition, [])
  
  // Create the client object
  const client = {
    [ClientTypeId]: ClientTypeId,
    
    Provider: createProvider(router),
    
    invalidate: (paths: readonly string[]) => {
      // Get tags from paths
      const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
      // Note: This only works if a ReactivityService is available globally
      // For proper usage, use the BoundClient's invalidate method
      console.warn("invalidate() on unbound client requires ReactivityService in scope. Use api.provide(layer) first.")
    },
    
    provide: (layer: Layer.Layer<Transport.Transport>): BoundClient<Router.Router<D>> => {
      const fullLayer = ClientServiceLive.pipe(Layer.provide(layer))
      const runtime = ManagedRuntime.make(fullLayer)
      
      const boundProxy = buildBoundProxy(router.definition, [], rootTag, runtime)
      
      return {
        [ClientTypeId]: ClientTypeId,
        ...boundProxy,
        invalidate: (paths: readonly string[]) => {
          const tags = paths.flatMap((path) => Router.tagsToInvalidate(router, path))
          runtime.runPromise(
            Effect.gen(function* () {
              const service = yield* ClientServiceTag
              yield* service.invalidate(tags)
            })
          )
        },
        shutdown: () => runtime.dispose(),
      } as BoundClient<Router.Router<D>>
    },
    
    ...proxy,
  }
  
  return client as Client<Router.Router<D>> & ClientProxy<D>
}

// =============================================================================
// Internal Helpers
// =============================================================================

const createProcedureClient = <P extends Procedure.Any>(
  tag: string,
  procedure: P,
  runtime: ManagedRuntime.ManagedRuntime<ClientServiceTag, never> | null
): ProcedureClient<P> => {
  const payloadSchema = procedure.payloadSchema
  const successSchema = procedure.successSchema
  const errorSchema = procedure.errorSchema
  
  const createRunEffect = (payload: unknown) =>
    Effect.gen(function* () {
      const service = yield* ClientServiceTag
      return yield* service.send(tag, payload, successSchema, errorSchema)
    })
  
  const createStreamEffect = (payload: unknown) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const service = yield* ClientServiceTag
        return service.sendStream(tag, payload, successSchema, errorSchema)
      })
    )
  
  if (Procedure.isQuery(procedure)) {
    return {
      useQuery: createUseQuery(tag, procedure),
      run: Schema.is(Schema.Void)(payloadSchema)
        ? createRunEffect(undefined)
        : (payload: unknown) => createRunEffect(payload),
      runPromise: runtime
        ? (payload?: unknown) => runtime.runPromise(createRunEffect(payload))
        : () => { throw new Error("runPromise requires a bound runtime. Use api.provide(layer) first.") },
      prefetch: Schema.is(Schema.Void)(payloadSchema)
        ? createRunEffect(undefined).pipe(Effect.asVoid)
        : (payload: unknown) => createRunEffect(payload).pipe(Effect.asVoid),
    } as ProcedureClient<P>
  }
  
  if (Procedure.isMutation(procedure)) {
    const mutation = procedure as Procedure.Mutation<any, any, any, any>
    const invalidatePaths = mutation.invalidates
    
    // Extract root tag (e.g., "@api" from "@api/users/create")
    const rootTag = tag.split("/")[0]
    
    // Create mutation effect that also invalidates after success
    const createMutationEffect = (payload: unknown) =>
      Effect.gen(function* () {
        const service = yield* ClientServiceTag
        const result = yield* service.send(tag, payload, successSchema, errorSchema)
        
        // Invalidate on success
        // PathReactivity handles normalization internally ("users.list" → "users/list")
        if (invalidatePaths.length > 0) {
          yield* service.invalidate(invalidatePaths)
        }
        
        return result
      })
    
    return {
      useMutation: createUseMutation(tag, procedure),
      run: (payload: unknown) => createMutationEffect(payload),
      runPromise: runtime
        ? (payload: unknown) => runtime.runPromise(createMutationEffect(payload))
        : () => { throw new Error("runPromise requires a bound runtime. Use api.provide(layer) first.") },
    } as ProcedureClient<P>
  }
  
  if (Procedure.isStream(procedure)) {
    return {
      useStream: createUseStream(tag, procedure),
      stream: Schema.is(Schema.Void)(payloadSchema)
        ? createStreamEffect(undefined)
        : (payload: unknown) => createStreamEffect(payload),
    } as ProcedureClient<P>
  }
  
  throw new Error(`Unknown procedure type: ${(procedure as any)._tag}`)
}

const buildBoundProxy = <D extends Router.Definition>(
  def: D,
  pathParts: readonly string[],
  rootTag: string,
  runtime: ManagedRuntime.ManagedRuntime<ClientServiceTag, never>
): ClientProxy<D> =>
  Record.map(def, (value, key) => {
    const newPath = [...pathParts, key]
    const tag = [rootTag, ...newPath].join("/")
    
    if (Procedure.isProcedure(value)) {
      return createProcedureClient(tag, value, runtime)
    }
    return buildBoundProxy(value as Router.Definition, newPath, rootTag, runtime)
  }) as ClientProxy<D>

// =============================================================================
// React Hooks (imported from react.ts)
// =============================================================================

// Import React hooks - these will throw helpful errors if React isn't available
import {
  createProvider as createProviderImpl,
  createUseQuery as createUseQueryImpl,
  createUseMutation as createUseMutationImpl,
  createUseStream as createUseStreamImpl,
} from "./react.js"

const createProvider = <D extends Router.Definition>(
  router: Router.Router<D>
): React.FC<ProviderProps> => {
  try {
    return createProviderImpl(router)
  } catch {
    // React not available - return stub
    return ({ children }) => children as any
  }
}

const createUseQuery = <P extends Procedure.Query<any, any, any>>(
  tag: string,
  procedure: P
): UseQueryFn<any, any, any> => {
  try {
    return createUseQueryImpl(tag, procedure) as UseQueryFn<any, any, any>
  } catch {
    return (() => {
      throw new Error("useQuery requires React. Use inside a component wrapped by <api.Provider>")
    }) as any
  }
}

const createUseMutation = <P extends Procedure.Mutation<any, any, any, any>>(
  tag: string,
  procedure: P
): UseMutationFn<any, any, any> => {
  try {
    return createUseMutationImpl(tag, procedure) as UseMutationFn<any, any, any>
  } catch {
    return (() => {
      throw new Error("useMutation requires React. Use inside a component wrapped by <api.Provider>")
    }) as any
  }
}

const createUseStream = <P extends Procedure.Stream<any, any, any>>(
  tag: string,
  procedure: P
): UseStreamFn<any, any, any> => {
  try {
    return createUseStreamImpl(tag, procedure) as UseStreamFn<any, any, any>
  } catch {
    return (() => {
      throw new Error("useStream requires React. Use inside a component wrapped by <api.Provider>")
    }) as any
  }
}

// =============================================================================
// Re-exports
// =============================================================================

/**
 * Re-export Router.Definition for convenience
 * 
 * @since 1.0.0
 * @category type-level
 */
export type { Definition } from "../Router/index.js"
