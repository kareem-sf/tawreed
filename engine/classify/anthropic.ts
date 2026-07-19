// Anthropic classifier — builds prompts, validates responses, repairs on malformed output.
// The actual HTTP call is injected as `transport` (Rust proxy in production, stub in tests).
import { z } from 'zod';
import type { BoqItem, Classification } from '../../shared/types';
import { TAXONOMY } from './taxonomy';
import { heuristicFallback } from './heuristic';

export type LlmTransport = (request: AnthropicRequest) => Promise<string>;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const responseSchema = z.object({
  classifications: z.array(
    z.object({
      itemId: z.number(),
      packageCode: z.string(),
      packageNameEn: z.string().optional(),
      packageNameAr: z.string().optional(),
      confidence: z.number().min(0).max(1).default(0.8),
    })
  ),
});

const SYSTEM = `You are a senior quantity surveyor classifying construction BOQ line items into procurement work-packages.
Return ONLY valid JSON matching: {"classifications":[{"itemId":<number>,"packageCode":"<code>","packageNameEn":"<English name>","packageNameAr":"<Arabic name>","confidence":<0..1>}]}
Classify every itemId you are given. Prefer the standard taxonomy when it fits. When the BOQ contains a legitimate trade or procurement package outside that taxonomy, create a specific code shaped WP-AI-SHORT-NAME and provide both package names. Use WP-99 only when the line itself is unintelligible.`;

/** Flatten a chat-style request into a single prompt string (for CLI providers like Codex). */
export function requestToPrompt(req: AnthropicRequest): string {
  const parts = [req.system, ''];
  for (const m of req.messages) {
    parts.push(m.role === 'user' ? m.content : `ASSISTANT: ${m.content}`);
  }
  parts.push('', 'REMINDER: Respond with the JSON object only. No prose, no markdown fences, no tool use.');
  return parts.join('\n\n');
}

const BATCH_SIZE = 100;
export const DEFAULT_MODEL = 'claude-sonnet-4-5';

function taxonomyBlock(): string {
  return 'STANDARD PACKAGES (preferred, not restrictive):\n' +
    TAXONOMY.map((p) => `${p.code}: ${p.nameEn} / ${p.nameAr}`).join('\n') +
    '\nWP-99: Unclassified / غير مصنف';
}

function buildRequest(items: BoqItem[], model: string): AnthropicRequest {
  const lines = items
    .map((i) => `${i.id} | ${i.code} | ${i.description} | unit:${i.unit} | qty:${i.qty}`)
    .join('\n');
  return {
    model,
    max_tokens: 4096,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${taxonomyBlock()}\n\nITEMS (id | code | description | unit | qty):\n${lines}\n\nCreate a new WP-AI-* package only when no standard package is accurate. Keep identical trades in the same package. Return the JSON object only.`,
      },
    ],
  };
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in LLM response');
  return JSON.parse(text.slice(start, end + 1));
}

async function classifyBatch(items: BoqItem[], transport: LlmTransport, model: string): Promise<Classification[]> {
  const request = buildRequest(items, model);
  let parsed: z.infer<typeof responseSchema> | null = null;
  try {
    parsed = responseSchema.parse(extractJson(await transport(request)));
  } catch {
    // One repair attempt: show the failure, ask for corrected JSON only.
    try {
      const repair: AnthropicRequest = {
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: '(previous response was malformed)' },
          { role: 'user', content: 'Your previous response was not valid JSON per the schema. Return ONLY the corrected JSON object, no prose.' },
        ],
      };
      parsed = responseSchema.parse(extractJson(await transport(repair)));
    } catch {
      parsed = null;
    }
  }
  const validCodes = new Set([...TAXONOMY.map((p) => p.code), 'WP-99']);
  const byId = new Map<number, Classification>();
  if (parsed) {
    for (const c of parsed.classifications) {
      const code = c.packageCode.trim().toUpperCase();
      const dynamic = /^WP-AI-[A-Z0-9][A-Z0-9-]{0,30}$/.test(code);
      if (!validCodes.has(code) && !dynamic) continue;
      if (dynamic && !c.packageNameEn?.trim()) continue;
      byId.set(c.itemId, {
        itemId: c.itemId,
        packageCode: code,
        packageNameEn: c.packageNameEn?.trim(),
        packageNameAr: c.packageNameAr?.trim(),
        confidence: c.confidence,
        source: 'llm',
      });
    }
  }
  // Any item the LLM missed (or if the call failed entirely) → deterministic fallback.
  return items.map((i) => byId.get(i.id) ?? heuristicFallback(i));
}

export async function llmClassify(
  items: BoqItem[],
  transport: LlmTransport,
  onBatch?: (done: number, total: number) => void,
  model: string = DEFAULT_MODEL
): Promise<Classification[]> {
  const out: Classification[] = [];
  const totalBatches = Math.ceil(items.length / BATCH_SIZE);
  for (let b = 0; b < totalBatches; b++) {
    const batch = items.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    out.push(...(await classifyBatch(batch, transport, model)));
    onBatch?.(b + 1, totalBatches);
  }
  return out;
}
