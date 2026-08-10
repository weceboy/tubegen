export interface VoiceProvider {
  synthesize(input: { text: string; language?: string; voiceId?: string }): Promise<{ audioStorageKey: string; durationMs: number; transcript: string; provider: string; model?: string }>;
}
