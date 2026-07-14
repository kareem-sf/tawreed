import { z } from "zod";

export const engineMessageSchema = z.object({
  version: z.literal(1),
  kind: z.string().min(1),
  payload: z.unknown(),
  requestId: z.string().optional(),
});

export const responsePayloadSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export const progressSchema = z.object({
  phase: z.enum([
    "empty",
    "ready",
    "inspecting",
    "structuring",
    "classifying",
    "validating",
    "approval",
    "exporting",
    "complete",
    "error",
  ]),
  message: z.string(),
  current: z
    .number()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  total: z
    .number()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
  elapsed_seconds: z.number().default(0),
  cancellable: z.boolean().default(false),
});

export const approvalRequestSchema = z.object({
  token: z.string().min(1),
  summary: z.object({
    source_filename: z.string(),
    total_items: z.number().int().nonnegative(),
    package_counts: z.array(
      z.tuple([z.string(), z.number().int().nonnegative()]),
    ),
    warnings: z.array(z.string()),
    provider: z.string(),
    model: z.string(),
  }),
});

export const settingsSchema = z.object({
  provider: z.enum([
    "Codex",
    "OpenAI",
    "Claude",
    "Google",
    "OpenAI Compatible",
  ]),
  model: z.string(),
  model_id: z.string().optional(),
  base_url: z.string().default(""),
  language: z.enum(["en", "ar"]).default("en"),
  theme: z.enum(["system", "dark", "light"]).default("system"),
  has_api_key: z.boolean().default(false),
});

export const historySchema = z.array(
  z.object({
    id: z.number().int(),
    timestamp: z.string(),
    project_name: z.string(),
    packages_count: z.number().int(),
    output_path: z.string(),
  }),
);

export const modelCatalogSchema = z.object({
  provider: z.string(),
  models: z.array(z.string()),
  source: z.enum(["live", "curated", "manual", "error"]),
  error: z.string().nullable(),
  default_model: z.string().nullable(),
});
