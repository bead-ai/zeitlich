# Contributing to Zeitlich

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js >= 18
- Temporal server (`temporal server start-dev`)
- Redis

### Setup

```bash
git clone https://github.com/bead-ai/zeitlich.git
cd zeitlich
npm install
```

### Development

```bash
npm run dev       # Build in watch mode
npm run build     # One-off build
npm run typecheck # Type checking
npm run lint      # Lint with ESLint
npm run lint:fix  # Lint and auto-fix
npm run format    # Format with Prettier
```

A pre-commit hook runs `lint` and `typecheck` automatically via Husky.

## Project Structure

```
src/
├── index.ts              # Activity entry point (zeitlich)
├── workflow.ts            # Workflow entry point (zeitlich/workflow)
├── lib/                   # Core library code
│   ├── types.ts           # Core shared types (zero internal deps)
│   ├── hooks/             # Session lifecycle + message hooks, Hooks aggregate
│   ├── model/             # AgentResponse, ModelInvoker, workflow helpers
│   ├── session/           # createSession, SessionConfig, ThreadOps
│   ├── state/             # createAgentStateManager, AgentState types
│   ├── thread/            # Thread manager, ID generation
│   ├── tool-router/       # Tool routing, execution, hook pipeline
│   ├── subagent/          # Subagent tool, handler, registration, types
│   ├── skills/            # Skill parsing, registration, filesystem provider
│   └── sandbox/           # Sandbox manager, types, file tree generation
├── tools/                 # Built-in tool implementations
│   ├── bash/
│   ├── edit/
│   ├── glob/
│   └── ...
└── adapters/              # LLM provider adapters
    └── thread/langchain/  # LangChain adapter (thread ops + model invoker)
```

Each `lib/` subdirectory has its own `types.ts` and `index.ts` barrel. The dependency chain flows downward: `types.ts` (core) → `tool-router/` → `hooks/`, `subagent/`, `session/`, etc.

Two entry points exist due to Temporal's workflow sandboxing:

- **`zeitlich/workflow`** — Pure TypeScript, safe for Temporal workflow files (no Node.js APIs or external deps)
- **`zeitlich`** — Full functionality for activities, workers, and Node.js code

## Making Changes

1. **Fork & branch** — Create a feature branch from `main`
2. **Make your changes** — Keep commits focused and atomic
3. **Ensure checks pass** — Run `npm run lint && npm run typecheck` before pushing
4. **Submit a PR** — Open a pull request against `main`

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) for automatic changelog generation via release-please.

| Prefix      | Use for                |
| ----------- | ---------------------- |
| `feat:`     | New features           |
| `fix:`      | Bug fixes              |
| `perf:`     | Performance changes    |
| `refactor:` | Code refactoring       |
| `docs:`     | Documentation          |
| `chore:`    | Maintenance tasks      |
| `test:`     | Tests                  |
| `ci:`       | CI/CD changes          |

Example: `feat: add support for streaming tool responses`

## Code Style

- **Formatter**: Prettier (double quotes, semicolons, 2-space indent, trailing commas)
- **Linter**: ESLint with typescript-eslint
- Run `npm run format` and `npm run lint:fix` to auto-fix

## Pull Requests

- Keep PRs small and focused on a single concern
- Include a clear description of what changed and why
- Make sure all checks pass (lint, typecheck)
- Link related issues with `Fixes #123` or `Closes #123`

## Reporting Issues

Open an issue at [github.com/bead-ai/zeitlich/issues](https://github.com/bead-ai/zeitlich/issues) with:

- A clear description of the problem or feature request
- Steps to reproduce (for bugs)
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
