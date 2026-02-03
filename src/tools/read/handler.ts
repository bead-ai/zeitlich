import type { ContentBlock } from "@langchain/core/messages";
import type {
  FileSystemProvider,
  FileNode,
  FileContent,
} from "../../lib/filesystem/types";
import { fileContentToMessageContent } from "../../lib/filesystem/types";
import { isPathInScope } from "../../lib/filesystem/tree-builder";
import type { ReadToolSchemaType } from "./tool";

export interface ReadHandlerConfig {
  provider: FileSystemProvider;
  scopedNodes: FileNode[];
}

/**
 * Apply offset and limit to text content
 */
function applyTextRange(
  content: string,
  offset?: number,
  limit?: number
): string {
  if (offset === undefined && limit === undefined) {
    return content;
  }

  const lines = content.split("\n");
  const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
  const endLine = limit !== undefined ? startLine + limit : lines.length;

  const selectedLines = lines.slice(startLine, endLine);

  // Format with line numbers
  return selectedLines
    .map((line, i) => {
      const lineNum = (startLine + i + 1).toString().padStart(6, " ");
      return `${lineNum}|${line}`;
    })
    .join("\n");
}

/**
 * Create a read handler that reads files within the scoped file tree.
 */
export function createReadHandler(config: ReadHandlerConfig) {
  return async (
    args: ReadToolSchemaType
  ): Promise<{
    content: ContentBlock[];
    result: { path: string; content: FileContent };
  }> => {
    const { path, offset, limit } = args;

    // Validate path is in scope
    if (!isPathInScope(path, config.scopedNodes)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Path "${path}" is not within the available file system scope.`,
          },
        ],
        result: {
          path,
          content: {
            type: "text",
            content:
              "Error: Path is not within the available file system scope.",
          },
        },
      };
    }

    try {
      // Check if file exists
      const exists = await config.provider.exists(path);
      if (!exists) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File "${path}" does not exist.`,
            },
          ],
          result: {
            path,
            content: { type: "text", content: "Error: File does not exist." },
          },
        };
      }

      const fileContent: FileContent = await config.provider.read(path);

      // Handle text content with offset/limit
      if (fileContent.type === "text") {
        const processedContent = applyTextRange(
          fileContent.content,
          offset,
          limit
        );

        let header = `File: ${path}`;
        if (offset !== undefined || limit !== undefined) {
          const startLine = offset ?? 1;
          const endInfo = limit ? `, showing ${limit} lines` : "";
          header += ` (from line ${startLine}${endInfo})`;
        }

        return {
          content: [
            {
              type: "text",
              text: `${header}\n\n${processedContent}`,
            },
          ],
          result: {
            path,
            content: {
              type: "text",
              content: `${header}\n\n${processedContent}`,
            },
          },
        };
      }

      // For non-text content, return as multimodal
      const messageContent = fileContentToMessageContent(fileContent);

      return {
        content: [
          {
            type: "text",
            text: `File: ${path} (${fileContent.type})`,
          },
          ...messageContent,
        ],
        result: { path, content: fileContent },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `Error reading file "${path}": ${message}`,
          },
        ],
        result: {
          path,
          content: {
            type: "text",
            content: `Error reading file "${path}": ${message}`,
          },
        },
      };
    }
  };
}
