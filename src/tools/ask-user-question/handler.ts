import type { ActivityToolHandler } from "../../lib/tool-router";
import type { AskUserQuestionArgs } from "./tool";

/**
 * Creates handler for user interaction tool - creates AI messages for display.
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
