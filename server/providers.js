export class ProviderError extends Error {
  constructor(message, { retryable = false, code = 'PROVIDER_ERROR' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
    this.code = code;
  }
}

export class ResearchProvider {
  async search(_query, _options = {}) {
    throw new ProviderError('Research provider not configured');
  }
}

export class LLMProvider {
  async generateScript(_input) {
    throw new ProviderError('LLM provider not configured');
  }
  async generateScenes(_input) {
    throw new ProviderError('LLM provider not configured');
  }
}

export class VoiceProvider {
  async synthesize(_input) {
    throw new ProviderError('Voice provider not configured');
  }
}

export class TranscriptionProvider {
  async transcribe(_input) {
    throw new ProviderError('Transcription provider not configured');
  }
}

export class ImageProvider {
  async generate(_input) {
    throw new ProviderError('Image provider not configured');
  }
}

export class StorageProvider {
  async put(_input) {
    throw new ProviderError('Storage provider not configured');
  }
  async signedUrl(_objectKey, _expiresSeconds = 900) {
    throw new ProviderError('Storage provider not configured');
  }
}

export class RenderProvider {
  async render(_input) {
    throw new ProviderError('Render provider not configured');
  }
}

export function providerRegistry(overrides = {}) {
  return {
    research: overrides.research || new ResearchProvider(),
    llm: overrides.llm || new LLMProvider(),
    voice: overrides.voice || new VoiceProvider(),
    transcription: overrides.transcription || new TranscriptionProvider(),
    image: overrides.image || new ImageProvider(),
    storage: overrides.storage || new StorageProvider(),
    render: overrides.render || new RenderProvider()
  };
}
