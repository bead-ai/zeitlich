[![npm version](https://img.shields.io/npm/v/zeitlich.svg?style=flat-square)](https://www.npmjs.org/package/zeitlich)
[![npm downloads](https://img.shields.io/npm/dm/zeitlich.svg?style=flat-square)](https://npm-stat.com/charts.html?package=zeitlich)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/bead-ai/zeitlich)

# Zeitlich

> **⚠️ Experimental Beta**: This library is under active development. APIs and interfaces may change between versions. Use in production at your own risk.

**Durable AI Agents for Temporal**

Zeitlich is an opinionated framework for building reliable, stateful AI agents using [Temporal](https://temporal.io). It provides the building blocks for creating agents that can survive crashes, handle long-running tasks, and coordinate with other agents—all with full type safety.

## Why Zeitlich?

Building production AI agents is hard. Agents need to:

- **Survive failures** — What happens when your agent crashes mid-task?
- **Handle long-running work** — Some tasks take hours or days
- **Coordinate** — Multiple agents often need to work together
- **Maintain state** — Conversation history, tool results, workflow state

Temporal solves these problems for workflows. Zeitlich brings these guarantees to AI agents.

## Features

- **Durable execution** — Agent state survives process restarts and failures
- **Thread management** — Redis-backed conversation storage with automatic persistence
- **Type-safe tools** — Define tools with Zod schemas, get full TypeScript inference
- **Lifecycle hooks** — Pre/post tool execution, session start/end
- **Subagent support** — Spawn child agents as Temporal child workflows
- **Skills** — First-class [agentskills.io](https://agentskills.io) support with progressive disclosure
- **Filesystem utilities** — In-memory or custom providers for file operations
- **Model flexibility** — Framework-agnostic model invocation with adapters for LangChain, Vercel AI SDK, or provider-specific SDKs

## LLM Integration

Zeitlich's core is framework-agnostic — it defines generic interfaces (`ModelInvoker`, `ThreadOps`, `MessageContent`) that work with any LLM SDK. You choose a **thread adapter** (for conversation storage and model invocation) and a **sandbox adapter** (for filesystem operations), then wire them together.

### Thread Adapters

A thread adapter bundles two concerns:
1. **Thread management** — Storing and retrieving conversation messages in Redis
2. **Model invocation** — Calling the LLM with the conversation history and tools

Each adapter exposes the same shape: `createActivities(scope)` for Temporal worker registration, and an `invoker` for model calls. Pick the one matching your preferred SDK:

| Adapter | Import | SDK |
|---------|--------|-----|
| LangChain | `zeitlich/adapters/thread/langchain` | `@langchain/core` + any provider package |
| Google GenAI | `zeitlich/adapters/thread/google-genai` | `@google/genai` |

Vercel AI SDK and other provider-specific adapters can be built by implementing the `ThreadOps` and `ModelInvoker` interfaces.

### Sandbox Adapters

A sandbox adapter provides filesystem access for tools like `Bash`, `Read`, `Write`, and `Edit`:

| Adapter | Import | Use case |
|---------|--------|----------|
| In-memory | `zeitlich/adapters/sandbox/inmemory` | Tests and lightweight agents |
| Virtual | `zeitlich/adapters/sandbox/virtual` | Custom resolvers with path-only ops |
| Daytona | `zeitlich/adapters/sandbox/daytona` | Remote Daytona workspaces |
| E2B | `zeitlich/adapters/sandbox/e2b` | E2B cloud sandboxes |
| Bedrock | `zeitlich/adapters/sandbox/bedrock` | AWS Bedrock AgentCore Code Interpreter |

### Example: LangChain Adapter

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { createLangChainAdapter } from "zeitlich/adapters/thread/langchain";
import { createRunAgentActivity } from "zeitlich";

const adapter = createLangChainAdapter({
  redis,
  model: new ChatAnthropic({ model: "claude-sonnet-4-20250514" }),
});

export function createActivities(client: WorkflowClient) {
  return {
    ...adapter.createActivities("myAgentWorkflow"),
    runAgent: createRunAgentActivity(client, adapter.invoker),
  };
}
```

All adapters follow the same pattern — `createActivities(scope)` for worker registration and `invoker` for model calls.

## Installation

```bash
npm install zeitlich ioredis
```

**Peer dependencies:**

- `ioredis` >= 5.0.0
- `@langchain/core` >= 1.0.0 (optional — only when using the LangChain adapter)
- `@google/genai` >= 1.0.0 (optional — only when using the Google GenAI adapter)
- `@aws-sdk/client-bedrock-agentcore` >= 3.900.0 (optional — only when using the Bedrock adapter)

**Required infrastructure:**

- Temporal server (local dev: `temporal server start-dev`)
- Redis instance

## Import Paths

Zeitlich uses separate entry points for workflow-side and activity-side code:

```typescript
// In workflow files — no external dependencies (Redis, LLM SDKs, etc.)
import {
  createSession,
  createAgentStateManager,
  defineTool,
  bashTool,
} from "zeitlich/workflow";

// Adapter workflow proxies (auto-scoped to current workflow)
import { proxyLangChainThreadOps } from "zeitlich/adapters/thread/langchain/workflow";
import { proxyInMemorySandboxOps } from "zeitlich/adapters/sandbox/inmemory/workflow";

// In activity files and worker setup — framework-agnostic core
import {
  createRunAgentActivity,
  SandboxManager,
  withSandbox,
  bashHandler,
} from "zeitlich";

// Thread adapter — activity-side
import { createLangChainAdapter } from "zeitlich/adapters/thread/langchain";
```

**Entry points:**

- `zeitlich/workflow` — Pure TypeScript, safe for Temporal's V8 sandbox
- `zeitlich/adapters/*/workflow` — Workflow-side proxies that auto-scope activities to the current workflow
- `zeitlich` — Activity-side utilities (Redis, filesystem), framework-agnostic
- `zeitlich/adapters/thread/*` — Activity-side adapters (thread management + model invocation)
- `zeitlich/adapters/sandbox/*` — Activity-side sandbox providers

## Examples

Runnable examples (worker, client, workflows) are in a separate repo: [zeitlich-examples](https://github.com/bead-ai/zeitlich-examples).

## Quick Start

### 1. Define Your Tools

```typescript
import { z } from "zod";
import type { ToolDefinition } from "zeitlich/workflow";

export const searchTool: ToolDefinition<"Search", typeof searchSchema> = {
  name: "Search",
  description: "Search for information",
  schema: z.object({
    query: z.string().describe("The search query"),
  }),
};
```

### 2. Create the Workflow

The workflow wires together a **thread adapter** (for conversation storage / model calls) and a **sandbox adapter** (for filesystem tools). Both are pluggable — swap the proxy import to switch providers.

```typescript
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  createAgentStateManager,
  createSession,
  defineWorkflow,
  askUserQuestionTool,
  bashTool,
  defineTool,
} from "zeitlich/workflow";
import { searchTool } from "./tools";
import type { MyActivities } from "./activities";

import { proxyLangChainThreadOps } from "zeitlich/adapters/thread/langchain/workflow";
import { proxyInMemorySandboxOps } from "zeitlich/adapters/sandbox/inmemory/workflow";

const {
  runAgentActivity,
  searchHandlerActivity,
  bashHandlerActivity,
  askUserQuestionHandlerActivity,
} = proxyActivities<MyActivities>({
  startToCloseTimeout: "30m",
  retry: {
    maximumAttempts: 6,
    initialInterval: "5s",
    maximumInterval: "15m",
    backoffCoefficient: 4,
  },
  heartbeatTimeout: "5m",
});

export const myAgentWorkflow = defineWorkflow(
  { name: "myAgentWorkflow" },
  async ({ prompt }: { prompt: string }, sessionInput) => {
    const { runId } = workflowInfo();

    const stateManager = createAgentStateManager({
      initialState: {
        systemPrompt: "You are a helpful assistant.",
      },
      agentName: "my-agent",
    });

    const session = await createSession({
      agentName: "my-agent",
      maxTurns: 20,
      threadId: runId,
      threadOps: proxyLangChainThreadOps(),
      sandboxOps: proxyInMemorySandboxOps(),
      runAgent: runAgentActivity,
      buildContextMessage: () => [{ type: "text", text: prompt }],
      tools: {
        Search: defineTool({
          ...searchTool,
          handler: searchHandlerActivity,
        }),
        AskUserQuestion: defineTool({
          ...askUserQuestionTool,
          handler: askUserQuestionHandlerActivity,
          hooks: {
            onPostToolUse: () => {
              stateManager.waitForInput();
            },
          },
        }),
        Bash: defineTool({
          ...bashTool,
          handler: bashHandlerActivity,
        }),
      },
      ...sessionInput,
    });

    const result = await session.runSession({ stateManager });
    return result;
  }
);
```

### 3. Create Activities

Activities are factory functions that receive infrastructure dependencies (`redis`, `client`). The thread adapter and sandbox provider are configured here — swap imports to change LLM or sandbox backend.

```typescript
import type Redis from "ioredis";
import type { WorkflowClient } from "@temporalio/client";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  SandboxManager,
  withSandbox,
  bashHandler,
  createAskUserQuestionHandler,
  createRunAgentActivity,
} from "zeitlich";
import { InMemorySandboxProvider } from "zeitlich/adapters/sandbox/inmemory";

import { createLangChainAdapter } from "zeitlich/adapters/thread/langchain";

const sandboxProvider = new InMemorySandboxProvider();
const sandboxManager = new SandboxManager(sandboxProvider);

export const createActivities = ({
  redis,
  client,
}: {
  redis: Redis;
  client: WorkflowClient;
}) => {
  const adapter = createLangChainAdapter({
    redis,
    model: new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
    }),
  });

  return {
    ...adapter.createActivities("myAgentWorkflow"),
    ...sandboxManager.createActivities("myAgentWorkflow"),
    runAgentActivity: createRunAgentActivity(client, adapter.invoker),
    searchHandlerActivity: async (args: { query: string }) => ({
      toolResponse: JSON.stringify(await performSearch(args.query)),
      data: null,
    }),
    bashHandlerActivity: withSandbox(sandboxManager, bashHandler),
    askUserQuestionHandlerActivity: createAskUserQuestionHandler(),
  };
};

export type MyActivities = ReturnType<typeof createActivities>;
```

### 4. Set Up the Worker

```typescript
import { Worker, NativeConnection } from "@temporalio/worker";
import Redis from "ioredis";
import { fileURLToPath } from "node:url";
import { createActivities } from "./activities";

async function run() {
  const connection = await NativeConnection.connect({
    address: "localhost:7233",
  });
  const redis = new Redis({ host: "localhost", port: 6379 });

  const worker = await Worker.create({
    connection,
    taskQueue: "my-agent",
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities: createActivities({ redis, client }),
  });

  await worker.run();
}
```

## Core Concepts

### Agent State Manager

Manages workflow state with automatic versioning and status tracking. Requires `agentName` to register Temporal query/update handlers, and accepts an optional `initialState` for system prompt and custom fields:

```typescript
import { createAgentStateManager } from "zeitlich/workflow";

const stateManager = createAgentStateManager({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    customField: "value",
  },
  agentName: "my-agent",
});

// State operations
stateManager.set("customField", "new value");
stateManager.get("customField"); // Get current value
stateManager.complete(); // Mark as COMPLETED
stateManager.waitForInput(); // Mark as WAITING_FOR_INPUT
stateManager.isRunning(); // Check if RUNNING
stateManager.isTerminal(); // Check if COMPLETED/FAILED/CANCELLED
```

### Tools with Handlers

Define tools with their handlers inline in `createSession`:

```typescript
import { z } from "zod";
import type { ToolDefinition } from "zeitlich/workflow";

// Define tool schema
const searchTool: ToolDefinition<"Search", typeof searchSchema> = {
  name: "Search",
  description: "Search for information",
  schema: z.object({ query: z.string() }),
};

// In workflow - combine tool definition with handler using defineTool()
const session = await createSession({
  // ... other config
  tools: {
    Search: defineTool({
      ...searchTool,
      handler: handleSearchResult, // Activity that implements the tool
    }),
  },
});
```

### Lifecycle Hooks

Add hooks for tool execution and session lifecycle:

```typescript
const session = await createSession({
  // ... other config
  hooks: {
    onPreToolUse: ({ toolCall }) => {
      console.log(`Executing ${toolCall.name}`);
      return {}; // Can return { skip: true } or { modifiedArgs: {...} }
    },
    onPostToolUse: ({ toolCall, result, durationMs }) => {
      console.log(`${toolCall.name} completed in ${durationMs}ms`);
      // Access stateManager here to update state based on results
    },
    onPostToolUseFailure: ({ toolCall, error }) => {
      return { fallbackContent: "Tool failed, please try again" };
    },
    onSessionStart: ({ threadId, agentName }) => {
      console.log(`Session started: ${agentName}`);
    },
    onSessionEnd: ({ exitReason, turns }) => {
      console.log(`Session ended: ${exitReason} after ${turns} turns`);
    },
  },
});
```

### Subagents

Spawn child agents as Temporal child workflows. Use `defineSubagentWorkflow` to define the workflow with its metadata once, then `defineSubagent` to register it in the parent:

```typescript
// researcher.workflow.ts
import { proxyActivities } from "@temporalio/workflow";
import {
  createAgentStateManager,
  createSession,
  defineSubagentWorkflow,
} from "zeitlich/workflow";
import { proxyLangChainThreadOps } from "zeitlich/adapters/thread/langchain/workflow";
import type { createResearcherActivities } from "./activities";

const { runResearcherActivity } = proxyActivities<
  ReturnType<typeof createResearcherActivities>
>({ startToCloseTimeout: "30m", heartbeatTimeout: "5m" });

// Define the workflow — name, description (and optional resultSchema) live here
export const researcherWorkflow = defineSubagentWorkflow(
  {
    name: "Researcher",
    description: "Researches topics and gathers information",
  },
  async (prompt, sessionInput) => {
    const stateManager = createAgentStateManager({
      initialState: { systemPrompt: "You are a researcher." },
    });

    const session = await createSession({
      ...sessionInput, // spreads agentName, threadId, continueThread, sandboxId
      threadOps: proxyLangChainThreadOps(), // auto-scoped to "Researcher"
      runAgent: runResearcherActivity,
      buildContextMessage: () => [{ type: "text", text: prompt }],
    });

    const { finalMessage, threadId } = await session.runSession({ stateManager });
    return {
      toolResponse: finalMessage ? extractText(finalMessage) : "No response",
      data: null,
      threadId,
    };
  },
);
```

In the parent workflow, register it with `defineSubagent` and pass it to `createSession`:

```typescript
// parent.workflow.ts
import { defineSubagent } from "zeitlich/workflow";
import { researcherWorkflow } from "./researcher.workflow";

// Metadata (name, description) comes from the workflow definition
export const researcherSubagent = defineSubagent(researcherWorkflow);

// Optionally override parent-specific config
export const researcherSubagent = defineSubagent(researcherWorkflow, {
  allowThreadContinuation: true,
  sandbox: "own",
  hooks: {
    onPostExecution: ({ result }) => console.log("researcher done", result),
  },
});

const session = await createSession({
  // ... other config
  subagents: [researcherSubagent, codeReviewerSubagent],
});
```

The `Subagent` tool is automatically added when subagents are configured, allowing the LLM to spawn child workflows.

### Skills

Zeitlich has first-class support for the [agentskills.io](https://agentskills.io) specification. Skills are reusable instruction sets that an agent can load on-demand via the built-in `ReadSkill` tool — progressive disclosure keeps token usage low while giving agents access to rich, domain-specific guidance.

#### Defining a Skill

Each skill lives in its own directory as a `SKILL.md` file with YAML frontmatter. A skill directory can also contain **resource files** — supporting documents, templates, or data that the agent can read from the sandbox filesystem:

```
skills/
├── code-review/
│   ├── SKILL.md
│   └── resources/
│       └── checklist.md
├── pdf-processing/
│   ├── SKILL.md
│   └── templates/
│       └── extraction-prompt.txt
```

```markdown
---
name: code-review
description: Review pull requests for correctness, style, and security issues
allowed-tools: Bash Grep Read
license: MIT
---

## Instructions

When reviewing code, follow these steps:
1. Read the diff with `Bash`
2. Search for related tests with `Grep`
3. Read the checklist from `resources/checklist.md`
4. ...
```

Required fields: `name` and `description`. Optional: `license`, `compatibility`, `allowed-tools` (space-delimited), `metadata` (key-value map).

Resource files are any non-`SKILL.md` files inside the skill directory (discovered recursively). When loaded via `FileSystemSkillProvider`, their contents are stored in `skill.resourceContents` — a `Record<string, string>` keyed by relative path (e.g. `"resources/checklist.md"`).

#### Loading Skills

Use `FileSystemSkillProvider` to load skills from a directory (works with any sandbox filesystem). `loadAll()` eagerly reads `SKILL.md` instructions **and** all resource file contents into each `Skill` object:

```typescript
import { FileSystemSkillProvider } from "zeitlich";
import { InMemorySandboxProvider } from "zeitlich/adapters/sandbox/inmemory";

const provider = new InMemorySandboxProvider();
const { sandbox } = await provider.create({});

const skillProvider = new FileSystemSkillProvider(sandbox.fs, "/skills");
const skills = await skillProvider.loadAll();
// Each skill has: { name, description, instructions, resourceContents }
// resourceContents: { "resources/checklist.md": "...", ... }
```

For lightweight discovery without reading file contents, use `listSkills()`:

```typescript
const metadata = await skillProvider.listSkills();
// SkillMetadata[] — name, description, location only
```

Or parse a single file directly:

```typescript
import { parseSkillFile } from "zeitlich/workflow";

const { frontmatter, body } = parseSkillFile(rawMarkdown);
// frontmatter: SkillMetadata, body: instruction text
```

#### Passing Skills to a Session

Pass loaded skills to `createSession`. Zeitlich automatically:

1. Registers a `ReadSkill` tool whose description lists all available skills — the agent discovers them through the tool definition and loads instructions on demand.
2. Seeds `resourceContents` into the sandbox as `initialFiles` (when `sandboxOps` is configured), so the agent can read resource files with its `Read` tool without any extra setup.

```typescript
import { createSession } from "zeitlich/workflow";

const session = await createSession({
  // ... other config
  skills, // Skill[] — loaded via FileSystemSkillProvider or manually
});
```

The `ReadSkill` tool accepts a `skill_name` parameter (constrained to an enum of available names) and returns the full instruction body plus a list of available resource file paths. The handler runs directly in the workflow — no activity needed. Resource file contents are not included in the `ReadSkill` response (progressive disclosure); the agent reads them from the sandbox filesystem on demand.

#### Building Skills Manually

For advanced use cases, you can construct the tool and handler independently:

```typescript
import { createReadSkillTool, createReadSkillHandler } from "zeitlich/workflow";

const tool = createReadSkillTool(skills);    // ToolDefinition with enum schema
const handler = createReadSkillHandler(skills); // Returns skill instructions
```

### Thread Continuation

By default, each session initializes a fresh thread. To continue from an existing thread (e.g., resuming a conversation after a workflow completes), pass `continueThread: true` along with the previous `threadId`:

```typescript
import { createSession } from "zeitlich/workflow";

// First run — threadId defaults to getShortId() if omitted
const session = await createSession({
  // threadId is optional, auto-generated if not provided
  // ... other config
});

// Later — new workflow forks the previous thread
const resumedSession = await createSession({
  threadId: savedThreadId, // the thread to continue from
  continueThread: true, // fork into a new thread with the old messages
  // ... other config
});
```

When `continueThread` is true the session **forks** the provided thread — it copies all messages into a new thread and operates on the copy. The original thread is never mutated, so multiple sessions can safely continue from the same thread in parallel.

`getShortId()` produces compact, workflow-deterministic IDs (~12 base-62 chars) that are more token-efficient than UUIDs.

#### Subagent Thread Continuation

Subagents can opt in to thread continuation via `allowThreadContinuation`. When enabled, the parent agent can pass a `threadId` to resume a previous subagent conversation:

```typescript
import { defineSubagentWorkflow, defineSubagent, createSession } from "zeitlich/workflow";
import { proxyLangChainThreadOps } from "zeitlich/adapters/thread/langchain/workflow";

export const researcherWorkflow = defineSubagentWorkflow(
  {
    name: "Researcher",
    description: "Researches topics and gathers information",
  },
  async (prompt, sessionInput) => {
    const session = await createSession({
      ...sessionInput, // threadId/continueThread are provided by parent when resuming
      threadOps: proxyLangChainThreadOps(),
      // ... other config
    });

    const { threadId, finalMessage } = await session.runSession({ stateManager });
    return {
      toolResponse: finalMessage ? extractText(finalMessage) : "No response",
      data: null,
      threadId,
    };
  },
);

// Enable thread continuation in the parent registration
export const researcherSubagent = defineSubagent(researcherWorkflow, {
  allowThreadContinuation: true,
});
```

The subagent returns its `threadId` in the response, which the handler surfaces to the parent LLM as `[Thread ID: ...]`. The parent can then pass that ID back in a subsequent `Subagent` tool call to continue the conversation.

### Filesystem Utilities

Built-in support for file operations with in-memory or custom filesystem providers (e.g. from [`just-bash`](https://github.com/nicholasgasior/just-bash)).

`toTree` generates a file tree string from an `IFileSystem` instance:

```typescript
import { toTree } from "zeitlich";

// In activities - generate a file tree string for agent context
export const createActivities = ({ redis, client }) => ({
  generateFileTreeActivity: async () => toTree(inMemoryFileSystem),
  // ...
});
```

Use the tree in `buildContextMessage` to give the agent filesystem awareness:

```typescript
// In workflow
const fileTree = await generateFileTreeActivity();

const session = await createSession({
  // ... other config
  buildContextMessage: () => [
    { type: "text", text: `Files in the filesystem: ${fileTree}` },
    { type: "text", text: prompt },
  ],
});
```

For file operations, use the built-in tool handlers wrapped with `withSandbox`:

```typescript
import {
  SandboxManager,
  withSandbox,
  globHandler,
  editHandler,
  bashHandler,
} from "zeitlich";

const sandboxManager = new SandboxManager(provider);

export const createActivities = ({ redis, client }) => ({
  // scope auto-prepends the provider id (e.g. "inMemory", "virtual")
  ...sandboxManager.createActivities("MyAgentWorkflow"),
  globHandlerActivity: withSandbox(sandboxManager, globHandler),
  editHandlerActivity: withSandbox(sandboxManager, editHandler),
  bashHandlerActivity: withSandbox(sandboxManager, bashHandler),
});
```

#### Sandbox Path Semantics (Virtual + Daytona)

Filesystem adapters now apply the same path rules:

- Absolute paths are used as-is (canonicalized).
- Relative paths are resolved from `/`.
- Paths are normalized (duplicate slashes removed, `.`/`..` collapsed).

This means `readFile("a/b.txt")` is treated as `/a/b.txt` across adapters.

Each `fs` instance also exposes `workspaceBase`, which is the base used for relative paths.

**Virtual sandbox example (path-only calls):**

```typescript
import { createVirtualSandbox, VirtualSandboxProvider } from "zeitlich";

const provider = new VirtualSandboxProvider(resolver);
const { sandbox } = await provider.create({
  resolverContext: { projectId: "p1" },
  workspaceBase: "/repo",
});

const fs = sandbox.fs;
console.log(fs.workspaceBase); // "/repo"

await fs.writeFile("src/index.ts", 'export const ok = true;\n');
const content = await fs.readFile("src/index.ts"); // reads /repo/src/index.ts
```

**Daytona sandbox example (base `/home/daytona`):**

```typescript
import { DaytonaSandboxProvider } from "zeitlich";

const provider = new DaytonaSandboxProvider();
const { sandbox } = await provider.create({
  workspaceBase: "/home/daytona",
});

const fs = sandbox.fs;
console.log(fs.workspaceBase); // "/home/daytona"

await fs.mkdir("project", { recursive: true });
await fs.writeFile("project/README.md", "# Hello from Daytona\n");
const content = await fs.readFile("project/README.md");
```

For Daytona, use `workspaceBase: "/home/daytona"` (or your own working dir) so relative paths stay in the expected workspace.

### Built-in Tools

Zeitlich provides ready-to-use tool definitions and handlers for common agent operations.

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `Read`            | Read file contents with optional pagination                       |
| `Write`           | Create or overwrite files with new content                        |
| `Edit`            | Edit specific sections of a file by find/replace                  |
| `Glob`            | Search for files matching a glob pattern                          |
| `Grep`            | Search file contents with regex patterns                          |
| `Bash`            | Execute shell commands                                            |
| `AskUserQuestion` | Ask the user questions during execution with structured options   |
| `ReadSkill`       | Load skill instructions on demand (see [Skills](#skills))         |
| `Task`            | Launch subagents as child workflows (see [Subagents](#subagents)) |

```typescript
// Import tool definitions in workflows
import {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  bashTool,
  askUserQuestionTool,
} from "zeitlich/workflow";

// Import handlers + wrapper in activities
import {
  withSandbox,
  editHandler,
  globHandler,
  bashHandler,
  createAskUserQuestionHandler,
} from "zeitlich";
```

All tools are passed via `tools`. The Bash tool's description is automatically enhanced with the file tree when provided:

```typescript
const session = await createSession({
  // ... other config
  tools: {
    AskUserQuestion: defineTool({
      ...askUserQuestionTool,
      handler: askUserQuestionHandlerActivity,
    }),
    Bash: defineTool({
      ...bashTool,
      handler: bashHandlerActivity,
    }),
  },
});
```

## API Reference

### Workflow Entry Point (`zeitlich/workflow`)

Safe for use in Temporal workflow files:

| Export                      | Description                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createSession`             | Creates an agent session with tools, prompts, subagents, and hooks                                     |
| `createAgentStateManager`   | Creates a state manager for workflow state with query/update handlers                                  |
| `createToolRouter`          | Creates a tool router (used internally by session, or for advanced use)                                |
| `defineTool`                | Identity function for type-safe tool definition with handler and hooks                                 |
| `defineSubagentWorkflow`    | Defines a subagent workflow with embedded name, description, and optional resultSchema                 |
| `defineSubagent`            | Creates a `SubagentConfig` from a `SubagentDefinition` with optional parent-specific overrides         |
| `getShortId`                | Generate a compact, workflow-deterministic identifier (base-62, 12 chars)                              |
| Tool definitions            | `askUserQuestionTool`, `globTool`, `grepTool`, `readFileTool`, `writeFileTool`, `editTool`, `bashTool` |
| Task tools                  | `taskCreateTool`, `taskGetTool`, `taskListTool`, `taskUpdateTool` for workflow task management         |
| Skill utilities             | `parseSkillFile`, `createReadSkillTool`, `createReadSkillHandler`, `buildSkillRegistration`             |
| Types                       | `Skill`, `SkillMetadata`, `SkillProvider`, `SubagentDefinition`, `SubagentConfig`, `ToolDefinition`, `ToolWithHandler`, `RouterContext`, `SessionConfig`, etc. |

### Activity Entry Point (`zeitlich`)

Framework-agnostic utilities for activities, worker setup, and Node.js code:

| Export                    | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `createRunAgentActivity`  | Wraps a handler into a `RunAgentActivity` with auto-fetched parent workflow state             |
| `withParentWorkflowState`  | Wraps a tool handler into an `ActivityToolHandler` with auto-fetched parent workflow state    |
| `createThreadManager`     | Generic Redis-backed thread manager factory                                                   |
| `toTree`                  | Generate file tree string from an `IFileSystem` instance                                      |
| `withSandbox`             | Wraps a handler to auto-resolve sandbox from context (pairs with `withAutoAppend`)            |
| `FileSystemSkillProvider`   | Load skills from a directory following the agentskills.io layout                                  |
| Tool handlers             | `bashHandler`, `editHandler`, `globHandler`, `readFileHandler`, `writeFileHandler`, `createAskUserQuestionHandler` |

### Thread Adapter Entry Points

**LangChain** (`zeitlich/adapters/thread/langchain`):

| Export                              | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `createLangChainAdapter`            | Unified adapter returning `createActivities`, `invoker`, `createModelInvoker` |
| `createLangChainModelInvoker`       | Factory that returns a `ModelInvoker` backed by a LangChain chat model |
| `invokeLangChainModel`              | One-shot model invocation convenience function                         |
| `createLangChainThreadManager`      | Thread manager with LangChain `StoredMessage` helpers                  |

**Google GenAI** (`zeitlich/adapters/thread/google-genai`):

| Export                              | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `createGoogleGenAIAdapter`          | Unified adapter returning `createActivities`, `invoker`, `createModelInvoker` |
| `createGoogleGenAIModelInvoker`     | Factory that returns a `ModelInvoker` backed by the `@google/genai` SDK |
| `invokeGoogleGenAIModel`            | One-shot model invocation convenience function                         |
| `createGoogleGenAIThreadManager`    | Thread manager with Google GenAI `Content` helpers                     |

### Types

| Export                  | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `AgentStatus`           | `"RUNNING" \| "WAITING_FOR_INPUT" \| "COMPLETED" \| "FAILED" \| "CANCELLED"` |
| `MessageContent`        | Framework-agnostic message content (`string \| ContentPart[]`)               |
| `ToolMessageContent`    | Content returned by a tool handler (`string`)                                |
| `ModelInvoker`          | Generic model invocation contract                                            |
| `ModelInvokerConfig`    | Configuration passed to a model invoker                                      |
| `ToolDefinition`        | Tool definition with name, description, and Zod schema                       |
| `ToolWithHandler`       | Tool definition combined with its handler                                    |
| `RouterContext`          | Base context every tool handler receives (`threadId`, `toolCallId`, `toolName`, `sandboxId?`) |
| `Hooks`                 | Combined session lifecycle + tool execution hooks                            |
| `ToolRouterHooks`       | Narrowed hook interface for tool execution only (pre/post/failure)            |
| `SubagentDefinition`    | Callable subagent workflow with embedded metadata (from `defineSubagentWorkflow`) |
| `SubagentConfig`        | Resolved subagent configuration consumed by `createSession`                  |
| `AgentState`            | Generic agent state type                                                     |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Temporal Worker                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Workflow (zeitlich/workflow)                  │  │
│  │  ┌────────────────┐  ┌───────────────────────────────┐   │  │
│  │  │ State Manager  │  │           Session             │   │  │
│  │  │ • Status       │  │  • Agent loop                 │   │  │
│  │  │ • Turns        │  │  • Tool routing & hooks       │   │  │
│  │  │ • Custom state │  │  • Prompts (system, context)  │   │  │
│  │  └────────────────┘  │  • Subagent coordination      │   │  │
│  │                      │  • Skills (progressive load)   │   │  │
│  │                      └───────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                Activities (zeitlich)                       │  │
│  │  • Tool handlers (search, file ops, bash, etc.)           │  │
│  │  • Generic thread manager (BaseThreadManager<T>)          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │          Thread Adapter (zeitlich/adapters/thread/*)       │  │
│  │  • LangChain, Google GenAI, or custom                     │  │
│  │  • Thread ops (message storage) + model invoker            │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Sandbox Adapter (zeitlich/adapters/sandbox/*)      │  │
│  │  • In-memory, Virtual, Daytona, E2B, Bedrock, or custom   │  │
│  │  • Filesystem ops for agent tools                          │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │      Redis      │
                    │ • Thread state  │
                    │ • Messages      │
                    └─────────────────┘
```

## Requirements

- Node.js >= 18
- Temporal server
- Redis

## Contributing

Contributions are welcome! Please open an issue or submit a PR.

For maintainers: see [RELEASING.md](./RELEASING.md) for the release process.

## License

MIT © [Bead Technologies Inc.](https://usebead.ai)
