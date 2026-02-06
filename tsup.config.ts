import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    workflow: "src/workflow.ts",
    "just-bash": "src/just-bash.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  outDir: "dist",
  external: [
    /^@temporalio\//,
    /^@langchain\//,
    "ioredis",
    "@mongodb-js/zstd",
    "node-liblzma",
  ],
  noExternal: ["just-bash"],
});
