import { z } from 'zod';
import type { ConnectionSummary } from '../../../shared/platform';
import { connectionSummarySchema } from '../../../shared/platform';

export type { ConnectionSummary };

export type ConnectionActionMode = 'chatgpt' | 'api-key';

export type WorkingSlot = 'chatgpt-login' | 'api-key-save' | 'health-check' | 'connection-remove';

/** Strict parse of renderer-facing summaries; a secret field fails loudly. */
export function parseConnectionSummaries(value: unknown): ConnectionSummary[] {
  return z.array(connectionSummarySchema).parse(value);
}

export const agentHealthSchema = z
  .object({
    status: z.literal('ok'),
    protocolVersion: z.literal(1),
  })
  .strict();

export function isAgentHealthy(payload: unknown): boolean {
  return agentHealthSchema.safeParse(payload).success;
}
