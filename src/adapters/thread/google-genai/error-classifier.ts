import { ApiError } from "@google/genai";
import {
  GRPC_STATUS_KIND,
  httpCodeFromMessage,
  kindFromHttpStatus,
  type LlmErrorClassifier,
} from "../../../lib/llm-errors";

/**
 * Vertex/Gemini classifier — anchored to the genai SDK's exported
 * {@link ApiError} class. Deliberately `instanceof`, not name-string matching,
 * so drift in the SDK's error types is caught at compile time.
 *
 * This lives in the google-genai adapter rather than the core `llm-errors`
 * module because `@google/genai` is an optional peer dependency — a runtime
 * import from the main `zeitlich` entry would crash consumers that don't
 * install it. Compose it into `classifyLlmError` (from `zeitlich`):
 *
 * ```typescript
 * classifyLlmError(error, { provider: "vertex", model }, {
 *   classifiers: [genaiErrorClassifier],
 * });
 * ```
 */
export const genaiErrorClassifier: LlmErrorClassifier = (error) => {
  if (!(error instanceof ApiError)) return undefined;
  // The SDK types `status` as a numeric HTTP code, but Vertex surfaces gRPC
  // status-name strings at runtime (e.g. 'RESOURCE_EXHAUSTED'); the numeric
  // code embedded in the message body is the fallback.
  const grpc: string | number = error.status;
  const code = httpCodeFromMessage(error.message);
  const kind =
    (grpc ? GRPC_STATUS_KIND[grpc] : undefined) ??
    (code != null ? kindFromHttpStatus(code) : undefined);
  if (!kind) return undefined;
  return { kind, status: grpc || code };
};
