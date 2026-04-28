import type { InvokeAgentRuntimeCommandStreamOutput } from "@aws-sdk/client-bedrock-agentcore";
import type { ShellResult } from "../../../lib/sandbox/shell";

/**
 * Consume the streaming response from `InvokeAgentRuntimeCommand`,
 * concatenating stdout/stderr deltas and capturing the final exit code.
 *
 * Throws on any of the discriminated exception members in the union.
 */
export async function consumeCommandStream(
  stream: AsyncIterable<InvokeAgentRuntimeCommandStreamOutput>
): Promise<ShellResult> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  for await (const event of stream) {
    if ("chunk" in event && event.chunk) {
      const c = event.chunk;
      if (c.contentDelta?.stdout) stdout += c.contentDelta.stdout;
      if (c.contentDelta?.stderr) stderr += c.contentDelta.stderr;
      if (c.contentStop) exitCode = c.contentStop.exitCode ?? 0;
      continue;
    }
    if ("accessDeniedException" in event && event.accessDeniedException)
      throw new Error(event.accessDeniedException.message ?? "Access denied");
    if ("resourceNotFoundException" in event && event.resourceNotFoundException)
      throw new Error(
        event.resourceNotFoundException.message ?? "Resource not found"
      );
    if ("validationException" in event && event.validationException)
      throw new Error(event.validationException.message ?? "Validation error");
    if ("internalServerException" in event && event.internalServerException)
      throw new Error(
        event.internalServerException.message ?? "Internal server error"
      );
    if ("throttlingException" in event && event.throttlingException)
      throw new Error(event.throttlingException.message ?? "Throttled");
    if (
      "serviceQuotaExceededException" in event &&
      event.serviceQuotaExceededException
    )
      throw new Error(
        event.serviceQuotaExceededException.message ?? "Quota exceeded"
      );
    if ("runtimeClientError" in event && event.runtimeClientError)
      throw new Error(
        event.runtimeClientError.message ?? "Runtime client error"
      );
  }
  return { exitCode, stdout, stderr };
}
