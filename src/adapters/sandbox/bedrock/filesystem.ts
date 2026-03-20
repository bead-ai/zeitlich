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
      throw new Error(
        event.validationException.message ?? "Validation error"
      );
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

  private async execShell(command: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const result = await this.invoke("executeCommand" as ToolNameType, {
      command,
    });
    return {
      stdout: result.structuredContent?.stdout ?? "",
      stderr: result.structuredContent?.stderr ?? "",
      exitCode: result.structuredContent?.exitCode ?? 0,
    };
  }

  async readFile(path: string): Promise<string> {
    const norm = this.normalisePath(path);
    const result = await this.invoke("readFiles" as ToolNameType, {
      paths: [norm],
    });

    for (const block of result.content ?? []) {
      if (block.resource?.text != null) return block.resource.text;
      if (block.text != null) return block.text;
    }
    return "";
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const norm = this.normalisePath(path);
    const result = await this.invoke("readFiles" as ToolNameType, {
      paths: [norm],
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
    const norm = this.normalisePath(path);
    const isText = typeof content === "string";
    const result = await this.invoke("writeFiles" as ToolNameType, {
      content: [
        {
          path: norm,
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
    const addition =
      typeof content === "string"
        ? content
        : new TextDecoder().decode(content);
    const escaped = addition.replace(/'/g, "'\\''");
    const { exitCode, stderr } = await this.execShell(
      `printf '%s' '${escaped}' >> "${norm}"`
    );
    if (exitCode !== 0) throw new Error(`appendFile failed: ${stderr}`);
  }

  async exists(path: string): Promise<boolean> {
    const norm = this.normalisePath(path);
    const { exitCode } = await this.execShell(`test -e "${norm}"`);
    return exitCode === 0;
  }

  async stat(path: string): Promise<FileStat> {
    const norm = this.normalisePath(path);
    const { stdout, exitCode, stderr } = await this.execShell(
      `stat -c '%F %s %Y' "${norm}" 2>&1`
    );
    if (exitCode !== 0) throw new Error(`stat failed: ${stderr || stdout}`);

    const parts = stdout.trim().split(" ");
    const fileType = parts.slice(0, -2).join(" ");
    const sizeStr = parts[parts.length - 2] ?? "0";
    const mtimeStr = parts[parts.length - 1] ?? "0";
    const size = parseInt(sizeStr, 10);
    const mtimeEpoch = parseInt(mtimeStr, 10);

    return {
      isFile: fileType === "regular file" || fileType === "regular empty file",
      isDirectory: fileType === "directory",
      isSymbolicLink: fileType === "symbolic link",
      size: isNaN(size) ? 0 : size,
      mtime: new Date(isNaN(mtimeEpoch) ? 0 : mtimeEpoch * 1000),
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const norm = this.normalisePath(path);
    const flag = options?.recursive ? "-p " : "";
    const { exitCode, stderr } = await this.execShell(
      `mkdir ${flag}"${norm}"`
    );
    if (exitCode !== 0) throw new Error(`mkdir failed: ${stderr}`);
  }

  async readdir(path: string): Promise<string[]> {
    const norm = this.normalisePath(path);
    const result = await this.invoke("listFiles" as ToolNameType, {
      directoryPath: norm,
    });

    const names: string[] = [];
    for (const block of result.content ?? []) {
      if (block.name) names.push(block.name);
    }

    if (names.length > 0) return names;

    const { stdout, exitCode, stderr } = await this.execShell(
      `ls -1A "${norm}"`
    );
    if (exitCode !== 0) throw new Error(`readdir failed: ${stderr}`);
    return stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
  }

  async readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    const norm = this.normalisePath(path);
    const { stdout, exitCode, stderr } = await this.execShell(
      `find "${norm}" -maxdepth 1 -mindepth 1 -printf '%y %f\\n'`
    );
    if (exitCode !== 0)
      throw new Error(`readdirWithFileTypes failed: ${stderr}`);

    return stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((line) => {
        const type = line.charAt(0);
        const name = line.slice(2);
        return {
          name,
          isFile: type === "f",
          isDirectory: type === "d",
          isSymbolicLink: type === "l",
        };
      });
  }

  async rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void> {
    const norm = this.normalisePath(path);
    if (options?.recursive || options?.force) {
      const flags = `${options?.recursive ? "-r" : ""} ${options?.force ? "-f" : ""}`.trim();
      const { exitCode, stderr } = await this.execShell(
        `rm ${flags} "${norm}"`
      );
      if (exitCode !== 0 && !options?.force)
        throw new Error(`rm failed: ${stderr}`);
      return;
    }

    const result = await this.invoke("removeFiles" as ToolNameType, {
      paths: [norm],
    });
    if (result.isError) {
      const msg =
        result.content?.map((b) => b.text).join("") ?? "rm failed";
      throw new Error(msg);
    }
  }

  async cp(
    src: string,
    dest: string,
    options?: { recursive?: boolean }
  ): Promise<void> {
    const normSrc = this.normalisePath(src);
    const normDest = this.normalisePath(dest);
    const flag = options?.recursive ? "-r " : "";
    const { exitCode, stderr } = await this.execShell(
      `cp ${flag}"${normSrc}" "${normDest}"`
    );
    if (exitCode !== 0) throw new Error(`cp failed: ${stderr}`);
  }

  async mv(src: string, dest: string): Promise<void> {
    const normSrc = this.normalisePath(src);
    const normDest = this.normalisePath(dest);
    const { exitCode, stderr } = await this.execShell(
      `mv "${normSrc}" "${normDest}"`
    );
    if (exitCode !== 0) throw new Error(`mv failed: ${stderr}`);
  }

  async readlink(path: string): Promise<string> {
    const norm = this.normalisePath(path);
    const { stdout, exitCode, stderr } = await this.execShell(
      `readlink "${norm}"`
    );
    if (exitCode !== 0)
      throw new SandboxNotSupportedError(`readlink: ${stderr}`);
    return stdout.trim();
  }

  resolvePath(base: string, path: string): string {
    return posix.resolve(this.normalisePath(base), path);
  }
}
