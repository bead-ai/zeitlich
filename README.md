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
- **Model flexibility** — Use any LLM provider via LangChain

## LLM Integration

Zeitlich uses [LangChain](https://js.langchain.com/) as the abstraction layer for LLM execution. This gives you:

- **Provider flexibility** — Use Anthropic, OpenAI, Google, Azure, AWS Bedrock, or any LangChain-supported provider
- **Consistent interface** — Same tool calling and message format regardless of provider
- **Easy model swapping** — Change models without rewriting agent logic
- **Soon** — Support native provider SDKs directly

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

// Use any LangChain chat model
const anthropic = new ChatAnthropic({ model: "claude-sonnet-4-20250514" });
const openai = new ChatOpenAI({ model: "gpt-4o" });
const google = new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro" });

// Pass to invokeModel in your activity
return {
  runAgent: (config) =>
    invokeModel({ config, model: anthropic, redis, client }),
};
```

Install the LangChain package for your chosen provider:

```bash
npm install @langchain/anthropic  # Anthropic
npm install @langchain/openai     # OpenAI
npm install @langchain/google-genai # Google
```

## Installation

```bash
npm install zeitlich ioredis
```

**Peer dependencies:**

- `ioredis` >= 5.0.0

**Required infrastructure:**

- Temporal server (local dev: `temporal server start-dev`)
- Redis instance

## Import Paths

Zeitlich provides two entry points to work with Temporal's workflow sandboxing:

```typescript
// In workflow files - no external dependencies (Redis, LangChain, etc.)
import {
  createSession,
  createAgentStateManager,
  askUserQuestionTool,
  bashTool,
  defineTool,
  type SubagentWorkflow,
} from "zeitlich/workflow";

// In activity files and worker setup - full functionality
import {
  ZeitlichPlugin,
  invokeModel,
  createBashHandler,
  createAskUserQuestionHandler,
  toTree,
  type InvokeModelConfig,
} from "zeitlich";
```

**Why?** Temporal workflows run in an isolated V8 sandbox that cannot import modules with Node.js APIs or external dependencies. The `/workflow` entry point contains only pure TypeScript code safe for workflow use.

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
  invokeModel,
  createBashHandler,
  createAskUserQuestionHandler,
  type InvokeModelConfig,
} from "zeitlich";

export const createActivities = ({
  redis,
  client,
}: {
  redis: Redis;
  client: WorkflowClient;
}) => ({
  runAgentActivity: (config: InvokeModelConfig) => {
    const model = new ChatAnthropic({
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
    });
    return invokeModel({ config, model, redis, client });
  },
  searchHandlerActivity: async (args: { query: string }) => ({
    toolResponse: JSON.stringify(await performSearch(args.query)),
    data: null,
  }),
  bashHandlerActivity: createBashHandler({ fs: inMemoryFileSystem }),
  askUserQuestionHandlerActivity: createAskUserQuestionHandler(),
});

export type MyActivities = ReturnType<typeof createActivities>;
```

### 4. Set Up the Worker

```typescript
import { Worker, NativeConnection } from "@temporalio/worker";
import { Client } from "@temporalio/client";
import { ZeitlichPlugin } from "zeitlich";
import Redis from "ioredis";
import { fileURLToPath } from "node:url";
import { createActivities } from "./activities";

async function run() {
  const connection = await NativeConnection.connect({
    address: "localhost:7233",
  });
  const client = new Client({ connection });
  const redis = new Redis({ host: "localhost", port: 6379 });

  const worker = await Worker.create({
    plugins: [new ZeitlichPlugin({ redis })],
    connection,
    taskQueue: "my-agent",
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities: createActivities({ redis, client: client.workflow }),
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

For file operations, use the built-in tool handler factories. All handlers accept an `IFileSystem`:

```typescript
import {
  createGlobHandler,
  createEditHandler,
  createBashHandler,
} from "zeitlich";

export const createActivities = ({ redis, client }) => ({
  generateFileTreeActivity: async () => toTree(inMemoryFileSystem),
  globHandlerActivity: createGlobHandler(inMemoryFileSystem),
  editHandlerActivity: createEditHandler(inMemoryFileSystem),
  bashHandlerActivity: createBashHandler({ fs: inMemoryFileSystem }),
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

// Import handler factories in activities
import {
  createEditHandler,
  createGlobHandler,
  createBashHandler,
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

| Export                    | Description                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createSession`           | Creates an agent session with tools, prompts, subagents, and hooks                                     |
| `createAgentStateManager` | Creates a state manager for workflow state with query/update handlers                                  |
| `createToolRouter`        | Creates a tool router (used internally by session, or for advanced use)                                |
| `defineTool`              | Identity function for type-safe tool definition with handler and hooks                                 |
| `defineSubagent`          | Identity function for type-safe subagent configuration                                                 |
| `createSubagentTool`      | Creates the Subagent tool for spawning child workflows                                                 |
| Tool definitions          | `askUserQuestionTool`, `globTool`, `grepTool`, `readFileTool`, `writeFileTool`, `editTool`, `bashTool` |
| Task tools                | `taskCreateTool`, `taskGetTool`, `taskListTool`, `taskUpdateTool` for workflow task management         |
| Types                     | `SubagentWorkflow`, `ToolDefinition`, `ToolWithHandler`, `AgentConfig`, `SessionConfig`, etc.          |

### Activity Entry Point (`zeitlich`)

For use in activities, worker setup, and Node.js code:

| Export                   | Description                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `ZeitlichPlugin`         | Temporal worker plugin that registers shared activities                                       |
| `createSharedActivities` | Creates thread management activities                                                          |
| `invokeModel`            | Core LLM invocation utility (requires Redis + LangChain)                                      |
| `toTree`                 | Generate file tree string from an `IFileSystem` instance                                      |
| Tool handlers            | `createGlobHandler`, `createEditHandler`, `createBashHandler`, `createAskUserQuestionHandler` |

### Types

| Export                  | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| `AgentStatus`           | `"RUNNING" \| "WAITING_FOR_INPUT" \| "COMPLETED" \| "FAILED" \| "CANCELLED"` |
| `ToolDefinition`        | Tool definition with name, description, and Zod schema                       |
| `ToolWithHandler`       | Tool definition combined with its handler                                    |
| `SubagentConfig`        | Configuration for subagent workflows                                         |
| `SessionLifecycleHooks` | Lifecycle hooks interface                                                    |
| `AgentState`            | Generic agent state type                                                     |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Temporal Worker                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    ZeitlichPlugin                         │  │
│  │  • Registers shared activities (thread management)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      Workflow                             │  │
│  │  ┌────────────────┐  ┌───────────────────────────────┐   │  │
│  │  │ State Manager  │  │           Session             │   │  │
│  │  │ • Status       │  │  • Agent loop                 │   │  │
│  │  │ • Turns        │  │  • Tool routing & hooks       │   │  │
│  │  │ • Custom state │  │  • Prompts (system, context)  │   │  │
│  │  └────────────────┘  │  • Subagent coordination      │   │  │
│  │                      └───────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      Activities                           │  │
│  │  • runAgent (LLM invocation)                              │  │
│  │  • Tool handlers (search, file ops, bash, etc.)           │  │
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
