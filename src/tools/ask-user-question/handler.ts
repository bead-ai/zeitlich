import { AIMessage, type StoredMessage } from "@langchain/core/messages";
import type { ActivityToolHandler } from "../../lib/tool-router";
import type { AskUserQuestionArgs } from "./tool";

/**
 * Creates handler for user interaction tool - creates AI messages for display.
 */
export const createAskUserQuestionHandler = (): ActivityToolHandler<
  AskUserQuestionArgs,
  { chatMessages: StoredMessage[] }
> => async (args) => {
  const messages = args.questions.map(
    ({ question, header, options, multiSelect }) =>
      new AIMessage({
        content: question,
        additional_kwargs: {
          header,
          options,
          multiSelect,
        },
      }).toDict()
  );

  return { toolResponse: "Question submitted", data: { chatMessages: messages } };
};
