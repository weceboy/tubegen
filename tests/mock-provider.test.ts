import { describe, expect, it } from "vitest";
import { MockLLMProvider, MockResearchProvider } from "../src/providers/mock/mock-providers.js";

describe("mock providers", () => {
  it("returns deterministic development responses", async () => {
    const provider = new MockLLMProvider();
    const result = await provider.generateText({ prompt: "Write a short script" });
    expect(result.model).toBe("mock-llm-v1");
    expect(result.text).toContain("Mock generation");
  });

  it("does not invent external research sources", async () => {
    const provider = new MockResearchProvider();
    const sources = await provider.search("test topic");
    expect(sources).toEqual([]);
  });
});
