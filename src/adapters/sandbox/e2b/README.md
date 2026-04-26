# E2B Sandbox Adapter

Adapter that exposes [E2B](https://e2b.dev/) cloud sandboxes through the
standard `SandboxProvider` interface used by the rest of Zeitlich.

## Configuration

`E2bSandboxProvider` accepts an `E2bSandboxConfig` (provider-level defaults).
Per-create overrides may be passed to `create()` via `E2bSandboxCreateOptions`.

```ts
import { E2bSandboxProvider } from "zeitlich/adapters/sandbox/e2b";

const provider = new E2bSandboxProvider({
  template: "my-template",
  timeoutMs: 15 * 60 * 1000,    // kill-on-abandon safety net
  keepAliveMs: 15 * 60 * 1000,  // refreshed on every tool call
});
```

## Keep-alive pattern

E2B's `timeoutMs` on `Sandbox.create` is a **sandbox lifetime**, not an idle
timeout: when it elapses, E2B kills the sandbox regardless of activity. Long
agent loops (LLM thinking + many tool calls) can outlive that window, and the
next tool call hits `Sandbox.connect(sandboxId)` and surfaces a
`SandboxNotFoundError` mid-run.

`keepAliveMs` solves this without giving up the kill-on-abandon safety net.
When set, every call to `provider.get(sandboxId)` passes
`{ timeoutMs: keepAliveMs }` to `Sandbox.connect()`, which extends the
sandbox lifetime to at least that many milliseconds (E2B's
`Sandbox.connect(sandboxId, { timeoutMs })` only extends when the new value is
longer than the time remaining, so it's idempotent and safe to call on every
tool invocation).

`provider.get()` is invoked exactly once per tool call by `withSandbox`, so:

- An active session's tool calls each refresh the lifetime by `keepAliveMs`.
  The sandbox cannot be killed mid-run as long as tools are still firing —
  conceptually this is the sandbox equivalent of a Temporal activity heartbeat.
- An abandoned sandbox still dies `keepAliveMs` after the last tool call. The
  existing kill-on-timeout safety net is preserved.
- Consumers can drop `timeoutMs` back down to short, safe values (e.g.
  15 minutes) without tuning against worst-case run length.

### Recommended usage

- Set `timeoutMs` to a value that bounds how long a sandbox can sit unused
  after the consumer abnormally terminates (worker crash, workflow terminated,
  `workflowRunTimeout`). This is your **abandon safety net**.
- Set `keepAliveMs` to your **per-call refresh window** — typically the same
  value as `timeoutMs`, or shorter if you want sandboxes to be reaped sooner
  after the last tool call.

### Per-create override

Per-create `keepAliveMs` overrides the provider default for that sandbox only.
The override is tracked internally by sandbox id and cleared on `destroy()`.
Honoured by every code path that mints a fresh sandbox id — `create()`,
`restore()`, and `fork()` — so a per-call override applies to the sandbox it
was passed alongside.

```ts
const { sandbox } = await provider.create({ keepAliveMs: 5 * 60 * 1000 });
```

### When connect-with-options stops extending lifetime

If E2B ever changes the semantics of `Sandbox.connect(sandboxId, { timeoutMs })`
so it no longer extends a running sandbox's lifetime, `Sandbox.setTimeout` and
the static `SandboxApi.setTimeout(sandboxId, timeoutMs)` are equivalent
alternatives — swap the call site in `provider.get()` accordingly.
