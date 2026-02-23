# Contributing to effect-trpc

Thank you for your interest in contributing to effect-trpc!

> [!WARNING]
> This project is in early experimental stages. The API is unstable and may change significantly.
> Please open an issue to discuss before starting work on large changes.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/sebastian/effect-trpc.git
cd effect-trpc

# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test

# Type check
bun run typecheck

# Lint
bun run lint
```

## Project Structure

```
packages/
  effect-trpc/        # Main library
    src/
      core/           # Core types, procedures, router, middleware
      react/          # React hooks and provider
      next/           # Next.js integration
      node/           # Node.js HTTP and WebSocket adapters
      bun/            # Bun HTTP and WebSocket adapters
      ws/             # WebSocket protocol and subscription system
      shared/         # Shared utilities
      __tests__/      # Tests
```

## Guidelines

### Code Style

- Use Effect patterns (no `async/await`, no `throw`, no `try/catch`)
- Use `Effect.gen` for sequential operations
- Use `Schema` for all data validation
- Use `Context.Tag` for services
- Prefer `Effect.fn()` for functions with tracing

### Testing

- Write tests for new features
- Run `pnpm test` before submitting PRs
- Tests should not require external services

### Commits

- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Keep commits focused on a single change

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## Questions?

Open an issue for questions or discussions.
