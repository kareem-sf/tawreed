export interface LlmProgress {
  phase: 'heuristic' | 'llm';
  done: number;
  total: number;
  remainingItems: number;
}
