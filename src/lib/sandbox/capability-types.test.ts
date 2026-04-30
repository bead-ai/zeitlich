/**
 * Type-level + runtime fixture covering the capability-generic
 * {@link SandboxProvider} / {@link SandboxOps} contracts.
 *
 * The unused functions in this file are intentional: their bodies are
 * meaningful at compile time only — `tsc --noEmit` (run via the
 * project's `npm run typecheck` and the husky pre-commit hook) is what
 * enforces the type-level contract here. The runtime `expect` calls
 * pin the parts of the contract TypeScript can't enforce on its own
 * (the runtime `supportedCapabilities` set), so the file can't be
 * silently dropped from the suite without notice.
 *
 * The negative assertions use `// @ts-expect-error` so a regression in
 * the type-level gating (e.g. accidentally re-widening a narrowed
 * adapter) flips them from "expected" to "unexpected" and breaks the
 * type check.
 */
import { describe, expect, it } from "vitest";
import { SandboxManager } from "./manager";
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxCapability,
  SandboxCreateOptions,
  SandboxCreateResult,
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
// Synthetic partial-cap fixture (`TCaps = "pause" | "resume"`)
//
// Mirrors the shape of the bedrock-runtime adapter (which lives on a
// separate branch) so the contract for partial-cap providers is pinned
// here and stays stable across the bedrock-runtime rebase.
// ---------------------------------------------------------------------------

const PAUSABLE_CAPS = [
  "pause",
  "resume",
] as const satisfies readonly SandboxCapability[];
type PausableCaps = (typeof PAUSABLE_CAPS)[number];

class FakePausableProvider
  implements SandboxProvider<SandboxCreateOptions, Sandbox, PausableCaps>
{
  readonly id = "fakePausable";
  readonly capabilities: SandboxCapabilities = {
    filesystem: false,
    execution: false,
    persistence: false,
  };
  readonly supportedCapabilities: ReadonlySet<PausableCaps> = new Set(
    PAUSABLE_CAPS
  );

  async create(_options?: SandboxCreateOptions): Promise<SandboxCreateResult> {
    throw new Error("not used in type-level fixture");
  }
  async get(_id: string): Promise<Sandbox> {
    throw new Error("not used in type-level fixture");
  }
  async destroy(_id: string): Promise<void> {
    /* not used */
  }
  async pause(_id: string, _ttlSeconds?: number): Promise<void> {
    /* not used */
  }
  async resume(_id: string): Promise<void> {
    /* not used */
  }
}

function _partialCapPositiveCalls(p: FakePausableProvider): void {
  void p.pause("id");
  void p.pause("id", 60);
  void p.resume("id");
  void p.create();
  void p.destroy("id");
}

function _partialCapNegativeCalls(p: FakePausableProvider): void {
  // @ts-expect-error TCaps = "pause" | "resume" omits "snapshot"
  void p.snapshot("id");
  // @ts-expect-error TCaps = "pause" | "resume" omits "deleteSnapshot"
  void p.deleteSnapshot({} as SandboxSnapshot);
  // @ts-expect-error TCaps = "pause" | "resume" omits "restore"
  void p.restore({} as SandboxSnapshot);
  // @ts-expect-error TCaps = "pause" | "resume" omits "fork"
  void p.fork("id");
}

function _partialCapOpsGating(
  ops: SandboxOps<SandboxCreateOptions, unknown, PausableCaps>
): void {
  void ops.pauseSandbox("id");
  void ops.resumeSandbox("id");
  // @ts-expect-error TCaps = "pause" | "resume" omits "snapshot"
  void ops.snapshotSandbox("id");
  // @ts-expect-error TCaps = "pause" | "resume" omits "fork"
  void ops.forkSandbox("id");
}

// ---------------------------------------------------------------------------
// Type-level guard: the runtime `supportedCapabilities` set element type
// must be a subset of `TCaps`.
//
// The constraint on `SandboxProvider` is
// `ReadonlySet<TCaps & SandboxCapability>`. This block proves that an
// adapter declared with `TCaps = never` cannot smuggle "pause" through
// the runtime set.
// ---------------------------------------------------------------------------

function _runtimeSetCannotExceedTCaps(): void {
  // @ts-expect-error a never-cap provider cannot ship a non-empty set
  const _badSet: ReadonlySet<never> = new Set<SandboxCapability>(["pause"]);
  // The well-typed empty case still works:
  const _goodSet: ReadonlySet<never> = new Set();
  void _badSet;
  void _goodSet;
}

// ---------------------------------------------------------------------------
// Runtime introspection: supportedCapabilities matches the type-level set
// ---------------------------------------------------------------------------

describe("SandboxCapability fixture — type ↔ runtime alignment", () => {
  it("InMemorySandboxProvider exposes the full capability set at runtime", () => {
    const inMem = new InMemorySandboxProvider();
    expect([...inMem.supportedCapabilities].sort()).toEqual(
      ["fork", "pause", "restore", "resume", "snapshot"].sort()
    );
    expect(inMem.supportedCapabilities.size).toBe(5);
  });

  it("DaytonaSandboxProvider's runtime supportedCapabilities is empty", () => {
    const daytona = new DaytonaSandboxProvider({
      apiKey: "test",
      apiUrl: "https://example.invalid",
    });
    expect(daytona.supportedCapabilities.size).toBe(0);
    expect([...daytona.supportedCapabilities]).toEqual([]);
  });

  it("BedrockSandboxProvider's runtime supportedCapabilities is empty", () => {
    const bedrock = new BedrockSandboxProvider({
      codeInterpreterIdentifier: "noop",
    });
    expect(bedrock.supportedCapabilities.size).toBe(0);
    expect([...bedrock.supportedCapabilities]).toEqual([]);
  });

  it("partial-cap provider's runtime set matches its declared TCaps", () => {
    const partial = new FakePausableProvider();
    expect([...partial.supportedCapabilities].sort()).toEqual(
      ["pause", "resume"].sort()
    );
    expect(partial.supportedCapabilities.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SandboxManager constructor-time runtime consistency check
//
// Belt-and-suspenders for the type-level subset constraint: TS prevents
// the runtime set from containing capabilities not in `TCaps`, but it
// can't catch a provider that declares a cap and forgets to ship the
// matching method (or vice versa). The manager trips a loud failure at
// construction time for both shapes; this fixture pins that contract.
// ---------------------------------------------------------------------------

class _DriftedProvider
  implements SandboxProvider<SandboxCreateOptions, Sandbox, never>
{
  readonly id = "drifted";
  readonly capabilities: SandboxCapabilities = {
    filesystem: false,
    execution: false,
    persistence: false,
  };
  // Force a runtime set that exceeds `TCaps = never`. We cast through
  // `unknown` because the type-level constraint already forbids this
  // shape — exactly the scenario the runtime guard is meant to catch.
  readonly supportedCapabilities: ReadonlySet<never> = new Set<unknown>([
    "pause",
  ]) as unknown as ReadonlySet<never>;

  async create(): Promise<SandboxCreateResult> {
    throw new Error("not used");
  }
  async get(): Promise<Sandbox> {
    throw new Error("not used");
  }
  async destroy(): Promise<void> {}
}

class _ImplWithoutDeclProvider {
  readonly id = "impl-without-decl";
  readonly capabilities: SandboxCapabilities = {
    filesystem: false,
    execution: false,
    persistence: false,
  };
  // Empty runtime set, but ships a `pause` method below — drift in the
  // opposite direction.
  readonly supportedCapabilities: ReadonlySet<SandboxCapability> = new Set();

  async create(): Promise<SandboxCreateResult> {
    throw new Error("not used");
  }
  async get(): Promise<Sandbox> {
    throw new Error("not used");
  }
  async destroy(): Promise<void> {}
  async pause(_id: string): Promise<void> {}
}

describe("SandboxManager runtime cap consistency check", () => {
  it("rejects a provider that lists a capability it does not implement", () => {
    expect(() => new SandboxManager(new _DriftedProvider())).toThrow(
      /lists "pause" in supportedCapabilities but does not implement pause/
    );
  });

  it("rejects a provider that implements a method without listing the cap", () => {
    expect(
      () =>
        new SandboxManager(
          new _ImplWithoutDeclProvider() as unknown as ConstructorParameters<
            typeof SandboxManager
          >[0]
        )
    ).toThrow(
      /implements pause\(\) but does not list "pause" in supportedCapabilities/
    );
  });
});
