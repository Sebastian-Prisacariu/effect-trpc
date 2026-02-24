# DECISION-009: Network & Gate System

**Date:** 2026-02-24  
**Status:** Implemented (v1 complete, offline queue deferred)  
**Impacts:** React hooks, client configuration, offline support, SSR/hydration

---

## Summary

Design for a unified network status and flow control system that:
1. Provides a **Gate** primitive for flow control (semaphore-based)
2. Provides a **Network** service for online/offline detection
3. Handles **SSR/Client/Hydration** correctly
4. Integrates with **automatic refetching** (PR #1)
5. Supports **opt-in offline features** (queue, persistence)

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gate primitive | Exposed via `Gate.*` | Users can create custom gates |
| Network service | Context.Tag-based | Proper Effect service pattern |
| Detection strategy | Browser events (default) | Works everywhere including serverless |
| WebSocket detection | Optional (non-serverless) | More reliable but requires long-running server |
| Offline queue | Opt-in only | Not all apps need offline support |
| SSR handling | Always online on server | No browser APIs available |
| Hydration | Deferred state sync | Avoid mismatch warnings |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client                                          │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         Gate Primitive                                   ││
│  │  • Binary semaphore (open/closed)                                        ││
│  │  • Configurable behavior when closed (wait/fail/queue)                   ││
│  │  • Observable state via SubscriptionRef                                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                         │
│                    ┌───────────────┼───────────────┐                        │
│                    │               │               │                        │
│                    ▼               ▼               ▼                        │
│  ┌─────────────────────┐ ┌─────────────────┐ ┌─────────────────────┐       │
│  │   Network Service   │ │   Auth Gate     │ │   Custom Gates      │       │
│  │   (built-in)        │ │   (example)     │ │   (user-defined)    │       │
│  └─────────────────────┘ └─────────────────┘ └─────────────────────┘       │
│            │                                                                 │
│            ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                      Offline Queue (opt-in)                              ││
│  │  • Queues mutations when offline                                         ││
│  │  • Processes when back online                                            ││
│  │  • Persistence: memory / localStorage / IndexedDB                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Gate Primitive

### API Design

Following the `[Domain].[action]` naming pattern:

```typescript
import { Gate } from 'effect-trpc'

// ═══════════════════════════════════════════════════════════════════════════
// Creating Gates
// ═══════════════════════════════════════════════════════════════════════════

const authGate = yield* Gate.make('auth', {
  initiallyOpen: false,
  closedBehavior: 'fail',  // 'wait' | 'fail' | 'queue'
})

// ═══════════════════════════════════════════════════════════════════════════
// Controlling Gates
// ═══════════════════════════════════════════════════════════════════════════

yield* Gate.open(authGate)
yield* Gate.close(authGate)
yield* Gate.toggle(authGate)

// ═══════════════════════════════════════════════════════════════════════════
// Using Gates
// ═══════════════════════════════════════════════════════════════════════════

// Run effect only when gate is open
yield* Gate.whenOpen(authGate, myEffect)

// Compose multiple gates
yield* Gate.whenAllOpen([authGate, networkGate], myEffect)

// ═══════════════════════════════════════════════════════════════════════════
// Observing Gates
// ═══════════════════════════════════════════════════════════════════════════

// Effect-based
const isOpen = yield* Gate.isOpen(authGate)
yield* Gate.awaitOpen(authGate)
yield* Gate.awaitClose(authGate)

// Stream-based (for subscriptions)
const changes: Stream.Stream<boolean> = Gate.changes(authGate)

// Callback-based (for React integration)
const cleanup = Gate.subscribe(authGate, (isOpen) => {
  console.log('Gate is now:', isOpen ? 'open' : 'closed')
})
```

### Implementation

```typescript
import { Effect, SubscriptionRef, Scope, Stream } from 'effect'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type ClosedBehavior = 'wait' | 'fail' | 'queue'

export interface GateState {
  readonly isOpen: boolean
  readonly closedAt: number | null
  readonly openedAt: number | null
}

export interface Gate {
  readonly _tag: 'Gate'
  readonly name: string
  readonly state: SubscriptionRef.SubscriptionRef<GateState>
  readonly semaphore: Effect.Semaphore
  readonly closedBehavior: ClosedBehavior
}

// ═══════════════════════════════════════════════════════════════════════════
// Constructor
// ═══════════════════════════════════════════════════════════════════════════

export const make = (
  name: string,
  options: {
    initiallyOpen?: boolean
    closedBehavior?: ClosedBehavior
  } = {}
): Effect.Effect<Gate, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { initiallyOpen = true, closedBehavior = 'wait' } = options
    
    const semaphore = yield* Effect.makeSemaphore(initiallyOpen ? 1 : 0)
    const state = yield* SubscriptionRef.make<GateState>({
      isOpen: initiallyOpen,
      closedAt: initiallyOpen ? null : Date.now(),
      openedAt: initiallyOpen ? Date.now() : null,
    })
    
    return {
      _tag: 'Gate' as const,
      name,
      state,
      semaphore,
      closedBehavior,
    }
  })

// ═══════════════════════════════════════════════════════════════════════════
// Control
// ═══════════════════════════════════════════════════════════════════════════

export const open = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (current.isOpen) return
    
    yield* gate.semaphore.release(1)
    yield* SubscriptionRef.set(gate.state, {
      isOpen: true,
      closedAt: current.closedAt,
      openedAt: Date.now(),
    })
  })

export const close = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (!current.isOpen) return
    
    yield* gate.semaphore.take(1)
    yield* SubscriptionRef.set(gate.state, {
      isOpen: false,
      closedAt: Date.now(),
      openedAt: current.openedAt,
    })
  })

// ═══════════════════════════════════════════════════════════════════════════
// Usage
// ═══════════════════════════════════════════════════════════════════════════

export const whenOpen = <A, E, R>(
  gate: Gate,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | GateClosedError, R> => {
  switch (gate.closedBehavior) {
    case 'wait':
      return gate.semaphore.withPermit(effect)
    
    case 'fail':
      return Effect.gen(function* () {
        const state = yield* SubscriptionRef.get(gate.state)
        if (!state.isOpen) {
          return yield* Effect.fail(new GateClosedError({ gate: gate.name }))
        }
        return yield* gate.semaphore.withPermit(effect)
      })
    
    case 'queue':
      // Queue behavior is handled by OfflineQueue integration
      return gate.semaphore.withPermit(effect)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Observation
// ═══════════════════════════════════════════════════════════════════════════

export const isOpen = (gate: Gate): Effect.Effect<boolean> =>
  SubscriptionRef.get(gate.state).pipe(Effect.map(s => s.isOpen))

export const awaitOpen = (gate: Gate): Effect.Effect<void> =>
  Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(gate.state)
    if (current.isOpen) return
    
    yield* SubscriptionRef.changes(gate.state).pipe(
      Stream.filter(s => s.isOpen),
      Stream.take(1),
      Stream.runDrain
    )
  })

export const changes = (gate: Gate): Stream.Stream<boolean> =>
  SubscriptionRef.changes(gate.state).pipe(
    Stream.map(s => s.isOpen),
    Stream.changes
  )

// Callback-based for React (returns cleanup function)
export const subscribe = (
  gate: Gate,
  callback: (isOpen: boolean) => void
): () => void => {
  const fiber = Effect.runFork(
    changes(gate).pipe(
      Stream.tap(isOpen => Effect.sync(() => callback(isOpen))),
      Stream.runDrain
    )
  )
  return () => Effect.runFork(Fiber.interrupt(fiber))
}
```

---

## Part 2: Network Service

### Design Goals

1. **Context.Tag-based** — Proper Effect service pattern
2. **SSR-safe** — Works on server (always online) and client (browser APIs)
3. **Hydration-safe** — No mismatch between server and client render
4. **Extensible** — Support multiple detection strategies

### Service Interface

```typescript
import { Context, Effect, Stream, Layer, SubscriptionRef } from 'effect'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface NetworkState {
  readonly isOnline: boolean
  readonly lastOnlineAt: number | null
  readonly lastOfflineAt: number | null
}

export type NetworkDetector = 
  | 'browser'     // navigator.onLine + events (default, works everywhere)
  | 'websocket'   // WebSocket connection state (more reliable, requires WS)
  | 'none'        // Always online (disable detection)

// ═══════════════════════════════════════════════════════════════════════════
// Service Interface
// ═══════════════════════════════════════════════════════════════════════════

export interface NetworkService {
  // ─────────────────────────────────────────────────────────────────────────
  // State (Effect-based)
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Current online status */
  readonly isOnline: Effect.Effect<boolean>
  
  /** Full state including timestamps */
  readonly state: Effect.Effect<NetworkState>
  
  /** Wait until online */
  readonly awaitOnline: Effect.Effect<void>
  
  /** Wait until offline */
  readonly awaitOffline: Effect.Effect<void>
  
  // ─────────────────────────────────────────────────────────────────────────
  // Reactive (Stream-based)
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Stream of online/offline changes */
  readonly changes: Stream.Stream<boolean>
  
  // ─────────────────────────────────────────────────────────────────────────
  // Gating
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Run effect when online (waits if offline) */
  readonly whenOnline: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | NetworkOfflineError, R>
  
  /** Run effect when offline (waits if online) */
  readonly whenOffline: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>
  
  // ─────────────────────────────────────────────────────────────────────────
  // Gate Access (for composition)
  // ─────────────────────────────────────────────────────────────────────────
  
  /** The underlying gate */
  readonly gate: Gate
  
  // ─────────────────────────────────────────────────────────────────────────
  // Callback-based (for React hooks)
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Subscribe to online status changes */
  readonly subscribe: (callback: (isOnline: boolean) => void) => () => void
  
  /** Subscribe specifically to reconnect events */
  readonly subscribeToReconnect: (callback: () => void) => () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Context.Tag
// ═══════════════════════════════════════════════════════════════════════════

export class Network extends Context.Tag('@effect-trpc/Network')<
  Network,
  NetworkService
>() {}
```

### Implementation: Browser Detector

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// Browser-based Network Detection
// ═══════════════════════════════════════════════════════════════════════════

const makeBrowserNetworkService = Effect.gen(function* () {
  const scope = yield* Effect.scope
  
  // Determine initial state
  const initialOnline = typeof navigator !== 'undefined' 
    ? navigator.onLine 
    : true  // SSR: assume online
  
  // Create underlying gate
  const gate = yield* Gate.make('network', {
    initiallyOpen: initialOnline,
    closedBehavior: 'wait',
  })
  
  // State with timestamps
  const stateRef = yield* SubscriptionRef.make<NetworkState>({
    isOnline: initialOnline,
    lastOnlineAt: initialOnline ? Date.now() : null,
    lastOfflineAt: initialOnline ? null : Date.now(),
  })
  
  // Set up browser event listeners (client-side only)
  if (typeof window !== 'undefined') {
    const handleOnline = () => {
      Effect.runSync(Effect.gen(function* () {
        yield* Gate.open(gate)
        yield* SubscriptionRef.update(stateRef, s => ({
          ...s,
          isOnline: true,
          lastOnlineAt: Date.now(),
        }))
      }))
    }
    
    const handleOffline = () => {
      Effect.runSync(Effect.gen(function* () {
        yield* Gate.close(gate)
        yield* SubscriptionRef.update(stateRef, s => ({
          ...s,
          isOnline: false,
          lastOfflineAt: Date.now(),
        }))
      }))
    }
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    yield* Scope.addFinalizer(scope, Effect.sync(() => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }))
  }
  
  // Build service
  const service: NetworkService = {
    isOnline: SubscriptionRef.get(stateRef).pipe(Effect.map(s => s.isOnline)),
    state: SubscriptionRef.get(stateRef),
    awaitOnline: Gate.awaitOpen(gate),
    awaitOffline: Gate.awaitClose(gate),
    
    changes: SubscriptionRef.changes(stateRef).pipe(
      Stream.map(s => s.isOnline),
      Stream.changes
    ),
    
    whenOnline: (effect) => Gate.whenOpen(gate, effect),
    whenOffline: (effect) => Effect.gen(function* () {
      yield* Gate.awaitClose(gate)
      return yield* effect
    }),
    
    gate,
    
    subscribe: (callback) => Gate.subscribe(gate, callback),
    
    subscribeToReconnect: (callback) => {
      if (typeof window === 'undefined') return () => {}
      
      const handler = () => callback()
      window.addEventListener('online', handler)
      return () => window.removeEventListener('online', handler)
    },
  }
  
  return service
})

export const NetworkLive = Layer.scoped(Network, makeBrowserNetworkService)
```

### SSR / Hydration Strategy

The challenge: Server renders with `isOnline: true`, but client might be offline.

**Strategy: Deferred Client State**

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// React Hook with Hydration Safety
// ═══════════════════════════════════════════════════════════════════════════

export function useNetworkStatus(): {
  isOnline: boolean
  isHydrated: boolean
} {
  // Start with server-safe value (true)
  const [isOnline, setIsOnline] = React.useState(true)
  const [isHydrated, setIsHydrated] = React.useState(false)
  
  React.useEffect(() => {
    // Now on client - get real value
    setIsOnline(navigator.onLine)
    setIsHydrated(true)
    
    // Subscribe to changes
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])
  
  return { isOnline, isHydrated }
}
```

**Why this works:**
1. **Server render:** `isOnline: true`, `isHydrated: false`
2. **Initial client render:** Same values (no mismatch!)
3. **After useEffect:** Real values, `isHydrated: true`
4. **UI can use `isHydrated`** to show loading state or defer offline UI

```tsx
function OfflineBanner() {
  const { isOnline, isHydrated } = trpc.network.useStatus()
  
  // Don't show banner until we know the real state
  if (!isHydrated) return null
  if (isOnline) return null
  
  return <div className="offline-banner">You are offline</div>
}
```

---

## Part 3: Integration with PR #1 (Automatic Refetching)

### Current PR Approach

```typescript
// signals.ts (current)
export const subscribeToNetworkReconnect = (callback: () => void) => {
  window.addEventListener('online', handleOnline)
  // ...
}

// create-client.ts (current)
React.useEffect(() => {
  if (!refetchOnReconnect) return
  return subscribeToNetworkReconnect(() => {
    if (isStale(...)) refetch()
  })
}, [...])
```

### Unified Approach

Replace standalone `subscribeToNetworkReconnect` with Network service:

```typescript
// signals.ts (updated) - re-export from Network for backward compatibility
export { subscribeToNetworkReconnect } from './network.js'

// network.ts (new)
export const subscribeToNetworkReconnect = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {}
  
  const handler = () => callback()
  window.addEventListener('online', handler)
  return () => window.removeEventListener('online', handler)
}

// Also export the full Network service for advanced use
export { Network, NetworkLive } from './services/Network.js'
```

**No breaking changes:** The PR's approach continues to work, but now it's part of the unified Network module.

---

## Part 4: Client Configuration

```typescript
export interface CreateTRPCReactOptions {
  readonly url: string
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Network Configuration
  // ═══════════════════════════════════════════════════════════════════════════
  
  readonly network?: {
    /**
     * How to detect online/offline status.
     * - 'browser': Use navigator.onLine + events (default, works everywhere)
     * - 'websocket': Use WebSocket connection state (requires WS support)
     * - 'none': Always online (disable detection)
     * @default 'browser'
     */
    detector?: NetworkDetector
    
    /**
     * Gate configuration.
     * @default { mode: 'auto' }
     */
    gate?: {
      /**
       * Gate mode.
       * - 'off': Gate always open (no gating)
       * - 'auto': Gate opens/closes based on detector
       * - 'manual': User controls via Network.gate
       * @default 'auto'
       */
      mode?: 'off' | 'auto' | 'manual'
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Validation
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Validate mutation input client-side before sending.
   * Fails fast with ParseError if input doesn't match schema.
   * @default false
   */
  readonly clientSideValidation?: boolean
  
  // ═══════════════════════════════════════════════════════════════════════════
  // Offline Features (all opt-in)
  // ═══════════════════════════════════════════════════════════════════════════
  
  readonly offline?: {
    /**
     * Queue mutations when offline, process when back online.
     */
    queue?: {
      enabled: boolean
      maxSize?: number           // Default: 100
      maxRetries?: number        // Default: 3
      persistence?: 'memory' | 'localStorage' | 'indexedDB'  // Default: 'memory'
    }
    
    /**
     * Conflict resolution strategy.
     * @default 'last-write-wins'
     */
    conflictResolution?: 'last-write-wins' | ConflictResolver
    
    /**
     * Rollback optimistic updates when queued mutation fails.
     * @default true
     */
    rollbackOnFailure?: boolean
  }
  
  // ... existing options (defaultQueryOptions, etc.)
}
```

---

## Part 5: React Hooks

Following domain-specific naming:

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// Network Hooks
// ═══════════════════════════════════════════════════════════════════════════

// trpc.network.useStatus()
interface UseNetworkStatusReturn {
  isOnline: boolean
  isHydrated: boolean
  lastOnlineAt: number | null
  lastOfflineAt: number | null
}

// trpc.network.useGate()
interface UseGateReturn {
  isOpen: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// Offline Queue Hooks (only available if offline.queue.enabled)
// ═══════════════════════════════════════════════════════════════════════════

// trpc.offline.useQueue()
interface UseOfflineQueueReturn {
  count: number
  processing: boolean
  failedCount: number
  clear: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Custom Gate Hooks
// ═══════════════════════════════════════════════════════════════════════════

// trpc.gate.useStatus(gate)
const isOpen = trpc.gate.useStatus(myCustomGate)
```

---

## Part 6: What's Always Enabled vs Opt-In

### Always Enabled (Zero Config)

| Feature | Description |
|---------|-------------|
| `Gate.*` primitive | Create/use custom gates |
| `Network.isOnline` | Check online status |
| `Network.changes` | Subscribe to status changes |
| `Network.subscribe` | Callback-based subscription |
| `refetchOnReconnect` | Auto-refetch on reconnect (from PR #1) |
| `trpc.network.useStatus()` | React hook for status |

### Opt-In Features

| Feature | Config | Description |
|---------|--------|-------------|
| Offline queue | `offline.queue.enabled: true` | Queue mutations offline |
| Queue persistence | `offline.queue.persistence` | localStorage/IndexedDB |
| Conflict resolution | `offline.conflictResolution` | Custom resolver |
| Client validation | `clientSideValidation: true` | Validate before sending |
| Network gating | `network.gate.mode` | Control request flow |

---

## Part 7: File Structure

```
packages/effect-trpc/src/
├── core/
│   ├── gate/
│   │   ├── index.ts          # Gate.* exports
│   │   ├── Gate.ts           # Gate primitive implementation
│   │   └── errors.ts         # GateClosedError
│   │
│   └── network/
│       ├── index.ts          # Network.* exports
│       ├── Network.ts        # NetworkService implementation
│       ├── detectors/
│       │   ├── browser.ts    # Browser event detector
│       │   └── websocket.ts  # WebSocket detector (future)
│       └── errors.ts         # NetworkOfflineError
│
├── offline/
│   ├── index.ts              # Offline.* exports
│   ├── OfflineQueue.ts       # Queue implementation
│   ├── storage/
│   │   ├── memory.ts
│   │   ├── localStorage.ts
│   │   └── indexedDB.ts
│   └── conflicts.ts          # Conflict resolution
│
└── react/
    ├── hooks/
    │   ├── useNetworkStatus.ts
    │   ├── useGate.ts
    │   └── useOfflineQueue.ts
    └── signals.ts            # Updated to use Network internally
```

---

## Part 8: Migration Path

### For PR #1

Minimal changes needed:

```typescript
// Before (signals.ts)
export const subscribeToNetworkReconnect = (callback) => {
  window.addEventListener('online', callback)
  return () => window.removeEventListener('online', callback)
}

// After (signals.ts)
// Keep the same export for backward compatibility
export const subscribeToNetworkReconnect = (callback: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', callback)
  return () => window.removeEventListener('online', callback)
}

// Add new Network service exports
export { Network } from '../core/network/index.js'
```

**No breaking changes to PR #1.** The `subscribeToNetworkReconnect` function stays the same.

---

## Open Questions

1. **WebSocket detector priority:** Should we auto-detect if WebSocket is available and prefer it?
   - **Recommendation:** No, explicit opt-in via `detector: 'websocket'`

2. **Queue ordering:** FIFO or priority-based?
   - **Recommendation:** FIFO default, opt-in priority via `queue.ordering: 'priority'`

3. **Queue deduplication:** Dedupe same mutation queued twice?
   - **Recommendation:** No deduplication by default (different inputs)

---

## Summary

| Component | Namespace | Always Enabled? |
|-----------|-----------|-----------------|
| Gate primitive | `Gate.*` | Yes |
| Network service | `Network.*` | Yes |
| Network hooks | `trpc.network.*` | Yes |
| Offline queue | `trpc.offline.*` | No (opt-in) |
| Client validation | Config option | No (opt-in) |

This design:
- **Unifies** network detection with PR #1's approach
- **Exposes** Gate primitive for custom flow control
- **Handles** SSR/hydration correctly
- **Keeps** offline features opt-in
- **Follows** `[Domain].[action]` naming pattern
