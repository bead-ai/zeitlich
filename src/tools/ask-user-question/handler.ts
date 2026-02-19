import type { ToolHandler } from "../../lib/tool-router";
import type { AskUserQuestionArgs } from "./tool";

/**
 * Creates handler for user interaction tool - creates AI messages for display.
 */
export const createAskUserQuestionHandler =
  (): ToolHandler<
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
  (args) => {
    return {
      toolResponse: "Question submitted",
      data: { questions: args.questions },
    };
  };
