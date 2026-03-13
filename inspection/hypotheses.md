# Hypotheses for External Codebase Analysis

Based on internal analysis findings, we need answers from external codebases.

---

## Effect RPC

### H1: Schema encoding error handling
Our encoding failures silently return raw values. How does Effect RPC handle encoding errors?

### H2: Streaming middleware pattern
We now run middleware for streams. Does Effect RPC do the same? What patterns can we learn?

### H3: Request batching
We removed batching config (planned). Does Effect RPC have batching?

### H4: Error response format
We use Success/Failure envelopes. What does Effect RPC use?

### H5: Transport protocols
We only have HTTP (SSE stubbed). What transports does Effect RPC support?

---

## Effect Atom

### H6: Cache architecture
We delegate to effect-atom. How does it actually store cached values?

### H7: Subscription management
We use useAtomValue. How does effect-atom manage subscriptions internally?

### H8: Service patterns
Our React integration has type errors with AtomRuntime. What's the correct pattern?

### H9: Invalidation mechanism
We use withReactivity. How does the invalidation flow work internally?

### H10: Async state handling
We have type issues with Result. How does effect-atom handle async state correctly?

---

## Effect Atom React

### H11: Hook implementation
Our hooks have type errors. How does atom-react implement hooks correctly?

### H12: Provider pattern
Our Provider doesn't connect properly. What's the correct Provider pattern?

### H13: Suspense integration
We don't have working Suspense. How does atom-react implement it?

### H14: Effect execution in React
We have try/catch violations. How does atom-react execute Effects?

### H15: SSR support
Our SSR is stubs. Does atom-react have real SSR patterns?

---

## tRPC

### H16: React Query integration
How does tRPC integrate with React Query? We might use similar patterns.

### H17: Batching implementation
We want to implement batching. How does tRPC do it?

### H18: Subscription handling
Our useStream is broken. How does tRPC handle subscriptions?

### H19: Middleware context
We're missing some middleware context values. What does tRPC provide?

### H20: Links architecture
We have single Transport. Should we adopt links pattern?

---

## Agent Assignments

| Agents | Repo | Hypotheses | Focus |
|--------|------|------------|-------|
| 1-5 | effect/rpc | H1-H5 | RPC patterns |
| 6-10 | effect-atom/atom | H6-H10 | State management |
| 11-15 | effect-atom/atom-react | H11-H15 | React integration |
| 16-20 | trpc/* | H16-H20 | tRPC patterns |
