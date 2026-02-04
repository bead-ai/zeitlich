import type {
  FileSystemProvider,
  FileNode,
  GrepMatch,
} from "../../lib/filesystem/types";
import type { GrepToolSchemaType } from "./tool";

/**
 * Result of a grep operation
 */
export interface GrepResult {
  matches: GrepMatch[];
}

/**
 * Grep handler response
 */
export interface GrepHandlerResponse {
  content: string;
  result: GrepResult;
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
 * Grep handler that searches within the scoped file tree.
 *
 * @param args - Tool arguments (pattern, ignoreCase, maxMatches, etc.)
 * @param scopedNodes - The file tree defining the allowed scope
 * @param provider - FileSystemProvider for I/O operations
 */
export async function grepHandler(
  args: GrepToolSchemaType,
  scopedNodes: FileNode[],
  provider: FileSystemProvider
): Promise<GrepHandlerResponse> {
  // scopedNodes is used by the provider for scope validation
  // The provider should be instantiated with the scopedNodes
  void scopedNodes;

  const {
    pattern,
    ignoreCase,
    maxMatches,
    includePatterns,
    excludePatterns,
    contextLines,
  } = args;

  try {
    const matches = await provider.grep(pattern, {
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
}
