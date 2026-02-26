/**
 * @module effect-trpc/react/runtime-context
 *
 * Runtime injection context for effect-trpc React hooks.
 * 
 * This module provides the React context for runtime injection,
 * enabling hooks to execute Effects through an app-provided runtime.
 *
 * @since 1.0.0
 */

import * as React from "react"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import type { Client } from "../core/client/index.js"

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimum service requirements for the TRPC runtime.
 * 
 * The app-provided runtime must include at least the `Client` service.
 * Additional services can be included for domain-specific needs.
 *
 * @since 1.0.0
 * @category types
 */
export type TRPCRuntimeServices = Client

/**
 * The runtime type that must be provided to EffectTRPCProvider.
 * 
 * @example
 * ```ts
 * import { ManagedRuntime, Layer } from "effect"
 * import { Client } from "effect-trpc"
 * 
 * // Create runtime with TRPC client + your domain services
 * const AppLive = Layer.mergeAll(
 *   Client.HttpLive("/api/trpc"),
 *   UserServiceLive,
 *   AuthServiceLive,
 * )
 * 
 * const appRuntime = ManagedRuntime.make(AppLive)
 * ```
 *
 * @since 1.0.0
 * @category types
 */
export type TRPCRuntime<R extends TRPCRuntimeServices = TRPCRuntimeServices> = 
  ManagedRuntime.ManagedRuntime<R, never>

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal context value shape.
 * @internal
 */
export interface RuntimeContextValue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly runtime: TRPCRuntime<any>
}

/**
 * React context for the TRPC runtime.
 * 
 * @internal
 */
export const RuntimeContext = React.createContext<RuntimeContextValue | null>(null)

/**
 * Hook to access the injected runtime.
 * 
 * @throws Error if used outside of EffectTRPCProvider
 * 
 * @example
 * ```ts
 * function MyComponent() {
 *   const runtime = useRuntime()
 *   
 *   // Execute an effect using the runtime
 *   const handleClick = async () => {
 *     const result = await runtime.runPromise(myEffect)
 *   }
 * }
 * ```
 *
 * @since 1.0.0
 * @category hooks
 */
export function useRuntime<R extends TRPCRuntimeServices = TRPCRuntimeServices>(): TRPCRuntime<R> {
  const context = React.useContext(RuntimeContext)
  
  if (context === null) {
    throw new Error(
      "[effect-trpc] useRuntime must be used within an EffectTRPCProvider. " +
      "Wrap your app with <EffectTRPCProvider runtime={appRuntime}>..."
    )
  }
  
  return context.runtime as TRPCRuntime<R>
}

/**
 * Check if we're inside an EffectTRPCProvider.
 * Useful for conditional rendering or fallback behavior.
 *
 * @since 1.0.0
 * @category hooks
 */
export function useHasRuntime(): boolean {
  const context = React.useContext(RuntimeContext)
  return context !== null
}
