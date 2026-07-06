import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { genaiErrorClassifier } from "./error-classifier";
import {
  classifyLlmError,
  LlmPermanentError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmUnavailableError,
} from "../../../lib/llm-errors";
import type { LlmProvider } from "../../../lib/llm-errors";

/**
 * A real genai `ApiError` (classification detects it via `instanceof`). The
 * cast is needed because the SDK types `status` as a numeric HTTP code, while
 * Vertex surfaces gRPC status-name strings at runtime.
 */
function genaiApiError(status: string, code?: number): ApiError {
  const message =
    code != null
      ? `got status: ${status}. {"error":{"code":${code},"status":"${status}"}}`
      : `got status: ${status}.`;
  return new ApiError({
    message,
    status,
  } as unknown as ConstructorParameters<typeof ApiError>[0]);
}

function classify(
  error: unknown,
  ctx: { provider: LlmProvider; model?: string } = { provider: "vertex" }
): ReturnType<typeof classifyLlmError> {
  return classifyLlmError(error, ctx, { classifiers: [genaiErrorClassifier] });
}

describe("genaiErrorClassifier — Vertex/Gemini (via genai ApiError)", () => {
  it("maps RESOURCE_EXHAUSTED → LlmRateLimitError", () => {
    const e = classify(genaiApiError("RESOURCE_EXHAUSTED"), {
      provider: "vertex",
      model: "gemini-x",
    });
    expect(e).toBeInstanceOf(LlmRateLimitError);
    expect(e?.kind).toBe("rate_limited");
    expect(e?.provider).toBe("vertex");
    expect(e?.model).toBe("gemini-x");
    expect(e?.status).toBe("RESOURCE_EXHAUSTED");
  });

  it("maps DEADLINE_EXCEEDED → LlmTimeoutError", () => {
    expect(classify(genaiApiError("DEADLINE_EXCEEDED"))).toBeInstanceOf(
      LlmTimeoutError
    );
  });

  it("maps UNAVAILABLE / INTERNAL → LlmUnavailableError", () => {
    expect(classify(genaiApiError("UNAVAILABLE"))).toBeInstanceOf(
      LlmUnavailableError
    );
    expect(classify(genaiApiError("INTERNAL"))).toBeInstanceOf(
      LlmUnavailableError
    );
  });

  it("maps INVALID_ARGUMENT → LlmPermanentError", () => {
    const e = classify(genaiApiError("INVALID_ARGUMENT"));
    expect(e).toBeInstanceOf(LlmPermanentError);
    expect(e?.kind).toBe("permanent");
  });

  it("falls back to the numeric code in the message when status is empty", () => {
    const e = classify(genaiApiError("", 429));
    expect(e).toBeInstanceOf(LlmRateLimitError);
    expect(e?.status).toBe(429);
  });

  it("preserves the original ApiError as the cause", () => {
    const original = genaiApiError("RESOURCE_EXHAUSTED");
    const e = classify(original);
    expect(e?.name).toBe("LlmRateLimitError");
    expect(e?.cause).toBe(original);
  });
});

describe("genaiErrorClassifier — anchoring", () => {
  it("returns undefined for a non-ApiError", () => {
    const err = new Error('{"error":{"code":429}}');
    err.name = "ApiError";
    expect(genaiErrorClassifier(err)).toBeUndefined();
  });

  it("returns undefined for an ApiError with an unrecognised status", () => {
    expect(genaiErrorClassifier(genaiApiError("CANCELLED"))).toBeUndefined();
  });
});
