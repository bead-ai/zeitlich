import type {
  MessageStructure,
  MessageToolDefinition,
} from "@langchain/core/messages";
import type { z } from "zod";

/**
 * A tool definition with a name, description, and Zod schema for arguments.
 */
export interface ToolDefinition<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
> {
  name: TName;
  description: string;
  schema: TSchema;
  strict?: boolean;
  max_uses?: number;
}

/**
 * A map of tool keys to tool definitions.
 */
export type ToolMap = Record<string, ToolDefinition>;

/**
 * Converts a ToolMap to MessageStructure-compatible tools type.
 * Maps each tool's name to a MessageToolDefinition with inferred input type from the schema.
 */
export type ToolMapToMessageTools<T extends ToolMap> = {
  [K in keyof T as T[K]["name"]]: MessageToolDefinition<
    z.infer<T[K]["schema"]>
  >;
};

/**
 * Creates a MessageStructure type from a ToolMap.
 * This allows typed tool_calls on AIMessage when using parseToolCalls.
 */
export type ToolMapToMessageStructure<T extends ToolMap> = MessageStructure<
  ToolMapToMessageTools<T>
>;

/**
 * Extract the tool names from a tool map (uses the tool's name property, not the key).
 */
export type ToolNames<T extends ToolMap> = T[keyof T]["name"];

/**
 * A raw tool call as received from the LLM before parsing.
 */
export interface RawToolCall {
  id?: string;
  name: string;
  args: unknown;
}

/**
 * A parsed tool call with validated arguments for a specific tool.
 */
export interface ParsedToolCall<
  TName extends string = string,
  TArgs = unknown,
> {
  id: string;
  name: TName;
  args: TArgs;
}

/**
 * Union type of all possible parsed tool calls from a tool map.
 */
export type ParsedToolCallUnion<T extends ToolMap> = {
  [K in keyof T]: ParsedToolCall<T[K]["name"], z.infer<T[K]["schema"]>>;
}[keyof T];

/**
 * The tool registry interface with full type inference.
 */
export interface ToolRegistry<T extends ToolMap> {
  /**
   * Parse and validate a raw tool call against the registry.
   * Returns a typed tool call with validated arguments.
   */
  parseToolCall(toolCall: RawToolCall): ParsedToolCallUnion<T>;

  /**
   * Get a specific tool by its key in the registry.
   */
  getTool<K extends keyof T>(name: K): T[K];

  /**
   * Check if a tool with the given name exists in the registry.
   */
  hasTool(name: string): boolean;

  /**
   * Get all tool names in the registry.
   */
  getToolNames(): ToolNames<T>[];

  /**
   * Get all tools in the registry.
   */
  getToolList(): T[keyof T][];
}

/**
 * Creates a type-safe tool registry for parsing and managing tool definitions.
 *
 * @example
 * const registry = createToolRegistry({
 *   AskUserQuestion: askUserQuestionTool,
 * });
 *
 */
export function createToolRegistry<T extends ToolMap>(
  tools: T
): ToolRegistry<T> {
  const toolMap = new Map<string, T[keyof T]>();

  for (const [_key, tool] of Object.entries(tools)) {
    toolMap.set(tool.name, tool as T[keyof T]);
  }

  return {
    parseToolCall(toolCall: RawToolCall): ParsedToolCallUnion<T> {
      const tool = toolMap.get(toolCall.name);

      if (!tool) {
        throw new Error(`Tool ${toolCall.name} not found`);
      }

      // Parse and validate args using the tool's schema
      const parsedArgs = tool.schema.parse(toolCall.args);

      return {
        id: toolCall.id ?? "",
        name: toolCall.name,
        args: parsedArgs,
      } as ParsedToolCallUnion<T>;
    },

    getTool<K extends keyof T>(name: K): T[K] {
      return tools[name];
    },

    hasTool(name: string): boolean {
      return toolMap.has(name);
    },

    getToolNames(): ToolNames<T>[] {
      return Array.from(toolMap.keys()) as ToolNames<T>[];
    },

    getToolList(): T[keyof T][] {
      return Object.values(tools) as T[keyof T][];
    },
  };
}
