import { uuid4 } from "@temporalio/workflow";

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Generate a compact, workflow-deterministic identifier.
 *
 * Uses Temporal's `uuid4()` internally (seeded by the workflow's RNG),
 * then re-encodes the hex bytes into a base-62 alphabet for a shorter,
 * more token-efficient identifier (~3 tokens vs ~10 for a full UUID).
 *
 * Suitable for thread IDs, child workflow IDs, or any workflow-scoped identifier.
 *
 * @param length - Number of base-62 characters (default 12, ~71 bits of entropy)
 */
export function getShortId(length = 12): string {
  const hex = uuid4().replace(/-/g, "");
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    result += BASE62[byte % BASE62.length];
  }
  return result;
}
