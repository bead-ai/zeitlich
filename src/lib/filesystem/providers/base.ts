import { minimatch } from "minimatch";
import type {
  FileSystemProvider,
  FileNode,
  FileContent,
  GrepOptions,
  GrepMatch,
} from "../types";
import { flattenFileTree } from "../tree-builder";

/**
 * Abstract base class for filesystem providers.
 * Implements scope validation and common utilities.
 * Subclasses only need to implement the actual I/O operations.
 */
export abstract class BaseFileSystemProvider implements FileSystemProvider {
  protected scopedNodes: FileNode[];
  protected allowedPaths: Set<string>;

  constructor(scopedNodes: FileNode[]) {
    this.scopedNodes = scopedNodes;
    this.allowedPaths = new Set(flattenFileTree(scopedNodes));
  }

  /**
   * Validate that a path is within the allowed scope.
   * Throws an error if the path is not allowed.
   */
  protected validatePath(path: string): void {
    if (!this.allowedPaths.has(path)) {
      throw new Error(`Path "${path}" is not within the allowed scope`);
    }
  }

  /**
   * Filter paths by glob pattern.
   */
  protected filterByPattern(
    paths: string[],
    pattern: string,
    root?: string
  ): string[] {
    // Prepend root if provided
    const effectivePattern = root ? `${root}/${pattern}` : pattern;

    return paths.filter((path) => {
      // Also match if root is provided and path starts with root
      if (root && !path.startsWith(root)) {
        return false;
      }
      return minimatch(path, effectivePattern, { matchBase: true });
    });
  }

  /**
   * Get all file paths in scope
   */
  protected getAllPaths(): string[] {
    return Array.from(this.allowedPaths);
  }

  /**
   * Find FileNode by path
   */
  protected findNode(path: string): FileNode | undefined {
    const findInNodes = (nodes: FileNode[]): FileNode | undefined => {
      for (const node of nodes) {
        if (node.path === path) {
          return node;
        }
        if (node.children) {
          const found = findInNodes(node.children);
          if (found) return found;
        }
      }
      return undefined;
    };
    return findInNodes(this.scopedNodes);
  }

  // ============================================================================
  // Abstract methods - must be implemented by subclasses
  // ============================================================================

  /**
   * Read raw file content from the backend.
   * This is called after scope validation.
   */
  protected abstract readFile(node: FileNode): Promise<FileContent>;

  /**
   * Read file as text for grep operations.
   * Default implementation uses readFile, but can be overridden for efficiency.
   */
  protected async readFileAsText(node: FileNode): Promise<string | null> {
    try {
      const content = await this.readFile(node);
      if (content.type === "text") {
        return content.content;
      }
      if (content.type === "pdf") {
        return content.content;
      }
      // Binary files can't be grepped
      return null;
    } catch {
      return null;
    }
  }

  // ============================================================================
  // FileSystemProvider implementation
  // ============================================================================

  async glob(pattern: string, root?: string): Promise<FileNode[]> {
    const allPaths = this.getAllPaths();
    const matchingPaths = this.filterByPattern(allPaths, pattern, root);

    return matchingPaths
      .map((path) => this.findNode(path))
      .filter((node): node is FileNode => node !== undefined);
  }

  async grep(pattern: string, options?: GrepOptions): Promise<GrepMatch[]> {
    const matches: GrepMatch[] = [];
    const maxMatches = options?.maxMatches ?? 50;

    // Build regex
    const flags = options?.ignoreCase ? "gi" : "g";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }

    // Get files to search
    let paths = this.getAllPaths();

    // Apply include patterns
    if (options?.includePatterns?.length) {
      const includePatterns = options.includePatterns;
      paths = paths.filter((path) =>
        includePatterns.some((p) => minimatch(path, p, { matchBase: true }))
      );
    }

    // Apply exclude patterns
    if (options?.excludePatterns?.length) {
      const excludePatterns = options.excludePatterns;
      paths = paths.filter(
        (path) =>
          !excludePatterns.some((p) => minimatch(path, p, { matchBase: true }))
      );
    }

    // Search each file
    for (const path of paths) {
      if (matches.length >= maxMatches) break;

      const node = this.findNode(path);
      if (!node || node.type !== "file") continue;

      const text = await this.readFileAsText(node);
      if (!text) continue;

      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxMatches) break;

        const line = lines[i];
        if (line === undefined) continue;

        if (regex.test(line)) {
          // Reset regex lastIndex for global flag
          regex.lastIndex = 0;

          const match: GrepMatch = {
            path,
            lineNumber: i + 1,
            line: line.trim(),
          };

          // Add context lines if requested
          if (options?.contextLines && options.contextLines > 0) {
            const contextBefore: string[] = [];
            const contextAfter: string[] = [];

            for (let j = Math.max(0, i - options.contextLines); j < i; j++) {
              const contextLine = lines[j];
              if (contextLine !== undefined) {
                contextBefore.push(contextLine.trim());
              }
            }

            for (
              let j = i + 1;
              j <= Math.min(lines.length - 1, i + options.contextLines);
              j++
            ) {
              const contextLine = lines[j];
              if (contextLine !== undefined) {
                contextAfter.push(contextLine.trim());
              }
            }

            match.contextBefore = contextBefore;
            match.contextAfter = contextAfter;
          }

          matches.push(match);
        }
      }
    }

    return matches;
  }

  async read(path: string): Promise<FileContent> {
    this.validatePath(path);

    const node = this.findNode(path);
    if (!node) {
      throw new Error(`File not found: ${path}`);
    }

    if (node.type !== "file") {
      throw new Error(`Path is a directory, not a file: ${path}`);
    }

    return this.readFile(node);
  }

  async exists(path: string): Promise<boolean> {
    return this.allowedPaths.has(path);
  }
  /**
   * Get the scoped nodes for the provider
   */
  getScopedNodes(): FileNode[] {
    return this.scopedNodes;
  }
}

/**
 * A simple in-memory filesystem provider for testing.
 * Files are stored as a map of path -> content.
 */
export class InMemoryFileSystemProvider extends BaseFileSystemProvider {
  private files: Map<string, FileContent>;

  constructor(scopedNodes: FileNode[], files: Map<string, FileContent>) {
    super(scopedNodes);
    this.files = files;
  }

  protected async readFile(node: FileNode): Promise<FileContent> {
    const content = this.files.get(node.path);
    if (!content) {
      throw new Error(`File not found in storage: ${node.path}`);
    }
    return content;
  }

  /**
   * Add or update a file in the in-memory storage
   */
  setFile(path: string, content: FileContent): void {
    this.files.set(path, content);
  }

  /**
   * Write text content to a file
   */
  async write(path: string, content: string): Promise<void> {
    this.validatePath(path);
    this.files.set(path, { type: "text", content });
  }

  /**
   * Create an InMemoryFileSystemProvider from a simple object map
   */
  static fromTextFiles(
    scopedNodes: FileNode[],
    files: Record<string, string>
  ): InMemoryFileSystemProvider {
    const fileMap = new Map<string, FileContent>();
    for (const [path, content] of Object.entries(files)) {
      fileMap.set(path, { type: "text", content });
    }
    return new InMemoryFileSystemProvider(scopedNodes, fileMap);
  }

  /**
   * Create an InMemoryFileSystemProvider with a specific scope.
   * Use this factory when instantiating providers per-call with dynamic file trees.
   *
   * @param scopedNodes - The file tree defining the allowed scope
   * @param files - Map of file paths to content
   */
  static withScope(
    scopedNodes: FileNode[],
    files: Map<string, FileContent>
  ): InMemoryFileSystemProvider {
    return new InMemoryFileSystemProvider(scopedNodes, files);
  }

  /**
   * Create an InMemoryFileSystemProvider with a specific scope from text files.
   * Convenience factory combining withScope and fromTextFiles.
   *
   * @param scopedNodes - The file tree defining the allowed scope
   * @param files - Object map of file paths to text content
   */
  static withScopeFromTextFiles(
    scopedNodes: FileNode[],
    files: Record<string, string>
  ): InMemoryFileSystemProvider {
    return InMemoryFileSystemProvider.fromTextFiles(scopedNodes, files);
  }
}

/**
 * A resolver function that reads file content given a FileNode.
 * Use this for simple cases where you just need to provide a read function.
 */
export type FileResolver = (node: FileNode) => Promise<FileContent>;

/**
 * Configuration for a backend in the CompositeFileSystemProvider
 */
export interface BackendConfig {
  /** The resolver function or provider for this backend */
  resolver: FileResolver | FileSystemProvider;
}

/**
 * A composite filesystem provider that routes to different backends based on file metadata.
 *
 * Files are routed based on `node.metadata.backend` field. If no backend is specified,
 * the default backend is used.
 *
 * @example
 * ```typescript
 * const files: FileNode[] = [
 *   { path: "invoices/2024.pdf", type: "file", metadata: { backend: "s3", s3Key: "..." } },
 *   { path: "cache/summary.txt", type: "file", metadata: { backend: "redis" } },
 *   { path: "local/config.json", type: "file" }, // uses default backend
 * ];
 *
 * const provider = new CompositeFileSystemProvider(files, {
 *   backends: {
 *     s3: { resolver: async (node) => s3Client.getObject(node.metadata.s3Key) },
 *     redis: { resolver: async (node) => redis.get(node.path) },
 *   },
 *   defaultBackend: "local",
 *   defaultResolver: async (node) => fs.readFile(node.path),
 * });
 * ```
 */
export class CompositeFileSystemProvider extends BaseFileSystemProvider {
  private backends: Map<string, BackendConfig>;
  private defaultBackend?: string;
  private defaultResolver?: FileResolver;

  constructor(
    scopedNodes: FileNode[],
    config: {
      /** Map of backend name to configuration */
      backends: Record<string, BackendConfig>;
      /** Default backend name for files without metadata.backend */
      defaultBackend?: string;
      /** Fallback resolver if no backend matches (alternative to defaultBackend) */
      defaultResolver?: FileResolver;
    }
  ) {
    super(scopedNodes);
    this.backends = new Map(Object.entries(config.backends));
    this.defaultBackend = config.defaultBackend;
    this.defaultResolver = config.defaultResolver;
  }

  /**
   * Get the backend name for a file node
   */
  private getBackendName(node: FileNode): string | undefined {
    const backend = node.metadata?.backend;
    if (typeof backend === "string") {
      return backend;
    }
    return this.defaultBackend;
  }

  /**
   * Resolve content using a resolver (function or provider)
   */
  private async resolveContent(
    resolver: FileResolver | FileSystemProvider,
    node: FileNode
  ): Promise<FileContent> {
    if (typeof resolver === "function") {
      return resolver(node);
    }
    // It's a FileSystemProvider
    return resolver.read(node.path);
  }

  protected async readFile(node: FileNode): Promise<FileContent> {
    const backendName = this.getBackendName(node);

    // Try named backend
    if (backendName) {
      const config = this.backends.get(backendName);
      if (config) {
        return this.resolveContent(config.resolver, node);
      }
    }

    // Try default resolver
    if (this.defaultResolver) {
      return this.defaultResolver(node);
    }

    // No resolver found
    const availableBackends = Array.from(this.backends.keys()).join(", ");
    throw new Error(
      `No resolver for file "${node.path}". ` +
        `Backend: ${backendName ?? "(none)"}. ` +
        `Available backends: ${availableBackends || "(none)"}`
    );
  }

  /**
   * Add or update a backend configuration
   */
  setBackend(name: string, config: BackendConfig): void {
    this.backends.set(name, config);
  }

  /**
   * Remove a backend
   */
  removeBackend(name: string): boolean {
    return this.backends.delete(name);
  }

  /**
   * Check if a backend exists
   */
  hasBackend(name: string): boolean {
    return this.backends.has(name);
  }

  /**
   * Create a CompositeFileSystemProvider with a specific scope.
   * Use this factory when instantiating providers per-call with dynamic file trees.
   *
   * @param scopedNodes - The file tree defining the allowed scope
   * @param config - Backend configuration including resolvers
   */
  static withScope(
    scopedNodes: FileNode[],
    config: {
      backends: Record<string, BackendConfig>;
      defaultBackend?: string;
      defaultResolver?: FileResolver;
    }
  ): CompositeFileSystemProvider {
    return new CompositeFileSystemProvider(scopedNodes, config);
  }
}
