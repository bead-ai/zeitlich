import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    workflow: "src/workflow.ts",
    "adapters/langchain/index": "src/adapters/langchain/index.ts",
    "adapters/google-genai/index": "src/adapters/google-genai/index.ts",
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
    "ioredis",
    "@mongodb-js/zstd",
    "node-liblzma",
  ],
});
