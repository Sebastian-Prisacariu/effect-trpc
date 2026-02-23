/**
 * @module effect-trpc/react/create-client
 *
 * Factory for creating typed TRPC React clients.
 * Uses Effect and @effect/platform throughout.
 *
 * **IMPORTANT**: This module uses @effect-atom/atom for state management.
 * See DECISION-007 for the atom hierarchy architecture.
 */

import * as React from "react"

import { useEvent } from "./internal/hooks.js"

import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
import * as Stream from "effect/Stream"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as Layer from "effect/Layer"
import type * as HttpClient from "@effect/platform/HttpClient"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as AtomResult from "@effect-atom/atom/Result"
import {
  useAtomValue,
  useAtomSet,
  useAtomMount,
} from "@effect-atom/atom-react"
import type { Router, RouterRecord, RouterEntry, AnyRouter, AnyProceduresGroup } from "../core/router.js"
import type { ProceduresGroup, ProcedureRecord } from "../core/procedures.js"
import type { ProcedureDefinition } from "../core/procedure.js"
import {
  type UseSubscriptionOptions,
  type UseSubscriptionReturn,
  useSubscription,
} from "./subscription.js"
import {
  createRpcEffect,
  createStreamEffect,
  extractTextFromPart,
  type TracingConfig,
} from "./internal/rpc.js"
import {
  RegistryProvider,
  useRegistry,
  queryAtomFamily,
  callerAtomFamily,
  streamAtomFamily,
  chatAtomFamily,
  generateQueryKey,
  generateCallerKey,
  registerQueryKey,
  invalidateQueryByKey,
  invalidateQueriesByPrefix,
  invalidateAllQueries,
  getQueryData as _getQueryDataFromAtom,
  setQueryData as _setQueryDataToAtom,
  createAtomCacheUtils,
  type AtomCacheUtils,
  type QueryAtomState,
  type MutationCallerState,
  type StreamAtomState as _StreamAtomState,
  type ChatAtomState as _ChatAtomState,
  initialQueryState as _initialQueryState,
  initialCallerState,
  initialStreamState as _initialStreamState,
  initialChatState,
} from "./atoms.js"

import { Result, type QueryResult, type MutationResult } from "./result.js"

// ─────────────────────────────────────────────────────────────────────────────
// Hook Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for useQuery hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseQueryOptions<A> {
  readonly initialData?: A
  readonly enabled?: boolean
  readonly refetchInterval?: number
  readonly staleTime?: number
  readonly cacheTime?: number
}

/**
 * Return type for useQuery hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseQueryReturn<A, E> extends QueryResult<A, E> {
  readonly refetch: () => void
}

/**
 * Options for useSuspenseQuery hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseSuspenseQueryOptions<A> {
  readonly initialData?: A
  readonly refetchInterval?: number
  readonly staleTime?: number
  readonly cacheTime?: number
}

/**
 * Return type for useSuspenseQuery hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseSuspenseQueryReturn<A, E> extends Omit<QueryResult<A, E>, "data"> {
  readonly data: A
  readonly refetch: () => void
}

/**
 * Configuration for optimistic updates in mutations.
 * Allows updating the cache before the mutation completes,
 * with rollback support on error.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface OptimisticUpdateConfig<I, Ctx = unknown> {
  /**
   * Called before the mutation executes.
   * Use this to optimistically update the cache.
   * 
   * @param input - The mutation input
   * @param cache - Cache utilities for reading/writing query data
   * @returns Context that will be passed to onSuccess, onError, and onSettled.
   *          Typically used to store the previous state for rollback.
   * 
   * @example
   * ```ts
   * onMutate: (input, cache) => {
   *   // Save previous state for rollback
   *   const previousPosts = cache.getQueryData<Post[]>("posts.list", {})
   *   
   *   // Optimistically add the new post
   *   cache.setQueryData("posts.list", {}, (old) => [...(old ?? []), { 
   *     id: 'temp-id', 
   *     title: input.title 
   *   }])
   *   
   *   // Return context for rollback
   *   return { previousPosts }
   * }
   * ```
   */
  readonly onMutate?: (input: I, cache: AtomCacheUtils) => Ctx | Promise<Ctx>

  /**
   * Called when the mutation succeeds.
   * Use this to update the cache with the actual server response.
   * 
   * @param result - The mutation result from the server
   * @param input - The mutation input
   * @param cache - Cache utilities for reading/writing query data
   * @param context - The context returned from onMutate
   */
  readonly onSuccess?: (
    result: unknown,
    input: I,
    cache: AtomCacheUtils,
    context: Ctx,
  ) => void | Promise<void>

  /**
   * Called when the mutation fails.
   * Use this to rollback optimistic changes.
   * 
   * @param error - The error that occurred
   * @param input - The mutation input
   * @param cache - Cache utilities for reading/writing query data
   * @param context - The context returned from onMutate
   * 
   * @example
   * ```ts
   * onError: (error, input, cache, context) => {
   *   // Rollback to previous state
   *   if (context.previousPosts) {
   *     cache.setQueryData("posts.list", {}, context.previousPosts)
   *   }
   * }
   * ```
   */
  readonly onError?: (
    error: unknown,
    input: I,
    cache: AtomCacheUtils,
    context: Ctx,
  ) => void | Promise<void>

  /**
   * Called after the mutation completes (success or error).
   * Use this for cleanup or final cache updates.
   * 
   * @param result - The mutation result, or undefined on error
   * @param error - The error, or undefined on success
   * @param input - The mutation input
   * @param cache - Cache utilities for reading/writing query data
   * @param context - The context returned from onMutate
   */
  readonly onSettled?: (
    result: unknown,
    error: unknown,
    input: I,
    cache: AtomCacheUtils,
    context: Ctx,
  ) => void | Promise<void>
}

/**
 * Options for useMutation hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseMutationOptions<A, E, I> {
  readonly onMutate?: (input: I) => void | Promise<void>
  readonly onSuccess?: (data: A, input: I) => void
  readonly onError?: (error: E, input: I) => void
  readonly onSettled?: (data: A | undefined, error: E | undefined, input: I) => void
  readonly invalidates?: ReadonlyArray<string>
  /**
   * Configuration for optimistic updates.
   * When provided, enables optimistic cache updates before the mutation completes.
   */
  readonly optimistic?: OptimisticUpdateConfig<I, unknown>
}

/**
 * Return type for useMutation hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseMutationReturn<A, E, I> extends MutationResult<A, E> {
  readonly mutateAsync: (input: I) => Promise<A>
  readonly mutate: (input: I) => Effect.Effect<A, E>
  readonly reset: () => void
}

/**
 * Options for useStream hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseStreamOptions {
  readonly enabled?: boolean
  readonly onPart?: (part: unknown) => void
  readonly onComplete?: (parts: ReadonlyArray<unknown>) => void
  readonly onError?: (error: unknown) => void
}

/**
 * Return type for useStream hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseStreamReturn<A, E> {
  readonly data: ReadonlyArray<A>
  readonly error: E | undefined
  readonly isStreaming: boolean
  readonly isError: boolean
  readonly isComplete: boolean
  readonly restart: () => void
  readonly stop: () => void
}

/**
 * Options for useChat hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseChatOptions {
  readonly onPart?: (part: unknown) => void
  readonly onFinish?: (parts: ReadonlyArray<unknown>) => void
  readonly onError?: (error: unknown) => void
}

/**
 * Return type for useChat hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseChatReturn<I, A, E> {
  readonly parts: ReadonlyArray<A>
  readonly text: string
  readonly error: E | undefined
  readonly isStreaming: boolean
  readonly isError: boolean
  readonly send: (input: I) => void
  readonly reset: () => void
  readonly stop: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedure Hook Types
// ─────────────────────────────────────────────────────────────────────────────

interface QueryProcedure<I, A, E> {
  useQuery: (
    input: I,
    options?: UseQueryOptions<A>,
  ) => UseQueryReturn<A, E>
  useSuspenseQuery: (
    input: I,
    options?: UseSuspenseQueryOptions<A>,
  ) => UseSuspenseQueryReturn<A, E>
}

interface MutationProcedure<I, A, E> {
  useMutation: (
    options?: UseMutationOptions<A, E, I>,
  ) => UseMutationReturn<A, E, I>
}

interface StreamProcedure<I, A, E> {
  useStream: (
    input: I,
    options?: UseStreamOptions,
  ) => UseStreamReturn<A, E>
}

interface ChatProcedure<I, A, E> {
  useChat: (options?: UseChatOptions) => UseChatReturn<I, A, E>
}

interface SubscriptionProcedure<I, A, E> {
  useSubscription: (
    input: I,
    options?: UseSubscriptionOptions<A>,
  ) => UseSubscriptionReturn<A, E>
}

type ProcedureHook<P> =
  P extends ProcedureDefinition<infer I, infer O, infer E, any, "query">
    ? QueryProcedure<unknown extends I ? void : I, O, E>
    : P extends ProcedureDefinition<infer I, infer O, infer E, any, "mutation">
      ? MutationProcedure<unknown extends I ? void : I, O, E>
      : P extends ProcedureDefinition<infer I, infer O, infer E, any, "stream">
        ? StreamProcedure<unknown extends I ? void : I, O, E>
        : P extends ProcedureDefinition<infer I, infer O, infer E, any, "chat">
          ? ChatProcedure<unknown extends I ? void : I, O, E>
          : P extends ProcedureDefinition<infer I, infer O, infer E, any, "subscription">
            ? SubscriptionProcedure<unknown extends I ? void : I, O, E>
            : never

type ProceduresHooks<P extends ProcedureRecord> = {
  [K in keyof P]: ProcedureHook<P[K]>
}

/**
 * Recursively build the client type from a RouterRecord.
 * Supports infinite nesting of routers and procedures groups.
 */
type RouterClient<R extends RouterRecord> = {
  [K in keyof R]: R[K] extends ProceduresGroup<any, infer P>
    ? ProceduresHooks<P>
    : R[K] extends Router<infer NestedRoutes>
      ? RouterClient<NestedRoutes>
      : never
}

// TracingConfig is re-exported from internal/rpc.ts for public API
export type { TracingConfig } from "./internal/rpc.js"

// ─────────────────────────────────────────────────────────────────────────────
// Runtime for running Effects in React
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ManagedRuntime type alias for the HTTP client runtime.
 */
type HttpManagedRuntime = ManagedRuntime.ManagedRuntime<HttpClient.HttpClient, never>

/**
 * Create a ManagedRuntime with FetchHttpClient for browser.
 * This properly manages the runtime lifecycle.
 */
const createManagedRuntime = (layer?: Layer.Layer<HttpClient.HttpClient>): HttpManagedRuntime =>
  ManagedRuntime.make(layer ?? FetchHttpClient.layer)

// ─────────────────────────────────────────────────────────────────────────────
// Client Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for a procedure, used for cache invalidation.
 *
 * @since 0.1.0
 * @category models
 */
export interface ProcedureMetadata {
  readonly invalidates?: ReadonlyArray<string>
  readonly invalidatesTags?: ReadonlyArray<string>
}

/**
 * Registry mapping procedure paths to their metadata.
 *
 * @since 0.1.0
 * @category models
 */
export type ProcedureMetadataRegistry = Record<string, ProcedureMetadata>

/**
 * Options for creating a TRPC React client.
 *
 * @since 0.1.0
 * @category constructors
 */
export interface CreateTRPCReactOptions {
  readonly url?: string
  readonly metadata?: ProcedureMetadataRegistry
  readonly tracing?: TracingConfig
  readonly httpClient?: Layer.Layer<HttpClient.HttpClient>
}

/**
 * A typed TRPC React client instance.
 *
 * @since 0.1.0
 * @category models
 */
export interface TRPCReactClient<TRouter extends Router> {
  readonly procedures: RouterClient<TRouter["routes"]>
  readonly Provider: (props: TRPCProviderProps) => any
  readonly useUtils: () => UseUtilsReturn
  /**
   * Dispose of the client's ManagedRuntime resources.
   * Call this when the client is no longer needed (e.g., during app shutdown).
   *
   * @remarks
   * The ManagedRuntime holds resources like the HTTP client layer.
   * In most React apps, you don't need to call this as the runtime will be
   * garbage collected when the page unloads. However, for proper cleanup
   * in tests or hot module reloading scenarios, call dispose().
   *
   * @example
   * ```ts
   * // In tests
   * afterEach(async () => {
   *   await trpc.dispose()
   * })
   *
   * // In Vite/webpack HMR (vite.config.ts or module.hot)
   * if (import.meta.hot) {
   *   import.meta.hot.dispose(() => trpc.dispose())
   * }
   * ```
   */
  readonly dispose: () => Promise<void>
}

/**
 * Props for the TRPC Provider component.
 *
 * @since 0.1.0
 * @category models
 */
export interface TRPCProviderProps {
  readonly children: React.ReactNode
}

/**
 * Return type for useUtils hook.
 *
 * @since 0.1.0
 * @category hooks
 */
export interface UseUtilsReturn {
  /**
   * Invalidate a query by its path and optionally its input.
   * 
   * @param path - The procedure path to invalidate.
   * @param input - Optional. If provided, invalidates the exact match for this path and input.
   *                If `undefined`, performs a **prefix-based invalidation**, refetching ALL
   *                queries whose path starts with the given `path`.
   */
  readonly invalidate: (path: string, input?: unknown) => void
  
  /**
   * Invalidate all cached queries.
   */
  readonly invalidateAll: () => void
}

/**
 * Create a typed TRPC React client.
 *
 * @since 0.1.0
 * @category constructors
 */
export function createTRPCReact<TRouter extends Router>(
  options?: CreateTRPCReactOptions,
): TRPCReactClient<TRouter> {
  const url = options?.url ?? "/api/trpc"
  const metadata = options?.metadata ?? {}
  const tracing = options?.tracing

  // Create ManagedRuntime once for proper lifecycle management
  const managedRuntime = createManagedRuntime(options?.httpClient)

  // Track number of mounted Providers for automatic runtime disposal
  // When the last Provider unmounts, the runtime is disposed automatically
  let providerCount = 0
  let isDisposed = false

  // ─────────────────────────────────────────────────────────────────────────
  // Query Deduplication
  // ─────────────────────────────────────────────────────────────────────────
  // Track in-flight requests to prevent duplicate network calls when multiple
  // components request the same query simultaneously. The promise is shared
  // between all callers with the same query key.
  const inFlightQueries = new Map<string, Promise<Exit.Exit<unknown, unknown>>>()

  /**
   * Execute a query with deduplication.
   * If a request for the same key is already in-flight, returns the existing promise.
   * Otherwise, starts a new request and tracks it.
   *
   * @param key - The query key (path + serialized input)
   * @param effect - The Effect to execute
   * @returns Promise resolving to the Exit value
   */
  const executeWithDeduplication = <A, E>(
    key: string,
    effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  ): Promise<Exit.Exit<A, E>> => {
    // Check if there's already an in-flight request for this key
    const existing = inFlightQueries.get(key)
    if (existing) {
      return existing as Promise<Exit.Exit<A, E>>
    }

    // Start new request and track it
    const promise = managedRuntime.runPromiseExit(effect).finally(() => {
      // Remove from tracking when complete (success or failure)
      inFlightQueries.delete(key)
    })

    inFlightQueries.set(key, promise as Promise<Exit.Exit<unknown, unknown>>)
    return promise
  }

  // Helper to run effects with HttpClient provided
  const runEffect = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    managedRuntime.runPromiseExit(effect)

  // Helper to run effects and get the fiber (for streams/cancellation)
  const runFork = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
    managedRuntime.runFork(effect)

  // Provider wraps with effect-atom RegistryProvider and manages runtime lifecycle
  const Provider = ({ children }: TRPCProviderProps) => {
    React.useEffect(() => {
      // Increment provider count on mount
      providerCount++
      isDisposed = false

      return () => {
        // Decrement provider count on unmount
        providerCount--
        
        // Auto-dispose ManagedRuntime when last Provider unmounts
        // This prevents resource leaks in tests and HMR scenarios
        if (providerCount === 0 && !isDisposed) {
          isDisposed = true
          managedRuntime.dispose().catch((error) => {
            // Log but don't throw - we're in cleanup
            console.warn("Failed to dispose ManagedRuntime:", error)
          })
        }
      }
    }, [])

    // Wrap with RegistryProvider for effect-atom state management
    return React.createElement(RegistryProvider, {}, children)
  }

  // Invalidation utilities hook (uses effect-atom registry)
  const useUtils = (): UseUtilsReturn => {
    const registry = useRegistry()

    const invalidate = React.useCallback(
      (path: string, input?: unknown) => {
        if (input !== undefined) {
          // Invalidate specific query by path + input
          const key = generateQueryKey(path, input)
          invalidateQueryByKey(registry, key)
        } else {
          // Invalidate all queries matching path prefix
          invalidateQueriesByPrefix(registry, path)
        }
      },
      [registry],
    )

    const invalidateAll = React.useCallback(() => {
      invalidateAllQueries(registry)
    }, [registry])

    return { invalidate, invalidateAll }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create procedure hooks via recursive proxy
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create hooks for a single procedure.
   * This is the leaf node in the proxy tree.
   *
   * @param path - Full dot-separated path (e.g., "user.posts.list")
   */
  const createProcedureHooks = (path: string) => {
    const procedureMetadata = metadata[path]
    const procedureInvalidates = procedureMetadata?.invalidates

    return {
      // ─────────────────────────────────────────────────────────────────
      // useQuery (effect-atom based - DECISION-007)
      // ─────────────────────────────────────────────────────────────────
       
      useQuery: (input: unknown, queryOptions?: UseQueryOptions<any>) => {
        const {
          enabled = true,
          initialData,
          refetchInterval = 0,
        } = queryOptions ?? {}

        // Get registry for key tracking
        const registry = useRegistry()

        // Use effect-atom for state management
        const key = generateQueryKey(path, input)
        const atom = queryAtomFamily(key)

        // Mount the atom (ensures it's tracked in the registry)
        useAtomMount(atom)

        // Register the query key for invalidation tracking
        React.useEffect(() => {
          registerQueryKey(registry, key)
        }, [registry, key])

        // Get the current state from the atom
        const atomState = useAtomValue(atom) as QueryAtomState<any, any>
        const setAtomState = useAtomSet(atom)

        // Version ref to handle race conditions
        const versionRef = React.useRef(0)

        // Refetch function using effect-atom with deduplication
        const refetch = React.useCallback(() => {
          const version = ++versionRef.current

          // Set to loading state, preserving previous value
          const previousValue = AtomResult.isSuccess(atomState.result)
            ? atomState.result.value
            : undefined

          setAtomState({
            result: AtomResult.waiting(
              previousValue !== undefined
                ? AtomResult.success(previousValue)
                : AtomResult.initial()
            ),
            lastFetchedAt: atomState.lastFetchedAt,
          })

          const effect = createRpcEffect(url, path, input, tracing)

          // Use deduplication to prevent duplicate network requests
          // If another component is already fetching this query, we'll share the promise
          void executeWithDeduplication(key, effect).then((exit) => {
            if (version !== versionRef.current) return

            if (Exit.isSuccess(exit)) {
              setAtomState({
                result: AtomResult.success(exit.value),
                lastFetchedAt: Date.now(),
              })
            } else {
              setAtomState({
                result: AtomResult.fail(Cause.squash(exit.cause)),
                lastFetchedAt: Date.now(),
              })
            }
          })
        }, [atomState, setAtomState, input, key])

        // Initialize with initialData if provided
        React.useEffect(() => {
          if (initialData !== undefined && AtomResult.isInitial(atomState.result)) {
            setAtomState({
              result: AtomResult.success(initialData),
              lastFetchedAt: null,
            })
          }
        }, [initialData, atomState.result, setAtomState])

        // Fetch on mount if enabled and initial
        React.useEffect(() => {
          if (!enabled) return
          if (AtomResult.isInitial(atomState.result) && initialData === undefined) {
            refetch()
          }

          // Set up refetch interval
          let intervalId: ReturnType<typeof setInterval> | undefined
          if (refetchInterval > 0) {
            intervalId = setInterval(refetch, refetchInterval)
          }

          return () => {
            if (intervalId) clearInterval(intervalId)
          }
        }, [enabled, refetch, refetchInterval, atomState.result, initialData])

        // Convert effect-atom Result to our QueryResult format
         
        const data = AtomResult.isSuccess(atomState.result)
          ? atomState.result.value
          : undefined
         
        const error = AtomResult.isFailure(atomState.result)
          ? Option.getOrUndefined(AtomResult.error(atomState.result))
          : undefined

        return {
          data,
          error,
          isLoading: AtomResult.isInitial(atomState.result) || atomState.result.waiting,
          isError: AtomResult.isFailure(atomState.result),
          isSuccess: AtomResult.isSuccess(atomState.result),
          isRefetching: AtomResult.isSuccess(atomState.result) && atomState.result.waiting,
          result: atomState.result,
          refetch,
        }
      },

      // ─────────────────────────────────────────────────────────────────
      // useSuspenseQuery (effect-atom based - DECISION-007)
      // ─────────────────────────────────────────────────────────────────
       
      useSuspenseQuery: (input: unknown, queryOptions?: UseSuspenseQueryOptions<any>) => {
        const { initialData, refetchInterval = 0 } = queryOptions ?? {}

        // Get registry for key tracking
        const registry = useRegistry()

        // Use effect-atom for state management
        const key = generateQueryKey(path, input)
        const atom = queryAtomFamily(key)

        // Mount the atom
        useAtomMount(atom)

        // Register the query key for invalidation tracking
        React.useEffect(() => {
          registerQueryKey(registry, key)
        }, [registry, key])

        // Get the current state from the atom
        const atomState = useAtomValue(atom) as QueryAtomState<any, any>
        const setAtomState = useAtomSet(atom)

        // Version ref to handle race conditions
        const versionRef = React.useRef(0)
        const promiseRef = React.useRef<Promise<void> | null>(null)

        // Refetch function with deduplication
        const refetch = React.useCallback(() => {
          const version = ++versionRef.current

          // Set to loading state
          const previousValue = AtomResult.isSuccess(atomState.result)
            ? atomState.result.value
            : undefined

          setAtomState({
            result: AtomResult.waiting(
              previousValue !== undefined
                ? AtomResult.success(previousValue)
                : AtomResult.initial()
            ),
            lastFetchedAt: atomState.lastFetchedAt,
          })

          const effect = createRpcEffect(url, path, input, tracing)

          // Use deduplication to prevent duplicate network requests
          const promise = executeWithDeduplication(key, effect).then((exit) => {
            if (version !== versionRef.current) return

            if (Exit.isSuccess(exit)) {
              setAtomState({
                result: AtomResult.success(exit.value),
                lastFetchedAt: Date.now(),
              })
            } else {
              setAtomState({
                result: AtomResult.fail(Cause.squash(exit.cause)),
                lastFetchedAt: Date.now(),
              })
            }
            promiseRef.current = null
          })

          promiseRef.current = promise
        }, [atomState, setAtomState, input, key])

        // Initialize with initialData if provided
        React.useEffect(() => {
          if (initialData !== undefined && AtomResult.isInitial(atomState.result)) {
            setAtomState({
              result: AtomResult.success(initialData),
              lastFetchedAt: null,
            })
          }
        }, [initialData, atomState.result, setAtomState])

        // Handle Suspense - throw promise if loading
        if (AtomResult.isInitial(atomState.result)) {
          if (!promiseRef.current) {
            refetch()
          }
          // eslint-disable-next-line @typescript-eslint/only-throw-error, no-throw-literal -- Suspense requires throwing promises
          throw promiseRef.current!
        }

        if (atomState.result.waiting && !AtomResult.isSuccess(atomState.result)) {
          if (promiseRef.current) {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense requires throwing promises
            throw promiseRef.current
          }
        }

        // Handle errors - throw for error boundary
        if (AtomResult.isFailure(atomState.result)) {
           
          throw Option.getOrUndefined(AtomResult.error(atomState.result))
        }

        // Set up refetch interval
        React.useEffect(() => {
          let intervalId: ReturnType<typeof setInterval> | undefined
          if (refetchInterval > 0) {
            intervalId = setInterval(refetch, refetchInterval)
          }

          return () => {
            if (intervalId) clearInterval(intervalId)
          }
        }, [refetch, refetchInterval])

        // At this point, we know we have success data
         
        const data = AtomResult.isSuccess(atomState.result)
          ? atomState.result.value
          : initialData!

        return {
          data,
          error: undefined,
          isLoading: false,
          isError: false,
          isSuccess: true,
          isRefetching: atomState.result.waiting,
          result: atomState.result,
          refetch,
        } as UseSuspenseQueryReturn<any, any>
      },

      // ─────────────────────────────────────────────────────────────────
      // useMutation (effect-atom based with 3-tier hierarchy - DECISION-007)
      // ─────────────────────────────────────────────────────────────────
       
      useMutation: (mutationOptions?: UseMutationOptions<any, any, any>) => {
         
        const { onMutate, onSuccess, onError, onSettled, invalidates, optimistic } =
          mutationOptions ?? {}
        
        // Get registry for atom-based operations
        const registry = useRegistry()

        // Generate a unique caller ID for this hook instance (3-tier: caller atom)
        const callerId = React.useId()
        const callerKey = generateCallerKey(path, callerId)
        const callerAtom = callerAtomFamily(callerKey)

        // Mount the caller atom
        useAtomMount(callerAtom)

        // Get caller state (isolated per hook instance)
        const callerState = useAtomValue(callerAtom) as MutationCallerState<any>
        const setCallerState = useAtomSet(callerAtom)

        // Track last successful result for the return value
        const lastResultRef = React.useRef<any>(undefined)

        // Version ref to handle rapid mutations - only the latest mutation updates state
        const versionRef = React.useRef(0)

        // Create cache utilities for optimistic updates (atom-based)
        const cacheUtils = React.useMemo(() => createAtomCacheUtils(registry), [registry])

        /**
         * Execute the mutation and return a Promise.
         *
         * @param input - The mutation input
         * @returns Promise resolving to the mutation result
         * @throws The procedure error when the mutation fails. This is intentional
         *         for Promise/async-await consumers - the error is the squashed
         *         Cause from the Effect, preserving the original error type.
         */
        const mutateAsync = React.useCallback(
          async (input: any): Promise<any> => {
            // Increment version to track this mutation - used to ignore stale results
            const version = ++versionRef.current
            
            // Context returned from optimistic onMutate, used for rollback
            let optimisticContext: unknown = undefined

            // Step 1: Call optimistic onMutate first (for cache updates)
            // Note: onMutate is always called even if superseded, as the user expects immediate feedback
            if (optimistic?.onMutate) {
              optimisticContext = await Promise.resolve(optimistic.onMutate(input, cacheUtils))
            }

            // Step 2: Call the regular onMutate callback
            if (onMutate) {
              await Promise.resolve(onMutate(input))
            }

            // Set caller state to pending (isolated per hook instance)
            setCallerState({
              isPending: true,
              error: null,
              lastInput: input,
            })

            const effect = createRpcEffect(url, path, input, tracing)
            const exit = await runEffect(effect)
            
            // Check if this mutation was superseded by a newer one
            // If so, skip state updates and callbacks to prevent race conditions
            const isStale = version !== versionRef.current

            if (Exit.isSuccess(exit)) {
              // Only update state if this is still the latest mutation
              if (!isStale) {
                // Update caller state
                setCallerState({
                  isPending: false,
                  error: null,
                  lastInput: input,
                })
                lastResultRef.current = exit.value

                // Step 3a: Call optimistic onSuccess (with cache utils and context)
                if (optimistic?.onSuccess) {
                  await Promise.resolve(
                    optimistic.onSuccess(exit.value, input, cacheUtils, optimisticContext),
                  )
                }

                // Step 3b: Call regular onSuccess callback
                onSuccess?.(exit.value, input)

                // Step 4a: Call optimistic onSettled
                if (optimistic?.onSettled) {
                  await Promise.resolve(
                    optimistic.onSettled(exit.value, undefined, input, cacheUtils, optimisticContext),
                  )
                }

                // Step 4b: Call regular onSettled callback
                onSettled?.(exit.value, undefined, input)

                // Step 5: Handle invalidations using atom-based approach
                const allInvalidates = [
                  ...(procedureInvalidates ?? []),
                  ...(invalidates ?? []),
                ]
                for (const invalidatePath of allInvalidates) {
                  // Use atom-based prefix invalidation
                  invalidateQueriesByPrefix(registry, invalidatePath)
                }
              }

              return exit.value
            } else {
              const error = Cause.squash(exit.cause)
              
              // Only update state and call callbacks if this is still the latest mutation
              if (!isStale) {
                // Update caller state with error
                setCallerState({
                  isPending: false,
                  error,
                  lastInput: input,
                })

                // Step 3a (error): Call optimistic onError (for rollback)
                if (optimistic?.onError) {
                  await Promise.resolve(
                    optimistic.onError(error, input, cacheUtils, optimisticContext),
                  )
                }

                // Step 3b (error): Call regular onError callback
                onError?.(error, input)

                // Step 4a (error): Call optimistic onSettled
                if (optimistic?.onSettled) {
                  await Promise.resolve(
                    optimistic.onSettled(undefined, error, input, cacheUtils, optimisticContext),
                  )
                }

                // Step 4b (error): Call regular onSettled callback
                onSettled?.(undefined, error, input)
              }

              // Intentional throw: mutateAsync returns Promise, must throw to reject
              // Always throw even for stale mutations so the Promise rejects correctly
              throw error
            }
          },
          [onMutate, onSuccess, onError, onSettled, invalidates, procedureInvalidates, registry, optimistic, cacheUtils, setCallerState],
        )

        const mutate = React.useCallback(
          (input: any): Effect.Effect<any, any> =>
            // mutateAsync throws the squashed error directly, so we preserve it as-is
            // The error type is already the procedure's error type (squashed from Cause)
            Effect.tryPromise({
              try: () => mutateAsync(input),
              catch: (error): unknown => error,
            }),
          [mutateAsync],
        )

        const reset = React.useCallback(() => {
          setCallerState(initialCallerState())
          lastResultRef.current = undefined
        }, [setCallerState])

        return {
          data: lastResultRef.current,
          error: callerState.error ?? undefined,
          isPending: callerState.isPending,
          isError: callerState.error !== null,
          isSuccess: lastResultRef.current !== undefined && !callerState.isPending && callerState.error === null,
          isIdle: !callerState.isPending && callerState.error === null && lastResultRef.current === undefined,
          result: callerState.isPending
            ? Result.initial(true) // initial with waiting=true for loading state
            : callerState.error !== null
              ? Result.fail(callerState.error)
              : lastResultRef.current !== undefined
                ? Result.success(lastResultRef.current)
                : Result.initial(),
          mutateAsync,
          mutate,
          reset,
        }
      },

      // ─────────────────────────────────────────────────────────────────
      // useStream (effect-atom based - DECISION-007)
      // ─────────────────────────────────────────────────────────────────
      useStream: (input: unknown, streamOptions?: UseStreamOptions) => {
        const { enabled = true, onPart, onComplete, onError } = streamOptions ?? {}

        // Use effect-atom for state management
        const key = generateQueryKey(path, input)
        const atom = streamAtomFamily(key)

        // Mount the atom
        useAtomMount(atom)

        // Get state from atom
        const atomState = useAtomValue(atom)
        const setAtomState = useAtomSet(atom)

        const fiberRef = React.useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)
        
        // useEffectEvent for callbacks - ensures we always call the latest version
        // without recreating the stream when callbacks change.
        const onPartEvent = useEvent((part: unknown) => {
          onPart?.(part)
        })
        const onCompleteEvent = useEvent((parts: ReadonlyArray<unknown>) => {
          onComplete?.(parts)
        })
        const onErrorEvent = useEvent((err: unknown) => {
          onError?.(err)
        })

        const stop = React.useCallback(() => {
          if (fiberRef.current) {
            // Interrupt the fiber in a non-blocking way using interruptFork
            // This ensures cleanup happens but doesn't block the React callback
            runFork(Fiber.interruptFork(fiberRef.current))
            fiberRef.current = null
          }
          setAtomState({
            ...atomState,
            isStreaming: false,
          })
        }, [atomState, setAtomState])

        const restart = React.useCallback(() => {
          stop()
          
          // Reset state via atom
          setAtomState({
            result: AtomResult.initial(),
            isStreaming: true,
            latestValue: null,
          })

          const parts: Array<unknown> = []

          const streamEffect = createStreamEffect(url, path, input).pipe(
            Stream.tap((part) =>
              Effect.sync(() => {
                parts.push(part)
                setAtomState({
                  result: AtomResult.success(parts as readonly unknown[]),
                  isStreaming: true,
                  latestValue: part,
                })
                // useEffectEvent ensures we call the latest callback
                onPartEvent(part)
              }),
            ),
            Stream.runDrain,
            Effect.tap(() =>
              Effect.sync(() => {
                fiberRef.current = null // Clear ref on completion
                setAtomState({
                  result: AtomResult.success(parts as readonly unknown[]),
                  isStreaming: false,
                  latestValue: parts[parts.length - 1] ?? null,
                })
                // useEffectEvent ensures we call the latest callback
                onCompleteEvent(parts)
              }),
            ),
            // Use catchAllCause to handle both errors AND defects
            Effect.catchAllCause((cause) =>
              Effect.sync(() => {
                fiberRef.current = null // Clear ref on error/defect
                const err = Cause.squash(cause)
                setAtomState({
                  result: AtomResult.fail(err),
                  isStreaming: false,
                  latestValue: atomState.latestValue,
                })
                // useEffectEvent ensures we call the latest callback
                onErrorEvent(err)
              }),
            ),
          )

          fiberRef.current = runFork(streamEffect)
        }, [input, stop, setAtomState, atomState.latestValue]) // onPartEvent, etc. use useEffectEvent - not needed in deps

        React.useEffect(() => {
          if (enabled) restart()
          return stop
        }, [enabled, restart, stop])

        // Extract data from atom state
        const data = AtomResult.isSuccess(atomState.result)
          ? atomState.result.value
          : []
        const error = AtomResult.isFailure(atomState.result)
          ? Option.getOrUndefined(AtomResult.error(atomState.result))
          : undefined

        return {
          data: data,
          error,
          isStreaming: atomState.isStreaming,
          isError: AtomResult.isFailure(atomState.result),
          isComplete: AtomResult.isSuccess(atomState.result) && !atomState.isStreaming,
          restart,
          stop,
        }
      },

      // ─────────────────────────────────────────────────────────────────
      // useChat (effect-atom based - DECISION-007)
      // ─────────────────────────────────────────────────────────────────
      useChat: (chatOptions?: UseChatOptions) => {
        const { onPart, onFinish, onError } = chatOptions ?? {}

        // Use effect-atom for state management
        // Use path only as key since input changes per send
        const atom = chatAtomFamily(path)

        // Mount the atom
        useAtomMount(atom)

        // Get state from atom
        const atomState = useAtomValue(atom)
        const setAtomState = useAtomSet(atom)

        const fiberRef = React.useRef<Fiber.RuntimeFiber<void, unknown> | null>(null)
        
        // useEffectEvent for callbacks - ensures we always call the latest version
        // without recreating the stream when callbacks change.
        const onPartEvent = useEvent((part: unknown) => {
          onPart?.(part)
        })
        const onFinishEvent = useEvent((parts: ReadonlyArray<unknown>) => {
          onFinish?.(parts)
        })
        const onErrorEvent = useEvent((err: unknown) => {
          onError?.(err)
        })

        const stop = React.useCallback(() => {
          if (fiberRef.current) {
            // Interrupt the fiber in a non-blocking way using interruptFork
            runFork(Fiber.interruptFork(fiberRef.current))
            fiberRef.current = null
          }
          setAtomState({
            ...atomState,
            isStreaming: false,
          })
        }, [atomState, setAtomState])

        const reset = React.useCallback(() => {
          stop()
          setAtomState(initialChatState())
        }, [stop, setAtomState])

        const send = React.useCallback(
          (input: unknown) => {
            stop()
            
            // Reset state for new message via atom
            setAtomState({
              result: AtomResult.initial(),
              parts: [],
              text: "",
              isStreaming: true,
            })

            const allParts: Array<unknown> = []
            let accumulatedText = ""

            const streamEffect = createStreamEffect(url, path, input).pipe(
              Stream.tap((part) =>
                Effect.sync(() => {
                  allParts.push(part)

                  // Extract text from chat parts using Schema for type safety
                  const textOption = extractTextFromPart(part)
                  if (Option.isSome(textOption)) {
                    accumulatedText += textOption.value
                  }

                  setAtomState({
                     
                    result: AtomResult.success(allParts as readonly any[]),
                     
                    parts: allParts as readonly any[],
                    text: accumulatedText,
                    isStreaming: true,
                  })

                  // useEffectEvent ensures we call the latest callback
                  onPartEvent(part)
                }),
              ),
              Stream.runDrain,
              Effect.tap(() =>
                Effect.sync(() => {
                  fiberRef.current = null // Clear ref on completion
                  setAtomState({
                     
                    result: AtomResult.success(allParts as readonly any[]),
                     
                    parts: allParts as readonly any[],
                    text: accumulatedText,
                    isStreaming: false,
                  })
                  // useEffectEvent ensures we call the latest callback
                  onFinishEvent(allParts)
                }),
              ),
              // Use catchAllCause to handle both errors AND defects
              Effect.catchAllCause((cause) =>
                Effect.sync(() => {
                  fiberRef.current = null // Clear ref on error/defect
                  const err = Cause.squash(cause)
                  setAtomState({
                    result: AtomResult.fail(err),
                     
                    parts: allParts as readonly any[],
                    text: accumulatedText,
                    isStreaming: false,
                  })
                  // useEffectEvent ensures we call the latest callback
                  onErrorEvent(err)
                }),
              ),
            )

            fiberRef.current = runFork(streamEffect)
          },
          [stop, setAtomState], // onPartEvent, etc. use useEffectEvent - not needed in deps
        )

        React.useEffect(() => stop, [stop])

        // Extract error from atom state
        const error = AtomResult.isFailure(atomState.result)
          ? Option.getOrUndefined(AtomResult.error(atomState.result))
          : undefined

        return {
          parts: atomState.parts,
          text: atomState.text,
          error,
          isStreaming: atomState.isStreaming,
          isError: AtomResult.isFailure(atomState.result),
          send,
          reset,
          stop,
        }
      },

      // ─────────────────────────────────────────────────────────────────
      // useSubscription
      // ─────────────────────────────────────────────────────────────────
      useSubscription: (input: unknown, subscriptionOptions?: UseSubscriptionOptions<any>) => {
        // Delegate to the useSubscription hook from subscription.ts
        // The hook needs WebSocketProvider context, so users must wrap with that provider
        return useSubscription(path, input, subscriptionOptions)
      },
    }
  }

  /**
   * Check if an entry appears to be a ProceduresGroup (has procedures property).
   * This is used at runtime to determine if we've reached a leaf node.
   */
  const looksLikeProceduresGroup = (entry: unknown): boolean => {
    return (
      entry !== null &&
      typeof entry === "object" &&
      "_tag" in entry &&
      (entry as { _tag: string })._tag === "ProceduresGroup"
    )
  }

  /**
   * Check if an entry appears to be a Router (has routes property).
   * This is used at runtime to determine if we need to recurse.
   */
  const looksLikeRouter = (entry: unknown): boolean => {
    return (
      entry !== null &&
      typeof entry === "object" &&
      "_tag" in entry &&
      (entry as { _tag: string })._tag === "Router"
    )
  }

  /**
   * Create a recursive proxy that handles infinite nesting.
   * Accumulates path segments as properties are accessed.
   *
   * @param routeEntry - The router entry (Router or ProceduresGroup) at this level
   * @param pathParts - Accumulated path segments
   *
   * @returns A proxy object typed as `any`
   *
   * @remarks
   * **Why `any` return type?**
   *
   * This function returns `any` because it creates a dynamic Proxy whose shape
   * depends on the runtime router structure. The actual type safety is provided
   * by the `RouterClient<TRouter>` type at the call site, which maps the router
   * definition to a typed client interface.
   *
   * TypeScript cannot infer the recursive proxy structure, but callers get full
   * type safety via: `const api: RouterClient<typeof appRouter> = createRecursiveProxy(...)`
   */
  /* eslint-disable @typescript-eslint/no-unused-vars -- Dynamic proxy requires any */
  const createRecursiveProxy = (
    routeEntry: RouterEntry | RouterRecord,
    pathParts: string[] = [],
  ): any => {
    return new Proxy({}, {
      get(_target, prop: string) {
        // Skip internal properties
        if (typeof prop !== "string" || prop === "then" || prop === "toJSON") {
          return undefined
        }

        const newPathParts = [...pathParts, prop]

        // If routeEntry is a RouterRecord (initial call or nested router routes)
        if (!("_tag" in routeEntry)) {
          const entry = (routeEntry)[prop]
          if (entry) {
            if (looksLikeRouter(entry)) {
              // Nested router - recurse into its routes
              return createRecursiveProxy((entry as AnyRouter).routes, newPathParts)
            } else if (looksLikeProceduresGroup(entry)) {
              // ProceduresGroup - return proxy for procedures
              return createRecursiveProxy(entry as AnyProceduresGroup, newPathParts)
            }
          }
          // Unknown entry - might be a procedure name, but we don't have the group
          // This shouldn't happen with proper types
          return undefined
        }

        // If we're inside a ProceduresGroup, prop should be a procedure name
        if (looksLikeProceduresGroup(routeEntry)) {
          const group = routeEntry as AnyProceduresGroup
          const procedureDef = group.procedures[prop]
          if (procedureDef) {
            // Build full path: join all parts with dots
            // Path format: "groupKey.procedureName" or "nested.path.groupKey.procedureName"
            const fullPath = newPathParts.join(".")
            return createProcedureHooks(fullPath)
          }
          return undefined
        }

        // If we're inside a Router, prop should be a key in routes
        if (looksLikeRouter(routeEntry)) {
          const router = routeEntry as AnyRouter
          const entry = router.routes[prop]
          if (entry) {
            if (looksLikeRouter(entry)) {
              return createRecursiveProxy((entry as AnyRouter).routes, newPathParts)
            } else if (looksLikeProceduresGroup(entry)) {
              return createRecursiveProxy(entry as AnyProceduresGroup, newPathParts)
            }
          }
          return undefined
        }

        return undefined
      },
    })
  }
   

  /**
   * Create the top-level procedures proxy from the router.
   */
  const createProceduresProxy = (): RouterClient<TRouter["routes"]> => {
    // We need access to the actual router at runtime.
    // Since we don't have it directly, we use a proxy that will be populated
    // when the user provides the router structure via options.
    //
    // For now, we use a simple approach: the proxy builds paths and creates hooks.
    // The actual router structure is only needed for type inference.
    //
    // The proxy accumulates path segments and creates hooks when a hook method is accessed.
    return new Proxy({} as RouterClient<TRouter["routes"]>, {
      get(_target, groupOrRouterKey: string) {
        // Skip internal properties
        if (typeof groupOrRouterKey !== "string" || groupOrRouterKey === "then" || groupOrRouterKey === "toJSON") {
          return undefined
        }

        // Return a nested proxy that accumulates the path
        return createNestedProxy([groupOrRouterKey])
      },
    })
  }

  /**
   * Create a nested proxy that accumulates path segments.
   * Returns procedure hooks when a hook method (useQuery, useMutation, etc.) is accessed.
   *
   * @param pathParts - Accumulated path segments (e.g., ["user", "posts"])
   *
   * @returns A proxy object typed as `any`
   *
   * @remarks
   * **Why `any` return type?**
   *
   * This function returns `any` because it creates a dynamic Proxy that can represent:
   * 1. A nested router level (returns another proxy)
   * 2. A procedure group level (returns another proxy)
   * 3. A procedure level (returns hook methods like `useQuery`, `useMutation`)
   *
   * The actual type safety comes from `RouterClient<TRouter>` which provides
   * compile-time type checking. The proxy implementation is dynamically typed
   * because TypeScript cannot express recursive proxy types that depend on
   * runtime path accumulation.
   */
   
  const createNestedProxy = (pathParts: string[]): any => {
    return new Proxy({}, {
      get(_target, prop: string) {
        // Skip internal properties
        if (typeof prop !== "string" || prop === "then" || prop === "toJSON") {
          return undefined
        }

        // Check if this is a hook method
        if (prop === "useQuery" || prop === "useMutation" || prop === "useStream" || prop === "useChat" || prop === "useSubscription") {
          // The last part is the procedure name, build the full path
          const fullPath = pathParts.join(".")
          const hooks = createProcedureHooks(fullPath)
          return hooks[prop as keyof typeof hooks]
        }

        // Otherwise, this is another path segment (could be router, group, or procedure)
         
        return createNestedProxy([...pathParts, prop])
      },
    })
  }

  // Dispose function to clean up ManagedRuntime resources
  // Safe to call even if already auto-disposed (when last Provider unmounted)
  const dispose = (): Promise<void> => {
    if (isDisposed) {
      return Promise.resolve()
    }
    isDisposed = true
    return managedRuntime.dispose()
  }

  return {
    procedures: createProceduresProxy(),
    Provider,
    useUtils,
    dispose,
  }
}
