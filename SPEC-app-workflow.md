# Spec: app-workflow

## Objective
Review and fix React workflow: state integrity, cancellation/retry, consent, review, settings, history, accessibility, and worker/host integration. Users are English/Arabic (RTL) reviewers who must give valid AI consent, never lose edits, and always get feedback on clicks. Success is no illegal state resurrection, no worker leaks, no privacy mislabeling, and no silent failures.

## Tech Stack
- React 19, shadcn/Radix + Tailwind 4, `react-window`, `i18next` (en/ar parity), Web Worker (`src/boq-worker.ts` + `src/workers/boq.worker.ts`)

## Commands
```sh
npm ci
npm run lint
npm run typecheck
npm test -- tests/workflow-reducer.test.ts tests/workflow-errors.test.ts tests/workflow-degradation.dom.test.ts tests/review-panel.test.tsx tests/accessibility-ui.test.ts tests/bridge.dom.test.ts
npm run build
npx playwright test
```

## Project Structure
```
src/App.tsx, src/main.tsx, src/i18n.ts, src/i18n/resources/{en,ar}.ts → shell + dictionaries
src/app/{types,useAppConfiguration,AppDialogs} → boot, onboarding/update state, dialogs
src/features/workflow/{types,reducer,useBoqWorkflow,components/WorkflowWorkspace,components/FileUpload} → pipeline orchestration
src/features/review/{ReviewPanel,ReviewItemsDialog,ReviewItemRow,PackageSummaryList} → human review
src/features/settings/{SettingsModal,ProviderSetup,useProviderSetup,useNamedProviderSetup} → providers + prefs
src/features/onboarding/, src/features/history/, src/features/about/ → wizard, runs, updates
src/components/{ErrorBoundary,WorkLoader,TitleBar}, src/lib/ → primitives
```

## Code Style
Preserve reducer-purity + `role=alert/status` + zod-guarded bridge style:
```tsx
// Errors that block the user get role=alert; progress gets role=status — see WorkflowWorkspace.tsx:53,157
{error && <p role="alert">{friendlyErrorMessage(error, t)}</p>}
```
Conventions: `workflowReducer` is the only state writer; every `invoke` awaited with try/catch → `setError`; no hardcoded UI strings (use `t()`); RTL via `document.dir` + Drawer position flip.

## Testing Strategy
- Vitest DOM: reducer transitions, consent matrix, degrade banners, review edit, settings failure rollback, history error states, i18n key parity.
- Playwright e2e: drop→consent→review→generate→done, offline ESC path, keyboard-only review, Arabic RTL snapshot.
- Every fix gets a regression test; `en.ts`/`ar.ts` must stay key-identical (existing `update-i18n.test.ts` pattern).

## Boundaries
- Always: preserve cancel protocol (`WorkerCancelledError` + `AbortError`), consent gating (`online→analyze(true)`, `ask→requestConsent`), `reviseClassification source:'user'`, zod `flatMap` drop-crash defense; add `role=alert` where missing; report manual SR/keyboard gaps.
- Ask first: changing consent defaults, changing provider list, new keyboard shortcuts, worker timeout values.
- Never: weaken consent; bypass review traceability; swallow `invoke` rejections with `.catch(()=>undefined)`; add hardcoded English/Arabic strings.

## Success Criteria
- [ ] C1 fixed: `WorkflowWorkspace.tsx:35-39` consent names Gemini/Grok correctly (no Anthropic fall-through) + matrix test for codex/compatible/anthropic/gemini/grok/none.
- [ ] C2 fixed: `PackageSummaryList.tsx:42` flagged wash renders (`aria-flagged`/`data-flagged` set) or dead variant removed + test.
- [ ] C3 fixed: `FileUpload.tsx:29,124-132` reject announces via `role=alert`/`aria-live` + test.
- [ ] C4 fixed: `reducer.ts:40-94` illegal transitions guarded (view-aware) + tests for showReview-from-done, requestConsent-from-review, updateData-in-idle.
- [ ] C5 fixed: `useBoqWorkflow.ts:289,321-324` concurrent handleFile/analyze guarded (prior worker cancelled, stale completion ignored) + double-drop test.
- [ ] C6 fixed: double `discardRevision` on non-preserved failure removed (single discard) + test.
- [ ] C7 fixed: `useBoqWorkflow.ts:463-471` generate catch checks run-id/reset before `showReview` + test.
- [ ] C8 fixed: all `void setSetting`/`changeLanguage`/`selectProvider`/`persistStep` handle rejection with rollback + tests (no `unhandledrejection`).
- [ ] C9 fixed: `AboutModal.tsx:125`, `LiveDemo.tsx:57,79-80,88`, `Onboarding.tsx:131` use `t()` keys; dead keys removed or wired + i18n test.
- [ ] C10 fixed: `HistoryDrawer.tsx:27-30` load failure shows error (not `emptyHistory`); corrupt rows logged via `appLog` + tests.
- [ ] C11 fixed: open actions (`WorkflowWorkspace.tsx:166,178`, `HistoryDrawer.tsx:113,125`) surface errors + tests.
- [ ] C12 fixed: `TitleBar.tsx:21-35` Alt+ shortcuts ignored in inputs + `e.repeat` guard + tests.
- [ ] C13 fixed: review edits append to `trace` (`human-review edited`), retry-after-discard starts clean trace + tests.
- [ ] `lint`, `typecheck`, DOM tests, e2e smoke green; `en/ar` key parity holds.

## Open Questions
1. Consent ESC/backdrop (`WorkflowWorkspace.tsx:64` `onClose→onConsent(false)` auto-offline): keep safe-default or require explicit Offline/Cancel choice? Default: explicit choice (no surprise run).
2. `processingMode` staleness when settings open during drop: refresh on every `handleFile` or block drops while modal open?
3. LiveDemo `pointer-events-none` + tour audio: keep synthetic `RevisionOutput` or drive real publish path?
4. `WP-99` label hardcode (`useBoqWorkflow.ts:67`) vs `t('unclassified')`: enforce catalog invariant or always render via `t()`?
5. Number formatting `en-EG` vs `ar-EG` digits: Latin or Arabic-Indic digits expected?

## Assumptions
1. Radix dialog focus-trap is trusted; fixes add missing live-regions, not replace modals.
2. `aiSkipped = source!=='llm'` accounting and offline `0/false` forcing are intentional.
3. `react-window` 44px virtualization stays; focus-restore added, not list rewrite.

## Decisions recorded (implementation)
- Consent ESC/backdrop: unchanged (still `onConsent(false)` auto-offline); flagged as product follow-up, not silently changed.
- `processingMode` staleness + LiveDemo replay race + RTL grid + `en-EG` digits: unverified, listed as follow-ups.
- Review-edit trace uses `human-review/completed` ("Item N reassigned to CODE") — `AgentEvent.status` has no `edited` variant and the shared contract was left untouched.
- `WP-99` label still hardcoded in `changeClassification` fallback; catalog invariant assumed.

## Residual round (2026-09-17, all fixed)
- Consent requires explicit choice (ESC/backdrop close disabled); mode re-read at drop time; corrupt dates render "unknown date" (shared `formatRunDate`); WP-99 fallback bilingual via fixed translators; LiveDemo replay guarded with `throwIfAborted`.
- Missing tests added: cp1256 CSV, reserved filenames, Invalid Date, multi-page provenance. RTL PDF untestable headless (Helvetica lacks Arabic glyphs); virtual-list focus + en-EG digits remain manual-QA follow-ups.
- `PipelineData`/`PendingInspection` carry `fileHash` instead of `bytes` (hash-before-transfer).
