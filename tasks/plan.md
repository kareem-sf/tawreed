# Plan: Tawreed reliability review — all modules

Source specs: `SPEC-document-engine.md`, `SPEC-desktop-host.md`, `SPEC-app-workflow.md`, `SPEC-delivery-checks.md`.
Capability order (from `CAPABILITY-MAP.md`): document-engine + desktop-host → app-workflow → delivery-checks.
Verification bar (human-selected): full `npm run check` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test` (per `README.md` Development section).

## 1. Major components & dependencies

### Wave 1A — document-engine (no cross-module deps)
- `engine/normalize.ts`: EU `1.250,50` parse (C11). Pure, no dependents blocked.
- `engine/validate.ts`: two-sided `RATE_OUTLIER` (C3). Affects review counts only.
- `engine/ingest/xlsx.ts` + `extract.ts` + `rows.ts` + `headers.ts`: warning text (C1), header-vs-summary qty guard (C6). Touches ingest pipeline; keep `fixtures.ts` green.
- `engine/generate.ts`: `locale` honor-or-remove (C2, decision). Affects RTL snapshots.
- `engine/pdf-ingest.ts` + `inspect-document.ts`: Node OCR-skip warning (C4). Affects `edge-cases` test expectation (currently asserts no warning — must update intentionally).
- `engine/agent-workflow.ts`: memory conflict/overcount/clobber (C5). Affects `agent-workflow.test.ts`.
- `engine/document-intelligence.ts`: `normalizedKey` parity (C7), agent language input parity (C10).
- `engine/spreadsheet-reader.ts`: blank-row provenance (C8).
- `engine/classify/llm.ts`: duplicate `itemId` guard (C9).

### Wave 1B — desktop-host (no cross-module deps, parallel with 1A)
- `src-tauri/src/store.rs` + `commands/credentials.rs`: delete-false-success (D1), settings-corrupt backup (S5→decision), `app_log` caps (D13).
- `commands/revisions.rs` + `store.rs`: session↔revision binding (D2), preserve-vs-wipe (D3 decision), artifact count+total caps (D4), backslash report (D5).
- `commands/system.rs`: symlink + CSV oracle + size cap (D6).
- `update.rs` + `AboutModal.tsx`: digest display-or-remove (D7).
- `commands/ai/anthropic.rs`: redirect + response cap parity (D9).
- `codex.rs`: case-sensitive dedup (D10).
- `commands/history.rs`: unknown-fields + truncate policy + trace caps (D11, D12).
- `features/workflow/errors.ts`: map 256KB + revision/artifact errors (D8).

### Wave 2 — app-workflow (depends on 1A + 1B contracts)
- Needs `error_contract.rs` strings stable (D8) + `REVIEW_CONFIDENCE_THRESHOLD` unchanged + `itemTotal` unchanged before editing `useBoqWorkflow`, `ReviewPanel`, `errors.ts`.
- `WorkflowWorkspace.tsx`: consent labels (C1), open-action errors (C11), ESC/backdrop decision.
- `reducer.ts` + `useBoqWorkflow.ts`: illegal-transition guards (C4), concurrency guard (C5), single-discard (C6), stale-resurrect guard (C7), trace audit (C13).
- `GeneralPreferences.tsx`, `useProviderSetup.ts`, `useNamedProviderSetup.ts`, `Onboarding.tsx`: settings rejection handling (C8).
- `AboutModal.tsx`, `LiveDemo.tsx`, `Onboarding.tsx`: i18n hardcodes (C9).
- `HistoryDrawer.tsx` + `bridge.ts`: error-vs-empty + corrupt-row logging (C10).
- `PackageSummaryList.tsx`, `FileUpload.tsx`, `TitleBar.tsx`: flagged attr (C2), live-region (C3), shortcut scope (C12).

### Wave 3 — delivery-checks (depends on 1A+1B+2 file locations staying stable)
- `release-please-config.json`: remove `release-as` (C1) — do last-after-version-gates to avoid tag confusion; verify `verify-version` still passes.
- `package.json` + `eslint.config.js` + `tsconfig.json`: lint/typecheck scope (C2, C3).
- `scripts/verify-*.cjs`: install-policy fallback (C4), vendor bidirectional (C5), notices core (C6), dist guard (C7), commands quoting (C12), docs scope (C13).
- `docs/RELEASING.md`, `README.md`: sync description (C10), check-vs-CI contract (C8).
- `index.html` + `tauri.conf.json` + CSP gate: fonts (C11).
- `.github/dependabot.yml`: ignore-list parity (C9).

## 2. Implementation order
1. Wave 1A + 1B in parallel (different owners, no shared files except `errors.ts`/`error_contract.rs` — sequence D8 after any Rust message change).
2. Wave 2 after 1A/1B green (consumes contracts).
3. Wave 3 after 2 (touches gates that verify 1–2).
4. Within each wave: pure/bilingual-text fixes first (C1, C3, C11, D8, C9-app), then state/IO/transport (C4–C6, D1–D6, D9–D13, C4-app–C8-app), then gate hardening (C2–C13-delivery).

## 3. Risks & mitigations
| Risk | Mitigation |
|---|---|
| C4 test currently asserts *no* warning — fix flips expectation | Update `edge-cases-ocr-and-language.test.ts:100-122` intentionally + note in PR |
| D2/D3 revision semantics change breaks existing revisions | Additive validation only; never migrate old `output/` layout; manual two-instance test |
| D6 symlink guard breaks legit picker paths | Canonicalize + allow under user-selected parent; keep `open_*` confinement tests green |
| C5 memory strictness breaks `agent-workflow.test.ts` overcount expectations | Update `applied` semantics + tests together; keep `WP-99` exclusion |
| C1-delivery `release-as` removal triggers unexpected minor bump | Remove in isolated commit; run `verify-version` + `sync:version --dry-run` if available before/after |
| C11 fonts/CSP breaks offline-first typography | Prefer self-host; visual check in Tauri webview (not just browser) |
| Full `check` + Rust gates slow (~10+ min) | Run fast `lint/typecheck/vitest` per-slice; full `check` at wave boundaries + final |

## 4. Parallel vs sequential
- Parallel: 1A ↔ 1B (no shared runtime files); within waves, text-only fixes ↔ transport fixes (different files).
- Sequential: `error_contract.rs` → `errors.ts` → `verify-commands`; `revisions.rs` D2 → D3 → D4 (same publish path); `reducer.ts` guards → `useBoqWorkflow` concurrency → trace audit; any gate change → run that gate standalone → then `check`.

## 5. Verification checkpoints
- After each slice: targeted `vitest` file(s) + `eslint` on touched files + `tsc --noEmit` (or `cargo test <module>` for Rust).
- After Wave 1A: `npm test -- tests/ingest validate normalize generate pdf-ingest classify* document-* agent-workflow encrypted universal edge-cases offline-knowledge pipeline` + `eval` floors.
- After Wave 1B: `cargo fmt --check`, `clippy -D warnings`, `cargo test --locked`, `verify:commands`, `verify:bindings`, `bridge.dom` + `workflow-errors` tests.
- After Wave 2: DOM suite + `playwright test` smoke + `ar` RTL snapshot + key-parity check.
- After Wave 3: each `verify-*` standalone via `node scripts/*.cjs` (Windows-safe) + `test:coverage` + `build` + `verify:assets/notices/version`.
- Final: full `npm run check` + Rust trio per README; `git status` clean except intended `SPEC-*`, `tasks/`, source + tests.
