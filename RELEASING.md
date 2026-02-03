# Release Process

This project uses [release-please](https://github.com/googleapis/release-please) to manage releases locally.

## Prerequisites

1. Install GitHub CLI: `brew install gh`
2. Authenticate: `gh auth login`
3. Set your GitHub token: `export GITHUB_TOKEN=$(gh auth token)`

## Release Steps

### Step 1: Create Release PR

```bash
export GITHUB_TOKEN=$(gh auth token)
npm run release:pr
```

This creates a PR that:

- Bumps version in `package.json`
- Updates `CHANGELOG.md` from conventional commits

### Step 2: Review & Merge

Go to https://github.com/bead-ai/zeitlich/pulls and merge the release PR.

### Step 3: Pull Changes

```bash
git pull
```

### Step 4: Publish Release

```bash
export GITHUB_TOKEN=$(gh auth token)
npm run release:publish
```

This will:

- Create a GitHub Release with the tag
- Publish to npm

## Conventional Commits

Use these prefixes for automatic changelog generation:

| Prefix      | Description             | Shows in Changelog |
| ----------- | ----------------------- | ------------------ |
| `feat:`     | New feature             | ✅ Features        |
| `fix:`      | Bug fix                 | ✅ Bug Fixes       |
| `perf:`     | Performance improvement | ✅ Performance     |
| `refactor:` | Code refactoring        | ✅ Refactoring     |
| `docs:`     | Documentation           | ✅ Documentation   |
| `chore:`    | Maintenance             | ❌ Hidden          |
| `test:`     | Tests                   | ❌ Hidden          |
| `ci:`       | CI changes              | ❌ Hidden          |

## Quick Reference

```bash
# Full release flow
export GITHUB_TOKEN=$(gh auth token)
npm run release:pr          # Step 1: Create PR
# ... merge PR on GitHub ... # Step 2: Merge
git pull                     # Step 3: Pull
npm run release:publish      # Step 4: Publish
```
