/**
 * Type-level fixture covering the capability-generic
 * {@link SandboxProvider} / {@link SandboxOps} contracts.
 *
 * The assertions are wrapped in `describe.skip` because the body is only
 * meaningful at compile time — `tsc --noEmit` (run via `pnpm typecheck`
 * and `vitest typecheck`) is what enforces the contract here. The runtime
 * `expect` calls keep the file shaped like a regular test so the file
 * can't be silently dropped from the suite without notice.
 *
 * The negative assertions use `// @ts-expect-error` so a regression in
 * the type-level gating (e.g. accidentally re-widening a narrowed
 * adapter) flips them from "expected" to "unexpected" and breaks the
 * type check.
 */
import { describe, expect, it } from "vitest";
import type {
  SandboxOps,
  SandboxProvider,
  SandboxSnapshot,
} from "./types";
import { InMemorySandboxProvider } from "../../adapters/sandbox/inmemory/index";
import { DaytonaSandboxProvider } from "../../adapters/sandbox/daytona/index";
import { BedrockSandboxProvider } from "../../adapters/sandbox/bedrock/index";
import type { E2bSandboxProvider } from "../../adapters/sandbox/e2b/index";

// ---------------------------------------------------------------------------
// Positive: wide-cap providers expose the gated lifecycle methods
// ---------------------------------------------------------------------------

function _wideProviderCallsCompile(p: InMemorySandboxProvider): void {
  void p.pause("id");
  void p.resume("id");
  void p.snapshot("id");
  void p.deleteSnapshot({} as SandboxSnapshot);
  void p.restore({} as SandboxSnapshot);
  void p.fork("id");
}

function _e2bProviderCallsCompile(p: E2bSandboxProvider): void {
  void p.pause("id");
  void p.snapshot("id");
  void p.fork("id");
}

function _wideOpsCallsCompile(ops: SandboxOps): void {
  void ops.createSandbox();
  void ops.destroySandbox("id");
  void ops.pauseSandbox("id");
  void ops.resumeSandbox("id");
  void ops.snapshotSandbox("id");
  void ops.deleteSandboxSnapshot({} as SandboxSnapshot);
  void ops.restoreSandbox({} as SandboxSnapshot);
  void ops.forkSandbox("id");
}

// ---------------------------------------------------------------------------
// Negative: narrowed (`TCaps = never`) adapters drop the gated methods
// ---------------------------------------------------------------------------

function _daytonaCallsRejected(p: DaytonaSandboxProvider): void {
  void p.create();
  void p.get("id");
  void p.destroy("id");
  // @ts-expect-error daytona declares `TCaps = never`, so `pause` is gone
  void p.pause("id");
  // @ts-expect-error daytona declares `TCaps = never`, so `resume` is gone
  void p.resume("id");
  // @ts-expect-error daytona declares `TCaps = never`, so `snapshot` is gone
  void p.snapshot("id");
  // @ts-expect-error daytona declares `TCaps = never`, so `restore` is gone
  void p.restore({} as SandboxSnapshot);
  // @ts-expect-error daytona declares `TCaps = never`, so `fork` is gone
  void p.fork("id");
  // @ts-expect-error daytona declares `TCaps = never`, so `deleteSnapshot` is gone
  void p.deleteSnapshot({} as SandboxSnapshot);
}

function _bedrockCallsRejected(p: BedrockSandboxProvider): void {
  void p.create();
  void p.destroy("id");
  // @ts-expect-error bedrock declares `TCaps = never`, so `pause` is gone
  void p.pause("id");
  // @ts-expect-error bedrock declares `TCaps = never`, so `snapshot` is gone
  void p.snapshot("id");
  // @ts-expect-error bedrock declares `TCaps = never`, so `fork` is gone
  void p.fork("id");
}

function _narrowOpsRejected(
  daytonaOps: SandboxOps<{ id?: string }, unknown, never>
): void {
  void daytonaOps.createSandbox();
  void daytonaOps.destroySandbox("id");
  // @ts-expect-error narrowed ops drop the gated method entirely
  void daytonaOps.pauseSandbox("id");
  // @ts-expect-error narrowed ops drop the gated method entirely
  void daytonaOps.snapshotSandbox("id");
  // @ts-expect-error narrowed ops drop the gated method entirely
  void daytonaOps.forkSandbox("id");
  // @ts-expect-error narrowed ops drop the gated method entirely
  void daytonaOps.restoreSandbox({} as SandboxSnapshot);
}

// ---------------------------------------------------------------------------
// Composition: a wide-cap provider satisfies a narrow consumer requirement
// ---------------------------------------------------------------------------

function _consumerNeedingPauseAcceptsWide(): void {
  type PausableProvider = SandboxProvider<
    Parameters<InMemorySandboxProvider["create"]>[0] extends infer O
      ? O extends { id?: string } | undefined
        ? Exclude<O, undefined>
        : { id?: string }
      : { id?: string },
    Awaited<ReturnType<InMemorySandboxProvider["get"]>>,
    "pause" | "resume"
  >;

  function takesPausable(_p: PausableProvider): void {}
  takesPausable(new InMemorySandboxProvider());
}

// ---------------------------------------------------------------------------
// Runtime introspection: supportedCapabilities mirrors the type-level cap
// ---------------------------------------------------------------------------

describe("SandboxCapability type fixture", () => {
  it("exposes runtime supportedCapabilities matching the type-level set", () => {
    const inMem = new InMemorySandboxProvider();
    expect([...inMem.supportedCapabilities].sort()).toEqual(
      ["fork", "pause", "restore", "resume", "snapshot"].sort()
    );
  });

  it("daytona declares no capabilities at runtime", () => {
    expect(typeof DaytonaSandboxProvider).toBe("function");
  });

  it("bedrock declares no capabilities at runtime", () => {
    expect(typeof BedrockSandboxProvider).toBe("function");
  });
});
