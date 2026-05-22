#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_DATASET = "evals/edit-tool/edit-tool-100.jsonl";
const DEFAULT_MODELS = {
  anthropic:
    process.env.EDIT_EVAL_ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
  openai: process.env.EDIT_EVAL_OPENAI_MODEL || "gpt-5.4-mini",
};

const baselineEditDescription = `Edit specific sections of a file by replacing text.

Usage:
- Provide the exact text to find and replace
- The old_string must match exactly (whitespace-sensitive)
- By default, only replaces the first occurrence
- Use replace_all: true to replace all occurrences

IMPORTANT:
- You must read the file first (in this session) before editing it
- old_string must be unique in the file (unless using replace_all)
- The operation fails if old_string is not found
- old_string and new_string must be different`;

const improvedEditDescription = `Edit specific sections of a file by replacing text.

Usage:
- Provide the exact text to find and replace
- The old_string must match exactly (whitespace-sensitive)
- By default, only replaces the first occurrence
- Use replace_all: true to replace all occurrences

IMPORTANT:
- You must read the file first (in this session) before editing it
- old_string must be unique in the file (unless using replace_all)
- The operation fails if old_string is not found
- old_string and new_string must be different`;

const fileEditParameters = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description: "The absolute virtual path to the file to modify",
    },
    old_string: { type: "string", description: "The exact text to replace" },
    new_string: {
      type: "string",
      description:
        "The text to replace it with; must be different from old_string",
    },
    replace_all: {
      type: "boolean",
      description:
        "If true, replace all occurrences of old_string; default false",
    },
  },
  required: ["file_path", "old_string", "new_string"],
  additionalProperties: false,
};

const multiEditParameters = {
  type: "object",
  properties: {
    file_path: {
      type: "string",
      description: "The absolute virtual path to the file to modify",
    },
    edits: {
      type: "array",
      minItems: 1,
      description: "Exact replacements to apply sequentially to the file",
      items: {
        type: "object",
        properties: {
          old_string: {
            type: "string",
            description: "The exact text to replace",
          },
          new_string: { type: "string", description: "The replacement text" },
          replace_all: {
            type: "boolean",
            description:
              "If true, replace all occurrences for this edit; default false",
          },
        },
        required: ["old_string", "new_string"],
        additionalProperties: false,
      },
    },
  },
  required: ["file_path", "edits"],
  additionalProperties: false,
};

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    providers: ["anthropic", "openai"],
    variants: ["baseline", "improved"],
    limit: undefined,
    concurrency: 1,
    outDir: "evals/edit-tool/results",
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dataset" && next) {
      args.dataset = next;
      i++;
    } else if (arg === "--providers" && next) {
      args.providers = next
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (arg === "--variants" && next) {
      args.variants = next
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      i++;
    } else if (arg === "--limit" && next) {
      args.limit = Number.parseInt(next, 10);
      i++;
    } else if (arg === "--concurrency" && next) {
      args.concurrency = Math.max(1, Number.parseInt(next, 10));
      i++;
    } else if (arg === "--out-dir" && next) {
      args.outDir = next;
      i++;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Run live edit-tool evals against Anthropic Claude Haiku and OpenAI.

Usage:
  npm run eval:edit -- [options]

Options:
  --dataset <path>          JSONL dataset path (default: ${DEFAULT_DATASET})
  --providers <csv>         anthropic,openai (default: both)
  --variants <csv>          baseline,improved (default: both)
  --limit <n>               Run first n cases
  --concurrency <n>         Concurrent API calls (default: 1)
  --out-dir <path>          Result directory (default: evals/edit-tool/results)
  --dry-run                 Validate dataset and print planned runs without API calls

Environment:
  ANTHROPIC_API_KEY                         Required for --providers anthropic
  OPENAI_API_KEY                            Required for --providers openai
  EDIT_EVAL_ANTHROPIC_MODEL                 Default ${DEFAULT_MODELS.anthropic}
  EDIT_EVAL_OPENAI_MODEL                    Default ${DEFAULT_MODELS.openai}
  EDIT_EVAL_OPENAI_MODE=responses|chat      Default responses
  EDIT_EVAL_OPENAI_BASE_URL                 Default https://api.openai.com/v1
  EDIT_EVAL_ANTHROPIC_BASE_URL              Default https://api.anthropic.com
`);
}

async function loadDataset(datasetPath, limit) {
  const raw = await fs.readFile(datasetPath, "utf8");
  const cases = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on dataset line ${index + 1}`, {
          cause: error,
        });
      }
    });
  const selected = limit === undefined ? cases : cases.slice(0, limit);
  for (const c of selected) validateCase(c);
  return selected;
}

function validateCase(c) {
  for (const key of [
    "id",
    "category",
    "file_path",
    "initial_content",
    "instruction",
    "expected_content",
  ]) {
    if (typeof c[key] !== "string") {
      throw new Error(`Case ${c.id ?? "<unknown>"} has invalid ${key}`);
    }
  }
}

function toolsForVariant(variant) {
  const editTool = {
    name: "FileEdit",
    description:
      variant === "baseline"
        ? baselineEditDescription
        : improvedEditDescription,
    parameters: fileEditParameters,
  };
  if (variant === "baseline") return [editTool];
  return [
    editTool,
    {
      name: "FileMultiEdit",
      description: `Apply multiple exact text replacements to one file in order.

Usage:
- Use this when a task needs several related edits in the same file
- Each edit is applied to the file content produced by the prior edit
- The operation is atomic: if any edit fails, the file is left unchanged

IMPORTANT:
- Each old_string must match exactly (whitespace-sensitive)
- Each old_string must be unique unless that edit uses replace_all: true
- old_string and new_string must be different for every edit`,
      parameters: multiEditParameters,
    },
  ];
}

function promptForCase(c) {
  return `You are editing exactly one file using the provided file-edit tool(s).
Return tool call(s) only. Do not answer in prose.
Use exact old_string values copied from the current file content.
The grader compares final file bytes exactly, so follow the requested replacement text literally.

File path: ${c.file_path}
Current file content:
\`\`\`
${c.initial_content}\`\`\`

Task: ${c.instruction}`;
}

async function invokeModel(provider, model, variant, c) {
  const tools = toolsForVariant(variant);
  const prompt = promptForCase(c);
  if (provider === "anthropic") {
    return invokeAnthropic(model, tools, prompt);
  }
  if (provider === "openai") {
    return invokeOpenAI(model, tools, prompt);
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

async function invokeAnthropic(model, tools, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const baseUrl =
    process.env.EDIT_EVAL_ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature: 0,
      system:
        "You are a precise coding agent. Use tool calls only for file edits.",
      messages: [{ role: "user", content: prompt }],
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
      tool_choice: { type: "any" },
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${JSON.stringify(json)}`);
  }
  const toolCalls = [];
  for (const block of json.content ?? []) {
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input ?? {},
      });
    }
  }
  return {
    raw: json,
    toolCalls,
    usage: {
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    },
  };
}

async function invokeOpenAI(model, tools, prompt) {
  const mode = process.env.EDIT_EVAL_OPENAI_MODE || "responses";
  if (mode === "chat") return invokeOpenAIChat(model, tools, prompt);
  return invokeOpenAIResponses(model, tools, prompt);
}

async function invokeOpenAIResponses(model, tools, prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const baseUrl =
    process.env.EDIT_EVAL_OPENAI_BASE_URL || "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a precise coding agent. Use tool calls only for file edits.",
        },
        { role: "user", content: prompt },
      ],
      max_output_tokens: 1024,
      tool_choice: "required",
      tools: tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${JSON.stringify(json)}`);
  }
  return {
    raw: json,
    toolCalls: extractOpenAIResponsesToolCalls(json),
    usage: {
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    },
  };
}

async function invokeOpenAIChat(model, tools, prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const baseUrl =
    process.env.EDIT_EVAL_OPENAI_BASE_URL || "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a precise coding agent. Use tool calls only for file edits.",
        },
        { role: "user", content: prompt },
      ],
      tool_choice: "required",
      parallel_tool_calls: true,
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${JSON.stringify(json)}`);
  }
  const message = json.choices?.[0]?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function?.name,
    args: parseJsonObject(call.function?.arguments),
  }));
  return {
    raw: json,
    toolCalls,
    usage: {
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
    },
  };
}

function extractOpenAIResponsesToolCalls(json) {
  const calls = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "function_call" && typeof value.name === "string") {
      calls.push({
        id: value.call_id || value.id,
        name: value.name,
        args: parseJsonObject(value.arguments),
      });
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(json.output ?? []);
  return calls;
}

function parseJsonObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function applyToolCalls(c, variant, toolCalls) {
  let content = c.initial_content;
  let replacements = 0;
  const applied = [];
  for (const [index, call] of toolCalls.entries()) {
    if (call.name === "FileEdit") {
      const result = applyOneEdit(content, call.args, index);
      if (!result.ok)
        return { content, replacements, applied, error: result.error };
      if (call.args.file_path !== c.file_path) {
        return {
          content,
          replacements,
          applied,
          error: `tool ${index} edited ${call.args.file_path}, expected ${c.file_path}`,
        };
      }
      content = result.content;
      replacements += result.replacements;
      applied.push({ name: call.name, replacements: result.replacements });
    } else if (call.name === "FileMultiEdit" && variant === "improved") {
      if (call.args.file_path !== c.file_path) {
        return {
          content,
          replacements,
          applied,
          error: `tool ${index} edited ${call.args.file_path}, expected ${c.file_path}`,
        };
      }
      const edits = Array.isArray(call.args.edits) ? call.args.edits : [];
      const result = applyEditPlan(content, edits);
      if (!result.ok)
        return { content, replacements, applied, error: result.error };
      content = result.content;
      replacements += result.replacements;
      applied.push({ name: call.name, replacements: result.replacements });
    } else {
      return {
        content,
        replacements,
        applied,
        error: `unsupported tool call: ${call.name}`,
      };
    }
  }
  return { content, replacements, applied };
}

function applyEditPlan(content, edits) {
  if (edits.length === 0)
    return { ok: false, error: "edits must be non-empty" };
  let current = content;
  let replacements = 0;
  for (const [index, edit] of edits.entries()) {
    const result = applyOneEdit(current, edit, index);
    if (!result.ok) return result;
    current = result.content;
    replacements += result.replacements;
  }
  return { ok: true, content: current, replacements };
}

function applyOneEdit(content, args, index) {
  const oldString = args.old_string;
  const newString = args.new_string;
  const replaceAll = args.replace_all === true;
  if (typeof oldString !== "string" || oldString.length === 0) {
    return {
      ok: false,
      error: `edit ${index} old_string is empty or not a string`,
    };
  }
  if (typeof newString !== "string") {
    return { ok: false, error: `edit ${index} new_string is not a string` };
  }
  if (oldString === newString) {
    return { ok: false, error: `edit ${index} old_string equals new_string` };
  }
  const occurrences = countOccurrences(content, oldString);
  if (occurrences === 0)
    return { ok: false, error: `edit ${index} old_string not found` };
  if (!replaceAll && occurrences > 1) {
    return {
      ok: false,
      error: `edit ${index} old_string appears ${occurrences} times without replace_all`,
    };
  }
  if (replaceAll) {
    return {
      ok: true,
      content: content.split(oldString).join(newString),
      replacements: occurrences,
    };
  }
  const at = content.indexOf(oldString);
  return {
    ok: true,
    content:
      content.slice(0, at) + newString + content.slice(at + oldString.length),
    replacements: 1,
  };
}

function countOccurrences(content, needle) {
  let count = 0;
  let cursor = 0;
  while (cursor <= content.length) {
    const at = content.indexOf(needle, cursor);
    if (at === -1) break;
    count++;
    cursor = at + needle.length;
  }
  return count;
}

function summarize(results) {
  const groups = new Map();
  for (const result of results) {
    const key = `${result.provider}\t${result.model}\t${result.variant}`;
    const group = groups.get(key) ?? {
      provider: result.provider,
      model: result.model,
      variant: result.variant,
      cases: 0,
      passed: 0,
      failed: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    group.cases++;
    if (result.pass) group.passed++;
    else group.failed++;
    group.toolCalls += result.toolCalls.length;
    group.inputTokens += result.usage?.inputTokens ?? 0;
    group.outputTokens += result.usage?.outputTokens ?? 0;
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((g) => ({
    ...g,
    passRate: g.cases === 0 ? 0 : g.passed / g.cases,
    avgToolCalls: g.cases === 0 ? 0 : g.toolCalls / g.cases,
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const cases = await loadDataset(args.dataset, args.limit);
  console.log(`Loaded ${cases.length} eval cases from ${args.dataset}`);
  console.log(`Providers: ${args.providers.join(", ")}`);
  console.log(`Variants: ${args.variants.join(", ")}`);
  if (args.dryRun) {
    console.log("Dry run only; no API calls made.");
    return;
  }

  const results = [];
  const startedAt = new Date().toISOString();
  const jobs = [];

  for (const provider of args.providers) {
    const model = DEFAULT_MODELS[provider];
    if (!model)
      throw new Error(`No default model configured for provider ${provider}`);
    const requiredKey =
      provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    if (!process.env[requiredKey]) {
      console.warn(`Skipping ${provider}: ${requiredKey} is not set`);
      continue;
    }
    for (const variant of args.variants) {
      for (const [caseIndex, c] of cases.entries()) {
        jobs.push({ provider, model, variant, c, caseIndex });
      }
    }
  }

  let cursor = 0;
  async function runOne(job) {
    const { provider, model, variant, c, caseIndex } = job;
    const label = `${provider}/${model}/${variant}/${caseIndex + 1}/${cases.length}/${c.id}`;
    try {
      const invocation = await invokeModel(provider, model, variant, c);
      const execution = applyToolCalls(c, variant, invocation.toolCalls);
      const pass = !execution.error && execution.content === c.expected_content;
      results.push({
        provider,
        model,
        variant,
        caseId: c.id,
        category: c.category,
        pass,
        error: execution.error,
        toolCalls: invocation.toolCalls.map((call) => ({
          name: call.name,
          args: call.args,
        })),
        applied: execution.applied,
        replacements: execution.replacements,
        usage: invocation.usage,
      });
      console.log(
        `${pass ? "PASS" : "FAIL"} ${label}${execution.error ? ` - ${execution.error}` : ""}`
      );
    } catch (error) {
      results.push({
        provider,
        model,
        variant,
        caseId: c.id,
        category: c.category,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
        toolCalls: [],
      });
      console.log(
        `ERROR ${label} - ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      await runOne(job);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, jobs.length) }, () =>
      worker()
    )
  );

  const summary = summarize(results);
  console.table(
    summary.map((g) => ({
      provider: g.provider,
      model: g.model,
      variant: g.variant,
      cases: g.cases,
      passed: g.passed,
      failed: g.failed,
      passRate: `${(g.passRate * 100).toFixed(1)}%`,
      avgToolCalls: g.avgToolCalls.toFixed(2),
      inputTokens: g.inputTokens,
      outputTokens: g.outputTokens,
    }))
  );

  await fs.mkdir(args.outDir, { recursive: true });
  const resultPath = path.join(
    args.outDir,
    `${startedAt.replace(/[:.]/g, "-")}-edit-tool-results.json`
  );
  await fs.writeFile(
    resultPath,
    JSON.stringify(
      {
        startedAt,
        dataset: args.dataset,
        cases: cases.length,
        summary,
        results,
      },
      null,
      2
    )
  );
  console.log(`Wrote ${resultPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
