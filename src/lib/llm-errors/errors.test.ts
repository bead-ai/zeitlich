import { describe, expect, it } from "vitest";
import {
  classifyLlmError,
  LlmError,
  LlmPermanentError,
  LlmRateLimitError,
  LlmTimeoutError,
  LlmUnavailableError,
} from "./errors";
import type { LlmErrorClassifier } from "./errors";

/** An error carrying the AWS SDK's typed error contract (`@smithy/types` SdkError). */
function awsError(opts: {
  httpStatusCode?: number;
  throttling?: boolean;
  fault?: "client" | "server";
  retryAfterSeconds?: number;
}): Error {
  const err = new Error("bedrock boom") as Error & {
    $metadata?: { httpStatusCode?: number };
    $retryable?: { throttling?: boolean };
    $fault?: "client" | "server";
    $response?: { headers?: Record<string, string> };
  };
  if (opts.httpStatusCode != null)
    err.$metadata = { httpStatusCode: opts.httpStatusCode };
  if (opts.throttling) err.$retryable = { throttling: true };
  if (opts.fault) err.$fault = opts.fault;
  if (opts.retryAfterSeconds != null)
    err.$response = {
      headers: { "retry-after": String(opts.retryAfterSeconds) },
    };
  return err;
}

function namedError(name: string): Error {
  const err = new Error(`${name} boom`);
  err.name = name;
  return err;
}

function errnoError(code: string): Error {
  const err = new Error(`${code} boom`) as Error & { code?: string };
  err.code = code;
  return err;
}

describe("classifyLlmError — Bedrock (via AWS SdkError contract)", () => {
  it("maps $retryable.throttling → LlmRateLimitError", () => {
    const e = classifyLlmError(
      awsError({ httpStatusCode: 429, throttling: true }),
      { provider: "bedrock", model: "claude" }
    );
    expect(e).toBeInstanceOf(LlmRateLimitError);
    expect(e?.kind).toBe("rate_limited");
    expect(e?.provider).toBe("bedrock");
    expect(e?.model).toBe("claude");
    expect(e?.status).toBe(429);
  });

  it("maps a 5xx server fault → LlmUnavailableError", () => {
    expect(
      classifyLlmError(awsError({ httpStatusCode: 503, fault: "server" }), {
        provider: "bedrock",
      })
    ).toBeInstanceOf(LlmUnavailableError);
  });

  it("maps a 4xx client fault → LlmPermanentError", () => {
    expect(
      classifyLlmError(awsError({ httpStatusCode: 400, fault: "client" }), {
        provider: "bedrock",
      })
    ).toBeInstanceOf(LlmPermanentError);
  });

  it("falls back to $fault when there is no HTTP status", () => {
    expect(
      classifyLlmError(awsError({ fault: "server" }), { provider: "bedrock" })
    ).toBeInstanceOf(LlmUnavailableError);
    expect(
      classifyLlmError(awsError({ fault: "client" }), { provider: "bedrock" })
    ).toBeInstanceOf(LlmPermanentError);
  });

  it("parses Retry-After (seconds) from an AWS $response into ms", () => {
    const e = classifyLlmError(
      awsError({
        httpStatusCode: 429,
        throttling: true,
        retryAfterSeconds: 30,
      }),
      { provider: "bedrock" }
    );
    expect(e?.retryAfterMs).toBe(30_000);
  });
});

describe("classifyLlmError — standard abort / transport errors", () => {
  it("does NOT classify a bare AbortError (ambiguous with cancellation)", () => {
    // An abort could be a genuine timeout or a Temporal cancellation; the
    // classifier must not mask cancellation as a retryable timeout.
    // Disambiguation is left to the caller's activity layer.
    expect(
      classifyLlmError(namedError("AbortError"), { provider: "bedrock" })
    ).toBeUndefined();
  });

  it("maps an unambiguous TimeoutError → LlmTimeoutError", () => {
    expect(
      classifyLlmError(namedError("TimeoutError"), { provider: "bedrock" })
    ).toBeInstanceOf(LlmTimeoutError);
  });

  it("maps transient Node errno codes", () => {
    expect(
      classifyLlmError(errnoError("ETIMEDOUT"), { provider: "bedrock" })
    ).toBeInstanceOf(LlmTimeoutError);
    const reset = classifyLlmError(errnoError("ECONNRESET"), {
      provider: "bedrock",
    });
    expect(reset).toBeInstanceOf(LlmUnavailableError);
    expect(reset?.status).toBe("ECONNRESET");
  });
});

describe("classifyLlmError — pluggable classifiers", () => {
  const alwaysPermanent: LlmErrorClassifier = () => ({ kind: "permanent" });

  it("classifies via opts.classifiers and propagates status/retryAfterMs", () => {
    const custom: LlmErrorClassifier = (error) =>
      error instanceof Error && error.message === "overloaded"
        ? { kind: "rate_limited", status: 529, retryAfterMs: 2_000 }
        : undefined;
    const e = classifyLlmError(
      new Error("overloaded"),
      { provider: "anthropic", model: "claude-sonnet" },
      { classifiers: [custom] }
    );
    expect(e).toBeInstanceOf(LlmRateLimitError);
    expect(e?.provider).toBe("anthropic");
    expect(e?.status).toBe(529);
    expect(e?.retryAfterMs).toBe(2_000);
  });

  it("leaves an ApiError-shaped error unclassified without the genai classifier", () => {
    // The genai classifier is `instanceof`-anchored and lives in the
    // google-genai adapter; core alone must not duck-type-match it.
    const err = new Error(
      'got status: RESOURCE_EXHAUSTED. {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'
    ) as Error & { status?: string };
    err.name = "ApiError";
    err.status = "RESOURCE_EXHAUSTED";
    expect(classifyLlmError(err, { provider: "vertex" })).toBeUndefined();
  });

  it("runs the transport classifier before opts.classifiers", () => {
    const e = classifyLlmError(
      namedError("TimeoutError"),
      { provider: "bedrock" },
      { classifiers: [alwaysPermanent] }
    );
    expect(e).toBeInstanceOf(LlmTimeoutError);
  });

  it("runs opts.classifiers before the AWS structural classifier", () => {
    // AWS would classify this as unavailable; the custom classifier wins.
    const e = classifyLlmError(
      awsError({ fault: "server" }),
      { provider: "bedrock" },
      { classifiers: [alwaysPermanent] }
    );
    expect(e).toBeInstanceOf(LlmPermanentError);
  });
});

describe("classifyLlmError — contracts", () => {
  it("sets this.name to the subclass name (survives minification)", () => {
    const e = classifyLlmError(awsError({ throttling: true }), {
      provider: "bedrock",
    });
    expect(e?.name).toBe("LlmRateLimitError");
    expect(e).toBeInstanceOf(LlmError);
    expect(e).toBeInstanceOf(Error);
  });

  it("preserves the original error as the cause", () => {
    const original = awsError({ throttling: true });
    const e = classifyLlmError(original, { provider: "bedrock" });
    expect(e?.cause).toBe(original);
  });

  it("returns undefined for an unrecognised (non-transport) error", () => {
    expect(
      classifyLlmError(new TypeError("x is not a function"), {
        provider: "bedrock",
      })
    ).toBeUndefined();
  });

  it("is idempotent — an already-classified error passes through unchanged", () => {
    const first = classifyLlmError(awsError({ throttling: true }), {
      provider: "bedrock",
    });
    expect(first).toBeDefined();
    expect(classifyLlmError(first, { provider: "bedrock" })).toBe(first);
  });
});
