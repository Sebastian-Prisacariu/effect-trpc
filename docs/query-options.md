# Query Options

Configure caching, revalidation, polling, and retry behavior for queries.

---

## Global Defaults

Set defaults for all queries in `createClient`:

```typescript
import { createClient, isTransientError } from "effect-trpc/client"
import { Duration, Schedule } from "effect"

const api = createClient<AppRouter>({
  url: "/api/trpc",
  defaults: {
    // Cache behavior
    idleTTL: Duration.minutes(5),           // Keep cached 5 min after unmount
    staleTime: Duration.minutes(1),         // Consider fresh for 1 min
    keepAlive: false,                       // Don't keep forever by default
    
    // Revalidation triggers
    refetchOnWindowFocus: true,             // Refetch when tab regains focus
    refetchOnReconnect: true,               // Refetch when back online
    refetchInterval: undefined,             // No polling by default
    
    // Client retry (transient errors only)
    retry: {
      schedule: Schedule.exponential(Duration.seconds(1)).pipe(
        Schedule.compose(Schedule.recurs(3))
      ),
      when: isTransientError,
    },
  },
})
```

---

## Per-Query Overrides

Override any default on a per-query basis:

```typescript
const query = api.user.list.useQuery({
  staleTime: Duration.seconds(30),
  idleTTL: Duration.minutes(10),
  keepAlive: true,
  // ... any option
})
```

---

## Option Reference

### Cache Behavior

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idleTTL` | `Duration` | `5 minutes` | How long to keep data in cache after all subscribers unmount |
| `staleTime` | `Duration` | `1 minute` | How long until data is considered stale and needs revalidation |
| `keepAlive` | `boolean` | `false` | Never garbage collect (alias for `idleTTL: Duration.infinity`) |

### Revalidation Triggers

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `refetchOnWindowFocus` | `boolean` | `true` | Refetch when browser tab regains focus |
| `refetchOnReconnect` | `boolean` | `true` | Refetch when network comes back online |
| `refetchInterval` | `Duration \| Schedule` | `undefined` | Poll at interval (see Polling section) |
| `enabled` | `boolean` | `true` | Enable/disable the query |

### Retry

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retry.schedule` | `Schedule` | `exponential(1s) + recurs(3)` | Retry timing (uses Effect Schedule) |
| `retry.when` | `(error) => boolean` | `isTransientError` | Which errors to retry |

---

## Polling

### Simple Polling (Duration)

```typescript
const query = api.user.list.useQuery({
  refetchInterval: Duration.seconds(10),  // Every 10 seconds
})
```

### Advanced Polling (Schedule)

Use Effect's `Schedule` for fine-grained control:

```typescript
// Only poll when tab is visible
const query = api.user.list.useQuery({
  refetchInterval: Schedule.spaced(Duration.seconds(10)).pipe(
    Schedule.whileOutput(() => document.visibilityState === "visible")
  ),
})

// Exponential backoff polling (useful for waiting on async jobs)
const query = api.job.status.useQuery({ jobId }, {
  refetchInterval: Schedule.exponential(Duration.seconds(1)).pipe(
    Schedule.compose(Schedule.recurs(10))  // Max 10 polls
  ),
})
```

### Conditional Polling

```typescript
const [isLive, setIsLive] = useState(false)

const query = api.user.list.useQuery({
  refetchInterval: isLive ? Duration.seconds(5) : undefined,
})
```

---

## Manual Refresh

### Via Hook

```typescript
function UserList() {
  const refresh = api.user.list.useRefresh()
  
  return <button onClick={() => refresh()}>Refresh</button>
}
```

### Via Query Result

```typescript
function UserList() {
  const query = api.user.list.useQuery()
  
  return <button onClick={() => query.refresh()}>Refresh</button>
}
```

---

## Retry Behavior

### Client vs Server Retry

**Client retry** is for transient/network errors:
- Connection refused
- Timeout
- 502, 503, 504 (server unavailable)
- 429 (rate limited) — with backoff

**Server retry** is for infrastructure errors:
- Database connection dropped
- External API flaky

**Don't retry** business errors:
- 400 Bad Request
- 401 Unauthorized
- Typed errors (ValidationError, NotFoundError, etc.)

### ⚠️ Retry Multiplication Warning

```typescript
// Client: 3 retries
retry: { schedule: Schedule.recurs(3) }

// Server handler: 2 retries
Effect.retry(dbCall, Schedule.recurs(2))

// Total worst case: 3 × 3 = 9 database calls!
```

**Recommendation**: Handle transient errors at one layer. Usually:
- Client retries network failures
- Server retries database/external service failures

### Custom Retry Logic

```typescript
const query = api.user.list.useQuery({
  retry: {
    schedule: Schedule.exponential(Duration.millis(500)).pipe(
      Schedule.compose(Schedule.recurs(5))
    ),
    when: (error) => {
      // Custom logic
      if (error instanceof HttpError && error.status === 429) {
        return true  // Retry rate limits
      }
      return isTransientError(error)
    },
  },
})
```

---

## Automatic Invalidation

Queries automatically subscribe to invalidation based on their path:

```typescript
// This query subscribes to keys:
// ["user", "user.list"]
api.user.list.useQuery()

// This mutation invalidates:
Procedure.mutation({
  invalidates: ["user.list"],  // Matches above!
})
```

No manual `reactivityKeys` needed — it's derived from the route path.

### Invalidation Matching

| Mutation `invalidates` | Queries Invalidated |
|------------------------|---------------------|
| `["user"]` | `user.*` (all user queries) |
| `["user.list"]` | Only `user.list` |
| `["user.list", "user.byId"]` | Both `user.list` and `user.byId` |

---

## keepPreviousData Behavior

When a query is refetching, `Result.Waiting` contains the previous value:

```typescript
Result.match(query.result, {
  onInitial: () => <Loading />,
  onWaiting: (previous) => (
    // Show stale data while refreshing
    <div>
      <UserTable users={previous} />
      <RefreshingSpinner />
    </div>
  ),
  onSuccess: (users) => <UserTable users={users} />,
  onFailure: (error) => <Error error={error} />,
})
```

---

## Full Example

```typescript
function Dashboard() {
  // Critical: poll frequently, keep alive, aggressive retry
  const activeUsers = api.user.active.useQuery({
    refetchInterval: Duration.seconds(5),
    keepAlive: true,
    retry: {
      schedule: Schedule.recurs(5),
      when: isTransientError,
    },
  })

  // Less critical: longer stale time, shorter cache
  const stats = api.stats.overview.useQuery({
    staleTime: Duration.minutes(5),
    idleTTL: Duration.minutes(1),
  })

  // Conditional query
  const [userId, setUserId] = useState<string | null>(null)
  const userDetail = api.user.byId.useQuery(
    { id: userId! },
    { enabled: userId !== null }
  )

  return (
    <div>
      <ActiveUsersWidget data={activeUsers.data} />
      <StatsCard data={stats.data} />
      {userDetail.data && <UserModal user={userDetail.data} />}
    </div>
  )
}
```
