export interface PublishingProvider {
  upload(input: { title: string; description?: string; tags?: string[]; storageKey: string; visibility?: string; scheduledAt?: Date }): Promise<{ externalVideoId: string; status: string; responseData?: unknown }>;
}
