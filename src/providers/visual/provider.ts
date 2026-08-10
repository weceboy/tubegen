export interface VisualProvider {
  generateImage(input: { prompt: string; negativePrompt?: string; width?: number; height?: number }): Promise<{ storageKey: string; provider: string; model?: string; providerAssetId?: string; mimeType: string; width: number; height: number }>;
  generateVideo?(input: { prompt: string; durationMs: number }): Promise<{ storageKey: string; provider: string; model?: string; providerAssetId?: string; mimeType: string; durationMs: number }>;
}
