/**
 * @module effect-trpc/react/provider
 *
 * EffectTRPCProvider - Runtime injection provider for effect-trpc.
 *
 * @since 1.0.0
 */

import * as React from "react"
import { RegistryProvider } from "./atoms.js"
import { RuntimeContext, type RuntimeContextValue, type TRPCRuntime, type TRPCRuntimeServices } from "./runtime-context.js"

// ─────────────────────────────────────────────────────────────────────────────
// Provider Props
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Props for EffectTRPCProvider.
 *
 * @since 1.0.0
 * @category types
 */
export interface EffectTRPCProviderProps<R extends TRPCRuntimeServices = TRPCRuntimeServices> {
  /**
   * The ManagedRuntime to use for executing Effects.
   * 
   * Must provide at least the `Client` service.
   * Can include additional domain services.
   *
   * @example
   * ```ts
   * import { ManagedRuntime, Layer } from "effect"
   * import { Client } from "effect-trpc"
   * 
   * const AppLive = Layer.mergeAll(
   *   Client.HttpLive("/api/trpc"),
   *   UserServiceLive,
   * )
   * 
   * const appRuntime = ManagedRuntime.make(AppLive)
   * 
   * <EffectTRPCProvider runtime={appRuntime}>
   *   <App />
   * </EffectTRPCProvider>
   * ```
   */
  readonly runtime: TRPCRuntime<R>

  /**
   * Children to render.
   */
  readonly children: React.ReactNode

  /**
   * How long unused/inactive cache data remains in memory (ms).
   * After this time, unmounted queries are garbage collected.
   *
   * Set to `Infinity` to keep query data indefinitely (no garbage collection).
   *
   * @default Infinity (no garbage collection)
   */
  readonly gcTime?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provider component that injects the Effect runtime into React.
 *
 * All effect-trpc hooks must be used within this provider.
 * The provider manages the atom registry for caching and the runtime context.
 *
 * @example
 * ```tsx
 * // app/providers.tsx
 * "use client"
 * 
 * import { ManagedRuntime, Layer } from "effect"
 * import { EffectTRPCProvider, Client } from "effect-trpc/react"
 * 
 * // Create your app runtime with TRPC client + domain services
 * const AppLive = Layer.mergeAll(
 *   Client.HttpLive("/api/trpc"),
 *   UserServiceLive,
 *   AuthServiceLive,
 * )
 * 
 * const appRuntime = ManagedRuntime.make(AppLive)
 * 
 * export function Providers({ children }: { children: React.ReactNode }) {
 *   return (
 *     <EffectTRPCProvider runtime={appRuntime} gcTime={5 * 60 * 1000}>
 *       {children}
 *     </EffectTRPCProvider>
 *   )
 * }
 * ```
 *
 * @since 1.0.0
 * @category components
 */
export function EffectTRPCProvider<R extends TRPCRuntimeServices>({
  runtime,
  children,
  gcTime,
}: EffectTRPCProviderProps<R>): React.ReactElement {
  // Memoize context value to prevent unnecessary re-renders
  const contextValue: RuntimeContextValue = React.useMemo(
    () => ({ runtime }),
    [runtime],
  )

  // Determine if we should set idle TTL for garbage collection
  const shouldSetIdleTTL =
    gcTime !== undefined && gcTime !== Infinity && Number.isFinite(gcTime)

  return (
    <RuntimeContext.Provider value={contextValue}>
      <RegistryProvider {...(shouldSetIdleTTL ? { defaultIdleTTL: gcTime } : {})}>
        {children}
      </RegistryProvider>
    </RuntimeContext.Provider>
  )
}
