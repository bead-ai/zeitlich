import { SimplePlugin } from "@temporalio/plugin";
import type { ZeitlichSharedActivities } from "./activities";

/**
 * Options for the Zeitlich plugin
 *
 * @experimental The Zeitlich plugin is an experimental feature; APIs may change without notice.
 */
export interface ZeitlichPluginOptions {
  /** Shared activities instance (e.g. from `createLangChainSharedActivities(redis)`) */
  activities: ZeitlichSharedActivities;
}

/**
 * A Temporal worker plugin that registers shared Zeitlich activities for
 * thread management (initialize, append messages, etc.).
 * Workflow-specific activities (like `runAgent`) should be created separately
 * and passed to the worker's `activities` option.
 *
 * @experimental The Zeitlich plugin is an experimental feature; APIs may change without notice.
 *
 * @example
 * ```typescript
 * import { Worker, NativeConnection } from '@temporalio/worker';
 * import { ZeitlichPlugin } from 'zeitlich';
 * import { createLangChainSharedActivities } from 'zeitlich/adapters/langchain';
 * import Redis from 'ioredis';
 *
 * const redis = new Redis();
 * const worker = await Worker.create({
 *   plugins: [new ZeitlichPlugin({ activities: createLangChainSharedActivities(redis) })],
 *   connection,
 *   taskQueue: "my-agent",
 *   workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
 *   activities: createActivities({ redis, client: client.workflow }),
 * });
 * ```
 */
export class ZeitlichPlugin extends SimplePlugin {
  constructor(options: ZeitlichPluginOptions) {
    super({
      name: "ZeitlichPlugin",
      activities: options.activities,
    });
  }
}
