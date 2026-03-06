import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    workflow: "src/workflow.ts",
    "adapters/thread/langchain/index": "src/adapters/thread/langchain/index.ts",
    "adapters/thread/google-genai/index": "src/adapters/thread/google-genai/index.ts",
    "adapters/sandbox/inmemory/index": "src/adapters/sandbox/inmemory/index.ts",
    "adapters/sandbox/daytona/index": "src/adapters/sandbox/daytona/index.ts",
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
    /^@daytonaio\//,
    "ioredis",
    "@mongodb-js/zstd",
    "node-liblzma",
  ],
});
