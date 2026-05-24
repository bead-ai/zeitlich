/**
 * Shared proxy helper for thread operations.
 *
 * Each adapter re-exports a thin wrapper that supplies its prefix and
 * casts the return type to carry the adapter's native content type.
 */
import {
  proxyActivities,
  workflowInfo,
  type ActivityInterfaceFor,
  type ActivityOptions,
} from "@temporalio/workflow";
import type { ThreadOps } from "../session/types";

type OpName = keyof ThreadOps;

/** Tight `startToCloseTimeout` so a sick Redis surfaces quickly via retry. */
const DEFAULT_OPTIONS: ActivityOptions = {
  startToCloseTimeout: "10s",
  retry: {
    maximumAttempts: 6,
    initialInterval: "5s",
    maximumInterval: "15m",
    backoffCoefficient: 4,
  },
};

/**
 * `heartbeatTimeout` assumes the built-in S3 cold store's progress
 * events (multipart `Upload` + chunked stream read). Stalls trip via
 * heartbeat rather than `startToCloseTimeout`. Custom backends without
 * progress events should override via `perOp`. Harmless on Redis-only
 * deployments — the activities no-op.
 */
const BUILTIN_PER_OP: Partial<Record<OpName, ActivityOptions>> = {
  hydrateThread: { startToCloseTimeout: "60s", heartbeatTimeout: "15s" },
  flushThread: { startToCloseTimeout: "60s", heartbeatTimeout: "15s" },
};

/**
 * `perOp[op]` layers shallow-rightmost over `defaults` and the
 * built-in cold-tier overlay (`hydrateThread` / `flushThread`).
 * A bare {@link ActivityOptions} is also accepted (treated as `{ defaults }`).
 *
 * @example
 * ```typescript
 * proxyAnthropicThreadOps(undefined, {
 *   defaults: { startToCloseTimeout: "5s" },
 *   perOp: {
 *     flushThread: { startToCloseTimeout: "180s" }, // heartbeatTimeout still inherited
 *   },
 * });
 * ```
 */
export interface ThreadOpsProxyOptions {
  defaults?: ActivityOptions;
  perOp?: Partial<Record<OpName, ActivityOptions>>;
}

function isProxyOptionsShape(o: object): o is ThreadOpsProxyOptions {
  return "defaults" in o || "perOp" in o;
}

/**
 * Creates a workflow-safe Temporal activity proxy for {@link ThreadOps}.
 *
 * @param adapterPrefix - Adapter identifier (e.g. "anthropic", "googleGenAI", "langChain")
 * @param scope - Workflow scope. Defaults to `workflowInfo().workflowType`.
 * @param options - {@link ThreadOpsProxyOptions} or a bare {@link ActivityOptions}.
 */
export function createThreadOpsProxy(
  adapterPrefix: string,
  scope?: string,
  options?: ActivityOptions | ThreadOpsProxyOptions
): ActivityInterfaceFor<ThreadOps> {
  const resolvedScope = scope ?? workflowInfo().workflowType;

  const opts: ThreadOpsProxyOptions =
    options && isProxyOptionsShape(options) ? options : { defaults: options };

  const base = opts.defaults ?? DEFAULT_OPTIONS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseActs = proxyActivities<Record<string, (...args: any[]) => any>>(base);

  const prefix = `${adapterPrefix}${resolvedScope.charAt(0).toUpperCase()}${resolvedScope.slice(1)}`;
  const p = (key: string): string =>
    `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;

  const pick = (op: OpName): unknown => {
    const overlay = { ...BUILTIN_PER_OP[op], ...opts.perOp?.[op] };
    if (Object.keys(overlay).length === 0) return baseActs[p(op)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return proxyActivities<Record<string, (...args: any[]) => any>>({
      ...base,
      ...overlay,
    })[p(op)];
  };

  return {
    initializeThread: pick("initializeThread"),
    appendHumanMessage: pick("appendHumanMessage"),
    appendToolResult: pick("appendToolResult"),
    appendAgentMessage: pick("appendAgentMessage"),
    appendSystemMessage: pick("appendSystemMessage"),
    forkThread: pick("forkThread"),
    truncateThread: pick("truncateThread"),
    loadThreadState: pick("loadThreadState"),
    saveThreadState: pick("saveThreadState"),
    hydrateThread: pick("hydrateThread"),
    flushThread: pick("flushThread"),
  } as ActivityInterfaceFor<ThreadOps>;
}
