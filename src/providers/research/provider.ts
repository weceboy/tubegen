export interface ResearchProvider {
  search(query: string): Promise<Array<{ url: string; title: string; domain: string }>>;
  retrieve(url: string): Promise<{ url: string; title: string; excerpt: string }>;
  analyze(input: { topic: string; sources: unknown[] }): Promise<{ summary: string; recommendedAngle: string; keywords: string[]; facts: string[] }>;
}
