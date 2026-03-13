# Hypotheses for External Codebase Analysis

Based on our internal analysis findings, we have specific questions about what we can learn from external codebases.

---

## Effect RPC (`/inspection/external-repos/effect/packages/rpc`)

### H1: Schema encoding patterns
Our Server uses `orElseSucceed` fallbacks for encoding failures. How does Effect RPC handle encoding errors properly?

### H2: Streaming with middleware  
Our streams bypass middleware (CRITICAL security issue). Does Effect RPC apply middleware to streams?

### H3: Request batching
Our batching config is ignored. Does Effect RPC implement batching? How?

### H4: Error handling pipeline
We have silent fallbacks. What's Effect RPC's error handling architecture?

### H5: Transport protocols
We only have HTTP. What transports does Effect RPC support (WebSocket, SSE)?

---

## Effect Atom (`/inspection/external-repos/effect-atom/packages/atom`)

### H6: Cache storage
Our Reactivity has invalidation without a cache. How does Effect Atom store reactive state?

### H7: Subscription management
We use manual useState. How does Effect Atom handle subscriptions?

### H8: Effect services pattern
We created our own Reactivity service. Does Effect Atom use Context.Tag properly?

### H9: Invalidation patterns
We have custom invalidation. Does Effect Atom have built-in invalidation?

### H10: Async state handling
Our hooks manage loading/error manually. How does Effect Atom handle async?

---

## Effect Atom React (`/inspection/external-repos/effect-atom/packages/atom-react`)

### H11: useAtom/useAtomValue implementation
We use vanilla React. How does atom-react implement real reactive hooks?

### H12: Provider pattern
We have a Provider but it's not using atoms. How does atom-react provide context?

### H13: Suspense integration
We don't have Suspense. Does atom-react support React Suspense?

### H14: Effect in React lifecycle
We run Effects with runPromise. How does atom-react manage Effect execution?

### H15: SSR support
We have no SSR. Does atom-react support server-side rendering?

---

## Vanilla tRPC (`/inspection/external-repos/trpc/packages/`)

### H16: React Query integration
We built custom hooks. How does tRPC integrate with React Query?

### H17: Batching implementation
Our batching doesn't work. How does tRPC actually implement batching?

### H18: Subscriptions
Our streams don't work with middleware. How does tRPC handle subscriptions?

### H19: Middleware context
We're missing procedure type/path in middleware. What context does tRPC middleware have?

### H20: Link architecture
We have a single Transport. Should we adopt tRPC's composable links pattern?

---

## Agent Assignments

| Agent | Repo | Hypothesis | Focus Area |
|-------|------|------------|------------|
| 1-5 | effect/rpc | H1-H5 | RPC patterns |
| 6-10 | effect-atom/atom | H6-H10 | State management |
| 11-15 | effect-atom/atom-react | H11-H15 | React integration |
| 16-20 | trpc/* | H16-H20 | tRPC patterns |
