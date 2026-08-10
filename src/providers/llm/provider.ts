export interface LLMProvider {
  generateText(input: { prompt: string; language?: string }): Promise<{ text: string; model: string }>;
  generateStructuredOutput<T>(input: { prompt: string; schema: unknown }): Promise<{ output: T; model: string }>;
}
