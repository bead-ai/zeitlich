import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    workflow: "src/workflow.ts",
    "adapters/thread/index": "src/adapters/thread/index.ts",
    "adapters/thread/langchain/index": "src/adapters/thread/langchain/index.ts",
    "adapters/thread/langchain/workflow":
      "src/adapters/thread/langchain/proxy.ts",
    "adapters/thread/google-genai/index":
      "src/adapters/thread/google-genai/index.ts",
    "adapters/thread/google-genai/workflow":
      "src/adapters/thread/google-genai/proxy.ts",
    "adapters/thread/anthropic/index": "src/adapters/thread/anthropic/index.ts",
    "adapters/thread/anthropic/workflow":
      "src/adapters/thread/anthropic/proxy.ts",
    "adapters/sandbox/daytona/index": "src/adapters/sandbox/daytona/index.ts",
    "adapters/sandbox/daytona/workflow":
      "src/adapters/sandbox/daytona/proxy.ts",
    "adapters/sandbox/e2b/index": "src/adapters/sandbox/e2b/index.ts",
    "adapters/sandbox/e2b/workflow": "src/adapters/sandbox/e2b/proxy.ts",
    "adapters/browser/agentcore/index":
      "src/adapters/browser/agentcore/index.ts",
    "adapters/browser/agentcore/workflow":
      "src/adapters/browser/agentcore/proxy.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  outDir: "dist",
  external: [
    /^@temporalio\//,
    /^@langchain\//,
    /^@google\//,
    /^@anthropic-ai\//,
    /^@daytonaio\//,
    /^@e2b\//,
    /^@aws-sdk\//,
    /^@aws-crypto\//,
    /^@smithy\//,
    "redis",
    /^@redis\//,
    "@mongodb-js/zstd",
    "node-liblzma",
  ],
});
