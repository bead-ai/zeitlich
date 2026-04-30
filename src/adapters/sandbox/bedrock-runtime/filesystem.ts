import type { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { InvokeAgentRuntimeCommandCommand } from "@aws-sdk/client-bedrock-agentcore";
import type {
  SandboxFileSystem,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import {
  q,
  ok,
  sh,
  parseStat,
  parseFindEntries,
  parseLsLines,
  type ShellCommand,
  type ShellResult,
} from "../../../lib/sandbox/shell";
import { consumeCommandStream } from "./stream";
import { posix } from "node:path";

/**
 * {@link SandboxFileSystem} backed by AWS Bedrock AgentCore Runtime sessions.
 *
 * Unlike the AgentCore Code Interpreter adapter (which has native
 * `readFiles` / `writeFiles` tools), Runtime exposes only a shell command
 * primitive (`InvokeAgentRuntimeCommand`). Every filesystem operation is
 * therefore a shell-out — `cat`, `base64`, `stat`, `mkdir`, `rm`, etc.
 *
 * Binary-safe reads and writes go through `base64` to avoid quoting issues
 * and binary corruption over the JSON-shaped command body. The container
 * image must therefore include `coreutils` (it does on every common base
 * image, including the AgentCore Python and Node defaults).
 */
export class BedrockRuntimeSandboxFileSystem implements SandboxFileSystem {
  readonly workspaceBase: string;

  constructor(
    private client: BedrockAgentCoreClient,
    private agentRuntimeArn: string,
    private qualifier: string | undefined,
    private runtimeSessionId: string,
    private commandTimeoutSeconds: number | undefined,
    workspaceBase = "/mnt/workspace"
  ) {
    this.workspaceBase = posix.resolve("/", workspaceBase);
  }

  private normalisePath(path: string): string {
    return posix.resolve(this.workspaceBase, path);
  }

  private async execShell(c: ShellCommand): Promise<ShellResult> {
    const resp = await this.client.send(
      new InvokeAgentRuntimeCommandCommand({
        agentRuntimeArn: this.agentRuntimeArn,
        runtimeSessionId: this.runtimeSessionId,
        qualifier: this.qualifier,
        contentType: "application/json",
        accept: "application/vnd.amazon.eventstream",
        body: {
          command: `/bin/bash -c ${q(c.command)}`,
          timeout: this.commandTimeoutSeconds,
        },
      })
    );

    if (!resp.stream)
      throw new Error("No stream in InvokeAgentRuntimeCommand response");
    const r = await consumeCommandStream(resp.stream);
    return { ...r, op: c.op };
  }

  async readFile(path: string): Promise<string> {
    return ok(await this.execShell(sh.readText(this.normalisePath(path))));
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const out = ok(
      await this.execShell(sh.readBase64(this.normalisePath(path)))
    );
    return new Uint8Array(Buffer.from(out.replace(/\s/g, ""), "base64"));
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const buf =
      typeof content === "string"
        ? Buffer.from(content, "utf-8")
        : Buffer.from(content);
    ok(
      await this.execShell(
        sh.writeFromBase64(this.normalisePath(path), buf.toString("base64"))
      )
    );
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const buf =
      typeof content === "string"
        ? Buffer.from(content, "utf-8")
        : Buffer.from(content);
    ok(
      await this.execShell(
        sh.appendFromBase64(this.normalisePath(path), buf.toString("base64"))
      )
    );
  }

  async exists(path: string): Promise<boolean> {
    const r = await this.execShell(sh.exists(this.normalisePath(path)));
    return r.exitCode === 0;
  }

  async stat(path: string): Promise<FileStat> {
    const out = ok(await this.execShell(sh.stat(this.normalisePath(path))));
    const { fileType, size, mtime } = parseStat(out);
    return {
      isFile: fileType === "regular file" || fileType === "regular empty file",
      isDirectory: fileType === "directory",
      isSymbolicLink: fileType === "symbolic link",
      size,
      mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    ok(
      await this.execShell(
        sh.mkdir(this.normalisePath(path), options?.recursive)
      )
    );
  }

  async readdir(path: string): Promise<string[]> {
    return parseLsLines(
      ok(await this.execShell(sh.readdir(this.normalisePath(path))))
    );
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const out = ok(
      await this.execShell(sh.findEntries(this.normalisePath(path)))
    );
    return parseFindEntries(out).map((e) => ({
      name: e.name,
      isFile: e.type === "f",
      isDirectory: e.type === "d",
      isSymbolicLink: e.type === "l",
    }));
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    const r = await this.execShell(sh.rm(this.normalisePath(path), options));
    if (r.exitCode !== 0 && !options?.force) {
      throw new Error(`rm failed: ${r.stderr}`);
    }
  }

  async cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    ok(
      await this.execShell(
        sh.cp(
          this.normalisePath(src),
          this.normalisePath(dest),
          options?.recursive
        )
      )
    );
  }

  async mv(src: string, dest: string): Promise<void> {
    ok(
      await this.execShell(
        sh.mv(this.normalisePath(src), this.normalisePath(dest))
      )
    );
  }

  async readlink(path: string): Promise<string> {
    return ok(
      await this.execShell(sh.readlink(this.normalisePath(path)))
    ).trim();
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(this.normalisePath(base), path);
  }
}
