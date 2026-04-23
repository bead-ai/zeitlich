import { describe, it, expect, expectTypeOf } from "vitest";
import { ADAPTER_ID as LANGCHAIN } from "./langchain/adapter-id";
import { ADAPTER_ID as GOOGLE_GENAI } from "./google-genai/adapter-id";
import { ADAPTER_ID as ANTHROPIC } from "./anthropic/adapter-id";
import {
  LANGCHAIN_ADAPTER_ID,
  GOOGLE_GENAI_ADAPTER_ID,
  ANTHROPIC_ADAPTER_ID,
  type ThreadAdapterId,
} from "./index";

describe("thread adapter identity", () => {
  it("langchain ADAPTER_ID is the wire-format string", () => {
    expect(LANGCHAIN).toBe("langChain");
    expect(LANGCHAIN_ADAPTER_ID).toBe("langChain");
  });

  it("google-genai ADAPTER_ID is the wire-format string", () => {
    expect(GOOGLE_GENAI).toBe("googleGenAI");
    expect(GOOGLE_GENAI_ADAPTER_ID).toBe("googleGenAI");
  });

  it("anthropic ADAPTER_ID is the wire-format string", () => {
    expect(ANTHROPIC).toBe("anthropic");
    expect(ANTHROPIC_ADAPTER_ID).toBe("anthropic");
  });

  it("ADAPTER_ID values narrow to string literals, not `string`", () => {
    expectTypeOf(LANGCHAIN).toEqualTypeOf<"langChain">();
    expectTypeOf(GOOGLE_GENAI).toEqualTypeOf<"googleGenAI">();
    expectTypeOf(ANTHROPIC).toEqualTypeOf<"anthropic">();
  });

  it("ThreadAdapterId is the discriminated union of every built-in id", () => {
    const allow = (_id: ThreadAdapterId): void => undefined;
    allow(LANGCHAIN);
    allow(GOOGLE_GENAI);
    allow(ANTHROPIC);
    // @ts-expect-error — arbitrary strings aren't members of the union
    allow("someOtherAdapter");
  });
});
