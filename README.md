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
  runAgent: (config, invocationConfig) =>
    invokeModel(redis, { ...config, tools }, anthropic, invocationConfig),
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
import { createSession, createToolRegistry, ... } from 'zeitlich/workflow';

// In activity files and worker setup - full functionality
import { ZeitlichPlugin, invokeModel, globHandler, ... } from 'zeitlich';
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

export const tools = { Search: searchTool };
```

### 2. Create Activities

```typescript
import type Redis from "ioredis";
import { ChatAnthropic } from "@langchain/anthropic";
import { invokeModel } from "zeitlich";
import { tools } from "./tools";

export const createActivities = (redis: Redis) => {
  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
  });

  return {
    runAgent: (config, invocationConfig) =>
      invokeModel(
        redis,
        { ...config, tools: Object.values(tools) },
        model,
        invocationConfig
      ),

    handleSearchResult: async ({ args }) => {
      // Your tool implementation
      const results = await performSearch(args.query);
      return { result: { results } };
    },
  };
};
```

### 3. Create the Workflow

```typescript
import { proxyActivities, workflowInfo } from "@temporalio/workflow";
import {
  createAgentStateManager,
  createSession,
  createPromptManager,
  createToolRegistry,
  createToolRouter,
} from "zeitlich/workflow";
import type { ZeitlichSharedActivities } from "zeitlich/workflow";
import { tools } from "./tools";

const { runAgent, handleSearchResult } = proxyActivities<MyActivities>({
  startToCloseTimeout: "30m",
});

const { appendToolResult } = proxyActivities<ZeitlichSharedActivities>({
  startToCloseTimeout: "30m",
});

export async function myAgentWorkflow({ prompt }: { prompt: string }) {
  const { runId } = workflowInfo();

  const stateManager = createAgentStateManager({
    initialState: { prompt },
  });

  const toolRegistry = createToolRegistry(tools);

  const toolRouter = createToolRouter(
    { registry: toolRegistry, threadId: runId, appendToolResult },
    { Search: handleSearchResult }
  );

  const promptManager = createPromptManager({
    baseSystemPrompt: "You are a helpful assistant.",
    buildContextMessage: () => [{ type: "text", text: prompt }],
  });

  const session = await createSession(
    { threadId: runId, agentName: "my-agent", maxTurns: 20 },
    { runAgent, promptManager, toolRouter, toolRegistry }
  );

  await session.runSession(prompt, stateManager);
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
  initialState: { customField: "value" },
});

// State operations
stateManager.set("customField", "new value");
stateManager.complete(); // Mark as COMPLETED
stateManager.waitForInput(); // Mark as WAITING_FOR_INPUT
stateManager.isRunning(); // Check if RUNNING
stateManager.isTerminal(); // Check if COMPLETED/FAILED/CANCELLED
```

### Tool Registry

Type-safe tool management with Zod validation:

```typescript
import { createToolRegistry } from "zeitlich/workflow";

const registry = createToolRegistry({
  Search: searchTool,
  Calculate: calculateTool,
});

// Parse and validate tool calls from LLM
const parsed = registry.parseToolCall(rawToolCall);
// parsed.name is "Search" | "Calculate"
// parsed.args is fully typed based on the tool's schema
```

### Tool Router

Routes tool calls to handlers with lifecycle hooks:

```typescript
import { createToolRouter } from "zeitlich/workflow";

const router = createToolRouter(
  {
    registry: toolRegistry,
    threadId,
    appendToolResult,
    hooks: {
      onPreToolUse: ({ toolCall }) => {
        console.log(`Executing ${toolCall.name}`);
        return {}; // Can return { skip: true } or { modifiedArgs: {...} }
      },
      onPostToolUse: ({ toolCall, result, durationMs }) => {
        console.log(`${toolCall.name} completed in ${durationMs}ms`);
      },
      onPostToolUseFailure: ({ toolCall, error }) => {
        return { fallbackContent: "Tool failed, please try again" };
      },
    },
  },
  {
    Search: handleSearchResult,
    Calculate: handleCalculateResult,
  }
);
```

### Subagents

Spawn child agents as Temporal child workflows:

```typescript
import { withSubagentSupport } from "zeitlich/workflow";
import { z } from "zod";

const { tools, taskHandler } = withSubagentSupport(baseTools, {
  subagents: [
    {
      name: "researcher",
      description: "Researches topics and returns findings",
      workflowType: "researcherWorkflow",
      resultSchema: z.object({
        findings: z.string(),
        sources: z.array(z.string()),
      }),
    },
  ],
});

// Include taskHandler in your tool router
const router = createToolRouter(
  { registry, threadId, appendToolResult },
  { ...handlers, Task: taskHandler }
);
```

### Filesystem Utilities

Built-in support for file operations with pluggable providers. File trees are dynamic and stored in workflow state, enabling per-workflow scoping.

```typescript
// In workflow - use the pure utilities and tool definitions
import {
  buildFileTreePrompt,
  globTool,
  readTool,
  type FileNode,
  type FileSystemProvider,
  type ToolHandlerContext,
} from "zeitlich/workflow";

// In activities - use the providers and handlers
import {
  CompositeFileSystemProvider,
  globHandler,
  readHandler,
} from "zeitlich";

// Define your handler context type
interface FileSystemContext extends ToolHandlerContext {
  scopedNodes: FileNode[];
  provider: FileSystemProvider;
}

// Activities receive context via handlerContext
export const createActivities = (dbClient: DbClient) => ({
  // Generate file tree (implements GenerateFileTreeActivity)
  generateFileTree: async (config?: { userId: string }): Promise<FileNode[]> => {
    const files = await dbClient.getFilesForUser(config?.userId);
    return files.map((f) => ({
      path: f.path,
      type: "file" as const,
      metadata: { dbId: f.id },
    }));
  },

  // Read file content from backend
  readFileContent: async (node: FileNode) => {
    const content = await dbClient.getFileContent(node.metadata?.dbId);
    return { type: "text" as const, content };
  },

  // Handlers receive context from processToolCalls
  glob: async (args: GlobToolSchemaType, context?: FileSystemContext) => {
    if (!context) throw new Error("FileSystemContext required");
    return globHandler(args, context.scopedNodes, context.provider);
  },

  read: async (args: ReadToolSchemaType, context?: FileSystemContext) => {
    if (!context) throw new Error("FileSystemContext required");
    return readHandler(args, context.scopedNodes, context.provider);
  },
});

// In workflow - file tree is generated at start, stored in state
const fileTree = await activities.generateFileTree({ userId });
stateManager.setFileTree(fileTree);

// Create provider for this workflow
const provider = CompositeFileSystemProvider.withScope(fileTree, {
  backends: {
    db: { resolver: (node) => activities.readFileContent(node) },
  },
  defaultBackend: "db",
});

// Pass handlerContext when processing tool calls
await toolRouter.processToolCalls(toolCalls, {
  turn: currentTurn,
  handlerContext: {
    scopedNodes: stateManager.getFileTree(),
    provider,
  },
});

// Build context for the agent prompt
const fileTreeContext = buildFileTreePrompt(stateManager.getFileTree(), {
  headerText: "Available Files",
});
```

### Built-in Tools

Zeitlich provides ready-to-use tool definitions and handlers for common agent operations. More tools will be added in future releases.

| Tool              | Description                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| `FileRead`        | Read file contents with optional pagination (supports text, images, PDFs) |
| `FileWrite`       | Create or overwrite files with new content                                |
| `FileEdit`        | Edit specific sections of a file by find/replace                          |
| `Glob`            | Search for files matching a glob pattern                                  |
| `Grep`            | Search file contents with regex patterns                                  |
| `AskUserQuestion` | Ask the user questions during execution with structured options           |
| `Task`            | Launch subagents as child workflows (see [Subagents](#subagents))         |

```typescript
// Import tool definitions in workflows
import {
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  askUserQuestionTool,
} from "zeitlich/workflow";

// Import handlers in activities
// Handlers are direct functions that accept scopedNodes per-call
import {
  readHandler,
  writeHandler,
  editHandler,
  globHandler,
  grepHandler,
} from "zeitlich";
```

## API Reference

### Workflow Entry Point (`zeitlich/workflow`)

Safe for use in Temporal workflow files:

| Export                    | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `createSession`           | Creates an agent session for running the agentic loop                              |
| `createAgentStateManager` | Creates a state manager for workflow state                                         |
| `createPromptManager`     | Creates a prompt manager for system/context prompts                                |
| `createToolRegistry`      | Creates a type-safe tool registry                                                  |
| `createToolRouter`        | Creates a tool router with handlers and hooks                                      |
| `withSubagentSupport`     | Adds Task tool for spawning subagents                                              |
| `buildFileTreePrompt`     | Generates file tree context for prompts                                            |
| Tool definitions          | `askUserQuestionTool`, `globTool`, `grepTool`, `readTool`, `writeTool`, `editTool` |
| Types                     | All TypeScript types and interfaces                                                |

### Activity Entry Point (`zeitlich`)

For use in activities, worker setup, and Node.js code:

| Export                        | Description                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ZeitlichPlugin`              | Temporal worker plugin that registers shared activities                                                  |
| `createSharedActivities`      | Creates thread management activities                                                                     |
| `invokeModel`                 | Core LLM invocation utility (requires Redis + LangChain)                                                 |
| `InMemoryFileSystemProvider`  | In-memory filesystem implementation (use `withScope` factory for per-call instantiation)                 |
| `CompositeFileSystemProvider` | Combines multiple filesystem providers (use `withScope` factory for per-call instantiation)              |
| `BaseFileSystemProvider`      | Base class for custom providers                                                                          |
| Tool handlers                 | `globHandler`, `grepHandler`, `readHandler`, `writeHandler`, `editHandler` (accept scopedNodes per-call) |

### Types

| Export           | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `AgentStatus`    | `"RUNNING" \| "WAITING_FOR_INPUT" \| "COMPLETED" \| "FAILED" \| "CANCELLED"` |
| `ToolDefinition` | Tool definition with name, description, and Zod schema                       |
| `SubagentConfig` | Configuration for subagent workflows                                         |
| `SessionHooks`   | Lifecycle hooks interface                                                    |

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
│  │  ┌────────────────┐  ┌─────────────┐  ┌──────────────┐   │  │
│  │  │ State Manager  │  │   Session   │  │ Tool Router  │   │  │
│  │  │ • Status       │  │ • Run loop  │  │ • Dispatch   │   │  │
│  │  │ • Turns        │  │ • Max turns │  │ • Hooks      │   │  │
│  │  │ • Custom state │  │ • Lifecycle │  │ • Handlers   │   │  │
│  │  └────────────────┘  └─────────────┘  └──────────────┘   │  │
│  │                              │                            │  │
│  │  ┌────────────────┐  ┌─────────────┐  ┌──────────────┐   │  │
│  │  │ Prompt Manager │  │Tool Registry│  │  Subagents   │   │  │
│  │  │ • System prompt│  │ • Parsing   │  │ • Child WFs  │   │  │
│  │  │ • Context      │  │ • Validation│  │ • Results    │   │  │
│  │  └────────────────┘  └─────────────┘  └──────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      Activities                           │  │
│  │  • runAgent (LLM invocation)                              │  │
│  │  • Tool handlers                                          │  │
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
