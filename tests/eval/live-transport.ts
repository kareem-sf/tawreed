// Dev-only transports for the live evaluation run.
//
// Production traffic goes through Rust (src-tauri/src/commands/ai/**) so an API key never
// enters the webview. The eval script runs in plain Node with no Tauri host and no
// keychain, so it talks to the providers directly using keys from the environment. This
// file is test-only and is never bundled — do not import it from engine/ or src/.
import type { LlmRequest, LlmTransport } from '../../engine/classify/llm';

export type EvalProvider = 'anthropic' | 'gemini' | 'grok';

const BASE: Record<Exclude<EvalProvider, 'anthropic'>, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  grok: 'https://api.x.ai/v1/chat/completions',
};

const KEY_ENV: Record<EvalProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grok: 'GROK_API_KEY',
};

export function apiKeyFor(provider: EvalProvider): string | undefined {
  return process.env[KEY_ENV[provider]]?.trim() || undefined;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  return response.json();
}

function anthropicTransport(key: string): LlmTransport {
  return async (request: LlmRequest): Promise<string> => {
    const json = await post('https://api.anthropic.com/v1/messages', {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }, {
      model: request.model,
      max_tokens: request.max_tokens,
      temperature: 0,
      system: request.system,
      messages: request.messages,
    }) as { content?: Array<{ type?: string; text?: string }> };
    return (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  };
}

function compatTransport(url: string, key: string, extra: Record<string, unknown>): LlmTransport {
  return async (request: LlmRequest): Promise<string> => {
    const json = await post(url, { authorization: `Bearer ${key}` }, {
      model: request.model,
      max_tokens: request.max_tokens,
      temperature: 0,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      ...extra,
    }) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? '';
  };
}

export function makeEvalTransport(provider: EvalProvider, key: string): LlmTransport {
  if (provider === 'anthropic') return anthropicTransport(key);
  // Gemini 3.x spends its whole budget thinking and returns empty content otherwise —
  // this mirrors the workaround in src-tauri/src/commands/ai/openai_compat.rs.
  const extra = provider === 'gemini' ? { reasoning_effort: 'low' } : {};
  return compatTransport(BASE[provider], key, extra);
}
