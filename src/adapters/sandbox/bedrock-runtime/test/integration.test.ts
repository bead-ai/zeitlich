/**
 * Live integration test for the bedrock-runtime sandbox adapter.
 *
 * Skipped automatically unless `BEDROCK_RUNTIME_TEST_ARN` is set in the
 * environment. See `./README.md` for the one-time AWS setup that
 * produces a usable ARN.
 *
 * Required env vars:
 *   BEDROCK_RUNTIME_TEST_ARN   AgentCore Runtime ARN
 *   AWS_REGION                 (optional) defaults to "us-west-2"
 *
 * AWS credentials come from the standard SDK chain (env, profile, IMDS).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BedrockRuntimeSandboxProvider } from "../index";
import type { BedrockRuntimeSandbox } from "../types";

const arn = process.env.BEDROCK_RUNTIME_TEST_ARN;
const region = process.env.AWS_REGION ?? "us-west-2";

describe.skipIf(!arn)("bedrock-runtime integration", () => {
  let provider: BedrockRuntimeSandboxProvider;
  let sandbox: BedrockRuntimeSandbox;

  beforeAll(async () => {
    if (!arn) throw new Error("BEDROCK_RUNTIME_TEST_ARN unset");
    provider = new BedrockRuntimeSandboxProvider({
      agentRuntimeArn: arn,
      clientConfig: { region },
    });
    const { sandbox: s } = await provider.create();
    sandbox = s as BedrockRuntimeSandbox;
  }, 120_000);

  afterAll(async () => {
    if (sandbox) await sandbox.destroy();
  }, 30_000);

  // --------------------------------------------------------------------
  // exec
  // --------------------------------------------------------------------

  it("exec returns stdout, stderr, exit code", async () => {
    const r = await sandbox.exec("echo hello && echo oops 1>&2");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("hello");
    expect(r.stderr.trim()).toBe("oops");
  });

  it("exec surfaces non-zero exit codes", async () => {
    const r = await sandbox.exec("exit 7");
    expect(r.exitCode).toBe(7);
  });

  it("exec respects cwd", async () => {
    await sandbox.fs.mkdir("cwd-test", { recursive: true });
    await sandbox.fs.writeFile("cwd-test/marker.txt", "found");
    const r = await sandbox.exec("cat marker.txt", {
      cwd: `${sandbox.fs.workspaceBase}/cwd-test`,
    });
    expect(r.stdout.trim()).toBe("found");
  });

  it("exec respects env", async () => {
    const r = await sandbox.exec("printenv MYTEST", {
      env: { MYTEST: "value with spaces" },
    });
    expect(r.stdout.trim()).toBe("value with spaces");
  });

  // --------------------------------------------------------------------
  // fs round-trips
  // --------------------------------------------------------------------

  it("writeFile + readFile round-trips text", async () => {
    await sandbox.fs.writeFile("hello.txt", "hi there");
    expect(await sandbox.fs.readFile("hello.txt")).toBe("hi there");
  });

  it("writeFile + readFile preserves single quotes (escaping smoke test)", async () => {
    const tricky = `it's a "test" with $vars and \`ticks\``;
    await sandbox.fs.writeFile("tricky.txt", tricky);
    expect(await sandbox.fs.readFile("tricky.txt")).toBe(tricky);
  });

  it("writeFile + readFileBuffer round-trips binary", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 250, 100, 0, 0, 7]);
    await sandbox.fs.writeFile("blob.bin", bytes);
    const back = await sandbox.fs.readFileBuffer("blob.bin");
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("appendFile concatenates", async () => {
    await sandbox.fs.writeFile("log.txt", "first ");
    await sandbox.fs.appendFile("log.txt", "second");
    expect(await sandbox.fs.readFile("log.txt")).toBe("first second");
  });

  // --------------------------------------------------------------------
  // fs metadata
  // --------------------------------------------------------------------

  it("exists returns true for present, false for absent", async () => {
    await sandbox.fs.writeFile("present.txt", "x");
    expect(await sandbox.fs.exists("present.txt")).toBe(true);
    expect(await sandbox.fs.exists("absent.txt")).toBe(false);
  });

  it("stat reports size and file type", async () => {
    await sandbox.fs.writeFile("sized.txt", "12345");
    const s = await sandbox.fs.stat("sized.txt");
    expect(s.isFile).toBe(true);
    expect(s.isDirectory).toBe(false);
    expect(s.size).toBe(5);
  });

  it("stat reports directory", async () => {
    await sandbox.fs.mkdir("statdir", { recursive: true });
    const s = await sandbox.fs.stat("statdir");
    expect(s.isDirectory).toBe(true);
    expect(s.isFile).toBe(false);
  });

  // --------------------------------------------------------------------
  // fs directory ops
  // --------------------------------------------------------------------

  it("mkdir + readdir lists contents", async () => {
    await sandbox.fs.mkdir("listing", { recursive: true });
    await sandbox.fs.writeFile("listing/a.txt", "a");
    await sandbox.fs.writeFile("listing/b.txt", "b");
    const entries = await sandbox.fs.readdir("listing");
    expect(entries.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("readdirWithFileTypes distinguishes files and directories", async () => {
    await sandbox.fs.mkdir("typed/inner", { recursive: true });
    await sandbox.fs.writeFile("typed/file.txt", "x");
    const entries = await sandbox.fs.readdirWithFileTypes("typed");
    const file = entries.find((e) => e.name === "file.txt");
    const dir = entries.find((e) => e.name === "inner");
    expect(file?.isFile).toBe(true);
    expect(file?.isDirectory).toBe(false);
    expect(dir?.isDirectory).toBe(true);
    expect(dir?.isFile).toBe(false);
  });

  // --------------------------------------------------------------------
  // fs mutations
  // --------------------------------------------------------------------

  it("rm removes a single file", async () => {
    await sandbox.fs.writeFile("doomed.txt", "x");
    await sandbox.fs.rm("doomed.txt");
    expect(await sandbox.fs.exists("doomed.txt")).toBe(false);
  });

  it("rm with recursive removes a directory tree", async () => {
    await sandbox.fs.mkdir("treedir/inner", { recursive: true });
    await sandbox.fs.writeFile("treedir/inner/x.txt", "x");
    await sandbox.fs.rm("treedir", { recursive: true });
    expect(await sandbox.fs.exists("treedir")).toBe(false);
  });

  it("rm with force does not throw on missing paths", async () => {
    await expect(
      sandbox.fs.rm("never-existed.txt", { force: true })
    ).resolves.toBeUndefined();
  });

  it("cp copies a file", async () => {
    await sandbox.fs.writeFile("src.txt", "copied");
    await sandbox.fs.cp("src.txt", "dst.txt");
    expect(await sandbox.fs.readFile("dst.txt")).toBe("copied");
  });

  it("mv moves a file", async () => {
    await sandbox.fs.writeFile("from.txt", "moved");
    await sandbox.fs.mv("from.txt", "to.txt");
    expect(await sandbox.fs.exists("from.txt")).toBe(false);
    expect(await sandbox.fs.readFile("to.txt")).toBe("moved");
  });
});
