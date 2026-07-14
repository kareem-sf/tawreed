export const PROTOCOL_VERSION = 1 as const;

export type RunPhase =
  | "empty"
  | "ready"
  | "inspecting"
  | "structuring"
  | "classifying"
  | "validating"
  | "approval"
  | "exporting"
  | "complete"
  | "error";

export interface SelectedWorkbook {
  path: string;
  name: string;
  size?: number;
}

export interface RunProgress {
  phase: RunPhase;
  message: string;
  current: number | null;
  total: number | null;
  elapsed_seconds: number;
  cancellable: boolean;
}

export interface ApprovalSummary {
  source_filename: string;
  total_items: number;
  package_counts: Array<[string, number]>;
  warnings: string[];
  provider: string;
  model: string;
}

export interface ApprovalRequest {
  token: string;
  summary: ApprovalSummary;
}

export interface HistoryEntry {
  id: number;
  timestamp: string;
  project_name: string;
  packages_count: number;
  output_path: string;
}

export type Provider =
  "Codex" | "OpenAI" | "Claude" | "Google" | "OpenAI Compatible";

export interface AppSettings {
  provider: Provider;
  model: string;
  model_id?: string;
  base_url: string;
  language: "en" | "ar";
  theme: "system" | "dark" | "light";
  has_api_key: boolean;
}

export interface ModelCatalog {
  provider: string;
  models: string[];
  source: "live" | "curated" | "manual" | "error";
  error: string | null;
  default_model: string | null;
}

export interface EngineMessage {
  version: typeof PROTOCOL_VERSION;
  kind: string;
  payload: unknown;
  requestId?: string;
}

export interface EngineCommand {
  version: typeof PROTOCOL_VERSION;
  type: string;
  requestId: string;
  payload: Record<string, unknown>;
}

export type EngineListener = (message: EngineMessage) => void;
