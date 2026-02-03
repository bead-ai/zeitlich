import z from "zod";

export const askUserQuestionTool = {
  name: "AskUserQuestion" as const,
  description: `Use this tool when you need to ask the user questions during execution. This allows you to:

1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:

* Users will always be able to select "Other" to provide custom text input
* Use multiSelect: true to allow multiple answers to be selected for a question
* If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label
`,
  schema: z.object({
    questions: z.array(
      z.object({
        question: z.string().describe("The full question text to display"),
        header: z
          .string()
          .describe("Short label for the question (max 12 characters)"),
        options: z
          .array(
            z.object({
              label: z.string(),
              description: z.string(),
            })
          )
          .min(0)
          .max(4)
          .describe("Array of 0-4 choices, each with label and description"),
        multiSelect: z
          .boolean()
          .describe("If true, users can select multiple options"),
      })
    ),
  }),
  strict: true,
};

export type AskUserQuestionToolSchemaType = z.infer<
  typeof askUserQuestionTool.schema
>;
