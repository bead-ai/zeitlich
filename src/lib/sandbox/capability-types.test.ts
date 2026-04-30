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

// ---------------------------------------------------------------------------
// SubagentSandboxConfig.proxy × continuation × adapter matrix
//
// `SubagentContinuationCaps` encodes the caps the chosen continuation
// **strategy** needs anywhere in the codebase (parent shutdown handler
// AND child session lifecycle), pinning the contract on the proxy
// field — which is structurally identical to the child's adapter type
// — so any `(continuation, adapter)` combination that can't execute
// at runtime fails to typecheck here:
//
//   continuation: "continue"  → no gated cap required (any adapter)
//   continuation: "fork"      → "fork" cap required (child calls forkSandbox)
//   continuation: "snapshot"  → "snapshot" | "restore" required
//                               (child calls snapshotSandbox + restoreSandbox;
//                                parent calls deleteSandboxSnapshot)
//
// The matrix is structured by (source × continuation × adapter), with
// expected pass/fail labelled per cell so a future regression that
// re-widens (over-reject) or re-narrows (under-reject) one cell trips
// the type check immediately.
// ---------------------------------------------------------------------------

import type { SubagentSandboxConfig } from "../subagent/types";
import { proxyDaytonaSandboxOps } from "../../adapters/sandbox/daytona/proxy";
import { proxyBedrockSandboxOps } from "../../adapters/sandbox/bedrock/proxy";
import { proxyE2bSandboxOps } from "../../adapters/sandbox/e2b/proxy";
import { proxyInMemorySandboxOps } from "../../adapters/sandbox/inmemory/proxy";

// Helper that pins the matrix cell type to `SubagentSandboxConfig` so
// `@ts-expect-error` directives consistently land on the call line. The
// helper is never invoked at runtime — the matrix is a pure
// type-level fixture wrapped in `_subagentMatrix()` below.
const subagentCfg = <T extends SubagentSandboxConfig>(c: T): T => c;

function _subagentMatrix(): void {
  // ===============================================================
  // own × continue
  // ===============================================================
  //
  // `mustSurvive=true` for `continuation: "continue"`. When the
  // user's shutdown isn't a survival value (`pause` / `keep` /
  // `pause-until-parent-close` / `keep-until-parent-close`), the
  // handler auto-injects `"pause"` (subsequent calls) or
  // `"pause-until-parent-close"` (creator first call). Each cell
  // below reflects the resulting required cap union.

  // shutdown omitted → auto-injected pause/pause-until-parent-close.
  // @ts-expect-error pauseSandbox/resumeSandbox missing — auto-injection on continue requires "pause" (and "resume" via pause-until-parent-close)
  subagentCfg({
    source: "own",
    continuation: "continue",
    proxy: proxyDaytonaSandboxOps,
  });
  // @ts-expect-error pauseSandbox missing — auto-injection on continue requires "pause"
  subagentCfg({
    source: "own",
    continuation: "continue",
    proxy: proxyBedrockSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "continue",
    proxy: proxyE2bSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "continue",
    proxy: proxyInMemorySandboxOps,
  });

  // shutdown: "keep" → alreadySurvives, no auto-inject. All compile.
  subagentCfg({
    source: "own",
    continuation: "continue",
    shutdown: "keep",
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "continue",
    shutdown: "keep",
    proxy: proxyBedrockSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "continue",
    shutdown: "keep",
    proxy: proxyE2bSandboxOps,
  });

  // shutdown: "pause" → propagates → "pause" cap.
  subagentCfg({
    source: "own",
    continuation: "continue",
    shutdown: "pause",
    // @ts-expect-error pauseSandbox missing — shutdown: "pause" requires "pause"
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "continue",
    shutdown: "pause",
    proxy: proxyE2bSandboxOps,
  });

  // shutdown: "destroy" → NOT alreadySurvives, auto-injection applies.
  subagentCfg({
    source: "own",
    continuation: "continue",
    shutdown: "destroy",
    // @ts-expect-error pauseSandbox missing — shutdown: "destroy" on continue still triggers pause auto-injection
    proxy: proxyDaytonaSandboxOps,
  });

  // ===============================================================
  // own × fork × per-call (default init)
  // ===============================================================

  // not mustSurvive, no auto-inject, needs "fork" only.
  subagentCfg({
    source: "own",
    continuation: "fork",
    init: "per-call",
    // @ts-expect-error forkSandbox missing — continuation: "fork" requires "fork"
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "fork",
    init: "per-call",
    // @ts-expect-error forkSandbox missing — continuation: "fork" requires "fork"
    proxy: proxyBedrockSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "fork",
    init: "per-call",
    proxy: proxyE2bSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "fork",
    init: "per-call",
    proxy: proxyInMemorySandboxOps,
  });

  // ===============================================================
  // own × fork × once (mustSurvive → auto-inject pause)
  // ===============================================================

  subagentCfg({
    source: "own",
    continuation: "fork",
    init: "once",
    // @ts-expect-error forkSandbox AND pauseSandbox missing — fork+once auto-injects pause and needs "fork"
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "fork",
    init: "once",
    proxy: proxyE2bSandboxOps,
  });

  // ===============================================================
  // own × snapshot (overrides shutdown to "snapshot")
  // ===============================================================

  subagentCfg({
    source: "own",
    continuation: "snapshot",
    proxy: proxyE2bSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "snapshot",
    proxy: proxyInMemorySandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "snapshot",
    // @ts-expect-error snapshotSandbox / restoreSandbox / deleteSandboxSnapshot missing
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "own",
    continuation: "snapshot",
    // @ts-expect-error snapshotSandbox / restoreSandbox / deleteSandboxSnapshot missing
    proxy: proxyBedrockSandboxOps,
  });

  // ===============================================================
  // inherit × continue (mode = "inherit" → sandboxOwned=false)
  // ===============================================================
  //
  // No exit-shutdown caps fire regardless of the shutdown value.

  subagentCfg({
    source: "inherit",
    continuation: "continue",
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "inherit",
    continuation: "continue",
    shutdown: "pause",
    proxy: proxyDaytonaSandboxOps,
  });
  subagentCfg({
    source: "inherit",
    continuation: "continue",
    proxy: proxyE2bSandboxOps,
  });

  // ===============================================================
  // inherit × fork (child runs mode: "fork" against parent's sandbox)
  // ===============================================================

  subagentCfg({
    source: "inherit",
    continuation: "fork",
    proxy: proxyE2bSandboxOps,
  });
  subagentCfg({
    source: "inherit",
    continuation: "fork",
    // @ts-expect-error forkSandbox missing — inherit+fork still requires "fork"
    proxy: proxyDaytonaSandboxOps,
  });

  // inherit + snapshot is structurally invalid (continuation domain).
  subagentCfg({
    source: "inherit",
    // @ts-expect-error inherit + snapshot is invalid by design
    continuation: "snapshot",
    proxy: proxyE2bSandboxOps,
  });
}
void _subagentMatrix;

// --- Synthetic adapter coverage of the "snapshot strategy needs both
// `snapshot` and `restore`" half of the (B) invariant: a proxy that ships
// only `snapshot` (no `restore`) must still be rejected for snapshot
// continuations, otherwise the child session's restoreSandbox call would
// throw at runtime. The synthetic proxies use `declare const` so they
// only exist at compile time; the wrapping `_syntheticAdapterMatrix`
// function is never called, keeping these checks pure type-level.

declare const proxySnapshotOnly: (
  scope: string
) => SandboxOps<SandboxCreateOptions, unknown, "snapshot">;
declare const proxyForkOnly: (
  scope: string
) => SandboxOps<SandboxCreateOptions, unknown, "fork">;

function _syntheticAdapterMatrix(): void {
  const _ownSnapshotSnapshotOnly: SubagentSandboxConfig = {
    source: "own",
    continuation: "snapshot",
    // @ts-expect-error snapshot continuation needs `restore` too — proxy is missing restoreSandbox
    proxy: proxySnapshotOnly,
  };

  // Symmetric positive: a fork-only proxy is enough for fork continuation
  // (no snapshot/restore needed). Pins (B) — the strategy's required cap
  // set is the *minimum* the adapter must expose.
  const _ownForkForkOnly: SubagentSandboxConfig = {
    source: "own",
    continuation: "fork",
    proxy: proxyForkOnly,
  };

  void [_ownSnapshotSnapshotOnly, _ownForkForkOnly];
}
void _syntheticAdapterMatrix;

// ---------------------------------------------------------------------------
// SessionConfig.sandboxOps × (sandbox.mode × sandboxShutdown × adapter) matrix
//
// Mirror of the subagent matrix for `createSession`. The session's
// `sandboxOps` field is gated on the literal types of the surrounding
// `sandbox` and `sandboxShutdown` fields via `SessionRequiredCaps`:
//
//   sandbox.mode === "fork"            → "fork" cap
//   sandbox.mode === "from-snapshot"   → "restore" cap
//   sandbox.mode === "continue" +
//     sandboxShutdown ===
//     "pause-until-parent-close"       → "resume" cap
//   sandboxShutdown === "snapshot"     → "snapshot" cap
//   sandboxShutdown === "pause" |
//     "pause-until-parent-close"       → "pause" cap
//
// The default wide `TInit` / `TShutdown` resolve to the full union, so
// existing call sites that don't pin the literals still require the
// full cap set (current behaviour). The matrix here pins both
// directions: when literals are passed explicitly, narrow adapters
// satisfy safe combinations and are rejected on unsafe ones.
// ---------------------------------------------------------------------------

import type {
  SessionConfig,
  SessionRequiredCaps,
  ThreadOps,
} from "../session/types";
import type { ToolMap } from "../tool-router/types";
import type { ActivityInterfaceFor } from "@temporalio/workflow";

declare const fakeThreadOps: ActivityInterfaceFor<ThreadOps<string>>;
declare const fakeTools: ToolMap;

function _sessionMatrix(): void {
  // Common config slot — all the non-sandbox required fields.
  type Base = Omit<
    SessionConfig<ToolMap, unknown, string>,
    "sandboxOps" | "sandbox" | "sandboxShutdown"
  >;
  const base: Base = {
    agentName: "a",
    runAgent: async () => ({ message: null, rawToolCalls: [] }),
    threadOps: fakeThreadOps,
    tools: fakeTools,
    buildContextMessage: () => "",
  };

  // --- mode: "new" + shutdown: "destroy" requires no caps. Daytona OK. -----
  const _newDestroyDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "new" },
    "destroy"
  > = {
    ...base,
    sandbox: { mode: "new" },
    sandboxShutdown: "destroy",
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };

  // --- mode: "fork" requires "fork" cap → daytona rejected. ----------------
  const _forkDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "fork"; sandboxId: string },
    "destroy"
  > = {
    ...base,
    sandbox: { mode: "fork", sandboxId: "x" },
    sandboxShutdown: "destroy",
    // @ts-expect-error mode: "fork" requires "fork" cap; daytona's proxy doesn't expose forkSandbox
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };
  // e2b satisfies "fork".
  const _forkE2b: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "fork"; sandboxId: string },
    "destroy"
  > = {
    ...base,
    sandbox: { mode: "fork", sandboxId: "x" },
    sandboxShutdown: "destroy",
    sandboxOps: proxyE2bSandboxOps("scope"),
  };

  // --- mode: "from-snapshot" requires "restore". Daytona rejected. ---------
  const _fromSnapshotDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "from-snapshot"; snapshot: SandboxSnapshot },
    "destroy"
  > = {
    ...base,
    sandbox: {
      mode: "from-snapshot",
      snapshot: {} as SandboxSnapshot,
    },
    sandboxShutdown: "destroy",
    // @ts-expect-error mode: "from-snapshot" requires "restore"; daytona doesn't have restoreSandbox
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };

  // --- shutdown: "snapshot" requires "snapshot" cap. Daytona rejected. -----
  const _snapshotShutdownDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "new" },
    "snapshot"
  > = {
    ...base,
    sandbox: { mode: "new" },
    sandboxShutdown: "snapshot",
    // @ts-expect-error shutdown: "snapshot" requires "snapshot" cap; daytona doesn't have snapshotSandbox
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };

  // --- shutdown: "pause" requires "pause" cap. Daytona rejected. -----------
  const _pauseShutdownDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "new" },
    "pause"
  > = {
    ...base,
    sandbox: { mode: "new" },
    sandboxShutdown: "pause",
    // @ts-expect-error shutdown: "pause" requires "pause" cap; daytona doesn't have pauseSandbox
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };

  // --- mode: "continue" + shutdown: "pause-until-parent-close" requires
  // "resume" + "pause" caps. Daytona rejected. ------------------------------
  const _continueResumeDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "continue"; sandboxId: string },
    "pause-until-parent-close"
  > = {
    ...base,
    sandbox: { mode: "continue", sandboxId: "x" },
    sandboxShutdown: "pause-until-parent-close",
    // @ts-expect-error continue + pause-until-parent-close requires "resume" + "pause"
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };

  // --- mode: "continue" + shutdown: "destroy" needs no gated cap.
  // Daytona accepted. -------------------------------------------------------
  const _continueDestroyDaytona: SessionConfig<
    ToolMap,
    unknown,
    string,
    { mode: "continue"; sandboxId: string },
    "destroy"
  > = {
    ...base,
    sandbox: { mode: "continue", sandboxId: "x" },
    sandboxShutdown: "destroy",
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };

  // --- Default `TInit` / `TShutdown` (no `as const`) widens back to full
  // caps — narrow adapters rejected, wide adapters accepted. ----------------
  const _defaultDaytona: SessionConfig<ToolMap, unknown, string> = {
    ...base,
    // @ts-expect-error wide default `SessionRequiredCaps` requires every gated method
    sandboxOps: proxyDaytonaSandboxOps("scope"),
  };
  const _defaultE2b: SessionConfig<ToolMap, unknown, string> = {
    ...base,
    sandboxOps: proxyE2bSandboxOps("scope"),
  };

  void [
    _newDestroyDaytona,
    _forkDaytona,
    _forkE2b,
    _fromSnapshotDaytona,
    _snapshotShutdownDaytona,
    _pauseShutdownDaytona,
    _continueResumeDaytona,
    _continueDestroyDaytona,
    _defaultDaytona,
    _defaultE2b,
  ];
}
void _sessionMatrix;

// Sanity check that `SessionRequiredCaps` resolves to the expected
// literal cap unions for each (init, shutdown) combination — locks the
// type-level mapping independently of the call-site matrix above.

type _Eq<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const _capsCheck: {
  newDestroy: _Eq<SessionRequiredCaps<{ mode: "new" }, "destroy">, never>;
  fork: _Eq<
    SessionRequiredCaps<{ mode: "fork"; sandboxId: string }, "destroy">,
    "fork"
  >;
  fromSnapshot: _Eq<
    SessionRequiredCaps<
      { mode: "from-snapshot"; snapshot: SandboxSnapshot },
      "destroy"
    >,
    "restore"
  >;
  snapshotShutdown: _Eq<
    SessionRequiredCaps<{ mode: "new" }, "snapshot">,
    "snapshot"
  >;
  pauseShutdown: _Eq<SessionRequiredCaps<{ mode: "new" }, "pause">, "pause">;
  continueResume: _Eq<
    SessionRequiredCaps<
      { mode: "continue"; sandboxId: string },
      "pause-until-parent-close"
    >,
    "resume" | "pause"
  >;
  // Wide defaults resolve to the full cap set.
  defaultWide: _Eq<SessionRequiredCaps, SandboxCapability>;
} = {
  newDestroy: true,
  fork: true,
  fromSnapshot: true,
  snapshotShutdown: true,
  pauseShutdown: true,
  continueResume: true,
  defaultWide: true,
};
void _capsCheck;

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
