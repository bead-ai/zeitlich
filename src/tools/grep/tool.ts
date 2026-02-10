import { z } from "zod";
import type { ToolDefinition } from "../../lib/tool-router";

export const grepTool = {
  name: "Grep" as const,
  description: `Search file contents for a pattern within the available file system.

Usage:
- Searches for a regex pattern across file contents
- Returns matching lines with file paths and line numbers
- Can filter by file patterns and limit results

Examples:
- Search for "TODO" in all files
- Search for function definitions with "function.*handleClick"
- Search case-insensitively with ignoreCase: true
`,
  schema: z.object({
    pattern: z
      .string()
      .describe("Regex pattern to search for in file contents"),
    ignoreCase: z
      .boolean()
      .optional()
      .describe("Case-insensitive search (default: false)"),
    maxMatches: z
      .number()
      .optional()
      .describe("Maximum number of matches to return (default: 50)"),
    includePatterns: z
      .array(z.string())
      .optional()
      .describe("Glob patterns to include (e.g., ['*.ts', '*.js'])"),
    excludePatterns: z
      .array(z.string())
      .optional()
      .describe("Glob patterns to exclude (e.g., ['*.test.ts'])"),
    contextLines: z
      .number()
      .optional()
      .describe("Number of context lines to show around matches"),
  }),
  strict: true,
} satisfies ToolDefinition;

export type GrepArgs = z.infer<typeof grepTool.schema>;
