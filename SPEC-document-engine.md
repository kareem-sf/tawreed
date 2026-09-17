# Spec: document-engine

## Objective
Review and fix deterministic BOQ intelligence: spreadsheet/PDF/OCR ingestion, normalization, classification, memory rules, validation, and workbook generation. Users are quantity surveyors importing dynamic Excel layouts and searchable/scanned PDFs in English or Arabic. Success is no silent row loss, no mis-parsed totals, no misleading warnings, and every assignment traceable to source quantities.

## Tech Stack
- TypeScript ES2022 strict + `noUncheckedIndexedAccess`, Vitest, SheetJS `@e965/xlsx`, ExcelJS 4.4, pdfjs-dist 6.2, Tesseract.js 7 (browser OCR only)
- Contracts: `shared/types.ts` (`BoqItem`, `Classification`, `REVIEW_CONFIDENCE_THRESHOLD=0.55`)

## Commands
```sh
npm ci
npm run lint -- --no-warn-ignored
npm run typecheck
npm test -- tests/ingest.test.ts tests/normalize.test.ts tests/validate.test.ts tests/generate.test.ts tests/pdf-ingest.test.ts tests/classify.test.ts
npm run build
npm run eval
```

## Project Structure
```
engine/                  → UI-independent engine (this module)
  ingest/{xlsx,headers,columns,cells,rows,extract,constants}.ts → header/column/block/extract pipeline
  classify/{heuristic,llm,agreement,taxonomy}.ts → offline + dynamic classification
  normalize.ts, item-total.ts, validate.ts, generate.ts → normalize/validate/generate
  pdf-ingest.ts, spreadsheet-reader.ts, inspect-document.ts → routing + tolerant readers
  document-intelligence.ts, document-agent.ts, agent-workflow.ts → project/comments/memory
shared/types.ts          → cross-layer contracts (authoritative)
tests/*.test.ts + tests/eval/corpus-synthetic → regression + grouping-quality floors
```

## Code Style
Preserve existing pure-function, bilingual-message style. Example (correct pattern to follow):
```ts
// Validation rule engine — errors block generation, warnings don't.
export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
```
Conventions: `normalizeText` for all matching keys; `BoqItem.qty/rate/total` nullable (0 is an error, null is missing); bilingual `messageEn/messageAr` on every issue/warning; never throw for recoverable row skips — warn with counts.

## Testing Strategy
- Framework: Vitest + existing `tests/pipeline-harness.ts` (`bytes→inspect→classify→validate`).
- Location: `tests/*.test.ts` colocated by concern; eval floors in `tests/eval/eval.test.ts`.
- Coverage: every fix gets a regression test asserting before/after; grouping-quality floors must not drop (pairwise precision/recall + purity).
- Levels: unit (parseNumber, header scoring, outlier), integration (ingest→validate→generate round-trip, PDF+OCR seams), eval (synthetic corpus).

## Boundaries
- Always: cite `file:line` evidence; distinguish CONFIRMED vs SUSPECT; preserve `REVIEW_CONFIDENCE_THRESHOLD`, `itemTotal`, bilingual messages; add regression tests; report unverified areas.
- Ask first: new dependencies, changing taxonomy version, changing eval floors, external AI calls.
- Never: weaken checks to pass; silently drop rows; treat LLM output as commercial fact; commit without authorization; expose BOQ content.

## Success Criteria
- [ ] C1 fixed: `ingest/xlsx.ts:104` warning no longer claims exclusion when `extract.ts:44-47` keeps rows as `other` (message corrected + test).
- [ ] C2 resolved (decision in Open Questions): `generate.ts:15` `locale` honored or removed, with test.
- [ ] C3 fixed: `validate.ts:134` `RATE_OUTLIER` fires both sides (|z|>2.5) or messages explicitly say high-only; low-typo test added.
- [ ] C4 fixed: Node scanned-PDF OCR skip (`pdf-ingest.ts:334`) emits actionable warning; test asserts warning.
- [ ] C5 fixed: `agent-workflow.ts:35-46` memory conflicts detected/surfaced, `applied` only on real change, `source:'user'` never clobbered.
- [ ] C6 fixed: `extract.ts:31-32` header-word + qty rows preserved (parity with summary path) + test.
- [ ] C7 fixed: `document-intelligence.ts:63-66` `normalizedKey` matches `normalize.ts:83-86` (`ٱ/ئ/ؤ` handling) + test.
- [ ] C8 fixed: tolerant reader (`spreadsheet-reader.ts:94`) preserves blank-row provenance or documents shift + test on `row` numbers.
- [ ] C9 fixed: `classify/llm.ts:285-289` duplicate `itemId` rejected/flagged, not last-wins + test.
- [ ] C10 fixed: `document-agent.ts:93` language input includes comments (parity with `xlsx.ts:140-143`) + test.
- [ ] C11 fixed: `normalize.ts:34-35` `parseNumber('1.250,50')===1250.5` + EU tests.
- [ ] `npm test`, `lint`, `typecheck` green; eval floors not regressed.

## Open Questions (per-fix decisions needed)
1. C2 `locale`: honor `locale:'ar'` as RTL override, or delete dead field? Default proposal: honor (explicit param wins over content sniffing).
2. Blocking enforcement: should `buildWorkbooks()` itself refuse when `hasBlockingErrors` true (S9), or keep enforcement in UI hook only? Default: add opt-in guard, UI keeps current flow.
3. `QTY_FMT=#,##0.00` forcing `5.00`: keep or use `#,##0.##`? Needs product call.
4. `cellNumber('12 m3')` inline units: accept (strip suffix) or keep rejecting? Needs fixture decision.
5. Weak single-hit fallback (0.63 > 0.55) escaping review: raise threshold or flag `fallback` source explicitly?

## Assumptions
1. Browser OCR remains unavailable in Node/Electron — warning, not engine OCR, is the fix.
2. `ml`→`m` (linear meter) and `باب`→`nr` mappings are intentional for BOQ domain.
3. `WP-99` fallback + `heuristic` exclusion from `LOW_CONFIDENCE` are intentional.

## Decisions recorded (implementation)
- C2 `locale`: honored — explicit `locale:'ar'` now forces RTL in cover/mini-cover/master (`generate.ts`).
- Blocking enforcement (S9): left in UI hook only; no engine guard added (minimal change).
- `QTY_FMT`, inline-unit qty, weak-fallback threshold: unchanged, left as open product questions.
- Pre-existing uncommitted `isSummaryDescription(text, hasItemEvidence)` in `engine/ingest/rows.ts` preserved; C6 header fix mirrors its convention.

## Residual round (2026-09-17, all fixed)
- Memory now records only `source:'user'` corrections (F1).
- Weak fallback capped below review threshold (F2); inline spaced units parsed with glued-spec guard (F3).
- Arithmetic role-tie withholds confidence bonus; ties need strict majority in agreement signal (F4/F5).
- Single-row headerless tables ingest; qty format `#,##0.##`; annotation attach extracted as tested seam (scale caveat documented).
- Windows-1256 text goes through explicit table decode — SheetJS ignores `codepage` for array input (found via failing test, fixed, regression-pinned).
