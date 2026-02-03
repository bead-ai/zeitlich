import type {
  FileSystemProvider,
  FileNode,
  GrepMatch,
} from "../../lib/filesystem/types";
import type { GrepToolSchemaType } from "./tool";

export interface GrepHandlerConfig {
  provider: FileSystemProvider;
  scopedNodes: FileNode[];
}

/**
 * Format a single grep match for display
 */
function formatMatch(match: GrepMatch, showContext: boolean): string {
  const lines: string[] = [];

  if (showContext && match.contextBefore?.length) {
    for (let i = 0; i < match.contextBefore.length; i++) {
      const lineNum = match.lineNumber - match.contextBefore.length + i;
      lines.push(`${match.path}:${lineNum}-${match.contextBefore[i]}`);
    }
  }

  lines.push(`${match.path}:${match.lineNumber}:${match.line}`);

  if (showContext && match.contextAfter?.length) {
    for (let i = 0; i < match.contextAfter.length; i++) {
      const lineNum = match.lineNumber + 1 + i;
      lines.push(`${match.path}:${lineNum}-${match.contextAfter[i]}`);
    }
  }

  return lines.join("\n");
}

/**
 * Create a grep handler that searches within the scoped file tree.
 */
export function createGrepHandler(config: GrepHandlerConfig) {
  return async (
    args: GrepToolSchemaType
  ): Promise<{ content: string; result: { matches: GrepMatch[] } }> => {
    const {
      pattern,
      ignoreCase,
      maxMatches,
      includePatterns,
      excludePatterns,
      contextLines,
    } = args;

    try {
      const matches = await config.provider.grep(pattern, {
        ignoreCase,
        maxMatches: maxMatches ?? 50,
        includePatterns,
        excludePatterns,
        contextLines,
      });

      if (matches.length === 0) {
        return {
          content: `No matches found for pattern: ${pattern}`,
          result: { matches: [] },
        };
      }

      const showContext = contextLines !== undefined && contextLines > 0;
      const formattedMatches = matches
        .map((m) => formatMatch(m, showContext))
        .join("\n");

      return {
        content: `Found ${matches.length} match(es) for "${pattern}":\n\n${formattedMatches}`,
        result: { matches },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: `Error searching file contents: ${message}`,
        result: { matches: [] },
      };
    }
  };
}
