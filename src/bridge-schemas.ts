// Runtime shapes for host responses that are not ts-rs generated.
//
// Commands returning `Vec<serde_json::Value>` (list_runs) carry no compile-time contract,
// so `invoke<RunRecord[]>` was an unchecked assertion — a corrupt or partially-written row
// would reach the history drawer looking exactly like a valid one. These schemas turn that
// assertion into a check. Anything ts-rs already generates belongs in ./bridge-types
// instead; do not restate a generated type here.
import { z } from 'zod';

const agentEventSchema = z.object({
  at: z.string(),
  stage: z.string(),
  status: z.string(),
  detail: z.string(),
});

export const runRecordSchema = z.object({
  id: z.number(),
  startedAt: z.string(),
  fileName: z.string(),
  fileHash: z.string(),
  itemCount: z.number(),
  packageCount: z.number(),
  errorCount: z.number(),
  warningCount: z.number(),
  outputFile: z.string(),
  durationMs: z.number(),
  llmUsed: z.boolean(),
  projectName: z.string().optional(),
  revision: z.number().optional(),
  packageFolder: z.string().optional(),
  sourceKind: z.enum(['xlsx', 'xls', 'csv', 'ods', 'pdf']).optional(),
  ocrUsed: z.boolean().optional(),
  provider: z.enum(['offline', 'codex', 'anthropic', 'compatible', 'gemini', 'grok']).optional(),
  model: z.string().optional(),
  trace: z.array(agentEventSchema).optional(),
  memoryApplied: z.number().optional(),
});

export const runClassificationSchema = z.object({
  runId: z.number(),
  itemId: z.number(),
  description: z.string(),
  packageCode: z.string(),
  source: z.enum(['heuristic', 'llm', 'fallback', 'memory', 'user']),
  confidence: z.number(),
});
