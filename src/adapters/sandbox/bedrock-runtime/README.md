# bedrock-runtime sandbox adapter

AWS Bedrock AgentCore Runtime as a [`SandboxProvider`](../../../lib/sandbox/types.ts).
The E2B-equivalent on AWS — bring-your-own container, native pause/resume,
opt-in persistent filesystem.

For deploying a runtime resource end-to-end (Dockerfile, ECR push, IAM role,
`CreateAgentRuntime`), see [`./test/README.md`](./test/README.md). This file
covers the *adapter's* semantics — what to know when you're using it, not
how to deploy.

---

## Quick reference

| What | Where |
|---|---|
| Deploy walkthrough (one-time AWS setup) | [`test/README.md`](./test/README.md) |
| Provider config | [`types.ts → BedrockRuntimeSandboxConfig`](./types.ts) |
| Workflow proxy | [`./proxy.ts`](./proxy.ts) (import via `zeitlich/adapters/sandbox/bedrock-runtime/workflow`) |
| Live integration tests | [`test/integration.test.ts`](./test/integration.test.ts) (gated on `BEDROCK_RUNTIME_TEST_ARN`) |
| Unit tests | [`./index.test.ts`](./index.test.ts) |

---

## Capabilities

| `SandboxProvider` op | Status |
|---|---|
| `create`, `get`, `destroy`, `Sandbox.exec`, `Sandbox.fs.*` | ✅ |
| `pause` / `resume` | ✅ (Stop + lazy resume on next invoke; idempotent) |
| Persistent filesystem across pause/resume | ✅ opt-in (see [Persistent FS](#persistent-fs)) |
| `snapshot`, `restore`, `deleteSnapshot`, `fork` | ❌ — throws `SandboxNotSupportedError` |

AgentCore Runtime exposes no microVM-level snapshot primitive. Filesystem-only
fork is feasible (tar over the exec channel) but not implemented; see the open
follow-up note in PR #108.

---

## When to use this vs. other adapters

| You want… | Use |
|---|---|
| Sandbox with snapshot/restore/fork | `e2b` |
| Sandbox on AWS, simple, AWS-managed Python image | `bedrock` (Code Interpreter) |
| Sandbox on AWS, your own container, pause/resume, persistent FS | **this adapter** |
| Sandbox in dev, no infra | `inmemory` |
| Sandbox on Daytona | `daytona` |

The bedrock-runtime adapter shares the AWS-IAM auth model with the existing
`bedrock` (Code Interpreter) adapter — both use
`@aws-sdk/client-bedrock-agentcore`. Pick this one when you need pause/resume
or persistent FS that the Code Interpreter adapter doesn't support, **or**
when you need a custom container (Code Interpreter uses an AWS-managed
image only).

---

## Configuration

```ts
import { BedrockRuntimeSandboxProvider } from "zeitlich/adapters/sandbox/bedrock-runtime";

const provider = new BedrockRuntimeSandboxProvider({
  // REQUIRED
  agentRuntimeArn: "arn:aws:bedrock-agentcore:<region>:<account>:runtime/<runtime-name>-<id>",

  // RECOMMENDED
  clientConfig: { region: "us-west-2" },
  workspaceBase: "/home/user", // match your container's workspace convention

  // OPTIONAL
  qualifier: "DEFAULT",         // server-side default if omitted
  commandTimeoutSeconds: 60,    // per-exec wall-clock cap
  strictGet: false,             // see "strictGet" section below — defaults to false
});
```

See [`types.ts → BedrockRuntimeSandboxConfig`](./types.ts) for the canonical
shape and JSDoc.

### `workspaceBase`

Where `sandbox.fs.*` resolves relative paths. Should match the directory
your container actually uses for application data.

If you use AgentCore's persistent session storage (recommended — see
below), the storage mount path is constrained to `/mnt/[a-zA-Z0-9._-]+`.
If your application code expects a different path (e.g. `/home/user`),
**symlink it in the Dockerfile**:

```dockerfile
RUN mkdir -p /mnt/workspace
RUN ln -s /mnt/workspace /home/user
```

Then pass `workspaceBase: "/home/user"` and register the runtime with
`sessionStorage.mountPath: "/mnt/workspace"`. Reads/writes via either path
hit the same persistent volume.

### `strictGet`

Opt-in defence against AgentCore's implicit-create-on-first-invoke
behaviour. **Defaults to `false`.**

When `true`:
- `provider.create()` writes a marker file at
  `${workspaceBase}/.zeitlich-agentcore-runtime/created_at`.
- `provider.get(id)` reads the marker; if absent, destroys the
  freshly-minted probe session and throws `SandboxNotFoundError`.

When `false` (default):
- `provider.get(id)` returns a thin handle bound to whatever id you
  passed. The first exec/fs call against it either reattaches to an
  existing session **or** silently mints a fresh empty one — AgentCore
  does the same thing for both, and the adapter cannot tell from outside.

Turn it on if session ids flow through untrusted state in your application
(LLM messages, multi-worker coordination via Temporal payloads, etc.) and
a typo or id-collision bug would silently corrupt unrelated sandboxes.
Skip it if your id flow is contained inside well-typed workflow code.

**Caveat:** the marker only survives compute recycles when the runtime has
persistent FS configured. Without persistent FS, `strictGet: true` throws
on any reattach after a Stop or idle-timeout, even legitimate ones.

---

## Lifetime semantics — three clocks

| Clock | Bound | Default | Configurable | Triggers when… |
|---|---|---|---|---|
| `idleRuntimeSessionTimeout` | Per-microVM idle | **15 min** | Yes (60 s – 8 h) | No invokes for that long → microVM killed |
| `maxLifetime` | Per-microVM total | **8 h** | Yes (60 s – 8 h) | microVM has been continuously alive for that long |
| Session-storage GC | Per session id, total idle | **14 days** | No | Session id has had *zero* invokes for that long → S3 data deleted |

```
session id "...abc"  ─────────────────────────────────────  14 days idle GC
  │
  │  microVM A (≤ 8h, killed at 15 min idle by default)
  │  ▓▓▓▓▓▓░ ◄ killed (idle or explicit Stop)
  │         │
  │  files flushed to S3 ──────────► persistent FS lives in S3
  │         │
  │  next invoke ─► microVM B (fresh; FS rehydrated from S3)
  │  microVM B ▓▓▓░ ◄ killed
  │              │
  │              │ next invoke ─► microVM C…
  │              │
  └─ as long as you invoke at least once every 14 days, recycles
     forever. After 14 days of zero invokes, AgentCore deletes the
     persistent FS data.
```

Two consequences worth pinning:

1. **The microVM dies on idle, not the session.** Without persistent FS,
   anything written to the container's filesystem is gone after 15 min
   idle (default) — even though the session id is still valid.
2. **The 8-hour cap is for one continuous spin-up.** Stop+resume gives
   you indefinite *logical* session lifetime (within the 14-day idle GC).

Tune `idleRuntimeSessionTimeout` to fit your workflow's natural pacing.
Workflows with long "thinking" gaps between activities (LLM round-trips,
human-in-the-loop, queued background work) want a higher idle timeout
(e.g. 1 h = 3600 s) so the microVM doesn't die mid-workflow. Active
workflows can leave it at the default to save idle compute cost.

Update via `aws bedrock-agentcore-control update-agent-runtime
--lifecycle-configuration 'idleRuntimeSessionTimeout=...,maxLifetime=...'`.
The same ARN is preserved; bumps the runtime version.

---

## Persistent FS

Files written to the container survive microVM recycles **only** if the
runtime is registered with `filesystemConfigurations.sessionStorage`.

```bash
aws bedrock-agentcore-control create-agent-runtime \
  ... \
  --filesystem-configurations '[{"sessionStorage":{"mountPath":"/mnt/workspace"}}]'
```

Writes asynchronously replicate to AWS-managed S3 backing during the
session. On microVM recycle (idle, Stop, or maxLifetime), the next invoke
spawns a fresh microVM with the same volume mounted and rehydrated.

Constraints:

- `mountPath` regex is `/mnt/[a-zA-Z0-9._-]+/?`. Use a symlink (above) if
  your application expects a different path.
- Without persistent FS, **anything in the container FS dies on every
  recycle**, including `strictGet`'s marker file. For any workflow that
  pauses or has idle gaps longer than `idleRuntimeSessionTimeout`,
  persistent FS is functionally mandatory.

---

## Container contract

AgentCore Runtime expects every container to satisfy a runtime contract
even when this adapter only ever calls the shell-exec path:

- HTTP server on port **8080**.
- Responds **200** to **`GET /ping`**.
- Responds to **`POST /invocations`** (any 2xx body — adapter never calls it).

Without `/ping` returning 200, AgentCore refuses to activate the session
and `InvokeAgentRuntimeCommand` returns **HTTP 424 / `RuntimeClientError`**.

`test/server.py` is a minimal 25-line satisfier. Use it or any equivalent
in your production container. The adapter's exec path (`bash -c "..."`)
runs alongside this server via AgentCore's `docker exec`-style mechanism;
the server doesn't need to know about the exec'd commands.

---

## Network modes

`networkConfiguration.networkMode` supports two values, configured at
`CreateAgentRuntime` time:

- **`PUBLIC`** — AgentCore-managed networking with public internet egress.
  Simplest. No VPC plumbing required. **No granular deny-list option**.
- **`VPC`** — runs in a VPC you provide. Egress is whatever your subnet
  routing + security groups allow. To get "no public internet," you need
  private subnets (no NAT/IGW), security groups with restricted egress,
  and VPC endpoints for ECR (image pull), CloudWatch Logs (runtime logs),
  S3 (ECR layers + any S3 the application uses), and any other AWS
  services the container talks to.

`PUBLIC` is the right default for development and most usage. `VPC` mode
makes sense for production workloads that need defence-in-depth network
isolation; expect ~$25–40/month of VPC interface endpoint cost on top of
runtime compute.

Per-sandbox network ACLs (the way E2B's `network: { denyOut: [...] }`
worked) are **not** available — network policy is a runtime-resource
attribute, not a per-session config. If you need different egress policies
for different workload types, register separate runtimes.

---

## Cost monitoring

AgentCore Runtime is consumption-billed:
- Compute hours per active session (CPU + memory while running).
- Session storage GB-hours.
- Network egress (PUBLIC) or VPC interface endpoint hours (VPC).

### Quick cost check

```bash
aws ce get-cost-and-usage \
  --region us-east-1 \
  --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics UnblendedCost UsageQuantity \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["Amazon Bedrock AgentCore"]}}' \
  --group-by '[{"Type":"DIMENSION","Key":"USAGE_TYPE"}]'
```

### Cost Explorer (UI)

Web UI: filter Service = `Bedrock AgentCore`, group by Usage Type, daily
granularity. Best for ongoing visibility.

### Tag for cost allocation

Tag runtime resources with `Environment`, `Service`, etc. so Cost Explorer
can group by tag:

```bash
aws bedrock-agentcore-control tag-resource \
  --region us-west-2 \
  --resource-arn <arn> \
  --tags Environment=test,Service=spreadsheet-agent
```

(Tag-based cost allocation must be enabled at the org level in
AWS Billing → Cost Allocation Tags first.)

### Idle-timeout cost intuition

Bumping `idleRuntimeSessionTimeout` from the default 15 min to 60 min
multiplies idle compute cost ~4× for workflows with idle tails. Tune to
the actual workload shape; "longer is safer" but isn't free.

---

## Observability

| What | Where |
|---|---|
| Per-session stdout/stderr | CloudWatch Logs at `/aws/bedrock-agentcore/runtimes/<runtime-name>` |
| Live tail | `aws logs tail /aws/bedrock-agentcore/runtimes/<runtime-name> --follow` |
| Runtime status | `aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <id>` |
| Service-emitted metrics | CloudWatch → Metrics → `BedrockAgentCore` namespace (invocations, duration, errors) |
| OpenTelemetry / structured agent traces | AgentCore Observability — requires container-side OTEL instrumentation |

There's no built-in "list active sessions" UI like E2B has. AgentCore
Runtime data plane has no `ListRuntimeSessions` API; sessions are
client-id-managed. Check log streams for active sessions instead.

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `InvokeAgentRuntimeCommand` returns HTTP 424 / `RuntimeClientError` | Container `/ping` not responding | Add the contract HTTP server (`test/server.py`) and rebuild |
| `Activity function ... is not registered on this Worker` | `provider.id` divergence between activity registration (`SandboxManager`) and workflow proxy (`ADAPTER_PREFIX`) | Both must yield the same camelCase prefix; bedrock-runtime uses `bedrockRuntime` |
| `SandboxNotFoundError` from `provider.get()` after a pause | `strictGet: true` + no persistent FS, marker died with the microVM | Either enable persistent FS on the runtime or set `strictGet: false` |
| `pause()` throws `ResourceNotFoundException` | Activity retry hit a session already-stopped by an earlier attempt | Already handled — `pause()` is idempotent and swallows this error since version with `index.test.ts` |
| `Bootstrap failed (exit 2): can't open file ...` | Container is missing application files baked in by the E2B template | Add the equivalent `COPY` lines in your AgentCore Dockerfile |
| `AccessDeniedException` on data-plane calls | Caller IAM lacks `bedrock-agentcore:Invoke*` etc. | Attach `BedrockAgentCoreFullAccess` for dev, or scope per-action for prod |

---

## Architecture notes

- The adapter implements the full `SandboxProvider` interface; methods that
  AgentCore Runtime cannot natively fulfil (`snapshot` / `restore` /
  `deleteSnapshot` / `fork`) throw `SandboxNotSupportedError` at runtime.
  No type-level narrowing — the wide interface is needed for composition
  with zeitlich's other APIs (`runSandboxActivities`, `SessionConfig.sandboxOps`,
  workflow scope `proxy:` fields).
- `pause(id)` and `provider.destroy(id)` both call `StopRuntimeSession`
  under the hood. The difference is intent: `pause` keeps the session id
  alive for later resume; `destroy` should be terminal (the session id
  will be re-allocated lazily on next invoke if used). Both are
  idempotent on `ResourceNotFoundException`.
- `Sandbox.exec` and `Sandbox.fs.*` all map to `InvokeAgentRuntimeCommand`
  (shell exec). Filesystem ops are shell-out via `cat`/`base64`/`stat`/etc.
  in [`./filesystem.ts`](./filesystem.ts), which uses the shared shell helper
  at [`../../../lib/sandbox/shell.ts`](../../../lib/sandbox/shell.ts).
- Activity name namespacing comes from `provider.id`. For this adapter:
  `provider.id = "bedrockRuntime"`. The workflow proxy at `proxy.ts`
  uses the same prefix.

---

## Reference

API and naming constraints we hit while building this — captured so you
don't have to re-derive them from `aws ... help` output.

### Identifiers

| Identifier | Constraint |
|---|---|
| `agentRuntimeName` | regex `[a-zA-Z][a-zA-Z0-9_]{0,47}` — letters/digits/underscores only, must start with a letter, max **48 chars**. **Hyphens not allowed**. |
| `runtimeSessionId` | min **33 characters** (caller-supplied). Anything shorter triggers a validation error from AgentCore. |
| `agentRuntimeArtifact.containerConfiguration.containerUri` | min 1, max 1024. |
| IAM `role-arn` | min 1, max 2048; pattern `arn:aws(-[^:]+)?:iam::([0-9]{12})?:role/.+`. |

### Lifecycle (`lifecycleConfiguration`)

| Field | Min | Max | Default |
|---|---|---|---|
| `idleRuntimeSessionTimeout` | 60 s | 28800 s (8 h) | 900 s (15 min) |
| `maxLifetime` | 60 s | 28800 s (8 h) | 28800 s (8 h) |

Both fields are mutable via `update-agent-runtime --lifecycle-configuration
'idleRuntimeSessionTimeout=...,maxLifetime=...'` (preserves the same ARN,
bumps the runtime version).

### Persistent FS (`filesystemConfigurations.sessionStorage`)

| Field | Constraint |
|---|---|
| `mountPath` | regex `/mnt/[a-zA-Z0-9._-]+/?` — must be under `/mnt/`. Use a Dockerfile symlink if your application expects a different path. |
| Session-storage GC | After **14 days of zero invocations** against the session id, AgentCore deletes the persistent S3 data. |

### Network (`networkConfiguration`)

| Field | Allowed values |
|---|---|
| `networkMode` | `PUBLIC` \| `VPC` (no other modes; no per-sandbox deny-list) |
| `networkModeConfig.subnets` (VPC mode) | 1–16 subnet IDs |
| `networkModeConfig.securityGroups` (VPC mode) | 1–16 security group IDs; each matches `sg-[0-9a-zA-Z]{8,17}` |

### Compute sizing

CPU/memory are **not user-configurable** at `CreateAgentRuntime` time
(unlike E2B's per-tier `cpuCount`/`memoryMB`). AgentCore Runtime uses a
fixed AWS-managed sizing per session. If you need different sizing tiers,
file a support case or check the
[pricing page](https://aws.amazon.com/bedrock/agentcore/pricing/) for
current defaults.

### Container contract (data plane)

| Aspect | Value |
|---|---|
| Listen port | **8080** |
| Required endpoint | `GET /ping` → 200 (any 2xx body) |
| Optional endpoint | `POST /invocations` (only called by `InvokeAgentRuntime`, which this adapter doesn't use) |

Without a healthy `/ping`, AgentCore refuses to activate sessions and
`InvokeAgentRuntimeCommand` fails with HTTP 424 / `RuntimeClientError`.

### CloudWatch

| Resource | Format |
|---|---|
| Log group | `/aws/bedrock-agentcore/runtimes/<agent-runtime-name>` |
| Metrics namespace | `BedrockAgentCore` |

### SDK / API surface this adapter uses

From [`@aws-sdk/client-bedrock-agentcore`](https://www.npmjs.com/package/@aws-sdk/client-bedrock-agentcore)
(data plane only — the control plane lives in
`@aws-sdk/client-bedrock-agentcore-control` and is not pulled by zeitlich):

- `BedrockAgentCoreClient`
- `InvokeAgentRuntimeCommandCommand` (shell exec via streamed stdout/stderr/exitCode)
- `StopRuntimeSessionCommand` (used by both `pause()` and `destroy()`)

Notably **absent** from the data plane SDK:
- `GetRuntimeSession` — no way to introspect a session by id.
- `ListAgentRuntimeSessions` — no way to enumerate active sessions
  under a runtime. Sessions are caller-id-managed and implicitly created
  on first invoke.

### Service status

| | |
|---|---|
| AgentCore service tier | **GA** (announced October 2025) |
| API stability promise | AWS standard for GA — additive changes only, no breaking renames |
| GA announcement | [aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/) |
| Service overview | [docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html) |

### Doc URLs cited in adapter code comments

For traceability when AWS doc URLs change — these are the anchors used
verbatim in source comments. If any of them 404, grep for them in this
package and update.

| URL | Cited in |
|---|---|
| `runtime-sessions.html#session-lifecycle` | `index.ts` `get()`, `pause()`, `resume()` |
| `runtime-sessions.html` ("How to use sessions" — 33-char rule) | `index.ts` `makeSessionId()` |
| `runtime-stop-session.html` | `index.ts` `pause()` |
| `runtime-persistent-filesystems.html#configure-session-storage` | `index.ts` `BedrockRuntimeSandboxImpl.capabilities` |
| `runtime-persistent-filesystems.html#session-storage-data-lifecycle` | `index.ts` `pause()` |

---

## See also

- [`./test/README.md`](./test/README.md) — Dockerfile + AWS deploy steps.
- [AgentCore Runtime sessions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-sessions.html#session-lifecycle)
- [Runtime persistent filesystems](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-persistent-filesystems.html)
- [Stop a running session](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-stop-session.html)
- [AgentCore IAM permissions](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-permissions.html)
- [AgentCore GA announcement (October 2025)](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-bedrock-agentcore-available/)
