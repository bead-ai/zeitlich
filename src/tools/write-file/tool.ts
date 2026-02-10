import { z } from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

export const writeTool = {
  name: "FileWrite" as const,
  description: `Create or overwrite a file with new content.

Usage:
- Provide the absolute path to the file
- The file will be created if it doesn't exist
- If the file exists, it will be completely overwritten

IMPORTANT:
- You must read the file first (in this session) before writing to it
- This is an atomic write operation - the entire file is replaced
- Path must be absolute (e.g., "/docs/readme.md", not "docs/readme.md")
`,
  schema: z.object({
    file_path: z.string().describe("The absolute path to the file to write"),
    content: z.string().describe("The content to write to the file"),
  }),
  strict: true,
} satisfies ToolDefinition;

export type FileWriteArgs = z.infer<typeof writeTool.schema>;
