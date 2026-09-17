# Plan: autonomous-pipeline (SPEC-autonomous-pipeline.md)

Verification bar: full `npm run check` + `cargo fmt --check` + `cargo clippy -D warnings` + `cargo test --locked`, same as the mainline.

## 1. Major components & dependencies

### Slice A — Trust store (Rust + types, no deps)
- `src-tauri/src/store.rs`: `ALLOWED_SETTINGS` += `autopilot`; `validate_setting` shape-checks `{ version: 1, trusted: [{ projectKey, projectName, grantedAt }] }` (key format = `memoryKey` output: ≤1000 chars, non-empty; `grantedAt` ISO string; cap list at 200 entries).
- `src/bridge.ts` (only if needed): typed helpers `getAutopilotTrust()` / `setAutopilotTrust()` over existing `getSettings`/`set_setting` — **zero new Tauri commands** (keeps `verify:commands` untouched).
- Rust `#[test]`: accept valid shape, reject bad version/overlong key/malformed entry/oversize list.

### Slice B — Machine-clean verdict (pure engine, no deps, parallel with A)
- `engine/validate.ts` (or new `engine/autopilot.ts` if it outgrows ~40 lines): `autopilotVerdict(issues, classifications) → { clean: boolean; reasons: string[] }` — clean iff zero `error` issues, zero `WP-99`, zero `LOW_CONFIDENCE`. Reasons are bilingual message keys, not freetext.
- Vitest: clean pipeline → clean; each blocker (ZERO_QTY, UNCLASSIFIED_ITEMS, WP-99 present, low-confidence present) → unclean with reason; warnings-only (mismatch/outlier/dupe/negative) → clean.

### Slice C — Auto path in workflow (depends on A + B)
- `useBoqWorkflow.handleFile`: after inspect, resolve `memoryKey(projectName)` → trust lookup → trusted ? `analyze(pending, true)` with auto marker : today's consent flow.
- After analyze: verdict → clean ? proceed to `generate()` programmatically : `showReview` + held-for-review reasons.
- Guards: re-check grant immediately before publish (revoke mid-flight → hold); existing `runIdRef`/`generatingRef` cover concurrency; trace records grant basis + `auto-pilot` marker event; `recordRun` unchanged (identifiable via marker).
- Tests in `tests/autonomous-pipeline.test.ts` (reducer-level + verdict integration with mocked bridge where needed).

### Slice D — Trust UI (depends on A; parallel with C)
- History row: "Trust this project" action (project name known) → writes grant with scope confirm.
- Settings: trusted list with per-entry revoke + scope text; `en`/`ar` keys (parity suite covers).
- Consent modal copy: one line noting auto-pilot exists for trusted projects (docs link, no behavior change).

### Slice E — Hold-for-review banner (depends on C)
- `ReviewPanel`: banner (`role=status`) listing held reasons when `data` carries them; extends `PipelineData` with `heldReasons: string[] | null` (type-only change, no Rust schema change).

### Slice F — Docs rewrite (depends on C–E settled)
- README trust model, USER-GUIDE review flow, PRIVACY consent scope, consent-modal docs: every human-review assertion gains its auto-pilot exception, each linking this spec. `verify:docs` must stay green.

## 2. Implementation order
1. A + B in parallel (no shared files).
2. C (consumes A verdict shape + B verdict fn).
3. D + E in parallel (D needs A shape; E needs C's held-reasons plumbing).
4. F after behavior frozen.
5. Within slices: types/store first, then logic, then UI, then tests last per TDD? No — TDD: failing test first per slice (repo convention).

## 3. Risks & mitigations
| Risk | Mitigation |
|---|---|
| `useBoqWorkflow.ts` at budget 516/516 — auto path adds lines | Compact first; re-pin with justification only if genuinely over (precedent exists, rule stands) |
| Revoke mid-flight publishes anyway | Re-check grant immediately before `writeRevisionBundle`; revocation also discards pending auto state |
| Double-publish on retry/double-drop | Existing `generatingRef` + run-id guards + revision-session binding already cover; auto path reuses `generate()`, no second publish path |
| Name-key collisions across clients | Documented warning in scope text + one-click revoke (spec default); lineage keying is a follow-up, not this build |
| Old settings without `autopilot` key | Tolerant read: missing → empty trust list (deny by default); `validate_setting` rejects malformed, never migrates silently |
| Provider outage mid-auto-run | Falls into existing fallbacks → verdict unclean → notify + queue (failure fails into review, per spec assumption) |
| New settings key breaks `verify:bindings` | No Rust struct change (settings are `serde_json::Value`), only allowlist + validation; `cargo test` covers |

## 4. Parallel vs sequential
- Parallel: A ↔ B; D ↔ E (after their deps).
- Sequential: A+B → C → (D,E) → F. `store.rs` validation → settings UI. Verdict fn → auto path. Auto path → banner + docs.

## 5. Verification checkpoints
- After A: `cargo test --locked` (new allowlist tests) + `verify:bindings` (no drift).
- After B: `npm test -- tests/autonomous-pipeline.test.ts` (verdict cases).
- After C: DOM suite + full `npm test`; manual trusted drop → done, untrusted → consent, revoke mid-flight → hold.
- After D+E: `update-i18n`-style parity (full suite covers), `lint`, `typecheck`.
- After F: `verify:docs` + full `npm run check` + Rust trio + coverage ratchets.
