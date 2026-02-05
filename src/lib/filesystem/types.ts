import type { ContentBlock } from "@langchain/core/messages";
import type { JsonSerializable } from "../state-manager";

/**
 * File node in the tree structure provided to the agent.
 * Represents both files and directories in a virtual file system.
 */
export interface FileNode {
  /** Virtual path (e.g., "docs/readme.md") */
  path: string;
  /** Whether this is a file or directory */
  type: "file" | "directory";
  /** Optional description shown in the prompt */
  description?: string;
  /** MIME type for multimodal content (e.g., "image/png", "application/pdf") */
  mimeType?: string;
  /** Provider-specific metadata (S3 key, database ID, etc.) */
  metadata?: JsonSerializable<Record<string, unknown>>;
  /** Child nodes for directories */
  children: FileNode[];
}

/**
 * Options for rendering the file tree in the prompt
 */
export interface FileTreeRenderOptions {
  /** Maximum depth to render (default: unlimited) */
  maxDepth?: number;
  /** Include file descriptions (default: true) */
  showDescriptions?: boolean;
  /** Show MIME types next to files (default: false) */
  showMimeTypes?: boolean;
  /** Glob patterns to exclude from display */
  excludePatterns?: string[];
  /** Custom header text (default: "Available files and directories:") */
  headerText?: string;
  /** Custom description text (default: "You have access to the following files. Use the Read, Glob, and Grep tools to explore them.") */
  descriptionText?: string;
}

/**
 * Text file content
 */
export interface TextFileContent {
  type: "text";
  content: string;
}

/**
 * Image file content (base64 encoded)
 */
export interface ImageFileContent {
  type: "image";
  mimeType: string;
  /** Base64-encoded image data */
  data: string;
}

/**
 * PDF file content (extracted text)
 */
export interface PdfFileContent {
  type: "pdf";
  /** Extracted text content */
  content: string;
}

/**
 * Union type for all file content types
 */
export type FileContent = TextFileContent | ImageFileContent | PdfFileContent;

/**
 * Options for grep operations
 */
export interface GrepOptions {
  /** Case-insensitive search */
  ignoreCase?: boolean;
  /** Maximum number of matches to return */
  maxMatches?: number;
  /** File patterns to include (glob) */
  includePatterns?: string[];
  /** File patterns to exclude (glob) */
  excludePatterns?: string[];
  /** Include N lines of context around matches */
  contextLines?: number;
}

/**
 * A single grep match result
 */
export interface GrepMatch {
  /** Path to the file containing the match */
  path: string;
  /** Line number (1-indexed) */
  lineNumber: number;
  /** The matching line content */
  line: string;
  /** Context lines before the match */
  contextBefore?: string[];
  /** Context lines after the match */
  contextAfter?: string[];
}

/**
 * Provider interface for file system operations.
 * Implement this interface to support different backends (local FS, S3, Redis, etc.)
 */
export interface FileSystemProvider {
  /**
   * Find files matching a glob pattern
   * @param pattern Glob pattern to match
   * @param root Optional root path to search from
   * @returns Array of matching file nodes
   */
  glob(pattern: string, root?: string): Promise<FileNode[]>;

  /**
   * Search file contents for a pattern
   * @param pattern Regex pattern to search for
   * @param options Search options
   * @returns Array of matches
   */
  grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]>;

  /**
   * Read file content
   * @param path Virtual path to the file
   * @returns File content in appropriate format
   */
  read(path: string): Promise<FileContent>;

  /**
   * Write content to a file
   * @param path Virtual path to the file
   * @param content Text content to write
   * @returns void
   * @optional - Providers may not support write operations
   */
  write?(path: string, content: string): Promise<void>;

  /**
   * Check if a file or directory exists
   * @param path Virtual path to check
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get the scoped nodes for the provider
   */
  getScopedNodes(): FileNode[];
}

/**
 * Configuration for creating file system tools
 */
export interface FileSystemToolsConfig {
  /** The file system provider implementation */
  provider: FileSystemProvider;
  /** The scoped file nodes the agent can access */
  scopedNodes: FileNode[];
}

/**
 * Convert FileContent to LangChain MessageContent format
 */
export function fileContentToMessageContent(
  content: FileContent
): ContentBlock[] {
  switch (content.type) {
    case "text":
      return [{ type: "text", text: content.content }];
    case "image":
      return [
        {
          type: "image_url",
          image_url: {
            url: `data:${content.mimeType};base64,${content.data}`,
          },
        },
      ];
    case "pdf":
      return [{ type: "text", text: content.content }];
  }
}
