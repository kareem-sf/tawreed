// Shared domain types — the single contract between engine, UI, and Rust host.

export type Unit =
  | 'm' | 'm2' | 'm3' | 'kg' | 'ton' | 'nr' | 'ls' | 'pt' | 'TR' | 'hr' | 'day' | 'other';

export type SourceKind = 'xlsx' | 'xls' | 'csv' | 'ods' | 'pdf';
export type DocumentLanguage = 'en' | 'ar' | 'mixed' | 'unknown';

export interface BoqItem {
  id: number;
  code: string;
  description: string;
  unit: Unit;
  unitLabel?: string;
  qty: number;
  rate: number | null;
  total: number | null;
  rateDerived?: boolean; // rate was computed as total/qty by ingest, not read from the source
  totalDerived?: boolean; // total was computed as qty*rate by ingest, not read from the source
  row: number; // source row in the original sheet (for traceability, never displayed)
  page?: number;
  comments?: string[];
}

export type ClassifySource = 'heuristic' | 'llm' | 'fallback' | 'memory' | 'user';
export type AiProvider = 'offline' | 'codex' | 'anthropic' | 'compatible' | 'gemini' | 'grok';

export type AgentStage =
  | 'inspect'
  | 'consent'
  | 'document-analysis'
  | 'classify'
  | 'memory'
  | 'validate'
  | 'human-review'
  | 'generate'
  | 'publish';

export interface AgentEvent {
  at: string;
  stage: AgentStage;
  status: 'started' | 'completed' | 'fallback' | 'cancelled' | 'failed';
  detail: string;
}

export interface Classification {
  itemId: number;
  packageCode: string;
  packageNameEn?: string;
  packageNameAr?: string;
  confidence: number; // 0..1
  source: ClassifySource;
  /**
   * The offline heuristic grouped this item with items the model put elsewhere. An
   * independent second opinion, unlike `confidence`, which the model reports about itself.
   * Only ever set on the LLM path; absent means agreement or no heuristic opinion.
   */
  heuristicDisagreement?: boolean;
}

export interface WorkPackageDef {
  code: string;
  nameEn: string;
  nameAr: string;
  keywords: string[]; // lowercase, pre-normalized
  negativeKeywords?: string[];
  unitSignals?: Unit[];
  priority?: number;
}

export type PackageDefinition = WorkPackageDef;

export interface ClassificationPlan {
  catalog: PackageDefinition[];
  classifications: Classification[];
}

export interface WorkPackage {
  code: string;
  nameEn: string;
  nameAr: string;
  itemIds: number[];
  totalCost: number;
  itemCount: number;
}

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  messageEn: string;
  messageAr: string;
  itemIds: number[];
}

export interface InspectionResult {
  fileName: string;
  sourceKind: SourceKind;
  projectName: string;
  projectNameConfidence: number;
  projectNameCandidates: string[];
  language: DocumentLanguage;
  pageCount: number;
  ocrPages: number;
  annotationCount: number;
  rejectedCount: number;
  sheetName: string;
  headerRow: number;
  mapping: ColumnMapping;
  items: BoqItem[];
  warnings: string[];
}

export interface ColumnMapping {
  code: number | null;
  description: number;
  unit: number | null;
  qty: number | null;
  rate: number | null;
  total: number | null;
  remarks: number | null;
  confidence: number; // 0..1
}

export interface PipelineResult {
  inspection: InspectionResult;
  classifications: Classification[];
  packages: WorkPackage[];
  issues: ValidationIssue[];
  unclassifiedCount: number;
}

export interface RunRecord {
  id?: number;
  startedAt: string;
  fileName: string;
  fileHash: string;
  itemCount: number;
  packageCount: number;
  errorCount: number;
  warningCount: number;
  outputFile: string;
  durationMs: number;
  llmUsed: boolean;
  projectName?: string;
  revision?: number;
  packageFolder?: string;
  sourceKind?: SourceKind;
  ocrUsed?: boolean;
  provider?: AiProvider;
  model?: string;
  trace?: AgentEvent[];
  memoryApplied?: number;
  /**
   * Per-item provenance for this run. Persisted so a human's corrections during review
   * survive publication — they are the only labelled examples of what the classifier got
   * wrong, and the evaluation corpus is built from them.
   */
  classifications?: RunClassificationRecord[];
}

export interface RunClassificationRecord {
  itemId: number;
  description: string;
  packageCode: string;
  source: ClassifySource;
  confidence: number;
}

/**
 * Confidence at or above which a classification is trusted without being flagged for
 * human verification. One constant so the review UI and the validator cannot drift into
 * flagging different sets of items — they previously disagreed (0.55 vs 0.5), leaving a
 * band of items warned about in one place and silently accepted in the other.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.55;
