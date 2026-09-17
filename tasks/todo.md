# Tasks: Tawreed reliability review

Convention: one task = one focused session, ≤5 files, explicit acceptance + verify.
Order follows `tasks/plan.md`: Wave 1A + 1B → Wave 2 → Wave 3. Do not skip verification.
Module ids: `document-engine`, `desktop-host`, `app-workflow`, `delivery-checks`.

## Wave 1A — document-engine

- [x] Task [document-engine]: Fix number/validation correctness (C11 EU parse, C3 two-sided outlier)
  - Acceptance: `parseNumber('1.250,50')===1250.5`; `RATE_OUTLIER` flags |z|>2.5 both sides with bilingual message accurate
  - Verify: `npm test -- tests/normalize.test.ts tests/validate.test.ts` — PASS (28 tests)
  - Files: `engine/normalize.ts`, `engine/validate.ts`, `tests/normalize.test.ts`, `tests/validate.test.ts`

- [x] Task [document-engine]: Fix ingest messaging + header/row guards (C1 warning text, C6 header-with-qty)
  - Acceptance: no-unit-column warning no longer claims exclusion; description `Quantity/Rate/Amount` + qty rows preserved
  - Verify: `npm test -- tests/ingest.test.ts` — PASS (17 tests)
  - Files: `engine/ingest/xlsx.ts`, `engine/ingest/extract.ts`, `engine/ingest/rows.ts`, `tests/ingest.test.ts`

- [x] Task [document-engine]: Fix memory + LLM identity guards (C5 conflicts/overcount/clobber, C9 duplicate itemId)
  - Acceptance: conflicting memory keeps first; `applied` only on real change; `source:'user'` never overwritten; duplicate LLM `itemId` keeps first
  - Verify: `npm test -- tests/agent-workflow.test.ts tests/classify.test.ts` — PASS (18 tests)
  - Files: `engine/agent-workflow.ts`, `engine/classify/llm.ts`, `tests/agent-workflow.test.ts`, `tests/classify.test.ts`

- [x] Task [document-engine]: Fix i18n/RTL + PDF seams (C2 locale, C7 normalizedKey, C10 agent language, C4 Node OCR warning, C8 blank-row provenance)
  - Acceptance: `locale:'ar'` alone yields RTL; `ٱ/ئ/ؤ` dedup parity; post-agent language includes comments; Node OCR-skip warns; tolerant reader preserves blanks
  - Verify: `npm test -- tests/generate.test.ts tests/document-intelligence.test.ts tests/document-agent.test.ts tests/pdf-ingest.test.ts tests/edge-cases-ocr-and-language.test.ts tests/universal-ingest.test.ts` — PASS (76 tests)
  - Files: `engine/generate.ts`, `engine/document-intelligence.ts`, `engine/document-agent.ts`, `engine/pdf-ingest.ts`, `engine/spreadsheet-reader.ts`

## Wave 1B — desktop-host

- [x] Task [desktop-host]: Fix credential + settings safety (D1 delete-false-success, settings backup, D13 app_log caps)
  - Acceptance: `delete_api_key` Errs when keyring unavailable; corrupt `settings.json` backed up + logged; `app_log` 8KB cap + `log_line` truncation
  - Verify: `cargo test --locked` — PASS (73 tests)
  - Files: `src-tauri/src/store.rs`, `src-tauri/src/commands/credentials.rs`, `src-tauri/src/commands/system.rs`

- [x] Task [desktop-host]: Fix revision publish integrity (D2 session binding, D3 preserve-vs-wipe, D4 artifact caps, D5 separator mismatch)
  - Acceptance: session prefix bound to revision; startup sweep only removes >24h orphans; 64-artifact + 1GB-total caps; reported paths separator-normalised
  - Verify: `cargo test --locked revisions` — PASS
  - Files: `src-tauri/src/commands/revisions.rs`, `src-tauri/src/store.rs`, `src-tauri/src/error_contract.rs`

- [x] Task [desktop-host]: Fix transport + history IPC (D6 symlink/CSV/size, D9 Anthropic parity, D11/D12 history caps, D10 dedup case)
  - Acceptance: symlinks refused + post-read size check; Anthropic `Policy::none` + 10MB cap + redirect reject; `deny_unknown_fields` parity; trace-event + string caps; Unix dedup case-sensitive
  - Verify: `cargo test --locked` — PASS
  - Files: `src-tauri/src/commands/system.rs`, `src-tauri/src/commands/ai/anthropic.rs`, `src-tauri/src/commands/history.rs`, `src-tauri/src/codex.rs`

- [x] Task [desktop-host]: Fix error mapping to UI (D8 256KB + revision/artifact branches, D7 digest decision)
  - Acceptance: `friendlyErrorMessage` passes 256KB + all revision/artifact/history errors verbatim; `asset_sha256` rendered via `t('updateChecksum')`
  - Verify: `npm test -- tests/workflow-errors.test.ts tests/bridge.dom.test.ts tests/update-i18n.test.ts` — PASS
  - Files: `src/features/workflow/errors.ts`, `src-tauri/src/error_contract.rs`, `src/features/about/AboutModal.tsx`, `src/i18n/resources/en.ts`, `src/i18n/resources/ar.ts`

## Wave 2 — app-workflow (after 1A+1B green)

- [x] Task [app-workflow]: Fix consent + i18n + list semantics (C1 provider labels, C9 hardcodes, C2 flagged attr, C3 live-region, C12 shortcut scope)
  - Acceptance: consent matrix codex/compatible/anthropic/gemini/grok/none correct; zero hardcoded UI strings (4 new keys, en+ar parity); flagged wash renders; reject announces; Alt+ ignored in inputs
  - Verify: `npm test -- tests/review-panel.test.tsx tests/accessibility-ui.test.ts tests/bridge.dom.test.ts tests/consent-provider.test.ts` — PASS
  - Files: `src/features/workflow/components/WorkflowWorkspace.tsx`, `src/features/review/PackageSummaryList.tsx`, `src/features/workflow/components/FileUpload.tsx`, `src/components/TitleBar.tsx`, `src/features/about/AboutModal.tsx`, `src/features/onboarding/Onboarding.tsx`, `src/features/onboarding/LiveDemo.tsx`, `src/i18n/resources/en.ts`, `src/i18n/resources/ar.ts`, `tests/consent-provider.test.ts`

- [x] Task [app-workflow]: Fix state + concurrency integrity (C4 guards, C5 double-handleFile, C6 double-discard, C7 stale resurrect)
  - Acceptance: illegal reducer transitions no-op; concurrent handleFile cancels prior + stale completion ignored; single discard; no resurrect after reset
  - Verify: `npm test -- tests/workflow-reducer.test.ts tests/workflow-degradation.dom.test.ts` — PASS
  - Files: `src/features/workflow/reducer.ts`, `src/features/workflow/useBoqWorkflow.ts`, `tests/workflow-reducer.test.ts`

- [x] Task [app-workflow]: Fix persistence + audit feedback (C8 settings rejections, C10 history error state, C11 open-action errors, C13 trace audit)
  - Acceptance: settings failures roll back with error; history load failure shows error + logs corrupt rows; open failures surface; review edits append to trace
  - Verify: `npm test` full suite — PASS (202 tests)
  - Files: `src/features/settings/GeneralPreferences.tsx`, `src/features/settings/useProviderSetup.ts`, `src/features/settings/useNamedProviderSetup.ts`, `src/features/onboarding/Onboarding.tsx`, `src/features/history/HistoryDrawer.tsx`, `src/bridge.ts`, `src/features/workflow/useBoqWorkflow.ts`, `src/features/workflow/components/WorkflowWorkspace.tsx`

## Wave 3 — delivery-checks (after Wave 2)

- [x] Task [delivery-checks]: Fix version + docs contract (C1 release-as, C10 sync text, C8 check-vs-CI, C9 dependabot)
  - Acceptance: `release-as` absent + `verify-version` green; RELEASING sync text correct + pin section removed; README documents CI-only coverage/e2e; dependabot covers all 34 direct deps
  - Verify: `npm run verify:version` — PASS
  - Files: `release-please-config.json`, `docs/RELEASING.md`, `README.md`, `package.json`, `.github/dependabot.yml`

- [x] Task [delivery-checks]: Fix gate coverage (C2 lint scope, C3 typecheck scope, C4 install-policy fallback, C12 commands quoting, C13 docs scope)
  - Acceptance: lint+typecheck cover configs/scripts (caught real `URL` import bug in vite.config.ts); standalone `node` gate run passes; commands gate handles quotes/nested generics/block comments; docs gate covers SUPPORT/.github/notices
  - Verify: `node scripts/verify-install-script-policy.cjs`, `node scripts/verify-commands.cjs`, `node scripts/verify-docs.cjs`, `npm run lint`, `npm run typecheck` — PASS
  - Files: `package.json`, `eslint.config.js`, `tsconfig.json`, `vite.config.ts`, `scripts/verify-install-script-policy.cjs`, `scripts/verify-commands.cjs`, `scripts/verify-docs.cjs`

- [x] Task [delivery-checks]: Fix asset + CSP integrity (C5 bidirectional, C6 tesseract-core, C7 dist guard, C11 fonts)
  - Acceptance: deleted wasm/cmap fails `verify-vendor-assets`; notices track `tesseract.js-core`; missing `dist/` fails unless `--skip-dist`; CSP allows Google Fonts
  - Verify: `npm run build && npm run verify:assets && npm run verify:notices` — PASS
  - Files: `scripts/verify-vendor-assets.cjs`, `scripts/verify-notices.cjs`, `index.html`, `src-tauri/tauri.conf.json`, `THIRD_PARTY_NOTICES.md`

## Final gate (all modules)
- [x] Task: Full verification + report
  - Acceptance: `npm run check` chain + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test --locked` green; `test:coverage` ratchets hold; `git status` shows only intended files
  - Verify: see Final verification below
  - Files: `tasks/plan.md`, `tasks/todo.md`, `SPEC-*.md`

### Final verification (2026-09-17)
- `npm test`: 25 files passed, 1 skipped; 202 tests passed, 1 skipped (baseline was 186 passed — +16 new regression tests)
- `npm run test:coverage`: thresholds hold (Stmts 60.0%, Branch 55.1%, Funcs 47.1%, Lines 61.1%)
- `npm run lint`, `npm run typecheck`: clean
- `cargo test --locked`: 73 passed, 0 failed
- `cargo fmt --check`, `cargo clippy -D warnings`: clean
- `verify:architecture/commands/bindings/docs/install-scripts/vendor-assets/notices/version`: all green
- `npm run build`: clean (41s)
- NOT run: `playwright test` e2e (needs browsers + dev server; CI-owned per README), two-instance revision race + headless-keyring + 100MB memory profiles (manual)
