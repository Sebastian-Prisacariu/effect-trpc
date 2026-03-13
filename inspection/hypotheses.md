# Hypotheses for External Codebase Analysis

Based on our internal analysis, we have specific questions and hypotheses about what we can learn from external codebases. These hypotheses guide our 20 agents (5 per repo).

---

## Effect RPC (`/inspection/external-repos/effect/packages/rpc`)

### H1: Effect RPC uses Schema for request/response encoding
We use Schema.decodeUnknown but may be missing patterns for bidirectional encoding. How does Effect RPC handle this?

### H2: Effect RPC has proper streaming with middleware
Our streams bypass middleware. Does Effect RPC have a pattern for stream procedures that properly chains middleware?

### H3: Effect RPC has batching implementation
We have batching config but no implementation. Does Effect RPC batch requests? How?

### H4: Effect RPC has proper error encoding
We have silent fallbacks when error encoding fails. What pattern does Effect RPC use?

### H5: Effect RPC has SSE/WebSocket transport
We have HTTP only. What transport protocols does Effect RPC support?

---

## Effect Atom (`/inspection/external-repos/effect-atom/packages/atom`)

### H6: Effect Atom has actual cache storage
Our Reactivity module has invalidation without a cache. How does Effect Atom store reactive state?

### H7: Effect Atom has subscription management
We need to understand how Atom manages subscriptions for React integration.

### H8: Effect Atom uses Effect services
Does it follow the Context.Tag service pattern we should use?

### H9: Effect Atom has invalidation patterns
Does it have built-in invalidation or is this left to consumers?

### H10: Effect Atom handles async state
How does it handle Effect-based async computations in atoms?

---

## Effect Atom React (`/inspection/external-repos/effect-atom/packages/atom-react`)

### H11: Atom React has useAtom/useAtomValue hooks
We have stub hooks. How does Atom React implement real hooks?

### H12: Atom React has Provider pattern
Our Provider is a stub. How does Atom React provide context?

### H13: Atom React handles Suspense
Does it integrate with React Suspense for async atoms?

### H14: Atom React handles effects in React lifecycle
How does it run Effects within React's lifecycle?

### H15: Atom React has SSR support
Does it have patterns for server-side rendering we should follow?

---

## Vanilla tRPC (`/inspection/external-repos/trpc/packages/`)

### H16: tRPC React Query integration pattern
How does tRPC integrate with React Query? We might want similar patterns.

### H17: tRPC batching implementation
tRPC has request batching. How is it implemented?

### H18: tRPC subscription/streaming
How does tRPC handle subscriptions and WebSocket transport?

### H19: tRPC middleware pattern
Compare tRPC middleware to our middleware - what features are we missing?

### H20: tRPC link architecture
tRPC has a "links" system for composable transports. Should we adopt this?

---

## Analysis Approach

Each agent will:
1. Read relevant source files in their assigned repo
2. Answer the assigned hypotheses with evidence
3. Extract code patterns we should adopt
4. Identify features we're missing
5. Write findings to `/inspection/{repo}/scan/{agent-number}.md`

## Agent Assignments

| Agent | Repo | Hypotheses | Focus |
|-------|------|------------|-------|
| 1-5 | effect/rpc | H1-H5 | RPC patterns, streaming, batching |
| 6-10 | effect-atom/atom | H6-H10 | State management, caching |
| 11-15 | effect-atom/atom-react | H11-H15 | React integration |
| 16-20 | trpc/* | H16-H20 | tRPC patterns to adopt |
