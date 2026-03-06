import type { SandboxCreateOptions } from "../../../lib/sandbox/types";

export interface DaytonaSandboxConfig {
  apiKey?: string;
  apiUrl?: string;
  target?: string;
}

export interface DaytonaSandboxCreateOptions extends SandboxCreateOptions {
  /** Programming language runtime. Defaults to "python". */
  language?: string;
  /** Daytona snapshot name to create the sandbox from. */
  snapshot?: string;
  /** Custom Docker image to use. */
  image?: string;
  /** Resource allocation. */
  resources?: { cpu?: number; memory?: number; disk?: number };
  /** Auto-stop interval in minutes (0 = disabled). Default 15. */
  autoStopInterval?: number;
  /** Auto-archive interval in minutes (0 = max interval). Default 7 days. */
  autoArchiveInterval?: number;
  /** Auto-delete interval in minutes (negative = disabled). */
  autoDeleteInterval?: number;
  /** Custom labels for the sandbox. */
  labels?: Record<string, string>;
  /** Timeout in seconds for sandbox creation. Default 60. */
  timeout?: number;
}
