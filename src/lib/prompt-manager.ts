import type { MessageContent } from "@langchain/core/messages";

/**
 * Configuration for creating a prompt manager
 */
export interface PromptManagerConfig<TContext = unknown> {
  /**
   * Base system prompt (e.g., Auditron identity).
   * Can be a static string or async function.
   */
  baseSystemPrompt: string | (() => string | Promise<string>);
  /**
   * Agent-specific instructions prompt.
   * Can be a static string or async function.
   */
  instructionsPrompt: string | (() => string | Promise<string>);
  /**
   * Build context message content from agent-specific context.
   * Returns MessageContent array for the initial HumanMessage.
   */
  buildContextMessage: (
    context: TContext
  ) => MessageContent | Promise<MessageContent>;
}

/**
 * Prompt manager interface
 */
export interface PromptManager<TContext = unknown> {
  /**
   * Get the full system prompt (base + instructions combined).
   */
  getSystemPrompt(): Promise<string>;
  /**
   * Build the initial context message content.
   */
  buildContextMessage(context: TContext): Promise<MessageContent>;
}

/**
 * Creates a prompt manager for handling system prompts and context messages.
 *
 */
export function createPromptManager<TContext = unknown>(
  config: PromptManagerConfig<TContext>
): PromptManager<TContext> {
  const { baseSystemPrompt, instructionsPrompt, buildContextMessage } = config;

  async function resolvePrompt(
    prompt: string | (() => string | Promise<string>)
  ): Promise<string> {
    if (typeof prompt === "function") {
      return prompt();
    }
    return prompt;
  }

  return {
    async getSystemPrompt(): Promise<string> {
      const base = await resolvePrompt(baseSystemPrompt);
      const instructions = await resolvePrompt(instructionsPrompt);
      return [base, instructions].join("\n");
    },

    async buildContextMessage(context: TContext): Promise<MessageContent> {
      return buildContextMessage(context);
    },
  };
}
