# effect-trpc Fullstack Example

A complete fullstack example using effect-trpc with:
- **Turborepo** for monorepo management
- **Node.js** server with `effect-trpc/node` adapter
- **Vite + React** frontend with `effect-trpc/react` hooks
- **Shared API package** for type-safe router definitions

## Structure

```
fullstack/
├── turbo.json              # Turborepo config
├── pnpm-workspace.yaml     # Workspace config
├── packages/
│   └── api/                # Shared router + types
│       └── src/index.ts
└── apps/
    ├── server/             # Node.js backend
    │   └── src/index.ts
    └── web/                # Vite + React frontend
        └── src/
            ├── main.tsx
            ├── trpc.tsx
            └── App.tsx
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+

### Installation

```bash
cd examples/fullstack
pnpm install
```

### Development

Run both server and web app in development mode:

```bash
pnpm dev
```

Or run them separately:

```bash
# Terminal 1: Start server
cd apps/server && pnpm dev

# Terminal 2: Start web app
cd apps/web && pnpm dev
```

- Server: http://localhost:3001
- Web app: http://localhost:5173

### Build

Build all packages:

```bash
pnpm build
```

### Type Check

```bash
pnpm typecheck
```

## Features Demonstrated

### Shared API Definition (`packages/api`)

Define your router once, share types between server and client:

```typescript
import { procedures, procedure, Router } from "effect-trpc"
import * as Schema from "effect/Schema"

export const todosProcedures = procedures("todos", {
  list: procedure.output(Schema.Array(Todo)).query(),
  create: procedure.input(CreateTodoInput).output(Todo).mutation(),
})

export const appRouter = Router.make({
  todos: todosProcedures,
})

export type AppRouter = typeof appRouter
```

### Server (`apps/server`)

Use `effect-trpc/node` adapter with native Node.js http server:

```typescript
import { createHandler, nodeToWebRequest, webToNodeResponse } from "effect-trpc/node"

const handler = createHandler({
  router: appRouter,
  handlers: AppHandlersLive,
  cors: { origins: ["http://localhost:5173"] },
})

http.createServer(async (req, res) => {
  const request = await nodeToWebRequest(req)
  const response = await handler.fetch(request)
  await webToNodeResponse(response, res)
}).listen(3001)
```

### React Client (`apps/web`)

Use `effect-trpc/react` for type-safe hooks:

```typescript
import { createTRPCReact } from "effect-trpc/react"
import type { AppRouter } from "@example/api"

const trpc = createTRPCReact<AppRouter>({
  url: "http://localhost:3001/rpc",
})

// In your app
const todosQuery = trpc.todos.list.useQuery()
const createMutation = trpc.todos.create.useMutation()
```

## Using with Bun

The example can easily be adapted to use Bun instead of Node.js. Replace the server with:

```typescript
import { createServer } from "effect-trpc/bun"

const server = createServer({
  router: appRouter,
  handlers: AppHandlersLive,
  port: 3001,
  cors: true,
})

console.log(`Server running on http://localhost:${server.port}`)
```
