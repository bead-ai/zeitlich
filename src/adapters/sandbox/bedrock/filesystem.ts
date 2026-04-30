import type {
  BedrockAgentCoreClient,
  CodeInterpreterStreamOutput,
  CodeInterpreterResult,
  ToolName as ToolNameType,
  ToolArguments,
} from "@aws-sdk/client-bedrock-agentcore";
import { InvokeCodeInterpreterCommand } from "@aws-sdk/client-bedrock-agentcore";
import type {
  SandboxFileSystem,
  DirentEntry,
  FileStat,
} from "../../../lib/sandbox/types";
import { SandboxNotSupportedError } from "../../../lib/sandbox/types";
import {
  ok,
  sh,
  parseStat,
  parseFindEntries,
  parseLsLines,
  type ShellCommand,
  type ShellResult,
} from "../../../lib/sandbox/shell";
import { posix } from "node:path";

async function consumeStream(
  stream: AsyncIterable<CodeInterpreterStreamOutput>
): Promise<CodeInterpreterResult> {
  for await (const event of stream) {
    if ("result" in event && event.result) return event.result;
    if ("accessDeniedException" in event && event.accessDeniedException)
      throw new Error(event.accessDeniedException.message ?? "Access denied");
    if ("resourceNotFoundException" in event && event.resourceNotFoundException)
      throw new Error(
        event.resourceNotFoundException.message ?? "Resource not found"
      );
    if ("validationException" in event && event.validationException)
      throw new Error(event.validationException.message ?? "Validation error");
    if ("internalServerException" in event && event.internalServerException)
      throw new Error(
        event.internalServerException.message ?? "Internal server error"
      );
    if ("throttlingException" in event && event.throttlingException)
      throw new Error(event.throttlingException.message ?? "Throttled");
    if (
      "serviceQuotaExceededException" in event &&
      event.serviceQuotaExceededException
    )
      throw new Error(
        event.serviceQuotaExceededException.message ?? "Quota exceeded"
      );
    if ("conflictException" in event && event.conflictException)
      throw new Error(event.conflictException.message ?? "Conflict");
  }
  throw new Error("No result received from code interpreter stream");
}

/**
 * {@link SandboxFileSystem} backed by AWS Bedrock AgentCore Code Interpreter.
 *
 * Maps zeitlich's filesystem interface to Code Interpreter's
 * `readFiles` / `writeFiles` / `listFiles` / `removeFiles` / `executeCommand`
 * tool invocations.
 */
export class BedrockSandboxFileSystem implements SandboxFileSystem {
  readonly workspaceBase: string;

  constructor(
    private client: BedrockAgentCoreClient,
    private codeInterpreterIdentifier: string,
    private sessionId: string,
    workspaceBase = "/home/user"
  ) {
    this.workspaceBase = posix.resolve("/", workspaceBase);
  }

  /**
   * Resolve a caller-supplied path to an absolute path within the workspace.
   * Used for shell commands that need full paths.
   */
  private normalisePath(path: string): string {
    if (
      posix.isAbsolute(path) &&
      !path.startsWith(this.workspaceBase + "/") &&
      path !== this.workspaceBase
    ) {
      path = path.replace(/^\/+/, "");
    }
    const resolved = posix.resolve(this.workspaceBase, path);
    if (
      !resolved.startsWith(this.workspaceBase + "/") &&
      resolved !== this.workspaceBase
    ) {
      throw new Error(
        `Invalid file path: "${resolved}" escapes workspace "${this.workspaceBase}"`
      );
    }
    return resolved;
  }

  /**
   * Return a workspace-relative path for Bedrock tool invocations
   * (`writeFiles`, `readFiles`, `listFiles`, `removeFiles`), which
   * reject absolute paths as "path traversal".
   */
  private toToolPath(path: string): string {
    const abs = this.normalisePath(path);
    const prefix = this.workspaceBase + "/";
    return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
  }

  private async invoke(
    name: ToolNameType,
    args: ToolArguments
  ): Promise<CodeInterpreterResult> {
    const resp = await this.client.send(
      new InvokeCodeInterpreterCommand({
        codeInterpreterIdentifier: this.codeInterpreterIdentifier,
        sessionId: this.sessionId,
        name,
        arguments: args,
      })
    );
    if (!resp.stream) throw new Error("No stream in code interpreter response");
    return consumeStream(resp.stream);
  }

  private async execShell(c: ShellCommand): Promise<ShellResult> {
    const result = await this.invoke("executeCommand" as ToolNameType, {
      command: c.command,
    });
    return {
      stdout: result.structuredContent?.stdout ?? "",
      stderr: result.structuredContent?.stderr ?? "",
      exitCode: result.structuredContent?.exitCode ?? 0,
      op: c.op,
    };
  }

  async readFile(path: string): Promise<string> {
    const rel = this.toToolPath(path);
    const result = await this.invoke("readFiles" as ToolNameType, {
      paths: [rel],
    });

    for (const block of result.content ?? []) {
      if (block.resource?.text != null) return block.resource.text;
      if (block.text != null) return block.text;
    }
    return "";
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const rel = this.toToolPath(path);
    const result = await this.invoke("readFiles" as ToolNameType, {
      paths: [rel],
    });

    for (const block of result.content ?? []) {
      if (block.resource?.blob) return block.resource.blob;
      if (block.data) return block.data;
      if (block.resource?.text != null)
        return new TextEncoder().encode(block.resource.text);
      if (block.text != null) return new TextEncoder().encode(block.text);
    }
    return new Uint8Array(0);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const rel = this.toToolPath(path);
    const isText = typeof content === "string";
    const result = await this.invoke("writeFiles" as ToolNameType, {
      content: [
        {
          path: rel,
          ...(isText
            ? { text: content as string }
            : { blob: content as Uint8Array }),
        },
      ],
    });
    if (result.isError) {
      const msg =
        result.content?.map((b) => b.text).join("") ?? "writeFile failed";
      throw new Error(msg);
    }
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<void> {
    const norm = this.normalisePath(path);
    const buf =
      typeof content === "string"
        ? Buffer.from(content, "utf-8")
        : Buffer.from(content);
    ok(
      await this.execShell(sh.appendFromBase64(norm, buf.toString("base64")))
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
    const rel = this.toToolPath(path);
    const result = await this.invoke("listFiles" as ToolNameType, {
      directoryPath: rel,
    });

    const names: string[] = [];
    for (const block of result.content ?? []) {
      if (block.name) names.push(block.name);
    }

    if (names.length > 0) return names;

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
    if (options?.recursive || options?.force) {
      const r = await this.execShell(sh.rm(this.normalisePath(path), options));
      if (r.exitCode !== 0 && !options?.force) {
        throw new Error(`rm failed: ${r.stderr}`);
      }
      return;
    }

    const rel = this.toToolPath(path);
    const result = await this.invoke("removeFiles" as ToolNameType, {
      paths: [rel],
    });
    if (result.isError) {
      const msg = result.content?.map((b) => b.text).join("") ?? "rm failed";
      throw new Error(msg);
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
    const r = await this.execShell(sh.readlink(this.normalisePath(path)));
    if (r.exitCode !== 0) {
      throw new SandboxNotSupportedError(`readlink: ${r.stderr}`);
    }
    return r.stdout.trim();
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(this.normalisePath(base), path);
  }
}
