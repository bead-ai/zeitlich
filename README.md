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
- **Filesystem utilities** — In-memory or custom providers for file operations
- **Model flexibility** — Framework-agnostic model invocation with adapters for LangChain (and more coming)

## LLM Integration

Zeitlich's core is framework-agnostic — it defines generic interfaces (`ModelInvoker`, `ThreadOps`, `MessageContent`) that work with any LLM SDK. Concrete implementations are provided via adapter packages.

### LangChain Adapter (`zeitlich/adapters/thread/langchain`)

The built-in LangChain adapter gives you:

- **Provider flexibility** — Use Anthropic, OpenAI, Google, Azure, AWS Bedrock, or any LangChain-supported provider
- **Consistent interface** — Same tool calling and message format regardless of provider
- **Easy model swapping** — Change models without rewriting agent logic

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { createLangChainAdapter } from "zeitlich/adapters/thread/langchain";
import { withParentWorkflowState } from "zeitlich";

const adapter = createLangChainAdapter({
  redis,
  model: new ChatAnthropic({ model: "claude-sonnet-4-20250514" }),
});

export function createActivities(client: WorkflowClient) {
  return {
    ...adapter.threadOps,
    runAgent: withParentWorkflowState(client, adapter.invoker),
  };
}
```

Install the LangChain package for your chosen provider:

```bash
npm install @langchain/core @langchain/anthropic  # Anthropic
npm install @langchain/core @langchain/openai     # OpenAI
npm install @langchain/core @langchain/google-genai # Google
```

## Installation

```bash
npm install zeitlich ioredis
```

**Peer dependencies:**

- `ioredis` >= 5.0.0
- `@langchain/core` >= 1.0.0 (optional — only needed when using `zeitlich/adapters/thread/langchain`)

**Required infrastructure:**

- Temporal server (local dev: `temporal server start-dev`)
- Redis instance

## Import Paths

Zeitlich provides three entry points:

```typescript
// In workflow files — no external dependencies (Redis, LangChain, etc.)
import {
  createSession,
  createAgentStateManager,
  askUserQuestionTool,
  bashTool,
  defineTool,
  type SubagentWorkflow,
  type ModelInvoker,
} from "zeitlich/workflow";

// In activity files and worker setup — framework-agnostic core
import {
  withParentWorkflowState,
  withSandbox,
  bashHandler,
  createAskUserQuestionHandler,
  toTree,
} from "zeitlich";

// LangChain adapter — unified adapter for LLM invocation and thread management
import { createLangChainAdapter } from "zeitlich/adapters/thread/langchain";
```

**Why three entry points?**

- `zeitlich/workflow` — Pure TypeScript, safe for Temporal's V8 sandbox
- `zeitlich` — Activity-side utilities (Redis, filesystem), framework-agnostic
- `zeitlich/adapters/thread/langchain` — LangChain-specific adapter (model invocation + thread management)

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

The system prompt is set via `createAgentStateManager`'s `initialState`, and agent config fields (`agentName`, `maxTurns`, etc.) are spread into `createSession`.

```typescript
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  createAgentStateManager,
  createSession,
  askUserQuestionTool,
  bashTool,
  defineTool,
} from "zeitlich/workflow";
import { searchTool } from "./tools";
import type { MyActivities } from "./activities";

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

export async function myAgentWorkflow({ prompt }: { prompt: string }) {
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
  });

  const result = await session.runSession({ stateManager });
  return result;
}
```

### 3. Create Activities

Activities are factory functions that receive infrastructure dependencies (`redis`, `client`). Each returns an object of activity functions registered with the Temporal worker.

```typescript
import type Redis from "ioredis";
import type { WorkflowClient } from "@temporalio/client";
import { ChatAnthropic } from "@langchain/anthropic";
import {
  withSandbox,
  bashHandler,
  createAskUserQuestionHandler,
  withParentWorkflowState,
} from "zeitlich";
import { createLangChainAdapter } from "zeitlich/adapters/thread/langchain";

export const createActivities = ({
  redis,
  client,
}: {
  redis: Redis;
  client: WorkflowClient;
}) => {
  const { threadOps, invoker } = createLangChainAdapter({
    redis,
    model: new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
    }),
  });

  return {
    ...threadOps,
    runAgentActivity: withParentWorkflowState(client, invoker),
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

Spawn child agents as Temporal child workflows. Each subagent is a workflow typed with `SubagentWorkflow` that returns `{ toolResponse, data }`:

```typescript
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  createAgentStateManager,
  createSession,
  type SubagentWorkflow,
} from "zeitlich/workflow";
import { agentConfig } from "./config";
import type { createResearcherActivities } from "./activities";

const { runResearcherActivity } = proxyActivities<
  ReturnType<typeof createResearcherActivities>
>({ startToCloseTimeout: "30m", heartbeatTimeout: "5m" });

// Subagent workflow typed as SubagentWorkflow
export const researcherSubagentWorkflow: SubagentWorkflow = async ({
  prompt,
}) => {
  const { runId } = workflowInfo();

  const stateManager = createAgentStateManager({
    initialState: { systemPrompt: agentConfig.systemPrompt },
    agentName: agentConfig.agentName,
  });

  const session = await createSession({
    ...agentConfig,
    threadId: runId,
    runAgent: runResearcherActivity,
    buildContextMessage: () => [{ type: "text", text: prompt }],
  });

  const { finalMessage } = await session.runSession({ stateManager });
  return {
    toolResponse: finalMessage ? extractText(finalMessage) : "No response",
    data: null,
  };
};

// Register the subagent for the parent workflow
export const researcherSubagent = {
  agentName: agentConfig.agentName,
  description: agentConfig.description,
  workflow: researcherSubagentWorkflow,
};
```

In the parent workflow, pass subagents to `createSession`:

```typescript
const session = await createSession({
  // ... other config
  subagents: [researcherSubagent, codeReviewerSubagent],
});
```

The `Subagent` tool is automatically added when subagents are configured, allowing the LLM to spawn child workflows.

### Thread Continuation

By default, each session initializes a fresh thread. To continue an existing thread (e.g., resuming a conversation after a workflow completes), pass `continueThread: true` along with the previous `threadId`:

```typescript
import { createSession } from "zeitlich/workflow";

// First run — threadId defaults to getShortId() if omitted
const session = await createSession({
  // threadId is optional, auto-generated if not provided
  // ... other config
});

// Later — new workflow picks up the same thread
const resumedSession = await createSession({
  threadId: savedThreadId, // pass the ID from the first run
  continueThread: true, // skip thread init + system prompt
  // ... other config
});
```

`getShortId()` produces compact, workflow-deterministic IDs (~12 base-62 chars) that are more token-efficient than UUIDs.

#### Subagent Thread Continuation

Subagents can opt in to thread continuation via `allowThreadContinuation`. When enabled, the parent agent can pass a `threadId` to resume a previous subagent conversation:

```typescript
import { getShortId, type SubagentWorkflow } from "zeitlich/workflow";

// Subagent workflow that supports continuation
export const researcherWorkflow: SubagentWorkflow = async ({
  prompt,
  threadId,
}) => {
  const effectiveThreadId = threadId ?? getShortId();

  const session = await createSession({
    threadId: effectiveThreadId,
    continueThread: !!threadId,
    // ... other config
  });

  const { finalMessage } = await session.runSession({ stateManager });
  return {
    toolResponse: finalMessage ? extractText(finalMessage) : "No response",
    data: null,
    threadId: effectiveThreadId,
  };
};

// Register with allowThreadContinuation
export const researcherSubagent = {
  agentName: "Researcher",
  description: "Researches topics and gathers information",
  workflow: researcherWorkflow,
  allowThreadContinuation: true,
};
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
  ...sandboxManager.createActivities(),
  globHandlerActivity: withSandbox(sandboxManager, globHandler),
  editHandlerActivity: withSandbox(sandboxManager, editHandler),
  bashHandlerActivity: withSandbox(sandboxManager, bashHandler),
});
```

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
| `defineSubagent`            | Identity function for type-safe subagent configuration                                                 |
| `getShortId`                | Generate a compact, workflow-deterministic identifier (base-62, 12 chars)                              |
| Tool definitions            | `askUserQuestionTool`, `globTool`, `grepTool`, `readFileTool`, `writeFileTool`, `editTool`, `bashTool` |
| Task tools                  | `taskCreateTool`, `taskGetTool`, `taskListTool`, `taskUpdateTool` for workflow task management         |
| Types                       | `SubagentWorkflow`, `ToolDefinition`, `ToolWithHandler`, `RouterContext`, `SessionConfig`, etc.        |

### Activity Entry Point (`zeitlich`)

Framework-agnostic utilities for activities, worker setup, and Node.js code:

| Export                    | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `withParentWorkflowState` | Wraps a `ModelInvoker` to auto-fetch parent workflow state before each invocation             |
| `createThreadManager`     | Generic Redis-backed thread manager factory                                                   |
| `toTree`                  | Generate file tree string from an `IFileSystem` instance                                      |
| `withSandbox`             | Wraps a handler to auto-resolve sandbox from context (pairs with `withAutoAppend`)            |
| Tool handlers             | `bashHandler`, `editHandler`, `globHandler`, `readFileHandler`, `writeFileHandler`, `createAskUserQuestionHandler` |

### LangChain Adapter Entry Point (`zeitlich/adapters/thread/langchain`)

LangChain-specific implementations:

| Export                              | Description                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `createLangChainAdapter`            | Unified adapter returning `threadOps`, `invoker`, `createModelInvoker` |
| `createLangChainModelInvoker`       | Factory that returns a `ModelInvoker` backed by a LangChain chat model |
| `invokeLangChainModel`              | One-shot model invocation convenience function                         |
| `createLangChainThreadManager`      | Thread manager with LangChain `StoredMessage` helpers                  |

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
| `SubagentConfig`        | Configuration for subagent workflows                                         |
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
│  │       LLM Adapter (zeitlich/adapters/thread/langchain)           │  │
│  │  • createLangChainAdapter (thread ops + model invoker)    │  │
│  │  • createLangChainThreadManager (message helpers)         │  │
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
