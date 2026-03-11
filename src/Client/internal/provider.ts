/**
 * React Provider implementation
 * @internal
 */

import { Effect, Layer, Runtime, ManagedRuntime } from "effect"
import { Transport } from "../../Transport/index.js"

interface ClientState {
  runtime: Runtime.Runtime<Transport> | null
  cache: Map<string, any>
  listeners: Map<string, Set<() => void>>
  invalidate: (keys: ReadonlyArray<string>) => void
  subscribe: (key: string, listener: () => void) => () => void
  getSnapshot: <A, E>(key: string) => any
  fetch: <A, E>(key: string, path: string, payload: unknown) => any
}

interface ProviderProps {
  readonly children: any
  readonly layer: Layer.Layer<Transport, never, never>
}

/**
 * Create a Provider component
 * 
 * Note: This is a simplified implementation. In production,
 * this would use React.createElement and proper React context.
 */
export const makeProvider = (state: ClientState) => {
  // This is a factory that returns a component function
  return function Provider(props: ProviderProps) {
    // In real React, we would:
    // 1. Create a runtime from the layer
    // 2. Store it in context
    // 3. Clean up on unmount
    
    // For now, initialize the runtime synchronously (not ideal, but works for basic cases)
    if (!state.runtime) {
      // Create runtime from layer
      const runtimeEffect = Effect.gen(function* () {
        return yield* Effect.runtime<Transport>()
      }).pipe(Effect.provide(props.layer))
      
      // Run synchronously to get runtime
      // In real implementation, would use useEffect + useState
      Effect.runPromise(runtimeEffect).then((runtime) => {
        state.runtime = runtime
      })
    }
    
    // Return children (in real React, would wrap in Context.Provider)
    return props.children
  }
}

/**
 * Create a Provider with proper lifecycle (async)
 */
export const makeProviderAsync = (state: ClientState) => {
  let cleanup: (() => void) | null = null
  
  return {
    mount: async (layer: Layer.Layer<Transport, never, never>) => {
      const managedRuntime = ManagedRuntime.make(layer)
      state.runtime = await managedRuntime.runtime()
      
      cleanup = () => {
        Effect.runPromise(managedRuntime.dispose())
      }
    },
    
    unmount: () => {
      if (cleanup) {
        cleanup()
        cleanup = null
      }
      state.runtime = null
    },
  }
}
