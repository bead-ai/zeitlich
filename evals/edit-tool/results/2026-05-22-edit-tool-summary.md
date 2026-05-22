# Edit tool eval run — 2026-05-22

Dataset: `evals/edit-tool/edit-tool-100.jsonl` (100 cases)
Harness: `npm run eval:edit -- --providers anthropic,openai --variants baseline,improved --limit 100 --concurrency 8`

| Provider  | Model                       |  Variant | Pass rate | Passed / total | Avg tool calls |
| --------- | --------------------------- | -------: | --------: | -------------: | -------------: |
| Anthropic | `claude-haiku-4-5-20251001` | baseline |     85.0% |       85 / 100 |           1.82 |
| Anthropic | `claude-haiku-4-5-20251001` | improved |    100.0% |      100 / 100 |           1.00 |
| OpenAI    | `gpt-5.4-mini`              | baseline |     57.0% |       57 / 100 |           1.14 |
| OpenAI    | `gpt-5.4-mini`              | improved |     84.0% |       84 / 100 |           1.00 |

By category:

| Provider / variant | single_exact | multi_exact | replace_all | whitespace_exact | special_chars |
| ------------------ | -----------: | ----------: | ----------: | ---------------: | ------------: |
| Anthropic baseline |        20/20 |       35/35 |       15/15 |            15/15 |          0/15 |
| Anthropic improved |        20/20 |       35/35 |       15/15 |            15/15 |         15/15 |
| OpenAI baseline    |        20/20 |        7/35 |       15/15 |            15/15 |          0/15 |
| OpenAI improved    |        20/20 |       32/35 |       15/15 |            15/15 |          2/15 |

Full raw results: `2026-05-22T15-03-18-376Z-edit-tool-results.json`.
