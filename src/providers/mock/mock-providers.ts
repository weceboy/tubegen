import type { LLMProvider } from "../llm/provider.js";
import type { ResearchProvider } from "../research/provider.js";

export class MockLLMProvider implements LLMProvider {
  async generateText(input: { prompt: string; language?: string }) {
    return {
      text: `Mock generation for: ${input.prompt.slice(0, 120)}`,
      model: "mock-llm-v1",
    };
  }

  async generateStructuredOutput<T>(input: { prompt: string; schema: unknown }) {
    void input.schema;
    return { output: { prompt: input.prompt, mock: true } as T, model: "mock-llm-v1" };
  }
}

export class MockResearchProvider implements ResearchProvider {
  async search(query: string) {
    return [{ url: `https://example.invalid/research/${encodeURIComponent(query)}`, title: `Mock source for ${query}`, domain: "example.invalid" }];
  }

  async retrieve(url: string) {
    return { url, title: "Mock source", excerpt: "Synthetic development-only research source." };
  }

  async analyze(input: { topic: string; sources: unknown[] }) {
    return {
      summary: `Mock research summary for ${input.topic}.`,
      recommendedAngle: `A practical angle on ${input.topic}.`,
      keywords: [input.topic],
      facts: [],
    };
  }
}
