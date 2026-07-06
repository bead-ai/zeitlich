import type { SdkError } from "@smithy/types";

/**
 * Shared classification of transient/permanent LLM provider failures into
 * typed subclasses of {@link LlmError}.
 *
 * Provider SDKs throw their own error shapes (the genai SDK's `ApiError`
 * covers 429/504/503; Bedrock surfaces `AbortError` and various AWS
 * exceptions) that Datadog Error Tracking lumps into a single issue and that
 * Temporal retries blindly. Two things make the normalised class name matter
 * downstream:
 *  - Datadog tags a span's error by `error.name`, so distinct subclass names
 *    give distinct Error Tracking issues instead of one lumped bucket.
 *  - Temporal's `ensureApplicationFailure` sets `ApplicationFailure.type` from
 *    `error.constructor?.name ?? error.name`, so a RetryPolicy's
 *    `nonRetryableErrorTypes` can match on the subclass name.
 *
 * Each subclass therefore sets `this.name` explicitly in its constructor —
 * minification rewrites `constructor.name`, but the assigned `name` survives.
 *
 * Classification is anchored to SDK types, not to drift-prone name strings:
 * Bedrock via the AWS SDK's typed error contract (`@smithy/types` `SdkError`:
 * `$retryable`, `$metadata.httpStatusCode`, `$fault`); Gemini via the genai
 * SDK's exported `ApiError` class — that classifier lives in
 * `zeitlich/adapters/thread/google-genai` (`genaiErrorClassifier`) because
 * `@google/genai` is an optional peer dependency that this module must not
 * import at runtime, and is composed in via `opts.classifiers` on
 * {@link classifyLlmError}. The only literals are gRPC's frozen status-code
 * names and the standard `AbortError` / Node errno names.
 *
 * This module only CLASSIFIES and normalises the error type. It deliberately
 * does NOT retry — retry/backoff is owned by Temporal's per-activity
 * RetryPolicy — and it has no side effects: consumers observe (metrics,
 * logging) at their catch sites and map {@link LlmErrorKind} into their own
 * error taxonomy.
 */

/** Known providers, kept open so consumers can pass their own identifiers. */
export type LlmProvider = "vertex" | "bedrock" | "anthropic" | (string & {});

export type LlmErrorKind =
  "rate_limited" | "timeout" | "unavailable" | "permanent";

export interface LlmErrorContext {
  provider: LlmProvider;
  model?: string;
  /** Provider status: gRPC status string (Vertex) or HTTP status code. */
  status?: string | number;
  /** Parsed `Retry-After`, in milliseconds, when the provider supplied one. */
  retryAfterMs?: number;
}

export abstract class LlmError extends Error {
  abstract readonly kind: LlmErrorKind;
  readonly provider: LlmProvider;
  readonly model?: string;
  readonly status?: string | number;
  readonly retryAfterMs?: number;
  /**
   * The original provider error. Set manually rather than via the ES2022
   * `Error(message, { cause })` option so we don't depend on ES2022 `Error`
   * lib typing; callers can walk this `.cause` chain to surface the
   * underlying message.
   */
  readonly cause?: unknown;

  constructor(
    message: string,
    ctx: LlmErrorContext,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.cause = options?.cause;
    this.provider = ctx.provider;
    this.model = ctx.model;
    this.status = ctx.status;
    this.retryAfterMs = ctx.retryAfterMs;
  }
}

/** 429 / RESOURCE_EXHAUSTED — provider throttling. Transient, retryable. */
export class LlmRateLimitError extends LlmError {
  readonly kind = "rate_limited" as const;
  constructor(
    message: string,
    ctx: LlmErrorContext,
    options?: { cause?: unknown }
  ) {
    super(message, ctx, options);
    this.name = "LlmRateLimitError";
  }
}

/** 504 / DEADLINE_EXCEEDED / genuine request timeout. Retryable. */
export class LlmTimeoutError extends LlmError {
  readonly kind = "timeout" as const;
  constructor(
    message: string,
    ctx: LlmErrorContext,
    options?: { cause?: unknown }
  ) {
    super(message, ctx, options);
    this.name = "LlmTimeoutError";
  }
}

/** 503 / 500 / UNAVAILABLE / INTERNAL — transient server-side. Retryable. */
export class LlmUnavailableError extends LlmError {
  readonly kind = "unavailable" as const;
  constructor(
    message: string,
    ctx: LlmErrorContext,
    options?: { cause?: unknown }
  ) {
    super(message, ctx, options);
    this.name = "LlmUnavailableError";
  }
}

/**
 * 400 / INVALID_ARGUMENT / permission / validation — a bad request that will
 * fail identically on retry. Register this class in a Temporal RetryPolicy's
 * `nonRetryableErrorTypes` so it fails fast instead of burning the retry
 * budget.
 */
export class LlmPermanentError extends LlmError {
  readonly kind = "permanent" as const;
  constructor(
    message: string,
    ctx: LlmErrorContext,
    options?: { cause?: unknown }
  ) {
    super(message, ctx, options);
    this.name = "LlmPermanentError";
  }
}

// ── classification ──────────────────────────────────────────────────────────

/** What a classifier reports about a recognised provider error. */
export interface LlmErrorClassification {
  kind: LlmErrorKind;
  status?: string | number;
  retryAfterMs?: number;
}

/**
 * A pluggable classifier for {@link classifyLlmError}. Return a classification
 * for errors you recognise, `undefined` otherwise. Use this to compose
 * SDK-anchored classifiers whose SDK is an optional dependency (e.g.
 * `genaiErrorClassifier` from `zeitlich/adapters/thread/google-genai`).
 */
export type LlmErrorClassifier = (
  error: unknown
) => LlmErrorClassification | undefined;

/**
 * gRPC canonical status → kind. Vertex/Gemini surface gRPC's frozen
 * status-code names (https://grpc.io/docs/guides/status-codes) as untyped
 * strings, so centralising them here gives a single source of truth instead
 * of literals scattered through a switch.
 */
export const GRPC_STATUS_KIND: Readonly<Record<string, LlmErrorKind>> = {
  RESOURCE_EXHAUSTED: "rate_limited",
  DEADLINE_EXCEEDED: "timeout",
  UNAVAILABLE: "unavailable",
  INTERNAL: "unavailable",
  UNKNOWN: "unavailable",
  INVALID_ARGUMENT: "permanent",
  FAILED_PRECONDITION: "permanent",
  PERMISSION_DENIED: "permanent",
  UNAUTHENTICATED: "permanent",
  NOT_FOUND: "permanent",
  OUT_OF_RANGE: "permanent",
  ALREADY_EXISTS: "permanent",
  UNIMPLEMENTED: "permanent",
};

/** Node transport errno codes that are transient (stable Node constants). */
const NODE_TRANSPORT_KIND: Readonly<Record<string, LlmErrorKind>> = {
  ETIMEDOUT: "timeout",
  ECONNRESET: "unavailable",
  ECONNREFUSED: "unavailable",
  EPIPE: "unavailable",
  ENOTFOUND: "unavailable",
  EAI_AGAIN: "unavailable",
};

export function kindFromHttpStatus(status: number): LlmErrorKind | undefined {
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "unavailable";
  if (status >= 400) return "permanent";
  return undefined;
}

/** Numeric HTTP code embedded in a provider message body, e.g. `{"code":429}`. */
export function httpCodeFromMessage(message: string): number | undefined {
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Unambiguous timeout / Node errno transport failures — apply to any provider.
 */
export const transportErrorClassifier: LlmErrorClassifier = (error) => {
  if (!(error instanceof Error)) return undefined;
  // Deliberately NOT matching `AbortError`: an abort is ambiguous — it can be a
  // genuine provider (httpOptions) timeout OR a Temporal activity cancellation /
  // worker shutdown. Classifying it as a retryable timeout here would mask
  // cancellation and cause cancelled work to be reported/retried as a provider
  // timeout. The abort signal that tells them apart lives in the caller's
  // activity layer, so that disambiguation is left to the caller and a bare
  // abort propagates unchanged. `TimeoutError` (AWS SDK request timeout,
  // `AbortSignal.timeout()`) is unambiguous and safe to classify.
  if (error.name === "TimeoutError") {
    return { kind: "timeout" };
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    const kind = NODE_TRANSPORT_KIND[code];
    if (kind) return { kind, status: code };
  }
  return undefined;
};

function retryAfterMsOf(sdk: Partial<SdkError>): number | undefined {
  const raw = sdk.$response?.headers?.["retry-after"];
  if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw) * 1000;
  return undefined;
}

/**
 * Bedrock — anchored to the AWS SDK's typed error contract (`@smithy/types`
 * `SdkError`): `$retryable.throttling`, `$metadata.httpStatusCode`, and
 * `$fault`. These are the SDK's own retry/fault signals, so classification
 * does not drift when individual exception class names change. The `SdkError`
 * import is type-only — `@smithy/types` is not a runtime dependency.
 */
export const awsErrorClassifier: LlmErrorClassifier = (error) => {
  if (typeof error !== "object" || error === null) return undefined;
  const sdk = error as Partial<SdkError>;
  const http = sdk.$metadata?.httpStatusCode;
  const retryAfterMs = retryAfterMsOf(sdk);

  if (sdk.$retryable?.throttling === true) {
    return { kind: "rate_limited", status: http, retryAfterMs };
  }
  if (http != null) {
    const kind = kindFromHttpStatus(http);
    if (kind) return { kind, status: http, retryAfterMs };
  }
  if (sdk.$fault === "server") {
    return { kind: "unavailable", status: http, retryAfterMs };
  }
  if (sdk.$fault === "client") {
    return { kind: "permanent", status: http, retryAfterMs };
  }
  return undefined;
};

function buildLlmError(
  kind: LlmErrorKind,
  message: string,
  ctx: LlmErrorContext,
  cause: unknown
): LlmError {
  switch (kind) {
    case "rate_limited":
      return new LlmRateLimitError(message, ctx, { cause });
    case "timeout":
      return new LlmTimeoutError(message, ctx, { cause });
    case "unavailable":
      return new LlmUnavailableError(message, ctx, { cause });
    case "permanent":
      return new LlmPermanentError(message, ctx, { cause });
  }
}

/**
 * Classify a thrown provider error into a typed {@link LlmError}.
 *
 * Classifiers run in order, first match wins:
 *  1. {@link transportErrorClassifier} — unambiguous `TimeoutError` / Node
 *     errno signals, checked first;
 *  2. `opts.classifiers`, in array order — SDK-anchored classifiers for
 *     optional dependencies (e.g. `genaiErrorClassifier` from
 *     `zeitlich/adapters/thread/google-genai`);
 *  3. {@link awsErrorClassifier} — structural (duck-types on `$`-prefixed
 *     `SdkError` fields rather than an `instanceof` anchor), so it runs last.
 *
 * Returns `undefined` when the error is not a recognised LLM transport failure
 * (e.g. a bug in the caller's own code) — callers should rethrow the original
 * so it surfaces under its real class rather than being mislabelled.
 */
export function classifyLlmError(
  error: unknown,
  ctx: { provider: LlmProvider; model?: string },
  opts?: { classifiers?: readonly LlmErrorClassifier[] }
): LlmError | undefined {
  if (error instanceof LlmError) return error;

  let classification = transportErrorClassifier(error);
  if (!classification) {
    for (const classifier of opts?.classifiers ?? []) {
      classification = classifier(error);
      if (classification) break;
    }
  }
  classification ??= awsErrorClassifier(error);
  if (!classification) return undefined;

  const message = error instanceof Error ? error.message : String(error);
  return buildLlmError(
    classification.kind,
    message,
    {
      provider: ctx.provider,
      model: ctx.model,
      status: classification.status,
      retryAfterMs: classification.retryAfterMs,
    },
    error
  );
}
