import { AIMessage, type StoredMessage } from "@langchain/core/messages";
import type { ActivityToolHandler } from "../../lib/tool-router";
import type { AskUserQuestionToolSchemaType } from "./tool";

/**
 * Handle user interaction tool result - creates AI messages for display.
 */
export const handleAskUserQuestionToolResult: ActivityToolHandler<
  AskUserQuestionToolSchemaType,
  { chatMessages: StoredMessage[] }
> = async (args) => {
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

  return { content: "Question submitted", result: { chatMessages: messages } };
};
