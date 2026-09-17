# Tasks: autonomous-pipeline (SPEC-autonomous-pipeline.md, tasks/plan-autonomous.md)

Convention: one task = one focused session, ≤5 files, explicit acceptance + verify.
Order: A + B → C → D + E → F → final gate.

## Slice A — Trust store

- [x] Task [autonomous]: Rust settings allowlist + validation for auto-pilot trust list
  - Acceptance: valid shape accepted; bad version / missing trusted / empty key / overlong key / missing grantedAt / >200 entries rejected; missing key reads as empty (deny by default)
  - Verify: `cargo test --locked` (76 passed, incl. new allowlist test) + `verify:bindings` green
  - Files: `src-tauri/src/store.rs`

- [x] Task [autonomous]: Typed trust helpers over existing settings bridge (zero new commands)
  - Acceptance: tolerant parse (malformed → []); exact-match finder; `verify:commands` untouched (43/43)
  - Verify: `npm test -- tests/bridge.dom.test.ts` (11 passed) + `verify:commands` green
  - Files: `src/bridge.ts`, `tests/bridge.dom.test.ts`

## Slice B — Verdict

- [x] Task [autonomous]: Machine-clean verdict function + tests
  - Acceptance: clean iff zero errors + zero WP-99 + zero LOW_CONFIDENCE (bilingual reasons); warnings-only → clean; stale-list WP-99 belt-and-braces
  - Verify: `npm test -- tests/autonomous-pipeline.test.ts` (5 passed)
  - Files: `engine/autopilot.ts` (new), `tests/autonomous-pipeline.test.ts` (new)

## Slice C — Auto path

- [x] Task [autonomous]: handleFile trust branch + auto-publish-or-hold
  - Acceptance: trusted drop skips consent (grant in trace); clean → generate + publish + done (hook-tested); unclean → review with reasons; untrusted byte-identical (consent kept); revoke re-checked before publish (hook-tested hold); `generate(overrideData)` reuse (no second publish path); `useBoqWorkflow` budget re-pinned 516→584 with justification
  - Verify: `tests/autonomous-workflow.dom.test.ts` (4 passed: publish/hold/revoke/unclean) + degradation suite green + `typecheck`/`lint` clean
  - Files: `src/features/workflow/useBoqWorkflow.ts`, `src/features/workflow/types.ts`, `tests/autonomous-workflow.dom.test.ts` (new)

## Slice D — Trust UI

- [x] Task [autonomous]: History trust action + Settings trust list + scope text + i18n
  - Acceptance: history two-step arm→grant with scope tooltip + trusted indicator; settings list with revoke + rollback; 9 new keys, en+ar parity
  - Verify: `tests/autonomous-ui.dom.test.tsx` (4 passed: banner ×2, list + revoke + rollback) + full suite parity green
  - Files: `src/features/history/HistoryDrawer.tsx`, `src/features/settings/AutopilotSetup.tsx` (new), `src/features/settings/SettingsModal.tsx`, `src/i18n/resources/en.ts`, `src/i18n/resources/ar.ts`, `src/features/workflow/components/WorkflowWorkspace.tsx` (consent tip line)

## Slice E — Hold banner

- [x] Task [autonomous]: Held-for-review banner + trace marker
  - Acceptance: `role=status` banner with bilingual reasons; auto runs identifiable via `published by auto-pilot` trace event (no schema change); consent event records grant basis
  - Verify: `tests/autonomous-ui.dom.test.tsx` + hook tests asserting heldReasons/marker
  - Files: `src/features/review/ReviewPanel.tsx`, `src/features/workflow/types.ts` (`autoPilot` + `heldReasons`)

## Slice F — Docs

- [x] Task [autonomous]: Rewrite human-review assertions with auto-pilot exceptions
  - Acceptance: README (What-it-does + trust model + new section), USER-GUIDE (intro, review step, new section), PRIVACY (grant coverage) rewritten with spec links; consent modal gains tip line; `docs/superpowers/*` historical artifacts untouched
  - Verify: `npm run verify:docs` green (in full check)
  - Files: `README.md`, `docs/USER-GUIDE.md`, `docs/PRIVACY.md`, consent tip in `WorkflowWorkspace.tsx`

## Final gate
- [x] Task: Full verification + report
  - Acceptance: `npm run check` exit 0 + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test --locked` (76) + coverage ratchets green; budgets re-pinned only with justification; stray shadcn files (not ours, broke gate) removed under explicit approval
  - Verify: `npm run check` exit 0 — 31 files / 240 tests; `cargo` trio green; coverage Stmts 63.2% / Branch 58.2% / Funcs 49.1% / Lines 64.6%
  - Files: `tasks/plan-autonomous.md`, `tasks/todo-autonomous.md`, `SPEC-autonomous-pipeline.md`
