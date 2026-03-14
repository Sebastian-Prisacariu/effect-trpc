# DevTools Integration Plan

## Current State

DevTools module exists with:
- Effect service (`DevTools.layer`)
- Event types (Query/Mutation/Network/Stream lifecycle)
- Reactive state via `SubscriptionRef`
- Event stream via `Queue`
- Helper functions for creating events

**Not wired:** Events aren't being emitted from Client/Transport yet.

---

## Phase 1: Wire Client Hooks

### 1.1 Update Provider to include DevTools

```typescript
// src/Client/react.ts

// Add optional DevTools to context
interface TrpcContextValue {
  readonly atomRuntime: Atom.AtomRuntime<...>
  readonly layer: Layer.Layer<...>
  readonly devtools: DevToolsService | null  // NEW
  readonly rootTag: string
}

// Provider accepts optional devtools flag
interface ProviderProps {
  readonly layer: Layer.Layer<Transport.Transport>
  readonly devtools?: boolean  // NEW - enable DevTools
  readonly children: React.ReactNode
}
```

### 1.2 Emit from useQuery

```typescript
// In createUseQuery hook

const queryEffect = Effect.gen(function* () {
  const devtools = yield* Effect.serviceOption(DevTools.DevTools)
  const startTime = Date.now()
  
  // Emit start
  if (Option.isSome(devtools)) {
    yield* devtools.value.emit(DevTools.queryStarted(path, payload))
  }
  
  const result = yield* service.send(tag, payload, ...)
  
  // Emit success
  if (Option.isSome(devtools)) {
    yield* devtools.value.emit(DevTools.querySuccess(path, result, startTime))
  }
  
  return result
}).pipe(
  Effect.tapError((error) =>
    Effect.gen(function* () {
      const devtools = yield* Effect.serviceOption(DevTools.DevTools)
      if (Option.isSome(devtools)) {
        yield* devtools.value.emit(DevTools.queryError(path, error, startTime))
      }
    })
  )
)
```

### 1.3 Emit from useMutation

```typescript
// In createUseMutation hook

const mutationEffect = Effect.gen(function* () {
  const devtools = yield* Effect.serviceOption(DevTools.DevTools)
  const startTime = Date.now()
  
  // Emit start
  if (Option.isSome(devtools)) {
    yield* devtools.value.emit(DevTools.mutationStarted(path, payload))
  }
  
  const result = yield* service.send(tag, payload, ..., "mutation")
  
  // Invalidate
  if (invalidatePaths.length > 0) {
    yield* service.invalidate(invalidatePaths)
    
    // Emit invalidation
    if (Option.isSome(devtools)) {
      yield* devtools.value.emit(DevTools.cacheInvalidated(invalidatePaths, path))
    }
  }
  
  // Emit success
  if (Option.isSome(devtools)) {
    yield* devtools.value.emit(
      DevTools.mutationSuccess(path, result, startTime, invalidatePaths)
    )
  }
  
  return result
})
```

### 1.4 Emit from useStream

```typescript
// In createUseStream hook

let chunkIndex = 0
const startTime = Date.now()

// On connect
devtools?.emit(DevTools.streamStarted(path, payload))

// On each chunk
stream.pipe(
  Stream.tap((chunk) =>
    Effect.gen(function* () {
      const devtools = yield* Effect.serviceOption(DevTools.DevTools)
      if (Option.isSome(devtools)) {
        yield* devtools.value.emit(DevTools.streamChunk(path, chunk, chunkIndex++))
      }
    })
  )
)

// On end
devtools?.emit(DevTools.streamEnded(path, chunkIndex, startTime))
```

---

## Phase 2: Wire Transport

### 2.1 Wrap HTTP transport with DevTools

```typescript
// src/Transport/index.ts

export const withDevTools = (
  transport: TransportService
): Effect.Effect<TransportService, never, DevTools.DevTools> =>
  Effect.gen(function* () {
    const devtools = yield* DevTools.DevTools
    
    return {
      send: (request) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          const eventId = DevTools.generateEventId()
          
          // Emit request
          yield* devtools.emit(DevTools.networkRequest(
            "POST",
            request.tag,
            request.payload,
            false // isBatch
          ))
          
          const response = yield* transport.send(request)
          
          // Emit response
          yield* devtools.emit(DevTools.networkResponse(
            eventId,
            200, // Would need actual status
            response,
            startTime
          ))
          
          return response
        }),
      
      sendStream: transport.sendStream, // Pass through for now
    }
  })
```

### 2.2 Wrap Batching with DevTools

```typescript
// src/Transport/batching.ts

// In processBatch function
yield* devtools.emit(DevTools.networkRequest(
  "POST",
  url,
  batchRequest,
  true // isBatch = true
))
```

---

## Phase 3: React Panel UI

### 3.1 Panel Component Structure

```
DevToolsPanel/
├── index.tsx          # Main floating panel
├── QueryList.tsx      # Query inspector
├── MutationLog.tsx    # Mutation history
├── NetworkLog.tsx     # Request/response log
├── CacheViewer.tsx    # Cache tree view
├── EventStream.tsx    # Raw event log
└── styles.css         # Panel styling
```

### 3.2 Panel Features

| Tab | Shows |
|-----|-------|
| Queries | Active queries, status badges, data preview, refetch button |
| Mutations | History log, payload/response, invalidation chain |
| Network | Request/response pairs, timing, batch indicator |
| Cache | Tree view of cached data by path |
| Events | Raw event stream with filters |

### 3.3 State Subscription

```tsx
function DevToolsPanel() {
  const [state, setState] = useState<DevToolsState | null>(null)
  const devtools = useDevTools() // From context
  
  useEffect(() => {
    const fiber = Effect.runFork(
      devtools.stateChanges.pipe(
        Stream.tap((s) => Effect.sync(() => setState(s))),
        Stream.runDrain
      )
    )
    return () => Effect.runPromise(Fiber.interrupt(fiber))
  }, [devtools])
  
  return (
    <FloatingPanel>
      <Tabs>
        <Tab label="Queries"><QueryList queries={state?.queries} /></Tab>
        <Tab label="Mutations"><MutationLog mutations={state?.mutations} /></Tab>
        <Tab label="Network"><NetworkLog log={state?.networkLog} /></Tab>
        <Tab label="Events"><EventStream events={state?.events} /></Tab>
      </Tabs>
    </FloatingPanel>
  )
}
```

---

## Phase 4: Optional Browser Extension

### 4.1 Architecture

```
┌─────────────┐     postMessage     ┌──────────────┐
│   App Tab   │ ◄────────────────► │  DevTools    │
│  (content)  │                     │   Panel      │
└─────────────┘                     └──────────────┘
```

### 4.2 Content Script Bridge

```typescript
// Inject into page, forward events to extension
window.addEventListener("effect-trpc-devtools", (e) => {
  chrome.runtime.sendMessage(e.detail)
})
```

### 4.3 Extension Panel

- Separate React app in extension popup/panel
- Receives events via `chrome.runtime.onMessage`
- Same UI components as floating panel

---

## Implementation Order

1. **Phase 1.1-1.2**: Wire useQuery (2h)
2. **Phase 1.3**: Wire useMutation (1h)
3. **Phase 1.4**: Wire useStream (1h)
4. **Phase 2.1-2.2**: Wire Transport (2h)
5. **Phase 3.1-3.3**: Build React Panel (4-6h)
6. **Phase 4**: Browser extension (optional, 4h)

**Total: ~10-12h for full integration**

---

## Testing

```typescript
describe("DevTools", () => {
  it("emits query lifecycle events", async () => {
    const events: DevToolsEvent[] = []
    
    // Subscribe to events
    await Effect.runPromise(
      devtools.events.pipe(
        Stream.take(3),
        Stream.tap((e) => Effect.sync(() => events.push(e))),
        Stream.runDrain
      )
    )
    
    // Trigger query
    await api.users.list.runPromise()
    
    expect(events[0]._tag).toBe("QueryStarted")
    expect(events[1]._tag).toBe("NetworkRequest")
    expect(events[2]._tag).toBe("QuerySuccess")
  })
})
```

---

## Open Questions

1. **Performance**: Should DevTools be tree-shaken in production builds?
2. **Serialization**: How to handle non-serializable data in events?
3. **Time Travel**: Worth adding state snapshots for replay?
