import type { MessageContent, SessionExitReason } from "../types";
import type {
  ToolMap,
  ToolRouterHooks,
} from "../tool-router/types";

// ============================================================================
// Session Lifecycle Hooks
// ============================================================================

/**
 * Context for SessionStart hook - called when session begins
 */
export interface SessionStartHookContext {
  threadId: string;
  agentName: string;
  metadata: Record<string, unknown>;
}

/**
 * SessionStart hook - called when session begins
 */
export type SessionStartHook = (
  ctx: SessionStartHookContext
) => void | Promise<void>;

/**
 * Context for SessionEnd hook - called when session ends
 */
export interface SessionEndHookContext {
  threadId: string;
  agentName: string;
  exitReason: SessionExitReason;
  turns: number;
  metadata: Record<string, unknown>;
}

/**
 * SessionEnd hook - called when session ends
 */
export type SessionEndHook = (
  ctx: SessionEndHookContext
) => void | Promise<void>;

// ============================================================================
// Message Lifecycle Hooks
// ============================================================================

/**
 * Context for PreHumanMessageAppend hook - called before each human message is appended to the thread
 */
export interface PreHumanMessageAppendHookContext {
  message: MessageContent;
  threadId: string;
}

/**
 * PreHumanMessageAppend hook - called before each human message is appended to the thread
 */
export type PreHumanMessageAppendHook = (
  ctx: PreHumanMessageAppendHookContext
) => void | Promise<void>;

/**
 * Context for PostHumanMessageAppend hook - called after each human message is appended to the thread
 */
export interface PostHumanMessageAppendHookContext {
  message: MessageContent;
  threadId: string;
}

/**
 * PostHumanMessageAppend hook - called after each human message is appended to the thread
 */
export type PostHumanMessageAppendHook = (
  ctx: PostHumanMessageAppendHookContext
) => void | Promise<void>;

// ============================================================================
// Combined Hooks Interface
// ============================================================================

/**
 * Full hooks interface for a session — combines tool execution hooks
 * (consumed by the router) with session/message lifecycle hooks
 * (consumed directly by the session).
 */
export interface Hooks<T extends ToolMap, TResult = unknown>
  extends ToolRouterHooks<T, TResult> {
  /** Called before each human message is appended to the thread */
  onPreHumanMessageAppend?: PreHumanMessageAppendHook;
  /** Called after each human message is appended to the thread */
  onPostHumanMessageAppend?: PostHumanMessageAppendHook;
  /** Called when session starts */
  onSessionStart?: SessionStartHook;
  /** Called when session ends */
  onSessionEnd?: SessionEndHook;
}
