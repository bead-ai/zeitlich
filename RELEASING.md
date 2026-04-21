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

This runs two steps, **in this exact order**:

1. `release:github` — creates the git tag, creates the GitHub Release, and **flips the release PR's label from `autorelease: pending` to `autorelease: tagged`** (release-please uses this label to decide whether the previous release is complete).
2. `release:npm` — builds and publishes to npm.

> ⚠️ **Never run `npm publish` or `npm run release:npm` standalone.** Skipping `release:github` leaves the release PR labeled `autorelease: pending`, which blocks the next `release:pr` with `⚠ There are untagged, merged release PRs outstanding - aborting`. See [Troubleshooting](#troubleshooting).

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
npm run release:publish      # Step 4: Publish (NEVER release:npm alone)
```

## Troubleshooting

### `⚠ There are untagged, merged release PRs outstanding - aborting`

The previous release PR was merged but release-please never flipped its label to `autorelease: tagged` — usually because `release:github` was skipped (e.g. someone ran `npm publish` or `release:npm` on its own). release-please refuses to cut a new release PR until state is consistent.

Recover by completing the missed `release:github` work manually for the last released version `X.Y.Z`:

```bash
# 1. Find the merge commit of the merged-but-untagged release PR
MERGE_SHA=$(gh pr view <PR#> --json mergeCommit --jq '.mergeCommit.oid')

# 2. Create + push the tag
git tag vX.Y.Z $MERGE_SHA
git push origin vX.Y.Z

# 3. Create the GitHub Release (notes are best-copied from CHANGELOG.md)
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes "…CHANGELOG section…"

# 4. Flip the label — this is what actually unsticks release-please
gh pr edit <PR#> \
  --remove-label "autorelease: pending" \
  --add-label "autorelease: tagged"

# 5. Re-run Step 1
npm run release:pr
```

All four steps are required — release-please keys off the **label**, not the tag.

### Forcing a specific version (e.g. patch instead of minor)

Pre-1.0, release-please treats `feat:` commits as a minor bump (`0.2.x → 0.3.0`). To pin the next release to a specific version, land an empty commit on `main` with a `Release-As:` trailer **before** running `release:pr`:

```bash
git commit --allow-empty -m "chore: release X.Y.Z

Release-As: X.Y.Z"
git push origin main
npm run release:pr
```
