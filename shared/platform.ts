import { z } from 'zod';

export const providerIdSchema = z.enum(['codex', 'claude', 'gemini', 'compatible']);
export type ProviderId = z.infer<typeof providerIdSchema>;

export const runtimePhaseSchema = z.enum([
  'checking', 'downloading', 'verifying', 'activating', 'ready', 'error',
]);
export const runtimeBootstrapStatusSchema = z.object({
  phase: runtimePhaseSchema,
  progress: z.number().min(0).max(100).nullable(),
  component: z.string().min(1).max(80).nullable(),
  version: z.string().min(1).max(40).nullable(),
  errorCode: z.string().min(1).max(80).nullable(),
  recoverable: z.boolean(),
}).strict();
export type RuntimeBootstrapStatus = z.infer<typeof runtimeBootstrapStatusSchema>;

export const connectionSummarySchema = z.object({
  provider: providerIdSchema,
  configured: z.boolean(),
  authenticated: z.boolean(),
  authKind: z.enum(['api_key', 'provider_file']).nullable(),
  displayName: z.string().min(1).max(80),
}).strict();
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  status: z.enum(['active', 'archived', 'needs_attention']),
  updatedAtMs: z.number().int().nonnegative(),
}).strict();
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
