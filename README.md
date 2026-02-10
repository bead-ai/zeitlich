[![npm version](https://img.shields.io/npm/v/zeitlich.svg?style=flat-square)](https://www.npmjs.org/package/zeitlich)
[![npm downloads](https://img.shields.io/npm/dm/zeitlich.svg?style=flat-square)](https://npm-stat.com/charts.html?package=zeitlich)

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
  runAgent: (config) => invokeModel(redis, config, anthropic),
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
import { createSession, createAgentStateManager, askUserQuestionTool } from 'zeitlich/workflow';

// In activity files and worker setup - full functionality
import { ZeitlichPlugin, invokeModel, toTree } from 'zeitlich';
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

### 2. Create Activities

```typescript
import type Redis from "ioredis";
import { ChatAnthropic } from "@langchain/anthropic";
import { invokeModel } from "zeitlich";

export const createActivities = (redis: Redis) => {
  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
  });

  return {
    runAgent: (config) => invokeModel(redis, config, model),

    handleSearchResult: async ({ args }) => {
      const results = await performSearch(args.query);
      return { result: { results } };
    },
  };
};

export type MyActivities = ReturnType<typeof createActivities>;
```

### 3. Create the Workflow

```typescript
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import { createAgentStateManager, createSession } from "zeitlich/workflow";
import { searchTool } from "./tools";
import type { MyActivities } from "./activities";

const { runAgent, handleSearchResult } = proxyActivities<MyActivities>({
  startToCloseTimeout: "30m",
});

export async function myAgentWorkflow({ prompt }: { prompt: string }) {
  const { runId } = workflowInfo();

  const stateManager = createAgentStateManager({});

  const session = await createSession({
    threadId: runId,
    agentName: "my-agent",
    maxTurns: 20,
    runAgent,
    baseSystemPrompt: "You are a helpful assistant.",
    instructionsPrompt: "Help the user with their request.",
    buildContextMessage: () => [{ type: "text", text: prompt }],
    tools: {
      Search: {
        ...searchTool,
        handler: handleSearchResult,
      },
    },
  });

  await session.runSession({ stateManager });
  return stateManager.getCurrentState();
}
```

### 4. Set Up the Worker

```typescript
import { Worker, NativeConnection } from "@temporalio/worker";
import { ZeitlichPlugin } from "zeitlich";
import Redis from "ioredis";
import { createActivities } from "./activities";

async function run() {
  const connection = await NativeConnection.connect({
    address: "localhost:7233",
  });
  const redis = new Redis({ host: "localhost", port: 6379 });

  const worker = await Worker.create({
    plugins: [new ZeitlichPlugin({ redis })],
    connection,
    taskQueue: "my-agent",
    workflowsPath: require.resolve("./workflows"),
    activities: createActivities(redis),
  });

  await worker.run();
}
```

## Core Concepts

### Agent State Manager

Manages workflow state with automatic versioning and status tracking:

```typescript
import { createAgentStateManager } from "zeitlich/workflow";

const stateManager = createAgentStateManager({
  customField: "value",
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

// In workflow - combine tool definition with handler
const session = await createSession({
  // ... other config
  tools: {
    Search: {
      ...searchTool,
      handler: handleSearchResult, // Activity that implements the tool
    },
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

Spawn child agents as Temporal child workflows:

```typescript
const session = await createSession({
  // ... other config
  subagents: [
    {
      name: "researcher",
      description: "Researches topics and returns findings",
      workflow: "researcherWorkflow",
    },
    {
      name: "code-reviewer",
      description: "Reviews code for quality and best practices",
      workflow: "codeReviewerWorkflow",
    },
  ],
});
```

The `Task` tool is automatically added when subagents are configured, allowing the agent to spawn child workflows.

### Filesystem Utilities

Built-in support for file operations. Use `buildFileTree` to generate a file tree string that's included in the agent's context:

```typescript
// In activities
export const createActivities = () => ({
  generateFileTree: async (): Promise<string> => {
    // Return a formatted file tree string
    return toTree("/path/to/workspace");
  },
});

// In workflow
const session = await createSession({
  // ... other config
  buildFileTree: generateFileTree, // Called at session start
});
```

For more advanced file operations, use the built-in tool handlers:

```typescript
import { globHandler, editHandler, toTree } from "zeitlich";

export const createActivities = () => ({
  generateFileTree: () => toTree("/workspace"),
  handleGlob: (args) => globHandler(args),
  handleEdit: (args) => editHandler(args, { basePath: "/workspace" }),
});
```

### Built-in Tools

Zeitlich provides ready-to-use tool definitions and handlers for common agent operations.

| Tool              | Description                                                     |
| ----------------- | --------------------------------------------------------------- |
| `Read`            | Read file contents with optional pagination                     |
| `Write`           | Create or overwrite files with new content                      |
| `Edit`            | Edit specific sections of a file by find/replace                |
| `Glob`            | Search for files matching a glob pattern                        |
| `Grep`            | Search file contents with regex patterns                        |
| `Bash`            | Execute shell commands                                          |
| `AskUserQuestion` | Ask the user questions during execution with structured options |
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

// Import handlers in activities
import {
  editHandler,
  globHandler,
  handleBashTool,
  handleAskUserQuestionToolResult,
} from "zeitlich";
```

All tools are passed via `tools`. The Bash tool's description is automatically enhanced with the file tree when provided:

```typescript
const session = await createSession({
  // ... other config
  tools: {
    AskUserQuestion: {
      ...askUserQuestionTool,
      handler: handleAskUserQuestionToolResult,
    },
    Bash: {
      ...bashTool,
      handler: handleBashTool(bashOptions),
    },
  },
});
```

## API Reference

### Workflow Entry Point (`zeitlich/workflow`)

Safe for use in Temporal workflow files:

| Export                    | Description                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `createSession`           | Creates an agent session with tools, prompts, subagents, and hooks                           |
| `createAgentStateManager` | Creates a state manager for workflow state                                                   |
| `createToolRouter`        | Creates a tool router (used internally by session, or for advanced use)                      |
| `createTaskTool`          | Creates the Task tool for subagent support                                                   |
| Tool definitions          | `askUserQuestionTool`, `globTool`, `grepTool`, `readTool`, `writeTool`, `editTool`, `bashTool` |
| Task tools                | `taskCreateTool`, `taskGetTool`, `taskListTool`, `taskUpdateTool` for workflow task management |
| Types                     | All TypeScript types and interfaces                                                          |

### Activity Entry Point (`zeitlich`)

For use in activities, worker setup, and Node.js code:

| Export                           | Description                                            |
| -------------------------------- | ------------------------------------------------------ |
| `ZeitlichPlugin`                 | Temporal worker plugin that registers shared activities |
| `createSharedActivities`         | Creates thread management activities                   |
| `invokeModel`                    | Core LLM invocation utility (requires Redis + LangChain) |
| `toTree`                         | Generate file tree string from a directory path        |
| Tool handlers                    | `globHandler`, `editHandler`, `handleBashTool`, `handleAskUserQuestionToolResult` |

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
