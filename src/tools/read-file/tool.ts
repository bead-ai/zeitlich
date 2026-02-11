import { z } from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

export const readTool = {
  name: "FileRead" as const,
  description: `Read file contents with optional pagination.

Usage:
- Provide the virtual path to the file you want to read
- Supports text files, images, and PDFs
- For large files, use offset and limit to read specific portions

The tool returns the file content in an appropriate format:
- Text files: Plain text content
- Images: Base64-encoded image data
- PDFs: Extracted text content
`,
  schema: z.object({
    path: z.string().describe("Virtual path to the file to read"),
    offset: z
      .number()
      .optional()
      .describe(
        "Line number to start reading from (1-indexed, for text files)"
      ),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of lines to read (for text files)"),
  }),
  strict: true,
} satisfies ToolDefinition;

export type FileReadArgs = z.infer<typeof readTool.schema>;
