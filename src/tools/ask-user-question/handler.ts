import type { ActivityToolHandler } from "../../lib/tool-router";
import type { AskUserQuestionArgs } from "./tool";

/**
 * Creates a handler for the AskUserQuestion tool.
 * Returns question data for display to the user via your UI layer.
 *
 * Typically paired with `stateManager.waitForInput()` in a `hooks.onPostToolUse`
 * callback to pause the agent loop until the user responds.
 *
 * @example
 * ```typescript
 * import { createAskUserQuestionHandler } from 'zeitlich';
 * import { askUserQuestionTool, defineTool } from 'zeitlich/workflow';
 *
 * // In activities
 * const askUserQuestionHandlerActivity = createAskUserQuestionHandler();
 *
 * // In workflow
 * tools: {
 *   AskUserQuestion: defineTool({
 *     ...askUserQuestionTool,
 *     handler: askUserQuestionHandlerActivity,
 *     hooks: {
 *       onPostToolUse: () => { stateManager.waitForInput(); },
 *     },
 *   }),
 * }
 * ```
 */
export const createAskUserQuestionHandler =
  (): ActivityToolHandler<
    AskUserQuestionArgs,
    {
      questions: {
        question: string;
        header: string;
        options: { label: string; description: string }[];
        multiSelect: boolean;
      }[];
    }
  > =>
  async (args) => {
    return {
      toolResponse: "Question submitted",
      data: { questions: args.questions },
    };
  };
