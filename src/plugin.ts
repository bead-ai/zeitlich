import { SimplePlugin } from "@temporalio/plugin";
import { createSharedActivities } from "./activities";
import type Redis from "ioredis";

/**
 * Options for the Zeitlich plugin
 *
 * @experimental The Zeitlich plugin is an experimental feature; APIs may change without notice.
 */
export interface ZeitlichPluginOptions {
  redis: Redis;
}

/**
 * A Temporal plugin that integrates Zeitlich for use in workflows.
 * This plugin creates shared activities for thread management.
 * Workflow-specific activities (like runAgent) should be created separately.
 *
 * @experimental The Zeitlich plugin is an experimental feature; APIs may change without notice.
 */
export class ZeitlichPlugin extends SimplePlugin {
  constructor(options: ZeitlichPluginOptions) {
    super({
      name: "ZeitlichPlugin",
      activities: createSharedActivities(options.redis),
    });
  }
}
