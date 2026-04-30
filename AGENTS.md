# AGENTS.md

## Cursor Cloud specific instructions

**Zeitlich** is a TypeScript library (not a runnable application). Development commands are in `package.json` scripts; see `CONTRIBUTING.md` for details.

### Key caveats

- **Optional peer dependencies required for build**: `@google/genai`, `@langchain/core`, and `ioredis` are peer deps. The DTS build (`npm run build`) fails without `@google/genai` installed. Install all three with `npm install --no-save @google/genai @langchain/core ioredis` before building.
- **Pre-commit hook**: Husky runs `npm run lint && npm run typecheck` on commit. Both must pass before committing.
- **Tests**: `npx vitest run` — current tests are unit tests that don't require Redis or Temporal.
- **Dev mode**: `npm run dev` starts tsup in watch mode for incremental rebuilds.
- **Node.js via nvm**: nvm is installed at `/home/ubuntu/.nvm` (not `$HOME/.nvm`). Source it with `export NVM_DIR="/home/ubuntu/.nvm" && . "$NVM_DIR/nvm.sh"`. The update script handles this automatically.
