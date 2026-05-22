import { z } from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

const textEditSchema = z.object({
  old_string: z.string().describe("The exact text to replace"),
  new_string: z.string().describe("The text to replace it with"),
  replace_all: z
    .boolean()
    .optional()
    .describe(
      "If true, replace all occurrences of old_string for this edit (default: false)"
    ),
});

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
} satisfies ToolDefinition;

export type FileEditArgs = z.infer<typeof editTool.schema>;

export const multiEditTool = {
  name: "FileMultiEdit" as const,
  description: `Apply multiple exact text replacements to one file in order.

Usage:
- Use this when a task needs several related edits in the same file
- Each edit is applied to the file content produced by the prior edit
- The operation is atomic: if any edit fails, the file is left unchanged

IMPORTANT:
- You must read the file first (in this session) before editing it
- Each old_string must match exactly (whitespace-sensitive)
- Each old_string must be unique unless that edit uses replace_all: true
- old_string and new_string must be different for every edit
`,
  schema: z.object({
    file_path: z
      .string()
      .describe("The absolute virtual path to the file to modify"),
    edits: z
      .array(textEditSchema)
      .min(1)
      .describe("Exact replacements to apply sequentially to the file"),
  }),
  strict: true,
} satisfies ToolDefinition;

export type FileMultiEditArgs = z.infer<typeof multiEditTool.schema>;
