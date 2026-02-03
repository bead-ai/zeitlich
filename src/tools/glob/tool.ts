import { z } from "zod";

export const globTool = {
  name: "Glob" as const,
  description: `Search for files matching a glob pattern within the available file system.

Usage:
- Use glob patterns like "**/*.ts" to find all TypeScript files
- Use "docs/**" to find all files in the docs directory
- Patterns are matched against virtual paths in the file system

Examples:
- "*.md" - Find all markdown files in the root
- "**/*.test.ts" - Find all test files recursively
- "src/**/*.ts" - Find all TypeScript files in src directory
`,
  schema: z.object({
    pattern: z.string().describe("Glob pattern to match files against"),
    root: z
      .string()
      .optional()
      .describe("Optional root directory to search from"),
  }),
  strict: true,
};

export type GlobToolSchemaType = z.infer<typeof globTool.schema>;
