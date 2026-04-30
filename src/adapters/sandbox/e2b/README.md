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
  timeoutMs: 15 * 60 * 1000, // kill-on-abandon safety net
  keepAliveMs: 15 * 60 * 1000, // refreshed on every tool call
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
`{ timeoutMs: keepAliveMs }` to `Sandbox.connect()`. Per the E2B SDK's
`SandboxConnectOpts.timeoutMs` JSDoc:

> For running sandboxes, the timeout will update only if the new timeout is
> longer than the existing one.

So `connect()` with a `timeoutMs` is **monotonic**: it never shrinks the
lifetime of a running sandbox. Pick `keepAliveMs` as the **full per-call
refresh window** you want — passing a value smaller than the time remaining
is a no-op rather than a shrink, but you should still pick the value with
"every tool call should give me at least this much headroom" in mind, not
"floor to add".

`provider.get()` is invoked exactly once per tool call by `withSandbox`, so:

- An active session's tool calls each refresh the lifetime to at least
  `keepAliveMs`. The sandbox cannot be killed mid-run as long as tools are
  still firing — conceptually this is the sandbox equivalent of a Temporal
  activity heartbeat.
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

### Provider-level only

`keepAliveMs` is a provider-construction-time config. There is intentionally
no per-create override: every sandbox managed by the provider refreshes by
the same amount on each `get()`. If a real use case for per-sandbox refresh
windows ever shows up we can add it without breaking changes.

### When connect-with-options is not enough

If you ever need to **shrink** a sandbox's remaining lifetime (e.g. force an
early reap), `connect()` won't do it because of the monotonic-extend rule
above. Use `Sandbox.setTimeout(timeoutMs)` or the static
`SandboxApi.setTimeout(sandboxId, timeoutMs)` instead — those can extend or
reduce.

If E2B ever changes the semantics of `Sandbox.connect(sandboxId, { timeoutMs })`
so it stops extending a running sandbox's lifetime at all, `setTimeout` is
also a drop-in replacement for the call site in `provider.get()`.
