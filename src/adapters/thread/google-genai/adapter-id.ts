/**
 * Public adapter identity for the Google GenAI thread adapter.
 *
 * This value is wire format — it appears as the prefix for Temporal
 * activity names (e.g. `googleGenAICodingAgentInitializeThread`) and
 * must never change, since renaming it would orphan existing persisted
 * threads and break in-flight workflows.
 *
 * Re-exported from `zeitlich/adapters/thread/google-genai` so downstream
 * consumers can use the exact same literal the adapter uses internally,
 * typed as the narrow string literal `"googleGenAI"`.
 */
export const ADAPTER_ID = "googleGenAI" as const;

/** Narrow string-literal type for {@link ADAPTER_ID}. */
export type AdapterId = typeof ADAPTER_ID;
