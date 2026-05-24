# Edit tool evals

`edit-tool-100.jsonl` contains 100 deterministic file-edit prompts for the edit tool:

- 20 single exact replacements
- 20 multi-edit TypeScript cases
- 15 replace-all documentation cases
- 15 multi-edit JSON/config cases
- 15 whitespace-sensitive Python cases
- 15 special-character shell cases

Run the live before/after measurement harness with:

```sh
npm run eval:edit
```

The harness compares two tool surfaces:

- `baseline`: the pre-improvement `FileEdit` tool only.
- `improved`: `FileEdit` plus the new atomic `FileMultiEdit` tool.

Default model IDs can be overridden with environment variables:

```sh
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export EDIT_EVAL_ANTHROPIC_MODEL=claude-haiku-4-5-20251001
export EDIT_EVAL_OPENAI_MODEL=gpt-5.4-mini
npm run eval:edit -- --providers anthropic,openai --variants baseline,improved
```

Use `--concurrency 8` for the recorded run shape if your API limits allow it.

For a quick dataset/schema check without API calls:

```sh
npm run eval:edit -- --dry-run
```

Results are written under `evals/edit-tool/results/`.
