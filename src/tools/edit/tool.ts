import { z } from "zod";

export const editTool = {
  name: "FileEdit" as const,
  description: `Edit specific sections of a file by replacing text.

Usage:
- Provide the exact text to find and replace
- The old_string must match exactly (whitespace-sensitive)
- By default, only replaces the first occurrence
- Use replace_all: true to replace all occurrences

IMPORTANT:
- You must read the file first (in this session) before editing it
- old_string must be unique in the file (unless using replace_all)
- The operation fails if old_string is not found
- old_string and new_string must be different
`,
  schema: z.object({
    file_path: z
      .string()
      .describe("The absolute virtual path to the file to modify"),
    old_string: z.string().describe("The exact text to replace"),
    new_string: z
      .string()
      .describe(
        "The text to replace it with (must be different from old_string)"
      ),
    replace_all: z
      .boolean()
      .optional()
      .describe(
        "If true, replace all occurrences of old_string (default: false)"
      ),
  }),
  strict: true,
};

export type EditToolSchemaType = z.infer<typeof editTool.schema>;
