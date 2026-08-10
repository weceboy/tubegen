export interface StorageProvider {
  put(input: { key: string; body: Uint8Array | Buffer; contentType: string }): Promise<{ key: string; checksum?: string }>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
