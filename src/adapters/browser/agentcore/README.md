# AWS Bedrock AgentCore Browser adapter

Browser-session provider backed by the [Amazon Bedrock AgentCore Browser](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html) — a managed, isolated browser environment driven over the Chrome DevTools Protocol (CDP).

## Peer dependencies

Optional peer deps (only required when using this adapter):

```bash
npm install @aws-sdk/client-bedrock-agentcore @aws-sdk/signature-v4 @aws-crypto/sha256-js
```

## Capabilities

Minimal-cap (like Daytona): only base `create` / `destroy` lifecycle. AgentCore browser sessions cannot be paused, resumed, snapshotted, or forked, so `supportedCapabilities` is empty and the workflow proxy exposes only `createBrowser` / `destroyBrowser`.

## Usage

```typescript
import { AgentCoreBrowserProvider } from "zeitlich/adapters/browser/agentcore";
import { BrowserSessionManager, withBrowser } from "zeitlich";

const provider = new AgentCoreBrowserProvider({ region: "us-west-2" });
const manager = new BrowserSessionManager(provider);

// Activity-side registration:
const activities = {
  ...manager.createActivities("WebAgent"),
  // Tool handlers that need the live session:
  browserNavigate: withBrowser(manager, async (args, { browserSession }) => {
    const { url, headers } = await browserSession.getConnection();
    // Bring your own CDP driver:
    // const browser = await chromium.connectOverCDP(url, { headers });
    return { toolResponse: "ok", data: null };
  }),
};
```

Workflow side:

```typescript
import { proxyAgentCoreBrowserOps } from "zeitlich/adapters/browser/agentcore/workflow";

const browserOps = proxyAgentCoreBrowserOps();
// pass to createSession({ browserOps, browser: { mode: "new" } })
```

The session is driven by the caller's own CDP client (Playwright / Puppeteer). `getConnection()` returns a freshly SigV4-signed `wss://` endpoint and the headers required for the WebSocket upgrade; fetch a fresh connection rather than caching it.
