import type { MessageContent, ToolResultConfig } from "./lib/types";

/**
 * Shared Zeitlich activities — thread management and message handling.
 *
 * This is a framework-agnostic interface. Concrete implementations are
 * provided by adapter packages (e.g. `zeitlich/langchain`).
 *
 * Note: `runAgent` is workflow-specific and should be created per-workflow.
 */
export interface ZeitlichSharedActivities {
  /** Append a tool result to the thread. */
  appendToolResult(config: ToolResultConfig): Promise<void>;

  /** Initialize an empty thread. */
  initializeThread(threadId: string): Promise<void>;

  /** Append raw messages to a thread. */
  appendThreadMessages(threadId: string, messages: unknown[]): Promise<void>;

  /** Append a human message to a thread. */
  appendHumanMessage(
    threadId: string,
    content: string | MessageContent,
  ): Promise<void>;

  /** Append a system message to a thread. */
  appendSystemMessage(threadId: string, content: string): Promise<void>;
}
