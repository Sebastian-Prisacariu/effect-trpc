/**
 * @module effect-trpc/react/hooks-factory
 *
 * Factory for creating typed TRPC React hooks that use runtime injection.
 * This is the V1 API - hooks execute through the app-provided runtime.
 *
 * @since 1.0.0
 */

import * as React from "react"
import { useAtomMount, useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import * as AtomResult from "@effect-atom/atom/Result"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"

import { Client } from "../core/client/index.js"
import type { RouterClient as CoreRouterClient } from "../core/client/proxy.js"
import type { ProcedureDefinition } from "../core/server/procedure.js"
import type { ProcedureRecord, ProceduresGroup } from "../core/server/procedures.js"
import type { RouterShape, RouterRecord } from "../core/server/router.js"

import {
  generateQueryKey,
  queryAtomFamily,
  registerQueryKey,
  useRegistry,
  type QueryAtomState,
} from "./atoms.js"
import { useRuntime, type TRPCRuntime, type TRPCRuntimeServices } from "./runtime-context.js"
import {
  isStale,
  subscribeToWindowFocus,
  subscribeToNetworkReconnect,
  isDocumentVisible,
} from "./signals.js"

import type {
  UseQueryOptions,
  UseQueryReturn,
  UseMutationOptions,
  UseMutationReturn,
} from "./create-client.js"

// ─────────────────────────────────────────────────────────────────────────────
// Hook Types
// ─────────────────────────────────────────────────────────────────────────────

interface QueryProcedureHook<I, A, E> {
  useQuery: (input: I, options?: UseQueryOptions<A>) => UseQueryReturn<A, E>
}

interface MutationProcedureHook<I, A, E> {
  useMutation: (options?: UseMutationOptions<A, E, I>) => UseMutationReturn<A, E, I>
}

/**
 * Extract ProcedureDefinition from an Effect or return the value directly.
 * Note: Uses `infer _E` and `infer _R` to handle Effect variance correctly.
 */
type ExtractProcedureDefinition<P> =
  P extends Effect.Effect<infer D, infer _E, infer _R>
    ? D extends ProcedureDefinition<infer I, infer A, infer E, infer Ctx, infer Type>
      ? ProcedureDefinition<I, A, E, Ctx, Type>
      : never
    : P extends ProcedureDefinition<infer I, infer A, infer E, infer Ctx, infer Type>
      ? ProcedureDefinition<I, A, E, Ctx, Type>
      : never

type ProcedureHook<P> =
  ExtractProcedureDefinition<P> extends ProcedureDefinition<
    infer I,
    infer O,
    infer E,
    any,
    infer Type
  >
    ? Type extends "query"
      ? QueryProcedureHook<unknown extends I ? void : I, O, E>
      : Type extends "mutation"
        ? MutationProcedureHook<unknown extends I ? void : I, O, E>
        : never
    : never

type ProceduresHooks<P extends ProcedureRecord> = {
  [K in keyof P]: ProcedureHook<P[K]>
}

/**
 * Extract ProceduresGroup from an Effect or return the value directly.
 * Note: Uses `infer _E` and `infer _R` to handle Effect variance correctly.
 */
type ExtractProceduresGroup<P> =
  P extends Effect.Effect<infer D, infer _E, infer _R>
    ? D extends ProceduresGroup<infer Name, infer Procs>
      ? ProceduresGroup<Name, Procs>
      : never
    : P extends ProceduresGroup<infer Name, infer Procs>
      ? ProceduresGroup<Name, Procs>
      : never

/**
 * Extract RouterShape from an Effect or return the value directly.
 * Note: Uses `infer _E` and `infer _R` to handle Effect variance correctly.
 */
type ExtractRouterShape<P> =
  P extends Effect.Effect<infer D, infer _E, infer _R>
    ? D extends RouterShape<infer Routes>
      ? RouterShape<Routes>
      : never
    : P extends RouterShape<infer Routes>
      ? RouterShape<Routes>
      : never

/**
 * Recursively build the hooks type from a RouterRecord.
 * Handles both Effect-wrapped and plain values.
 */
export type RouterHooks<R extends RouterRecord> = {
  [K in keyof R]: ExtractProceduresGroup<R[K]> extends ProceduresGroup<infer _Name, infer P>
    ? ProceduresHooks<P>
    : ExtractRouterShape<R[K]> extends RouterShape<infer NestedRoutes>
      ? RouterHooks<NestedRoutes>
      : never
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context for the TRPC client proxy.
 * Created by TRPCHooksProvider from the router and runtime.
 * @internal
 */
interface ClientContextValue<TRouter extends RouterShape<RouterRecord>> {
  readonly client: CoreRouterClient<TRouter["routes"]>
}

const ClientContext = React.createContext<ClientContextValue<any> | null>(null)

function useClient<TRouter extends RouterShape<RouterRecord>>(): CoreRouterClient<
  TRouter["routes"]
> {
  const context = React.useContext(ClientContext)
  if (context === null) {
    throw new Error(
      "[effect-trpc] useClient must be used within a TRPCHooksProvider. " +
        "Wrap your app with <trpc.Provider>...",
    )
  }
  return context.client
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for createTRPCHooks.
 *
 * @since 1.0.0
 * @category configuration
 */
export interface CreateTRPCHooksOptions<TRouter extends RouterShape<RouterRecord>> {
  /**
   * The router definition.
   * Required for type safety and creating the client proxy.
   */
  readonly router: TRouter

  /**
   * Default options for all queries.
   */
  readonly defaultQueryOptions?: Partial<UseQueryOptions<unknown>>
}

/**
 * Props for the TRPCHooksProvider component.
 *
 * @since 1.0.0
 * @category types
 */
export interface TRPCHooksProviderProps {
  readonly children: React.ReactNode
}

/**
 * Return type for createTRPCHooks.
 *
 * @since 1.0.0
 * @category types
 */
export interface TRPCHooks<TRouter extends RouterShape<RouterRecord>> {
  /**
   * Provider component that creates the client from the router.
   * Must be nested inside EffectTRPCProvider.
   */
  readonly Provider: (props: TRPCHooksProviderProps) => React.ReactElement

  /**
   * The typed procedure hooks.
   * Access via `trpc.procedures.domain.procedure.useQuery()`
   */
  readonly procedures: RouterHooks<TRouter["routes"]>
}

/**
 * Create typed TRPC hooks that use the injected runtime.
 *
 * Unlike `createTRPCReact`, this does NOT create its own runtime.
 * You must wrap your app with `EffectTRPCProvider` and provide a runtime.
 *
 * @example
 * ```tsx
 * // lib/trpc.ts
 * import { createTRPCHooks } from "effect-trpc/react"
 * import { appRouter } from "~/server/router"
 *
 * export const trpc = createTRPCHooks({ router: appRouter })
 *
 * // app/providers.tsx
 * import { EffectTRPCProvider, Client } from "effect-trpc/react"
 * import { ManagedRuntime, Layer } from "effect"
 * import { trpc } from "~/lib/trpc"
 *
 * const AppLive = Client.HttpLive("/api/trpc")
 * const appRuntime = ManagedRuntime.make(AppLive)
 *
 * export function Providers({ children }) {
 *   return (
 *     <EffectTRPCProvider runtime={appRuntime}>
 *       <trpc.Provider>
 *         {children}
 *       </trpc.Provider>
 *     </EffectTRPCProvider>
 *   )
 * }
 *
 * // components/UserList.tsx
 * import { trpc } from "~/lib/trpc"
 *
 * function UserList() {
 *   const { data, isLoading } = trpc.procedures.user.list.useQuery()
 *   // ...
 * }
 * ```
 *
 * @since 1.0.0
 * @category constructors
 */
export function createTRPCHooks<TRouter extends RouterShape<RouterRecord>>(
  options: CreateTRPCHooksOptions<TRouter>,
): TRPCHooks<TRouter> {
  const { router, defaultQueryOptions = {} } = options

  // ─────────────────────────────────────────────────────────────────────────
  // Provider Component
  // ─────────────────────────────────────────────────────────────────────────

  const Provider = ({ children }: TRPCHooksProviderProps): React.ReactElement => {
    const runtime = useRuntime()

    // Create the client proxy from the runtime
    const client = React.useMemo(() => {
      // Get the Client service and create a proxy for the router
      const program = Effect.gen(function* () {
        const clientService = yield* Client
        return clientService.create(router)
      })

      // Run synchronously since we need the client immediately
      // The runtime already has all required services
      return runtime.runSync(program)
    }, [runtime])

    const contextValue = React.useMemo(() => ({ client }), [client])

    return React.createElement(ClientContext.Provider, { value: contextValue }, children)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create procedure hooks via recursive proxy
  // ─────────────────────────────────────────────────────────────────────────

  const createProcedureHooks = (path: string) => {
    return {
      // ─────────────────────────────────────────────────────────────────
      // useQuery
      // ─────────────────────────────────────────────────────────────────

      useQuery: (input: unknown, queryOptions?: UseQueryOptions<unknown>) => {
        const runtime = useRuntime()
        const client = useClient<TRouter>()
        const registry = useRegistry()

        // Merge with defaultQueryOptions
        const mergedOptions = { ...defaultQueryOptions, ...queryOptions }
        const {
          enabled = true,
          initialData,
          staleTime = 0,
          refetchOnWindowFocus = true,
          refetchOnReconnect = true,
          refetchOnMount = true,
          refetchInterval = 0,
          refetchIntervalInBackground = false,
        } = mergedOptions

        // Use effect-atom for state management
        const key = generateQueryKey(path, input)
        const atom = queryAtomFamily(key)

        // Mount the atom
        useAtomMount(atom)

        // Register the query key
        React.useEffect(() => {
          registerQueryKey(registry, key)
        }, [registry, key])

        const atomState = useAtomValue(atom) as QueryAtomState<unknown, unknown>
        const setAtomState = useAtomSet(atom)

        // Version ref for race conditions
        const versionRef = React.useRef(0)

        // Check if data is stale
        const dataIsStale = React.useMemo(
          () => isStale(atomState.lastFetchedAt, staleTime),
          [atomState.lastFetchedAt, staleTime],
        )

        // Refs for stable refetch
        const atomStateRef = React.useRef(atomState)
        atomStateRef.current = atomState
        const inputRef = React.useRef(input)
        inputRef.current = input

        // Get the procedure call function from the client proxy
        const getProcedureCall = React.useCallback(() => {
          const segments = path.split(".")
          let current: unknown = client
          for (const segment of segments) {
            current = (current as Record<string, unknown>)[segment]
          }
          return current as (input: unknown) => Effect.Effect<unknown, unknown>
        }, [client, path])

        // Refetch function
        const refetch = React.useCallback(() => {
          const version = ++versionRef.current
          const currentAtomState = atomStateRef.current
          const currentInput = inputRef.current

          // Set to loading state
          const previousValue = AtomResult.isSuccess(currentAtomState.result)
            ? currentAtomState.result.value
            : undefined

          const currentError = AtomResult.isFailure(currentAtomState.result)
            ? Option.getOrNull(AtomResult.error(currentAtomState.result))
            : currentAtomState.previousError

          setAtomState({
            result: AtomResult.waiting(
              previousValue !== undefined
                ? AtomResult.success(previousValue)
                : AtomResult.initial(),
            ),
            lastFetchedAt: currentAtomState.lastFetchedAt,
            previousError: currentError,
          })

          // Get the procedure call and execute it
          const procedureCall = getProcedureCall()
          const effect = procedureCall(currentInput)

          void runtime.runPromiseExit(effect).then((exit) => {
            if (version !== versionRef.current) return

            if (Exit.isSuccess(exit)) {
              setAtomState({
                result: AtomResult.success(exit.value),
                lastFetchedAt: Date.now(),
                previousError: null,
              })
            } else {
              setAtomState({
                result: AtomResult.fail(Cause.squash(exit.cause)),
                lastFetchedAt: Date.now(),
                previousError: currentError,
              })
            }
          })
        }, [setAtomState, runtime, getProcedureCall])

        // Initialize with initialData if provided
        React.useEffect(() => {
          if (initialData !== undefined && AtomResult.isInitial(atomState.result)) {
            setAtomState({
              result: AtomResult.success(initialData),
              lastFetchedAt: null,
              previousError: null,
            })
          }
        }, [initialData, atomState.result, setAtomState])

        // Mount effect for initial fetch
        React.useEffect(() => {
          if (!enabled) return

          if (refetchOnMount === false) {
            if (AtomResult.isInitial(atomState.result) && initialData === undefined) {
              refetch()
            }
            return
          }

          if (refetchOnMount === "always") {
            refetch()
            return
          }

          if (AtomResult.isInitial(atomState.result) && initialData === undefined) {
            refetch()
          } else if (dataIsStale) {
            refetch()
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [])

        // Window focus refetch
        React.useEffect(() => {
          if (!enabled || !refetchOnWindowFocus) return
          return subscribeToWindowFocus(() => {
            if (isStale(atomState.lastFetchedAt, staleTime)) {
              refetch()
            }
          })
        }, [enabled, refetchOnWindowFocus, atomState.lastFetchedAt, staleTime, refetch])

        // Network reconnect refetch
        React.useEffect(() => {
          if (!enabled || !refetchOnReconnect) return
          return subscribeToNetworkReconnect(() => {
            if (isStale(atomState.lastFetchedAt, staleTime)) {
              refetch()
            }
          })
        }, [enabled, refetchOnReconnect, atomState.lastFetchedAt, staleTime, refetch])

        // Refetch interval
        React.useEffect(() => {
          if (!enabled) return
          const interval = typeof refetchInterval === "number" ? refetchInterval : 0
          if (interval <= 0) return

          const intervalFn = () => {
            if (refetchIntervalInBackground || isDocumentVisible()) {
              refetch()
            }
          }

          const intervalId = setInterval(intervalFn, interval)
          return () => clearInterval(intervalId)
        }, [enabled, refetchInterval, refetchIntervalInBackground, refetch])

        // Compute display data
        const data =
          AtomResult.isSuccess(atomState.result) && !atomState.result.waiting
            ? atomState.result.value
            : undefined

        const error = AtomResult.isFailure(atomState.result)
          ? Option.getOrUndefined(AtomResult.error(atomState.result))
          : undefined

        const hasData = AtomResult.isSuccess(atomState.result)
        const isWaiting = atomState.result.waiting || AtomResult.isInitial(atomState.result)

        return {
          data,
          error,
          previousError: atomState.previousError,
          isLoading: !hasData && isWaiting,
          isFetching: isWaiting,
          isRefetching: hasData && atomState.result.waiting,
          isError: AtomResult.isFailure(atomState.result),
          isSuccess: AtomResult.isSuccess(atomState.result),
          isPlaceholderData: false,
          result: atomState.result,
          refetch,
        } as UseQueryReturn<unknown, unknown>
      },

      // ─────────────────────────────────────────────────────────────────
      // useMutation
      // ─────────────────────────────────────────────────────────────────

      useMutation: (mutationOptions?: UseMutationOptions<unknown, unknown, unknown>) => {
        const runtime = useRuntime()
        const client = useClient<TRouter>()

        const [state, setState] = React.useState<{
          data: unknown
          error: unknown
          isLoading: boolean
          isError: boolean
          isSuccess: boolean
        }>({
          data: undefined,
          error: undefined,
          isLoading: false,
          isError: false,
          isSuccess: false,
        })

        // Get the procedure call function from the client proxy
        const getProcedureCall = React.useCallback(() => {
          const segments = path.split(".")
          let current: unknown = client
          for (const segment of segments) {
            current = (current as Record<string, unknown>)[segment]
          }
          return current as (input: unknown) => Effect.Effect<unknown, unknown>
        }, [client])

        const mutate = React.useCallback(
          (input: unknown) => {
            const procedureCall = getProcedureCall()
            return procedureCall(input)
          },
          [getProcedureCall],
        )

        const mutateAsync = React.useCallback(
          async (input: unknown) => {
            setState((prev) => ({ ...prev, isLoading: true, isError: false, isSuccess: false }))

            if (mutationOptions?.onMutate) {
              await mutationOptions.onMutate(input)
            }

            const procedureCall = getProcedureCall()
            const exit = await runtime.runPromiseExit(procedureCall(input))

            if (Exit.isSuccess(exit)) {
              setState({
                data: exit.value,
                error: undefined,
                isLoading: false,
                isError: false,
                isSuccess: true,
              })

              if (mutationOptions?.onSuccess) {
                mutationOptions.onSuccess(exit.value, input)
              }
              if (mutationOptions?.onSettled) {
                mutationOptions.onSettled(exit.value, undefined, input)
              }
            } else {
              const error = Cause.squash(exit.cause)
              setState({
                data: undefined,
                error,
                isLoading: false,
                isError: true,
                isSuccess: false,
              })

              if (mutationOptions?.onError) {
                mutationOptions.onError(error, input)
              }
              if (mutationOptions?.onSettled) {
                mutationOptions.onSettled(undefined, error, input)
              }
            }

            return exit
          },
          [runtime, getProcedureCall, mutationOptions],
        )

        const reset = React.useCallback(() => {
          setState({
            data: undefined,
            error: undefined,
            isLoading: false,
            isError: false,
            isSuccess: false,
          })
        }, [])

        return {
          ...state,
          isPending: state.isLoading,
          isIdle: !state.isLoading && !state.isError && !state.isSuccess,
          result: AtomResult.initial(), // TODO: track proper result state
          mutate,
          mutateAsync,
          reset,
        } as UseMutationReturn<unknown, unknown, unknown>
      },
    }
  }

  // Create recursive proxy for procedures
  const createRecursiveProxy = (pathSegments: string[] = []): unknown => {
    return new Proxy(
      {},
      {
        get(_target, prop: string) {
          const newPath = [...pathSegments, prop]

          // Check if this is a hook method
          if (prop === "useQuery" || prop === "useMutation") {
            const procedurePath = pathSegments.join(".")
            const hooks = createProcedureHooks(procedurePath)
            return (hooks as Record<string, unknown>)[prop]
          }

          // Otherwise, continue building the path
          return createRecursiveProxy(newPath)
        },
      },
    )
  }

  return {
    Provider,
    procedures: createRecursiveProxy() as RouterHooks<TRouter["routes"]>,
  }
}
