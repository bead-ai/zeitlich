import { describe, expect, it } from "vitest";
import {
  q,
  ok,
  sh,
  parseStat,
  parseFindEntries,
  parseLsLines,
} from "./shell";
import type { ShellResult } from "./shell";

describe("q (POSIX single-quoting)", () => {
  it("wraps simple strings in single quotes", () => {
    expect(q("hello")).toBe("'hello'");
  });

  it("wraps empty string", () => {
    expect(q("")).toBe("''");
  });

  it("escapes embedded single quotes via close-escape-open trick", () => {
    expect(q("a'b")).toBe(`'a'\\''b'`);
  });

  it("preserves $ literally — no expansion under bash", () => {
    expect(q("$HOME")).toBe("'$HOME'");
  });

  it("preserves double quotes literally", () => {
    expect(q(`a"b"c`)).toBe(`'a"b"c'`);
  });

  it("preserves backticks literally", () => {
    expect(q("`whoami`")).toBe("'`whoami`'");
  });

  it("preserves spaces", () => {
    expect(q("hello world")).toBe("'hello world'");
  });

  it("preserves newlines", () => {
    expect(q("line1\nline2")).toBe("'line1\nline2'");
  });

  it("escapes multiple single quotes", () => {
    expect(q("'a'b'")).toBe(`''\\''a'\\''b'\\'''`);
  });
});

describe("ok", () => {
  it("returns stdout when exit code is 0", () => {
    const r: ShellResult = { stdout: "hi", stderr: "", exitCode: 0, op: "x" };
    expect(ok(r)).toBe("hi");
  });

  it("throws labelled error when exit code is non-zero", () => {
    const r: ShellResult = {
      stdout: "",
      stderr: "no such file",
      exitCode: 1,
      op: "stat",
    };
    expect(() => ok(r)).toThrow(/^stat failed: no such file$/);
  });

  it("falls back to stdout in error message when stderr is empty", () => {
    const r: ShellResult = {
      stdout: "fallback",
      stderr: "",
      exitCode: 2,
      op: "rm",
    };
    expect(() => ok(r)).toThrow(/^rm failed: fallback$/);
  });

  it("uses 'shell' as label when op is missing", () => {
    const r: ShellResult = { stdout: "", stderr: "boom", exitCode: 1 };
    expect(() => ok(r)).toThrow(/^shell failed: boom$/);
  });
});

describe("sh builders", () => {
  it("exists produces test -e with quoted path", () => {
    expect(sh.exists("/a b")).toEqual({
      op: "exists",
      command: `test -e '/a b'`,
    });
  });

  it("stat produces stat with format flags", () => {
    expect(sh.stat("/p")).toEqual({
      op: "stat",
      command: `stat -c '%F %s %Y' '/p'`,
    });
  });

  it("mkdir without recursive produces no -p flag", () => {
    expect(sh.mkdir("/a")).toEqual({
      op: "mkdir",
      command: `mkdir '/a'`,
    });
  });

  it("mkdir with recursive produces -p flag", () => {
    expect(sh.mkdir("/a/b/c", true)).toEqual({
      op: "mkdir",
      command: `mkdir -p '/a/b/c'`,
    });
  });

  it("readdir produces ls -1A", () => {
    expect(sh.readdir("/d")).toEqual({
      op: "readdir",
      command: `ls -1A '/d'`,
    });
  });

  it("findEntries produces find with maxdepth and printf format", () => {
    expect(sh.findEntries("/d")).toEqual({
      op: "readdirWithFileTypes",
      command: `find '/d' -maxdepth 1 -mindepth 1 -printf '%y %f\\n'`,
    });
  });

  it("rm with no flags produces bare rm", () => {
    expect(sh.rm("/p")).toEqual({
      op: "rm",
      command: `rm '/p'`,
    });
  });

  it("rm with recursive only produces -r", () => {
    expect(sh.rm("/p", { recursive: true })).toEqual({
      op: "rm",
      command: `rm -r '/p'`,
    });
  });

  it("rm with both flags produces -r -f without double space", () => {
    expect(sh.rm("/p", { recursive: true, force: true })).toEqual({
      op: "rm",
      command: `rm -r -f '/p'`,
    });
  });

  it("cp with recursive produces -r flag", () => {
    expect(sh.cp("/a", "/b", true)).toEqual({
      op: "cp",
      command: `cp -r '/a' '/b'`,
    });
  });

  it("mv produces mv with two quoted paths", () => {
    expect(sh.mv("/a", "/b")).toEqual({
      op: "mv",
      command: `mv '/a' '/b'`,
    });
  });

  it("readlink produces readlink", () => {
    expect(sh.readlink("/p")).toEqual({
      op: "readlink",
      command: `readlink '/p'`,
    });
  });

  it("readText produces cat", () => {
    expect(sh.readText("/p")).toEqual({
      op: "readFile",
      command: `cat '/p'`,
    });
  });

  it("readBase64 produces base64", () => {
    expect(sh.readBase64("/p")).toEqual({
      op: "readFileBuffer",
      command: `base64 '/p'`,
    });
  });

  it("writeFromBase64 creates parent directory and writes", () => {
    expect(sh.writeFromBase64("/d/e/f.txt", "SGk=")).toEqual({
      op: "writeFile",
      command: `mkdir -p '/d/e' && printf %s 'SGk=' | base64 -d > '/d/e/f.txt'`,
    });
  });

  it("appendFromBase64 appends without recreating directory", () => {
    expect(sh.appendFromBase64("/p", "SGk=")).toEqual({
      op: "appendFile",
      command: `printf %s 'SGk=' | base64 -d >> '/p'`,
    });
  });

  it("paths with single quotes are escaped throughout", () => {
    const c = sh.cp("/a'1", "/b'2", true);
    expect(c.command).toBe(`cp -r '/a'\\''1' '/b'\\''2'`);
  });
});

describe("sh.withCwdAndEnv", () => {
  it("returns the bare command when no opts are supplied", () => {
    expect(sh.withCwdAndEnv("npm test")).toBe("npm test");
  });

  it("prepends cd when only cwd is supplied", () => {
    expect(sh.withCwdAndEnv("npm test", { cwd: "/work space" })).toBe(
      `cd '/work space' && npm test`
    );
  });

  it("prepends export statements when env is supplied", () => {
    expect(
      sh.withCwdAndEnv("npm test", { env: { NODE_ENV: "test", FOO: "bar" } })
    ).toBe(`export NODE_ENV='test' && export FOO='bar' && npm test`);
  });

  it("emits exports first, then cd, then the command", () => {
    expect(
      sh.withCwdAndEnv("npm test", {
        cwd: "/work",
        env: { FOO: "bar baz" },
      })
    ).toBe(`export FOO='bar baz' && cd '/work' && npm test`);
  });

  it("handles env values containing single quotes", () => {
    expect(sh.withCwdAndEnv("printenv", { env: { K: "a'b" } })).toBe(
      `export K='a'\\''b' && printenv`
    );
  });
});

describe("parseStat", () => {
  it("parses regular file output", () => {
    const r = parseStat("regular file 123 1700000000\n");
    expect(r.fileType).toBe("regular file");
    expect(r.size).toBe(123);
    expect(r.mtime.getTime()).toBe(1_700_000_000_000);
  });

  it("parses directory output", () => {
    const r = parseStat("directory 4096 1700000000");
    expect(r.fileType).toBe("directory");
    expect(r.size).toBe(4096);
  });

  it("parses regular empty file (multi-word fileType)", () => {
    const r = parseStat("regular empty file 0 1700000000");
    expect(r.fileType).toBe("regular empty file");
    expect(r.size).toBe(0);
  });

  it("parses symbolic link output", () => {
    const r = parseStat("symbolic link 7 1700000000");
    expect(r.fileType).toBe("symbolic link");
  });

  it("falls back to 0 size on bad numeric input", () => {
    const r = parseStat("regular file ?? 1700000000");
    expect(r.size).toBe(0);
  });

  it("falls back to epoch 0 on bad mtime input", () => {
    const r = parseStat("regular file 5 ??");
    expect(r.mtime.getTime()).toBe(0);
  });
});

describe("parseFindEntries", () => {
  it("parses one entry per line", () => {
    expect(parseFindEntries("f hello.txt\nd subdir\nl link\n")).toEqual([
      { type: "f", name: "hello.txt" },
      { type: "d", name: "subdir" },
      { type: "l", name: "link" },
    ]);
  });

  it("returns empty array for empty stdout", () => {
    expect(parseFindEntries("")).toEqual([]);
  });

  it("ignores trailing whitespace", () => {
    expect(parseFindEntries("f a\n\n")).toEqual([{ type: "f", name: "a" }]);
  });

  it("preserves spaces in names", () => {
    expect(parseFindEntries("f hello world.txt\n")).toEqual([
      { type: "f", name: "hello world.txt" },
    ]);
  });
});

describe("parseLsLines", () => {
  it("splits on newlines and drops blanks", () => {
    expect(parseLsLines("a\nb\nc\n")).toEqual(["a", "b", "c"]);
  });

  it("handles empty input", () => {
    expect(parseLsLines("")).toEqual([]);
  });

  it("preserves single-entry output", () => {
    expect(parseLsLines("only.txt")).toEqual(["only.txt"]);
  });
});
