export type Provider = 'codex' | 'anthropic' | 'compatible' | 'gemini' | 'grok';

export interface CompatibleSettings {
  baseUrl: string;
  model: string;
}

export interface ProviderMessage {
  color: string;
  text: string;
}
