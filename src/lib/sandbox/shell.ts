import { posix } from "node:path";

/**
 * POSIX-safe single-quoting. Wraps a string so it survives `bash -c` even
 * when the value contains `'`, `"`, `$`, backticks, spaces, or newlines.
 *
 * Uses the standard `'foo'\''bar'` trick: every embedded single quote is
 * encoded as `'\''` — close-quote, escaped quote, open-quote.
 */
export function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * A shell command paired with the operation name used in error messages.
 * Produced by the {@link sh} builders so callers don't have to repeat the
 * op name at every call site.
 */
export interface ShellCommand {
  /** Used as the label in error messages from {@link ok}. */
  op: string;
  command: string;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /**
   * Carried through from the originating {@link ShellCommand}. Optional
   * because raw-string runs that bypass the builders won't have it.
   */
  op?: string;
}

/**
 * Throw a labelled error if the shell result is non-zero. Returns stdout
 * on success so callers can chain a parse step:
 *
 * ```ts
 * const out = ok(await this.execShell(sh.stat(path)));
 * const parsed = parseStat(out);
 * ```
 *
 * The op label comes from the {@link ShellCommand} that produced the
 * result — usually the {@link sh} builder name (e.g. `"stat"`, `"mkdir"`).
 */
export function ok(r: ShellResult): string {
  if (r.exitCode !== 0) {
    throw new Error(`${r.op ?? "shell"} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

export interface ExecPreambleOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Composable shell-command builders. Every builder returns a
 * {@link ShellCommand} ready for an `execShell`-style helper to feed into
 * `bash -c`. Pair with {@link q} for path/value escaping.
 *
 * The `op` field on each result is the builder name, surfaced by
 * {@link ok} when the command fails.
 */
export const sh = {
  exists: (path: string): ShellCommand => ({
    op: "exists",
    command: `test -e ${q(path)}`,
  }),
  stat: (path: string): ShellCommand => ({
    op: "stat",
    command: `stat -c '%F %s %Y' ${q(path)}`,
  }),
  mkdir: (path: string, recursive = false): ShellCommand => ({
    op: "mkdir",
    command: `mkdir ${recursive ? "-p " : ""}${q(path)}`,
  }),
  readdir: (dir: string): ShellCommand => ({
    op: "readdir",
    command: `ls -1A ${q(dir)}`,
  }),
  findEntries: (dir: string): ShellCommand => ({
    op: "readdirWithFileTypes",
    command: `find ${q(dir)} -maxdepth 1 -mindepth 1 -printf '%y %f\\n'`,
  }),
  rm: (path: string, opts: RmOptions = {}): ShellCommand => {
    const flags = [opts.recursive && "-r", opts.force && "-f"]
      .filter(Boolean)
      .join(" ");
    return {
      op: "rm",
      command: `rm ${flags ? `${flags} ` : ""}${q(path)}`,
    };
  },
  cp: (src: string, dest: string, recursive = false): ShellCommand => ({
    op: "cp",
    command: `cp ${recursive ? "-r " : ""}${q(src)} ${q(dest)}`,
  }),
  mv: (src: string, dest: string): ShellCommand => ({
    op: "mv",
    command: `mv ${q(src)} ${q(dest)}`,
  }),
  readlink: (path: string): ShellCommand => ({
    op: "readlink",
    command: `readlink ${q(path)}`,
  }),
  /** Read a UTF-8 text file via `cat`. */
  readText: (path: string): ShellCommand => ({
    op: "readFile",
    command: `cat ${q(path)}`,
  }),
  /**
   * Read a file as base64 — pair with
   * `new Uint8Array(Buffer.from(out.replace(/\\s/g, ""), "base64"))`.
   */
  readBase64: (path: string): ShellCommand => ({
    op: "readFileBuffer",
    command: `base64 ${q(path)}`,
  }),
  /**
   * Write a base64-encoded payload to `path`, creating parent dirs first.
   * Pair with `Buffer.from(content).toString("base64")` on the caller side.
   */
  writeFromBase64: (path: string, b64: string): ShellCommand => ({
    op: "writeFile",
    command: `mkdir -p ${q(posix.dirname(path))} && printf %s ${q(b64)} | base64 -d > ${q(path)}`,
  }),
  /** Append a base64-encoded payload to `path`. */
  appendFromBase64: (path: string, b64: string): ShellCommand => ({
    op: "appendFile",
    command: `printf %s ${q(b64)} | base64 -d >> ${q(path)}`,
  }),
  /**
   * Prepend `cd` and `export` statements to a user-supplied command.
   *
   * Returns a plain string because the result is destined for the
   * adapter's user-facing `Sandbox.exec()` entrypoint, not for an internal
   * `execShell` failure-throws-with-label flow.
   */
  withCwdAndEnv: (
    command: string,
    opts: ExecPreambleOptions = {}
  ): string => {
    const parts: string[] = [];
    if (opts.env) {
      for (const [k, v] of Object.entries(opts.env)) {
        parts.push(`export ${k}=${q(v)}`);
      }
    }
    if (opts.cwd) parts.push(`cd ${q(opts.cwd)}`);
    parts.push(command);
    return parts.join(" && ");
  },
};

// ============================================================================
// Parsers
// ============================================================================

export interface ParsedStat {
  /** From `stat -c '%F'`, e.g. `"regular file"`, `"directory"`, `"symbolic link"`. */
  fileType: string;
  size: number;
  mtime: Date;
}

/** Parse a single line of `stat -c '%F %s %Y'` output. */
export function parseStat(line: string): ParsedStat {
  const parts = line.trim().split(" ");
  const sizeStr = parts[parts.length - 2] ?? "0";
  const mtimeStr = parts[parts.length - 1] ?? "0";
  const size = parseInt(sizeStr, 10);
  const mtimeEpoch = parseInt(mtimeStr, 10);
  return {
    fileType: parts.slice(0, -2).join(" "),
    size: isNaN(size) ? 0 : size,
    mtime: new Date(isNaN(mtimeEpoch) ? 0 : mtimeEpoch * 1000),
  };
}

export interface ParsedEntry {
  /** Single character from `find -printf %y`. `f`=file, `d`=dir, `l`=symlink. */
  type: string;
  name: string;
}

/** Parse the multi-line output of {@link sh.findEntries}. */
export function parseFindEntries(stdout: string): ParsedEntry[] {
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => ({ type: line.charAt(0), name: line.slice(2) }));
}

/** Parse the multi-line output of `ls -1A`. */
export function parseLsLines(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
}
