export interface RenderProvider {
  render(input: { projectId: string; timelineId: string; fps: number; width: number; height: number; durationMs?: number }): Promise<{ storageKey: string; provider: string; mimeType: string; durationMs?: number; width: number; height: number }>;
}
